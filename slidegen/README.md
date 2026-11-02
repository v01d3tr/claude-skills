# slidegen

Voice-over + script → animated, game-styled slide video, synced word by word to the narration (1920×1080, 30 fps).

| file | role |
|---|---|
| `script.py` | parses the script's `[n]` slide marks, `[file.mp4]` media and `[description]` tokens; maps them onto the recording |
| `align.py` | word-level transcription (Parakeet TDT v3 via sherpa-onnx) → `words.json`, `transcript.txt` |
| `render.mjs` | renders `spec.json` with Playwright Chromium + ffmpeg: `--cues`, `--preview`, `--board` (6 directions), `--budget` (resumable), segment cache |
| `template.html` | slide engine: 6 base themes, layouts `hero`, `icons`, `cards`, `feature` (+ `figure`), `meter`, `stats`, `media` |
| `icons.py` | official WoW icons (GitHub dump WeakThorr/wowinterfaceicons) |
| `assets.py` | finds game art in GitHub repos (search / ls / readme / get) |

Setup:
```bash
npm install
pip install --break-system-packages sherpa-onnx soundfile numpy
curl -sSL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2 | tar xj -C ~/models   # set PARAKEET=<dir>/ if not /home/claude/models/…
```
Playwright with Chromium and ffmpeg must be available.

Workflow and spec format: see the `voice-to-slides` skill. Example: `examples/dark-souls-bronie/`.

Game icons and art fetched by the tools belong to their publishers; use under the publishers' fan-content terms.
