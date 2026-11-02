"""Official WoW interface icons (64x64 PNG, Wowhead file names) from the GitHub dump WeakThorr/wowinterfaceicons.

usage: python3 icons.py find frostbolt frost_nova          # list matching names
       python3 icons.py get proj/icons spell_frost_frostbolt02 classicon_mage ...   # extract to a folder
"""
import sys, os, subprocess, zipfile, tempfile, shutil

ZIP = os.environ.get("WOWICONS", "/home/claude/wowicons/icons.zip")

def ensure():
    if os.path.exists(ZIP):
        return
    os.makedirs(os.path.dirname(ZIP), exist_ok=True)
    tmp = tempfile.mkdtemp()
    subprocess.run(["git", "clone", "-q", "--depth", "1", "https://github.com/WeakThorr/wowinterfaceicons", tmp], check=True)
    shutil.move(os.path.join(tmp, "icons.zip"), ZIP)
    shutil.rmtree(tmp, ignore_errors=True)

ensure()
z = zipfile.ZipFile(ZIP)
names = {os.path.basename(n)[:-4].lower(): n for n in z.namelist() if n.lower().endswith(".png")}
cmd = sys.argv[1]
if cmd == "find":
    for k in sys.argv[2:]:
        hits = sorted(n for n in names if k.lower() in n)
        print(f"{k}: {len(hits)}  " + " ".join(hits[:40]))
elif cmd == "get":
    out = sys.argv[2]; os.makedirs(out, exist_ok=True)
    for k in sys.argv[3:]:
        k = k.lower().removesuffix(".png").removesuffix(".jpg")
        if k not in names:
            print(f"MISSING {k}", file=sys.stderr); continue
        open(os.path.join(out, k + ".png"), "wb").write(z.read(names[k]))
        print(os.path.join(out, k + ".png"))
