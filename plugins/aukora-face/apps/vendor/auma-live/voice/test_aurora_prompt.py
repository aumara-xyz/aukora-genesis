# SPDX-License-Identifier: AGPL-3.0-or-later
"""Court: the sidecar looks for `aurora-prompt.wav` where setup.sh writes it (defect C).

Keyless: stdlib only (no numpy, no venv), run by scripts/check.sh as `python3 <this file>`.
Measured on a fresh Mac: setup.sh wrote the prompt under `<state>/auma-live/voice/models/`, the sidecar looked in
`voice/models/` beside sidecar.py, and logged "aurora clone off: no prompt wav" for a file that existed.

Arms (each RED on the commit before the fix):
  C1  setup.sh's own resolution (the lines are EXECUTED, not restated) and aurora_prompt.setup_models_dir agree for every env shape.
  C2  find_prompt finds a prompt written where setup.sh writes it, with MODELS empty; and prefers it over MODELS.
  C3  MODELS is still the fallback when setup's directory has none; nothing found says every path tried.
  C4  sidecar.py resolves the prompt through find_prompt (structural: importing sidecar needs numpy).

`--mutate` runs the arms against a copy of this folder with one protection removed and requires each to go RED.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SUBJECT = os.environ.get('AUKORA_COURT_VOICE_DIR', HERE)
sys.path.insert(0, SUBJECT)

MUTATIONS = [
    ('the sidecar never asks where setup wrote the prompt (defect C)', 'aurora_prompt.py',
     "    return [os.path.join(setup_models_dir(env), 'aurora-prompt.wav'),\n            os.path.join(os.path.abspath(models), 'aurora-prompt.wav')]",
     "    return [os.path.join(os.path.abspath(models), 'aurora-prompt.wav')]", 'C2'),
    ('the default state directory drifts from setup.sh', 'aurora_prompt.py',
     "STATE_DEFAULT = '~/Library/Application Support/AUKORA/state'", "STATE_DEFAULT = '~/Library/Application Support/AUKORA'", 'C1'),
    ('AUMA_LIVE_VOICE_MODELS is ignored', 'aurora_prompt.py',
     "    explicit = env.get('AUMA_LIVE_VOICE_MODELS')", "    explicit = None", 'C1'),
    ('the MODELS fallback is dropped', 'aurora_prompt.py',
     "            os.path.join(os.path.abspath(models), 'aurora-prompt.wav')]", "            ]", 'C3'),
    ('sidecar.py goes back to MODELS only', 'sidecar.py',
     'prompt, tried = find_prompt(MODELS)', 'prompt, tried = (os.path.join(MODELS, "aurora-prompt.wav"), [])', 'C4'),
    ('prompt lookup accepts directories', 'aurora_prompt.py',
     'os.path.isfile(path)', 'os.path.exists(path)', 'C5'),
    ('prompt lookup follows a symbolic link', 'aurora_prompt.py',
     ' and not os.path.islink(path)', '', 'C5'),
]


def setup_sh_models_dir(env):
    """Run the resolution lines OUT OF setup.sh itself, so this court cannot drift from what setup really does."""
    text = open(os.path.join(SUBJECT, 'setup.sh'), encoding='utf-8').read()
    start = text.index('_voice_models = os.environ.get')
    end = text.index('os.makedirs(_voice_models', start)
    snippet = 'import os\n' + text[start:end] + 'print(_voice_models)\n'
    run = subprocess.run([sys.executable, '-c', snippet], env=env, capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    return run.stdout.strip()


def arms():
    try:
        import aurora_prompt
    except ImportError as error:
        return [(name, f'aurora_prompt.py is missing ({error}): the sidecar has no shared resolution with setup.sh') for name in ('C1', 'C2', 'C3', 'C4')]
    results = []

    def arm(name):
        def wrap(fn):
            try:
                fn()
                results.append((name, None))
            except Exception as error:  # noqa: BLE001 - report the arm, keep going
                results.append((name, f'{type(error).__name__}: {error}'.splitlines()[0]))
            return fn
        return wrap

    @arm('C1')
    def _():
        home = tempfile.mkdtemp()
        base = {'PATH': os.environ.get('PATH', ''), 'HOME': home}
        for extra in ({}, {'AUKORA_STATE_DIR': '/x/state'}, {'AUMA_LIVE_VOICE_MODELS': '/y/models'},
                      {'AUKORA_STATE_DIR': '/x/state', 'AUMA_LIVE_VOICE_MODELS': '/y/models'},
                      {'AUKORA_STATE_DIR': '', 'AUMA_LIVE_VOICE_MODELS': ''}):
            env = {**base, **extra}
            saved = os.environ.copy()
            os.environ.clear(); os.environ.update(env)  # expanduser reads HOME from os.environ
            try:
                mine = aurora_prompt.setup_models_dir(env)
            finally:
                os.environ.clear(); os.environ.update(saved)
            theirs = os.path.abspath(setup_sh_models_dir(env))
            assert mine == theirs, f'{extra}: sidecar side {mine} != setup.sh {theirs}'
        shutil.rmtree(home)

    @arm('C2')
    def _():
        state = tempfile.mkdtemp(); models = tempfile.mkdtemp()
        written = os.path.join(state, 'auma-live', 'voice', 'models')
        os.makedirs(written)
        open(os.path.join(written, 'aurora-prompt.wav'), 'wb').write(b'RIFF')
        found, tried = aurora_prompt.find_prompt(models, {'AUKORA_STATE_DIR': state})
        assert found == os.path.join(written, 'aurora-prompt.wav'), f'not found where setup writes it; tried {tried}'
        # and it wins over a stale copy beside the sidecar
        open(os.path.join(models, 'aurora-prompt.wav'), 'wb').write(b'RIFF')
        found, _ = aurora_prompt.find_prompt(models, {'AUKORA_STATE_DIR': state})
        assert found == os.path.join(written, 'aurora-prompt.wav')
        shutil.rmtree(state); shutil.rmtree(models)

    @arm('C3')
    def _():
        state = tempfile.mkdtemp(); models = tempfile.mkdtemp()
        env = {'AUKORA_STATE_DIR': state}
        found, tried = aurora_prompt.find_prompt(models, env)
        assert found is None and len(tried) == 2, f'nothing on disk must say both paths: {tried}'
        open(os.path.join(models, 'aurora-prompt.wav'), 'wb').write(b'RIFF')
        found, _ = aurora_prompt.find_prompt(models, env)
        assert found == os.path.join(models, 'aurora-prompt.wav'), 'the MODELS fallback is gone'
        shutil.rmtree(state); shutil.rmtree(models)

    @arm('C4')
    def _():
        text = open(os.path.join(SUBJECT, 'sidecar.py'), encoding='utf-8').read()
        assert 'from aurora_prompt import find_prompt' in text, 'sidecar.py does not import find_prompt'
        assert re.search(r'prompt, tried = find_prompt\(MODELS\)', text), 'sidecar.py does not resolve the prompt through find_prompt'
        assert 'os.path.join(MODELS, "aurora-prompt.wav")' not in text, 'sidecar.py still looks only in MODELS'

    @arm('C5')
    def _():
        with tempfile.TemporaryDirectory() as scratch:
            setup = os.path.join(scratch, 'setup')
            models = os.path.join(scratch, 'models')
            os.makedirs(setup); os.makedirs(models)
            env = {'AUMA_LIVE_VOICE_MODELS': setup}
            prompt = os.path.join(setup, 'aurora-prompt.wav')
            os.mkdir(prompt)
            assert aurora_prompt.find_prompt(models, env)[0] is None, 'a directory was accepted as a prompt'
            os.rmdir(prompt)
            target = os.path.join(scratch, 'synthetic.wav')
            open(target, 'wb').write(b'RIFF')
            os.symlink(target, prompt)
            assert aurora_prompt.find_prompt(models, env)[0] is None, 'a symbolic link was accepted as a prompt'
            fallback = os.path.join(models, 'aurora-prompt.wav')
            open(fallback, 'wb').write(b'RIFF')
            assert aurora_prompt.find_prompt(models, env)[0] == fallback, 'a refused candidate suppressed the regular-file fallback'

    return results


def main():
    if '--mutate' in sys.argv:
        plain = subprocess.run([sys.executable, os.path.abspath(__file__)], capture_output=True, text=True)
        assert plain.returncode == 0, 'the court is ALREADY RED without a mutation:\n' + plain.stdout + plain.stderr
        missed = 0
        for label, name, old, new, expect in MUTATIONS:
            scratch = tempfile.mkdtemp()
            try:
                copy = os.path.join(scratch, 'voice')
                shutil.copytree(HERE, copy, ignore=shutil.ignore_patterns('.venv', 'models', '__pycache__'))
                target = os.path.join(copy, name)
                body = open(target, encoding='utf-8').read()
                assert old in body, f'MUTATION INVALID: {name} no longer contains {old!r}'
                open(target, 'w', encoding='utf-8').write(body.replace(old, new, 1))
                run = subprocess.run([sys.executable, os.path.abspath(__file__)], capture_output=True, text=True,
                                     env={**os.environ, 'AUKORA_COURT_VOICE_DIR': copy})
                said = run.stdout + run.stderr
                if run.returncode == 0:
                    missed += 1; print(f'MUTATION NOT CAUGHT: {label}')
                elif f'FAIL {expect}' not in said:
                    missed += 1; print(f'MUTATION MISATTRIBUTED: {label} (wanted {expect}):\n{said}')
                else:
                    print(f'MUTATION caught by {expect}: {label}')
            finally:
                shutil.rmtree(scratch, ignore_errors=True)
        again = subprocess.run([sys.executable, os.path.abspath(__file__)], capture_output=True, text=True)
        assert again.returncode == 0, 'the court is red after the mutations, which must be impossible'
        print('ALL %d MUTATIONS CAUGHT' % len(MUTATIONS) if missed == 0 else '%d MUTATION(S) NOT CAUGHT' % missed)
        return 1 if missed else 0
    failed = 0
    for name, problem in arms():
        print(('PASS ' if problem is None else 'FAIL ') + name + ('' if problem is None else ': ' + problem))
        failed += problem is not None
    print('ALL ARMS PASSED' if failed == 0 else '%d ARM(S) FAILED' % failed)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
