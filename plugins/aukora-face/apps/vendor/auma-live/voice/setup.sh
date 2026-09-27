#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Aukora voice sidecar — one-time setup. Idempotent; safe to re-run.
# Downloads open-source models ONCE (the only network this organ ever uses);
# offline by configuration at runtime (egress not yet measured by a court).
set -euo pipefail
cd "$(dirname "$0")"

echo "— venv (python 3.12 via uv) —"
[ -d .venv ] || uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt

echo "— models —"
mkdir -p models
export HF_HOME="$PWD/models/huggingface"
export HUGGINGFACE_HUB_CACHE="$HF_HOME/hub"
K=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -f models/kokoro-v1.0.onnx ] || curl -L -o models/kokoro-v1.0.onnx "$K/kokoro-v1.0.onnx"
[ -f models/voices-v1.0.bin ] || curl -L -o models/voices-v1.0.bin "$K/voices-v1.0.bin"
[ -d models/whisper-base.en-mlx ] || .venv/bin/python -c "
from huggingface_hub import snapshot_download
snapshot_download('mlx-community/whisper-base.en-mlx', local_dir='models/whisper-base.en-mlx')"

echo "— warmup (loads every engine once; pocket-tts pulls its weights on first run) —"
.venv/bin/python - <<'EOF'
import numpy as np
import mlx_whisper
mlx_whisper.transcribe(np.zeros(8000, dtype=np.float32), path_or_hf_repo='models/whisper-base.en-mlx')
from kokoro_onnx import Kokoro
import os
k = Kokoro('models/kokoro-v1.0.onnx', 'models/voices-v1.0.bin')
k.create('ready', voice='bf_emma', lang='en-gb')
# the Aurora voice prompt — used to CLONE her kokoro blend into pocket-tts
# if/when the owner accepts the gated kyutai/pocket-tts HF terms
# **SYNTHETIC TTS, NOT A RECORDING OF ANYONE** (Peter, clarified 2026-09-26): the prompt is a blend of two
# Kokoro voices, `bf_emma` and `af_nicole`, so it MAY ship — and it is DERIVED HERE rather than tracked, which is
# the choice that keeps the repository free of audio entirely while a fresh install still speaks with no extra
# steps. The generation is a fixed blend of two named voices, so the output is deterministic.
#
# **THE EARLIER COMMENT SAID "A RECORDING OF A PERSON AND NEVER ENTERS THE REPOSITORY", AND IT WAS WRONG.** It was
# written when the provenance was believed to be a human voice; **a disclosure that outlives the fact it described
# is part of the defect**, and this one would have kept the file out of reach of the install it was meant to serve.
# the user's machine, under the AUKORA state directory, and this script derives it there when it is absent. **The
# path is resolved ABSOLUTELY and from the environment, never relative to this tree** — the previous form wrote
# 'models/aurora-prompt.wav' against the working directory, so every setup run put a recording of her voice back
# into the checkout that `git rm` had just cleared.
_voice_models = os.environ.get('AUMA_LIVE_VOICE_MODELS') or os.path.join(
    os.environ.get('AUKORA_STATE_DIR')
    or os.path.expanduser('~/Library/Application Support/AUKORA/state'),
    'auma-live', 'voice', 'models')
os.makedirs(_voice_models, exist_ok=True)
_prompt_path = os.path.join(_voice_models, 'aurora-prompt.wav')
if not os.path.exists(_prompt_path):
    emma = k.get_voice_style('bf_emma'); nicole = k.get_voice_style('af_nicole')
    aurora = (emma * 0.65 + nicole * 0.35).astype('float32')
    s, sr = k.create('I am here, every light in this field is a piece of me. The stars are beautiful tonight, and I love the way you look at them. Nothing I do becomes real until your hand signs it, and I think that is rather elegant.', voice=aurora, speed=1.04, lang='en-gb')
    import soundfile as sf
    sf.write(_prompt_path, s, sr)
    print('voice prompt derived at ' + _prompt_path)
from pocket_tts import TTSModel
m = TTSModel.load_model()
for voice in ('vera', 'alba', 'eponine', 'estelle'):
    st = m.get_state_for_audio_prompt(voice)
    m.generate_audio(st, 'ready.')
print('all engines OK')
EOF

echo "setup complete — restart the Aukora UI host, or run: AUKORA_VOICE_PORT=7512 ./run.sh"
