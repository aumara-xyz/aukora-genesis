# SPDX-License-Identifier: AGPL-3.0-or-later
"""Where the Aurora clone prompt (`aurora-prompt.wav`) is looked for.

`setup.sh` derives the prompt into `$AUMA_LIVE_VOICE_MODELS`, else
`<$AUKORA_STATE_DIR or ~/Library/Application Support/AUKORA/state>/auma-live/voice/models/`, and the sidecar used to look
only in `MODELS` (`$AUKORA_VOICE_MODELS_DIR` or `voice/models/` beside sidecar.py), so a fresh install that ran setup.sh
never found the file it had just written and the clone stayed off with "no prompt wav".

This module is stdlib-only on purpose: the sidecar imports it, and `test_aurora_prompt.py` (a keyless check) imports it
without numpy, kokoro or a venv.
"""
import os

STATE_DEFAULT = '~/Library/Application Support/AUKORA/state'


def setup_models_dir(env=None):
    """The directory `setup.sh` writes into: same env keys, same default, made absolute."""
    env = os.environ if env is None else env
    explicit = env.get('AUMA_LIVE_VOICE_MODELS')
    if explicit:
        return os.path.abspath(explicit)
    state = env.get('AUKORA_STATE_DIR') or os.path.expanduser(STATE_DEFAULT)
    return os.path.abspath(os.path.join(state, 'auma-live', 'voice', 'models'))


def prompt_candidates(models, env=None):
    """Both places the prompt may be, in order: where setup writes it, then the sidecar's own MODELS."""
    return [os.path.join(setup_models_dir(env), 'aurora-prompt.wav'),
            os.path.join(os.path.abspath(models), 'aurora-prompt.wav')]


def find_prompt(models, env=None):
    """Return `(path, tried)`: the first candidate that exists (else None), and every path that was tried."""
    tried = prompt_candidates(models, env)
    for path in tried:
        if os.path.isfile(path) and not os.path.islink(path):
            return path, tried
    return None, tried
