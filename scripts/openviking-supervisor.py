#!/usr/bin/env python3
"""Foreground owner of OpenViking and its memory-bounded embedder."""

import ctypes
import errno
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time


class SetupError(Exception):
    """A safe diagnostic containing no configuration contents or key material."""


def say(message):
    print(f"openviking-setup: {message}", file=sys.stderr, flush=True)


def positive_integer(value, name):
    if isinstance(value, bool) or not re.fullmatch(r"[1-9][0-9]*", str(value)):
        raise SetupError(f"{name} must be a positive integer")
    return int(value)


def command(name):
    found = shutil.which(name, path=os.environ.get("PATH", os.defpath) + ":/usr/sbin")
    if not found:
        raise SetupError(f"{name} is required")
    return found


def capture(args):
    # run() kills and reaps its short-lived child on timeout, including during shutdown.
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          text=True, timeout=2, check=False)


def stop_child(child, immediate=False):
    if child is None or child.returncode is not None:
        return
    memory = MacMemory()

    def send(sig):
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            pass
        except PermissionError:
            # Darwin returns EPERM for a group containing only zombies. They
            # still reserve its ID, but need reaping, not another signal.
            if memory.group_alive(child.pid):
                raise

    # Keep the leader unreaped until the entire group has been signalled. This
    # reaches surviving workers without risking a recycled PID/process group.
    if not immediate:
        send(signal.SIGTERM)
        # Observe the whole group: the leader can exit before a worker flushes.
        deadline = time.monotonic() + 5
        while memory.group_alive(child.pid) and time.monotonic() < deadline:
            time.sleep(0.05)
    send(signal.SIGKILL)
    child.wait(timeout=5)


class MacMemory:
    # Darwin sys/resource.h, rusage_info_v0. Unlike RSS, physical footprint
    # includes compressed/swapped dirty allocations. The old 8 GiB prompt
    # cache could therefore exhaust this Mac while ps reported only 1.2 GiB.
    class Usage(ctypes.Structure):
        _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [
            (name, ctypes.c_uint64) for name in (
                "user_time", "system_time", "idle_wakeups", "interrupt_wakeups",
                "pageins", "wired_size", "resident_size", "phys_footprint",
                "start_abstime", "exit_abstime")]

    def __init__(self):
        self.lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        self.lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        self.lib.proc_pid_rusage.restype = ctypes.c_int
        self.lib.proc_listpgrppids.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
        self.lib.proc_listpgrppids.restype = ctypes.c_int

    def group_alive(self, pgid):
        pids = (ctypes.c_int * 4096)()
        count = self.lib.proc_listpgrppids(pgid, pids, ctypes.sizeof(pids))
        if count < 0 or count >= len(pids):
            raise OSError("could not enumerate child process group")
        for pid in pids[:count]:
            try:
                if self.usage(pid).exit_abstime == 0:
                    return True
            except OSError as error:
                if error.errno != errno.ESRCH:
                    raise
        return False

    def usage(self, pid):
        usage = self.Usage()
        if self.lib.proc_pid_rusage(pid, 0, ctypes.byref(usage)) != 0:
            raise OSError(ctypes.get_errno(), "could not sample child memory")
        return usage

    def exited(self, child):
        # poll()/wait() would reap the leader before group cleanup. Darwin keeps
        # this exit timestamp available for our unreaped child instead.
        if child.returncode is not None:
            return True
        try:
            return self.usage(child.pid).exit_abstime != 0
        except OSError as error:
            if error.errno == errno.ESRCH:
                return True
            raise

    def sample(self, pid):
        usage = self.usage(pid)
        return usage.resident_size // 1024, usage.phys_footprint // 1024


class Supervisor:
    def __init__(self, home):
        self.home = Path(home)
        if not self.home.is_absolute():
            raise SetupError("HOME must be an absolute path")
        with (self.home / "aukora-bridge.json").open() as source:
            embedding = json.load(source)["embedding"]
        self.port = positive_integer(embedding["port"], "embedding.port")
        if self.port > 65535:
            raise SetupError("embedding.port must be at most 65535")
        self.context = positive_integer(embedding["context"], "embedding.context")
        self.model = embedding["model"]
        if not isinstance(self.model, str) or not self.model or not Path(self.model).is_file():
            raise SetupError("embedding.model must name an existing model file")
        self.limit = positive_integer(os.environ.get("AUKORA_OPENVIKING_EMBED_RSS_MIB", "1536"),
                                      "AUKORA_OPENVIKING_EMBED_RSS_MIB") * 1024
        self.llama, self.lsof = (command(name) for name in ("llama-server", "lsof"))
        self.memory = MacMemory()
        self.embed = self.ov = None
        self.readiness = threading.Event()
        self.ready_cancel = threading.Event()
        self.ready_thread = None
        self.stopping = threading.Event()
        self.exit_signal = 0
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, self.on_signal)

    def on_signal(self, sig, _frame):
        # Do not raise between Popen and assignment: every child must reach cleanup.
        self.exit_signal = sig
        self.stopping.set()

    def start_embed(self):
        # Refuse an existing listener on every start. The ownership check below also
        # closes the bind/check race; a different server's health cannot make us ready.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as guard:
            guard.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                guard.bind(("127.0.0.1", self.port))
                guard.listen(1)
            except OSError:
                raise SetupError(f"embedding port {self.port} unavailable; refusing to adopt a server") from None
        batch = str(min(512, self.context))
        # output_reserve retains vocab * batch float logits even for pooled embeddings;
        # large batches also retain Metal buffers. LAST pooling supports splitting
        # a full-context input into these smaller batches without truncating it.
        # cache-ram 0 disables the default 8192 MiB heap prompt cache; a single
        # slot's prefix KV stays context-bounded. Keep mmap and f16 KV quality.
        args = [self.llama, "-m", self.model, "--embedding", "--pooling", "last",
                "--host", "127.0.0.1", "--port", str(self.port), "-c", str(self.context),
                "-b", batch, "-ub", batch, "--parallel", "1", "--cache-ram", "0", "--mmap",
                "--cache-type-k", "f16", "--cache-type-v", "f16", "--alias", "qwen3-embedding-0.6b"]
        # Explicit arguments govern the service. Inherited generation-server
        # defaults such as mlock or a different load mode must not undo the bound.
        env = {key: value for key, value in os.environ.items() if not key.startswith("LLAMA_ARG_")}
        env.pop("AUKORA_OPENVIKING_ROOT_KEY", None)
        # A restart truncates the existing log; there are no accumulating archives.
        with (self.home / "embed.log").open("wb") as log:
            self.embed = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT,
                                          env=env, start_new_session=True)
        self.readiness = threading.Event()
        self.ready_cancel = threading.Event()
        self.ready_thread = threading.Thread(target=self.wait_ready,
                                             args=(self.embed.pid, self.readiness, self.ready_cancel),
                                             daemon=True)
        self.ready_thread.start()

    def ready(self, pid):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=1)
        try:
            connection.request("GET", "/health")
            if connection.getresponse().status != 200:
                return False
        except (OSError, http.client.HTTPException):
            return False
        finally:
            connection.close()
        try:
            owner = capture([self.lsof, "-nP", "-a", "-p", str(pid),
                             f"-iTCP@127.0.0.1:{self.port}", "-sTCP:LISTEN", "-t"])
        except (OSError, subprocess.TimeoutExpired):
            return False
        return owner.returncode == 0 and owner.stdout.strip() == str(pid)

    def wait_ready(self, pid, ready, cancel):
        # HTTP and lsof can block. Keep them off the memory-sampling loop, and
        # bind readiness to this generation so an old probe cannot ready a new PID.
        while not cancel.is_set():
            if self.ready(pid):
                ready.set()
                return
            cancel.wait(1)

    def stop_embed(self, immediate=False):
        self.ready_cancel.set()
        stop_child(self.embed, immediate=immediate)
        if self.ready_thread is not None:
            self.ready_thread.join(timeout=4)
        self.ready_thread = None

    def start_ov(self):
        env = os.environ.copy()
        env["AUKORA_OPENVIKING_HOME"] = str(self.home)
        # Read only at runtime, never into shell arguments or supervisor output.
        env["AUKORA_OPENVIKING_ROOT_KEY"] = (self.home / "root.key").read_text().strip()
        if not env["AUKORA_OPENVIKING_ROOT_KEY"]:
            raise SetupError("root.key is empty")
        self.ov = subprocess.Popen([str(self.home / "venv/bin/openviking-server"),
                                    "--config", str(self.home / "ov.conf")],
                                   env=env, start_new_session=True)

    def run(self):
        failures, start_at, restart = 0, 0, None
        while not self.stopping.is_set():
            if self.ov is not None and self.memory.exited(self.ov):
                stop_child(self.ov)
                say(f"OpenViking exited (status {self.ov.returncode})")
                return self.ov.returncode if self.ov.returncode >= 0 else 128 - self.ov.returncode
            now = time.monotonic()
            if self.embed is None:
                if now < start_at:
                    self.stopping.wait(min(0.2, start_at - now))
                    continue
                self.start_embed()
                if restart:
                    say(f"embedding restart {restart} new_pid={self.embed.pid}")
                else:
                    say(f"embedding starting pid={self.embed.pid} rss_limit_mib={self.limit // 1024}")
                ready_at, last_rss, last_footprint = None, None, None
                deadline, next_rss = time.monotonic() + 120, 0

            reason = None
            try:
                if self.memory.exited(self.embed):
                    self.stop_embed(immediate=True)
                    reason = f"exit_status={self.embed.returncode}"
                elif time.monotonic() >= next_rss:
                    next_rss = time.monotonic() + 2
                    last_rss, last_footprint = self.memory.sample(self.embed.pid)
                    if max(last_rss, last_footprint) > self.limit:
                        reason = "memory_limit_exceeded"
            except OSError:
                reason = "memory_sample_failed"
            if self.stopping.is_set():
                break
            if reason is None and ready_at is None:
                if self.readiness.is_set():
                    ready_at = time.monotonic()
                    say(f"embedding server up on 127.0.0.1:{self.port} (pid {self.embed.pid})")
                    if self.ov is None and not self.stopping.is_set():
                        self.start_ov()
                elif time.monotonic() >= deadline:
                    reason = "readiness_timeout"
            if reason:
                restart = (f"reason={reason} old_pid={self.embed.pid} "
                           f"last_rss_kib={last_rss if last_rss is not None else 'unavailable'} "
                           f"last_footprint_kib={last_footprint if last_footprint is not None else 'unavailable'}")
                # Sampled protection, not a hard cap: bursts can overshoot and a
                # restart may interrupt a request. Keep OV through normal recycling;
                # repeated failures stop the pair for the outer service manager.
                self.stop_embed(immediate=reason.startswith("memory_"))
                self.embed = None
                if self.stopping.is_set():
                    break
                failures += 1
                if failures > 5:
                    raise SetupError(f"{restart}; embedder restart limit reached")
                delay = min(2 ** failures, 30)
                say(f"embedding stopped {restart}; retry_in_seconds={delay}")
                start_at = time.monotonic() + delay
                continue
            if ready_at is not None and time.monotonic() - ready_at >= 300:
                # A sustained healthy run earns a fresh five-restart allowance.
                failures = 0
            self.stopping.wait(0.2)
        return 128 + self.exit_signal

    def close(self):
        failed = False
        for child in (self.ov, self.embed):
            try:
                if child is self.embed:
                    self.stop_embed()
                else:
                    stop_child(child)
            except (OSError, subprocess.TimeoutExpired):
                failed = True
                say(f"cleanup failed for pid={child.pid}; no replacement started")
        return failed


def main():
    supervisor = None
    result = 1
    try:
        if len(sys.argv) != 2:
            raise SetupError("usage: openviking-supervisor.py HOME")
        supervisor = Supervisor(sys.argv[1])
        result = supervisor.run()
    except SetupError as error:
        say(str(error))
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        # Do not dump config, child output or exception payloads that might contain a key.
        say(f"supervisor failed ({type(error).__name__}); check configuration and embed.log")
    finally:
        if supervisor is not None and supervisor.close():
            result = 1
    return result


if __name__ == "__main__":
    sys.exit(main())
