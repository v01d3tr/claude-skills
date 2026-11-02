"""Parse the user's script and map its [tokens] onto the recording.

Tokens in square brackets:
  [3]                     slide boundary: slide 3 runs from here to the next number
  [boss.mp4] [mapa.png]   user-supplied media file shown from this point
  [any other text]        description of an image/clip Claude must find and show from this point

usage: python3 script.py split script.txt              -> sections.json + overview (works before recording)
       python3 script.py align script.txt words.json   -> marks.json {key: {t, i, conf}} for spec "mark"
Keys: "3" for [3], "m:boss.mp4" for files, "d:1", "d:2"... for descriptions in order.
"""
import sys, os, re, json, unicodedata
from difflib import SequenceMatcher

TOKEN = re.compile(r"\[([^\[\]]+)\]")
MEDIA = re.compile(r"^[^/\\]+\.(png|jpe?g|webp|gif|mp4|mov|webm|mkv|m4v|avi)$", re.I)

def norm(w):
    w = unicodedata.normalize("NFD", w.lower().replace("ł", "l"))
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if unicodedata.category(c) != "Mn"))

def parse(path):
    text = open(path, encoding="utf-8-sig").read()
    words, events, ndesc, pos = [], [], 0, 0
    for m in TOKEN.finditer(text):
        words += text[pos:m.start()].split()
        v = m.group(1).strip()
        if v.isdigit():
            key, kind = v, "mark"
        elif MEDIA.match(v):
            key, kind = "m:" + v, "media"
        else:
            ndesc += 1; key, kind = f"d:{ndesc}", "desc"
        events.append({"key": key, "kind": kind, "value": v, "pos": len(words)})
        pos = m.end()
    words += text[pos:].split()
    for e in events:
        e["context"] = " ".join(words[e["pos"]:e["pos"] + 10])
    return words, events

def sections(words, events):
    marks = [e for e in events if e["kind"] == "mark"]
    out = []
    if not marks:
        return [{"mark": None, "text": " ".join(words), "events": [e["key"] for e in events]}]
    if marks[0]["pos"] > 0:
        out.append({"mark": "0", "text": " ".join(words[:marks[0]["pos"]]), "events": []})
    for a, b in zip(marks, marks[1:] + [None]):
        end = b["pos"] if b else len(words)
        inside = [e["key"] for e in events if e["kind"] != "mark" and a["pos"] <= e["pos"] < end]
        out.append({"mark": a["value"], "text": " ".join(words[a["pos"]:end]), "events": inside})
    return out

cmd, script = sys.argv[1], sys.argv[2]
words, events = parse(script)
base = os.path.dirname(os.path.abspath(script))

if cmd == "split":
    secs = sections(words, events)
    json.dump({"events": events, "sections": secs}, open(os.path.join(base, "sections.json"), "w"), ensure_ascii=False, indent=1)
    print(f"{len(words)} words, ~{len(words) / 2.4 / 60:.1f} min of speech, {len(secs)} sections" + ("" if any(e['kind'] == 'mark' for e in events) else " (no [n] markers: split by topic)"))
    for s in secs:
        n = len(s["text"].split())
        print(f"\n[{s['mark']}] {n} words ~{n / 2.4:.0f}s  {' '.join(s['text'].split()[:16])}…")
        for k in s["events"]:
            e = next(x for x in events if x["key"] == k)
            print(f"    {e['kind']:5} {e['value']}  @ \"{e['context'][:60]}\"")
    missing = [e["value"] for e in events if e["kind"] == "media" and not os.path.exists(os.path.join(base, e["value"]))]
    if missing:
        print("\nMISSING media files (ask the user to attach):", ", ".join(missing))

elif cmd == "align":
    asr = json.load(open(sys.argv[3]))
    a, b = [norm(w) for w in words], [norm(w["w"]) for w in asr]
    sm = SequenceMatcher(None, a, b, autojunk=False)
    m = {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            m[blk.a + k] = blk.b + k
    print(f"script↔recording word match: {len(m) / max(1, len(a)):.0%}")
    res, prev_j = {}, -1
    for e in events:
        p = e["pos"]
        q = next((x for x in range(p, min(p + 40, len(a))) if x in m), None)
        if q is None:
            print(f"  {e['key']:>12}  NOT FOUND near \"{e['context'][:50]}\"  -> set its time by hand"); continue
        j = max(prev_j + 1, m[q] - (q - p))  # back up over unmatched leading words
        j = min(j, len(asr) - 1)
        win = [x for x in range(p, min(p + 8, len(a)))]
        conf = sum(1 for x in win if x in m) / max(1, len(win))
        res[e["key"]] = {"t": asr[j]["s"], "i": j, "conf": round(conf, 2)}
        prev_j = j
        flag = "" if conf >= .5 else "  <- low confidence, check"
        print(f"  {e['key']:>12}  {int(asr[j]['s'] // 60):02d}:{asr[j]['s'] % 60:05.2f}  \"{' '.join(w['w'] for w in asr[j:j + 7])}\"{flag}")
    json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[3])), "marks.json"), "w"), indent=1)
