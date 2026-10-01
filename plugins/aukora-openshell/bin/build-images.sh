#!/bin/sh
# Build the three local images the pinned OpenShell Docker driver needs, without pulling a registry:
#   aukora-openshell/workload:<tag>   the agent workload rootfs: bash + coreutils + their glibc, USER 1000, WORKDIR /sandbox
#   aukora-openshell/supervisor:<tag> the trusted supervisor (glibc base + openshell-supervisor)
#   aukora-openshell/sandbox:<tag>    the in-boundary runtime (openshell-sandbox)
# Usage: build-images.sh <dir-with-openshell-sandbox-and-openshell-supervisor> <tag>
# The binaries come from the pinned OpenShell source (see ../openshell-pin.json); this script never downloads.
set -eu
BIN=${1:?binary dir}; TAG=${2:?tag}
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
copy_with_libs() { # $1 rootfs, rest: absolute executables
  root=$1; shift
  for exe in "$@"; do
    mkdir -p "$root$(dirname "$exe")"; cp -L "$exe" "$root$exe"
    ldd "$exe" 2>/dev/null | awk '/=>/ {print $3} /^[ \t]*\// {print $1}' | while read -r lib; do
      [ -n "$lib" ] && [ -e "$lib" ] || continue
      mkdir -p "$root$(dirname "$lib")"; cp -L --update=none "$lib" "$root$lib"
    done
  done
}
base_etc() { # $1 rootfs
  mkdir -p "$1/etc" "$1/tmp" "$1/sandbox" "$1/proc" "$1/dev" "$1/run"
  chmod 1777 "$1/tmp"
  printf 'root:x:0:0::/root:/bin/false\nsandbox:x:1000:1000::/sandbox:/bin/bash\n' > "$1/etc/passwd"
  printf 'root:x:0:\nsandbox:x:1000:\n' > "$1/etc/group"
}
# workload
W=$work/workload; base_etc "$W"
# The driver extracts ONLY the openshell-sandbox binary from the runtime image and runs it inside this rootfs, so the
# workload must carry that binary's shared libraries too (glibc, libgcc_s, libm and the ELF interpreter).
copy_with_libs "$W" "$BIN/openshell-sandbox"; rm -f "$W$BIN/openshell-sandbox"
copy_with_libs "$W" /usr/bin/setsid /bin/bash /bin/sh /usr/bin/env /bin/cat /bin/ls /bin/echo /bin/sleep /bin/mkdir /bin/touch /usr/bin/id /bin/rm /usr/bin/stat /usr/bin/head /bin/grep /usr/bin/timeout /bin/kill /usr/bin/tr
chown -R 1000:1000 "$W/sandbox"
tar -C "$W" -cf "$work/workload.tar" .
docker import -c 'USER 1000:1000' -c 'WORKDIR /sandbox' -c 'ENTRYPOINT ["/bin/bash"]' "$work/workload.tar" "aukora-openshell/workload:$TAG" >/dev/null
# supervisor
S=$work/supervisor; base_etc "$S"
copy_with_libs "$S" "$BIN/openshell-supervisor"; mv "$S$BIN/openshell-supervisor" "$S/openshell-supervisor"
mkdir -p "$S/etc/ssl/certs"
tar -C "$S" -cf "$work/supervisor.tar" .
docker import -c 'ENTRYPOINT ["/openshell-supervisor"]' "$work/supervisor.tar" "aukora-openshell/supervisor:$TAG" >/dev/null
# sandbox runtime: the binary plus the glibc it needs (it executes inside the workload boundary)
R=$work/runtime; mkdir -p "$R"
copy_with_libs "$R" "$BIN/openshell-sandbox"; mv "$R$BIN/openshell-sandbox" "$R/openshell-sandbox"; chmod 0555 "$R/openshell-sandbox"
tar -C "$R" -cf "$work/runtime.tar" .
docker import -c 'USER 65532:65532' -c 'ENTRYPOINT ["/openshell-sandbox"]' "$work/runtime.tar" "aukora-openshell/sandbox:$TAG" >/dev/null
for i in workload supervisor sandbox; do docker image inspect --format "{{.Id}} aukora-openshell/$i:$TAG" "aukora-openshell/$i:$TAG"; done
