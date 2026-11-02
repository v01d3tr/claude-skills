"""Transcribe a voice recording with word-level timestamps.

usage: python3 align.py voice.wav words.json
Writes [{"w": "słowo", "s": start_sec, "e": end_sec}, ...] and a readable transcript.txt next to it.
"""
import sys, json, os, subprocess, tempfile, numpy as np, soundfile as sf, sherpa_onnx

M = os.environ.get("PARAKEET", "/home/claude/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/")
src, out = sys.argv[1], sys.argv[2]
SR = 16000

# decode anything ffmpeg understands to 16 kHz mono
with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-ac", "1", "-ar", str(SR), tmp.name], check=True)
    x, _ = sf.read(tmp.name, dtype="float32")

rec = sherpa_onnx.OfflineRecognizer.from_transducer(
    encoder=M + "encoder.int8.onnx", decoder=M + "decoder.int8.onnx", joiner=M + "joiner.int8.onnx",
    tokens=M + "tokens.txt", model_type="nemo_transducer", num_threads=os.cpu_count() or 2)

# chunks of 20–30 s, cut at the quietest 50 ms inside that range
win, pos, chunks = 800, 0, []
while pos < len(x):
    if len(x) - pos <= 30 * SR:
        chunks.append((pos, len(x))); break
    lo, hi = pos + 20 * SR, pos + 30 * SR
    e = np.convolve(x[lo:hi] ** 2, np.ones(win), "valid")
    cut = lo + int(np.argmin(e)) + win // 2
    chunks.append((pos, cut)); pos = cut

words = []
for a, b in chunks:
    s = rec.create_stream(); s.accept_waveform(SR, x[a:b]); rec.decode_stream(s)
    r = s.result
    off = a / SR
    durs = list(getattr(r, "durations", []) or [])
    for i, (tok, ts) in enumerate(zip(r.tokens, r.timestamps)):
        t = off + ts
        d = durs[i] if i < len(durs) else 0.08
        if tok.startswith("▁") or tok.startswith(" ") or not words:
            words.append({"w": tok.lstrip("▁ "), "s": round(t, 3), "e": round(t + d, 3)})
        else:
            words[-1]["w"] += tok
            words[-1]["e"] = round(t + d, 3)
    print(f"{off:7.1f}s  {r.text[:90]}", file=sys.stderr)

words = [w for w in words if w["w"]]
json.dump(words, open(out, "w"), ensure_ascii=False, indent=0)

# readable transcript: one line per ~12 s, with timestamps for writing cues
lines, cur, t0 = [], [], None
for w in words:
    if t0 is None: t0 = w["s"]
    cur.append(w["w"])
    if w["s"] - t0 > 12 and w["w"][-1:] in ".?!,":
        lines.append(f"[{int(t0//60):02d}:{t0%60:05.2f}] " + " ".join(cur)); cur, t0 = [], None
if cur: lines.append(f"[{int(t0//60):02d}:{t0%60:05.2f}] " + " ".join(cur))
open(os.path.join(os.path.dirname(os.path.abspath(out)), "transcript.txt"), "w").write("\n".join(lines) + "\n")
print(f"{len(words)} words", file=sys.stderr)
