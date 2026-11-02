"""Find real game art on GitHub (the only image source reachable from this sandbox besides package registries).

usage: python3 assets.py search "wow loading screens" "warcraft artwork"   # candidate repos (stars, size MB, description)
       python3 assets.py ls owner/repo [regex]                            # list image/video files in a repo (no download)
       python3 assets.py readme owner/repo                                # provenance: official dump or fan-made/modified?
       python3 assets.py get owner/repo outdir path/in/repo.png ...       # fetch only those files
Always look at a fetched image (Read) before using it, and tell the user where it came from.
"""
import sys, os, re, json, subprocess, shutil, urllib.parse, urllib.request

CACHE = "/home/claude/assets_cache"
IMG = re.compile(r"\.(png|jpe?g|webp|gif|blp|tga|mp4|webm|mov)$", re.I)

def repo_dir(repo):
    d = os.path.join(CACHE, repo.replace("/", "__"))
    if not os.path.exists(d):
        os.makedirs(CACHE, exist_ok=True)
        subprocess.run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout",
                        f"https://github.com/{repo}", d], check=True, timeout=300)
    return d

def files(repo):
    out = subprocess.run(["git", "-C", repo_dir(repo), "ls-tree", "-r", "--name-only", "HEAD"], capture_output=True, text=True, check=True).stdout
    return out.splitlines()

cmd = sys.argv[1]
if cmd == "search":
    for q in sys.argv[2:]:
        url = "https://api.github.com/search/repositories?" + urllib.parse.urlencode({"q": q, "sort": "stars", "per_page": 10})
        d = json.load(urllib.request.urlopen(url, timeout=20))
        print(f"== {q}")
        for r in d.get("items", []):
            print(f"  {r['full_name']}  ★{r['stargazers_count']}  {r['size'] / 1024:.0f} MB  | {(r['description'] or '')[:90]}")
elif cmd == "ls":
    pat = re.compile(sys.argv[3], re.I) if len(sys.argv) > 3 else None
    hits = [f for f in files(sys.argv[2]) if IMG.search(f) and (not pat or pat.search(f))]
    print(f"{len(hits)} files"); print("\n".join(hits[:300]))
elif cmd == "readme":
    d = repo_dir(sys.argv[2])
    names = [f for f in files(sys.argv[2]) if re.match(r"(?i)readme", os.path.basename(f))][:1]
    if names:
        subprocess.run(["git", "-C", d, "checkout", "-q", "HEAD", "--", names[0]], check=True)
        print(open(os.path.join(d, names[0]), errors="replace").read()[:3000])
elif cmd == "get":
    repo, out, paths = sys.argv[2], sys.argv[3], sys.argv[4:]
    d = repo_dir(repo); os.makedirs(out, exist_ok=True)
    subprocess.run(["git", "-C", d, "checkout", "-q", "HEAD", "--", *paths], check=True, timeout=600)
    for p in paths:
        dst = os.path.join(out, os.path.basename(p)); shutil.copy(os.path.join(d, p), dst); print(dst)
