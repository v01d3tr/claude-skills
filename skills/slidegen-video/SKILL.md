---
name: slidegen-video
description: Turn the user's script (.txt with [n] slide marks, [file] media and [description] tokens) and voice recording into a video of animated slides synced word-by-word to the narration, styled after the named game with its real icons/art.
---

# Script + voice → animated slides video (slidegen)

Inputs from the user (Michał):
- **script.txt** — the full narration text (may come pasted in the message). Square-bracket tokens:
  - `[1]`, `[2]`… — slide frames: slide n runs from `[n]` to `[n+1]`. Hard boundaries chosen by the user. If the script has none, split by topic (one thought per slide, ~10–40 s).
  - `[boss.mp4]`, `[mapa.png]` — a media file the user attaches; show it from that point of the narration.
  - `[any other text]`, e.g. `[obrazek z WoW pokazujący Lich Kinga]` — a description: find matching real content (see Assets) and show it from that point.
- **game name** — the look must reference this game directly or at least indirectly; icons/art must come from it (a file name like `ds_bronie` hints Dark Souls; confirm from the script).
- **voice recording** (any audio/video) — may arrive before or after the script; transcribe it as soon as it arrives.

Hard rule: **before rendering any video, show 6 game-flavoured visual directions on the user's own content and wait for their choice** (step 4). The board needs only the script.

Code: GitHub `v01d3tr/claude-skills`, folder `slidegen/` (README there lists the files). `script.py` tokens → sections → times · `align.py` Parakeet TDT v3 → words.json · `spec.json` written by Claude · `render.mjs` Playwright Chromium + ffmpeg (only moving windows captured, holds elsewhere, cached segments, boards) · `template.html` themes + layouts · `icons.py` official WoW icons · `assets.py` game art from GitHub. This skill's own source is `skills/slidegen-video/SKILL.md` in the same repo.

## 1. Setup (once per session; skip if /home/claude/slidegen/render.mjs exists)

1. Attach the repo with the add_repo tool (owner `v01d3tr`, repo `claude-skills`; `access: "push"` only if code changes will be pushed) and clone it exactly as the tool says, to `/home/claude/claude-skills`.
2. Install:
```bash
cp -r /home/claude/claude-skills/slidegen /home/claude/slidegen && cd /home/claude/slidegen && npm install
pip install -q --break-system-packages sherpa-onnx soundfile numpy
mkdir -p /home/claude/models && cd /home/claude/models && curl -sSL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2 | tar xj
```
If the repo can't be reached and the user attached `slidegen.zip`, unzip that to /home/claude/ instead. Playwright + Chromium are preinstalled. From the shell, HuggingFace, Wowhead, wikis, Fandom and game CDNs are blocked; GitHub (git, API search, releases) and npm/PyPI work.

## 2. Read the script

```bash
mkdir -p /home/claude/proj && cd /home/claude/proj && cp "<script upload>" script.txt   # or write the pasted text; plus any media files the user attached
python3 /home/claude/slidegen/script.py split script.txt   # sections, word counts, ~durations, media/description tokens, MISSING files
```
Missing media files → ask the user to attach them (continue meanwhile). If the recording is already there, run step 5's `align.py` + `script.py align` now: it shows which script parts were actually spoken — don't put unspoken content on slides.

## 3. Plan slides, find assets, write spec.json

The user prefers planning first: send a short outline (slide n → title, layout, key items, media) before polishing, unless they said to just go. The outline can go together with the style board (step 4).

- One slide per `[n]` frame. A `[file]`/`[description]` token inside a frame becomes a **media slide** starting at that word; if the frame continues > ~8 s after a clip ends, add a content slide after it (`"at": "<phrase>"`).
- Slide starts: `"mark": "3"` for `[3]`, `"mark": "m:boss.mp4"` for files, `"mark": "d:1"`… for descriptions in order (keys printed by `script.py`). Without `[n]` marks use `"at": "<first words of the topic>"`.
- Items cue on the word where the narrator names them: `"at": "<1–3 distinctive words>"` (fuzzy-matched; searched from the slide's start). Pick words ASR gets right (check transcript.txt), not mangled proper names.
- Titles ≤ ~26 chars (auto-shrunk), captions ≤ ~35, ≤ 5 icons per row, ≤ 4 cards (3 with a figure). Polish with correct diacritics; slides summarize, never transcribe. Spell names from the script, never from ASR.
- One entity per slide (weapon, class, boss, build) → `feature` layout; when the narration names a character/enemy/NPC, add its full-body `figure` on that cue (the user liked this).
- Look fields (`theme`, `vars`, `bgImage`, `fonts`) come from the direction the user picks in step 4.

Spec format (full working example: `slidegen/examples/dark-souls-bronie/spec.json`):
```json
{
  "series": "Dark Souls · najlepsze bronie PvE",
  "theme": "parchment", "vars": { "--accent": "#8c2a17" }, "bgImage": "art/Mapa_Lordran.webp", "fonts": ["marcellus-sc/400.css"],
  "boardThemes": [ /* the 6 directions, step 4 */ ],
  "audio": "voice.wav", "words": "words.json", "marks": "marks.json", "output": "out.mp4", "lead": 0.12,
  "slides": [
    { "mark": "1", "section": "1/4 Wstęp", "kicker": "Dark Souls · PvE", "title": "Najlepsze bronie", "layout": "icons",
      "items": [ { "icon": "icons/Zweihander.png", "tone": "fire", "label": "Zweihander", "caption": "siła" } ],
      "note": { "at": "według stylu", "text": "podział według stylu gry" } },
    { "mark": "3", "kicker": "Ulubieniec speedrunnerów", "title": "Black Knight Halberd", "layout": "feature",
      "feature": { "icon": "icons/Black Knight Halberd.png", "tone": "danger", "label": "BK Halberd", "caption": "quality / siła" },
      "figure": { "src": "art/black-knight-figure.jpg", "label": "Czarny Rycerz", "caption": "Darkroot Basin", "at": "czarnego rycerza" },
      "items": [ { "at": "czarnego rycerza", "icon": "icons/Black Knight Helm.png", "tone": "shadow", "label": "Drop z Czarnego Rycerza", "caption": "rzadki drop" } ] },
    { "mark": "m:boss.mp4", "layout": "media", "src": "boss.mp4", "caption": "Walka z bossem", "audio": true, "volume": 0.3, "clip": [12, 30] },
    { "mark": "d:1", "layout": "media", "src": "art/icc_raid.jpg", "kicker": "Raid", "title": "Icecrown Citadel", "kenburns": true },
    { "mark": "4", "layout": "meter", "items": [ { "at": "levelowanie", "value": 0.14, "tone": "nature", "label": "Levelowanie", "caption": "prosty i bezpieczny" } ] },
    { "at": "talenty", "layout": "stats", "items": [ { "at": "dziesiątym", "label": "10", "caption": "pierwszy punkt" } ] },
    { "at": "podsumowując", "layout": "hero", "kicker": "Podsumowanie", "title": "Szukamy magów", "subtitle": "serwer PvP, Horda" }
  ]
}
```
- Cue forms: `"at": "phrase"`, `"at": 12.5`, `{"at": "phrase", "offset": -0.3}`; `"mark"` (+ `"markLead"`, default 0.25 s). Un-cued items stagger in after the header; keep on-screen order = list order (use `offset` if a later item would cue earlier).
- Layouts: `hero` (big title + subtitle) · `icons` (row of tiles, label + caption; `off: true` greys + strikes) · `cards` (icon optional, caption, badge) · `feature` (`feature: {icon,label,caption,tone,at}` big tile left + cards right; optional `figure: {src,label,caption,at}` tall framed portrait rising in at its cue on the far right, `--fig-pos` = object-position) · `meter` (marker moves to each card's `value` 0–1, earlier cards dim; a second meter slide can continue) · `stats` (big numbers) · `media` (image or clip; optional title/kicker; `"fit": "full"`, `"contain": true`, `"kenburns": true`; clips: `"clip": [s,e]`, `"audio": true` + `volume` (default 0.35) mixes clip sound under the voice, else muted; `"mediaAt"` delays it).
- `tone`: arcane, fire, frost, nature, holy, shadow, danger, neutral.

### Assets — real content from the named game
- **WoW icons**: `python3 /home/claude/slidegen/icons.py find frostbolt lichking`; `icons.py get /home/claude/proj/icons <name>…` (64×64, ≈14k official icons from `WeakThorr/wowinterfaceicons`, non-commercial fan use). Mage specs: arcane `spell_holy_magicalsentry`, fire `spell_fire_firebolt02`, frost `spell_frost_frostbolt02`; bosses often `achievement_boss_*`. Unsure of a name → WebSearch "<spell> wowhead".
- **Other games / larger art**: `python3 /home/claude/slidegen/assets.py search "<game> icons" "<game> item icons" "<game> assets" "<game> wiki" "<game> fan site" "<game> landing page" "<game> loading screens"`; `assets.py readme owner/repo` (official dump vs fan-made); `assets.py ls owner/repo <regex>`; `assets.py get owner/repo /home/claude/proj/art <path>…`. Fan wiki / fan site / landing-page repos are the best source of screenshots, area art and character renders — grep with the subject in several languages (`black|knight|caballero|rycerz`). Also npm (`curl -s "https://registry.npmjs.org/-/v1/search?text=<game>%20icons&size=20"`).
- **Known sources** — WoW: `Jestokyzz/mod-loading-screen-16x9` (88 classic/TBC/WotLK loading screens 1920×1080, fan-remastered, with frame + logo), `Zogmaw/encounter-journal-images`. Dark Souls 1: `SlendyMawn/DarkSoulsItemIcons` (all DSR item icons, transparent PNG ~185 px, `Weapons/`, `Armor/`, `Consumables/`…), `ozankasikci/dark-souls-wiki` (`assets/images/{areas,armor,bosses,npcs,weapons,shields,rings,items}`; `armor/*-set.jpg` = full-body figure in the set, e.g. `black-knight-set.jpg` = Black Knight, 180×342 → upscale 3× Lanczos + light unsharp), `LeaGaj04/dark-souls-hub` (`public/`: bonfire 4K `44.jpg`, `Mapa_Lordran.webp`, `gwyn.jpg`, `artorias.jpg`, `solaire.jpg`, `OrnsteinSmough.jpg`), `ABDUSSALAM0005/dark-souls-ui` (`src/background.png` dark parchment, class renders).
- **Transparent item icons** (Souls style): game-wide `vars` `"--icon-crop": "0%", "--icon-pad": "7%", "--icon-fit": "contain", "--tile-bg": "radial-gradient(circle at 50% 42%,#2e2a25 0%,#141210 70%,#0a0908 100%)", "--tile-border": "#4d463c"`. WoW icons keep defaults (8% border crop).
- **Images with a game frame/logo** as a media slide: pre-crop to the art band with PIL (1920×1080 WotLK screens: `crop((437,340,1482,928))` → 1152×648); as `bgImage` use `--bgart-size: 200% auto; --bgart-pos: 50% 70%`. No logo may show.
- **Always Read every fetched image** and confirm it shows the subject. Never generate/draw a stand-in presented as game art; never image_search game characters.
- **Not found** → best real fallback (area art, armor-set figure, icon on a card) + list the gaps with links (WebSearch) so the user can attach files.
- Tell the user once where art came from (repo names; say when fan site/remaster) and that it is the publisher's IP under fan-content terms. game-icons.net (`gi:<name>`, CC BY 3.0, credit) only for generic concepts.

## 4. Style board — 6 game-flavoured directions, required before any render

Build `spec.boardThemes` (max 6) `{name, base, bgImage, fonts, vars}`; game-wide vars stay in `spec.vars`. Worked sets: Dark Souls (in the example spec — the user picked **2 · Mapa Lordranu**: parchment + Lordran map at `--bgart-op .17` + Marcellus SC) and WoW (Karazhan / Questlog / Nexus / Arena / Kirin Tor / Icecrown on WoW loading screens). Build a fresh set per game and topic. Rules:
- Direction = **base** structure + game-derived palette (`vars`) + optional real **background art** (`bgImage`, tuned with `--bgart-op/-blur/-bright/-sat/-size/-pos`) + optional font. Name it after a place, faction, element or UI piece of the game.
- ≥ 4 of 6 use real game art as background or imitate a recognizable game UI piece (quest log, inventory, map, loading-screen frame). All 6 clearly different (centered/left-aligned, light/dark, different art).
- Light bases with busy art: `--bgart-op` ≈ .17, darker `--muted`; set `--fcap-color` (feature caption) to a dark accent — tone colours are made for dark cards.
- Fonts only with `latin-ext` (Polish): `ls /home/claude/slidegen/node_modules/@fontsource/<f>/files | grep -c latin-ext` > 0. OK: Cinzel, Marcellus SC, Pirata One, Cormorant Garamond, Oswald, Rajdhani, Inter. Not: IM Fell English SC, Orbitron. Others: `npm i -s @fontsource/<f>`, `"fonts": ["<f>/400.css"]`, set `--title-font`/`--label-font`.
- Bases (`body[data-theme=…]` in template.html): `grimoire` dark warm gold Cinzel centered · `parchment` light paper, deep-red titles, dark cards · `arcane` indigo/teal glow, Rajdhani · `esports` charcoal, Oswald, left-aligned, tag kicker · `codex` light editorial Cormorant, left-aligned · `frostforge` cold steel-blue, white-ice Cinzel. Add a base if a game needs one.

Run on the 2 most representative slides (different layouts; add a media slide if the script relies on them):
```bash
cd /home/claude/slidegen && node render.mjs /home/claude/proj/spec.json --board 1,3   # works without a recording
```
Read `proj/build/board_*.jpg` first (overflow, text over art, logo leaks, wrong icons, low contrast), fix, then SendUserFile both + the outline, ask for a number or a mix. **Stop and wait.** Then copy the chosen direction to the spec top level: `theme` = base, `vars` = `{...spec.vars, ...direction.vars}`, `bgImage`, `fonts`.

## 5. Align the recording, render

```bash
cd /home/claude/proj
ffmpeg -v error -y -i "<recording upload>" -vn -ac 1 -ar 44100 voice.wav
python3 /home/claude/slidegen/align.py voice.wav words.json          # ~0.1× realtime; writes transcript.txt
python3 /home/claude/slidegen/script.py align script.txt words.json  # marks.json; check "low confidence" / "NOT FOUND"
cd /home/claude/slidegen
node render.mjs /home/claude/proj/spec.json --cues                    # all times; fix "Cue not found" / odd fuzzy matches
node render.mjs /home/claude/proj/spec.json --preview 12.4,95.2       # fullest moment of each slide → build/preview_*.jpg, Read them
node render.mjs /home/claude/proj/spec.json --budget 540              # foreground, timeout 600000; exit 3 = PARTIAL → rerun until done
```
Ad-libs are fine (alignment skips unmatched words); a NOT FOUND mark gets `"at"` with a phrase from transcript.txt. A busy 1-min video renders in ~40 s; long talks are mostly holds (≈25–35 min per 40 min). Spec edits re-render only changed segments; template edits re-render all. Verify (`ffmpeg -v error -i out.mp4 -f null -`, frames at transitions, new elements' cues, inside clips), SendUserFile the MP4, say edits are cheap.

## 6. Changing the code

New layout = new branch in `slides.map` in template.html: build HTML, cued elements get class `item`, motion via `anim(el, t, 'fade'|'rise')` or `[start,end]` pushed to `windows` and driven in `seek(t)`; resolve new cue/file fields in render.mjs (like `feature`/`figure`). Everything must be a pure function of t (no CSS transitions/animations, no timers). Work in /home/claude/slidegen; when the user approves a change, copy it into `/home/claude/claude-skills/slidegen/`, commit with the session's attribution lines and push to `main` (repo attached with `access: "push"`); if push is refused, give the user the GitHub App / reconnect links from the error and send an updated `slidegen.zip` meanwhile. If the workflow itself changes, update `skills/slidegen-video/SKILL.md` in the repo and propose the same text as the skill update.
