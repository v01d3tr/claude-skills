// Render animated slides synced to a voice track.
// usage: node render.mjs proj/spec.json                    -> proj/out.mp4 (needs voice + words.json)
//        node render.mjs proj/spec.json --cues             -> resolved cue times
//        node render.mjs proj/spec.json --preview 3.5,12   -> proj/build/preview_*.jpg
//        node render.mjs proj/spec.json --board 2,5        -> proj/build/board_2.jpg, board_5.jpg: slides 2 and 5 in all 6 themes
//        node render.mjs proj/spec.json --budget 540       -> stop after ~540 s with exit 3; rerun to continue
//        --theme <name> overrides spec.theme for any mode
// Without words.json (script only, no recording yet) slides get placeholder times: --board / --preview still work.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30, W = 1920, H = 1080;
const THEMES = ['grimoire', 'parchment', 'arcane', 'esports', 'codex', 'frostforge'];
const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-video_track_timescale', '15360'];
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|avi|gif)$/i;

const specPath = path.resolve(process.argv[2]);
const dir = path.dirname(specPath);
const args = process.argv.slice(3);
const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
if (arg('--theme')) spec.theme = arg('--theme');
const wordsPath = path.join(dir, spec.words || 'words.json');
const DRY = !fs.existsSync(wordsPath); // no recording yet
const words = DRY ? [] : JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
const marksPath = path.join(dir, spec.marks || 'marks.json');
const marks = !DRY && fs.existsSync(marksPath) ? JSON.parse(fs.readFileSync(marksPath, 'utf8')) : {};
const audio = path.join(dir, spec.audio || 'voice.wav');
const build = path.join(dir, 'build');
fs.mkdirSync(build, { recursive: true });
const run = (argv, stdinWriter) => new Promise((res, rej) => {
  const p = spawn('ffmpeg', argv, { stdio: [stdinWriter ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', d => err += d);
  p.on('close', c => c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${err.slice(-800)}`)));
  if (stdinWriter) stdinWriter(p.stdin).catch(rej);
});

// ---------- cue resolution ----------
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]/g, '');
const W_N = words.map(w => norm(w.w));
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1);
}
let cursor = 0, from = 0, reach = 0; // slides search from the previous slide; elements search from their slide
const LEAD = spec.lead ?? 0.12; // show things a hair before the word lands
function resolve(cue, label) {
  if (cue == null || DRY) return undefined;
  const off = typeof cue === 'object' ? (cue.offset || 0) : 0;
  const at = typeof cue === 'object' ? cue.at : cue;
  if (typeof at === 'number') return at + off;
  const ph = String(at).split(/\s+/).map(norm).filter(Boolean);
  let best = { score: 0, i: -1 };
  for (let i = from; i <= W_N.length - ph.length; i++) {
    let sc = 0;
    for (let k = 0; k < ph.length; k++) sc += W_N[i + k] === ph[k] ? 1 : lev(W_N[i + k], ph[k]);
    sc /= ph.length;
    if (sc === 1) { best = { score: 1, i }; break; }
    if (sc > best.score + 1e-9) best = { score: sc, i };
  }
  if (best.score < 0.72) {
    const ctx = words.slice(from, from + 25).map(w => w.w).join(' ');
    throw new Error(`Cue not found: "${at}" (${label}). Next words after cursor: ${ctx}`);
  }
  if (best.score < 1) console.warn(`~ fuzzy cue "${at}" -> "${words.slice(best.i, best.i + ph.length).map(w => w.w).join(' ')}" (${best.score.toFixed(2)})`);
  reach = Math.max(reach, best.i + 1);
  return Math.max(0, words[best.i].s - LEAD + off);
}

// ---------- icons & media ----------
const GI = JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules/@iconify-json/game-icons/icons.json'), 'utf8')).icons;
function icon(it) {
  if (!it.icon) return;
  if (it.icon.startsWith('gi:')) {
    const g = GI[it.icon.slice(3)];
    if (!g) throw new Error(`Unknown game-icons name: ${it.icon}`);
    it.svg = g.body;
  } else {
    const f = path.resolve(dir, it.icon);
    if (!fs.existsSync(f)) throw new Error(`Missing icon file: ${f}`);
    it.img = pathToFileURL(f).href;
  }
}
async function media(s) {
  const f = path.resolve(dir, s.src);
  if (!fs.existsSync(f)) throw new Error(`Missing media file: ${f}`);
  if (!VIDEO_EXT.test(f)) { s.media = { kind: 'image', src: pathToFileURL(f).href }; return; }
  // video -> JPEG frame sequence the page can seek deterministically
  const [cs, ce] = s.clip || [0, null];
  const st = fs.statSync(f);
  const key = crypto.createHash('sha1').update(`${f}|${st.size}|${st.mtimeMs}|${cs}|${ce}|${s.fit}`).digest('hex').slice(0, 10);
  const fdir = path.join(build, 'media', `${path.basename(f).replace(/\W+/g, '_')}_${key}`);
  if (!fs.existsSync(path.join(fdir, '.done'))) {
    fs.mkdirSync(fdir, { recursive: true });
    const width = s.fit === 'full' ? 1920 : 1440;
    await run(['-v', 'error', '-y', ...(cs ? ['-ss', String(cs)] : []), ...(ce ? ['-to', String(ce)] : []), '-i', f,
      '-vf', `fps=${FPS},scale=${width}:-2`, '-q:v', '3', path.join(fdir, '%05d.jpg')]);
    fs.writeFileSync(path.join(fdir, '.done'), '');
  }
  const count = fs.readdirSync(fdir).filter(x => x.endsWith('.jpg')).length;
  s.media = { kind: 'video', dir: pathToFileURL(fdir).href, count, fps: FPS, file: f, clip: [cs, ce] };
}

for (const [i, s] of spec.slides.entries()) {
  from = cursor;
  if (DRY) s.t = i * 12;
  else if (s.mark != null) {
    const m = marks[String(s.mark)];
    if (!m) throw new Error(`slide ${i + 1}: mark "${s.mark}" not in marks.json (run script.py align)`);
    s.t = Math.max(0, m.t - (s.markLead ?? 0.25)); reach = Math.max(reach, m.i + 1);
  } else s.t = resolve(s.at ?? (i === 0 ? 0 : undefined), `slide ${i + 1}`);
  if (s.t == null) throw new Error(`slide ${i + 1} needs "at" or "mark"`);
  from = DRY ? 0 : (s.mark != null || typeof (s.at?.at ?? s.at) === 'string') ? reach - 1 : cursor;
  if (s.feature) { s.feature.t = resolve(s.feature.at, `slide ${i + 1} feature`); icon(s.feature); }
  if (s.figure) {  // tall portrait next to the cards: {src, label, caption, at}
    s.figure.t = resolve(s.figure.at, `slide ${i + 1} figure`);
    const ff = path.resolve(dir, s.figure.src);
    if (!fs.existsSync(ff)) throw new Error(`Missing figure file: ${ff}`);
    s.figure.img = pathToFileURL(ff).href;
  }
  for (const [k, it] of (s.items || []).entries()) { it.t = resolve(it.at, `slide ${i + 1} item ${k + 1}`); icon(it); }
  if (s.note) s.note.t = resolve(s.note.at, `slide ${i + 1} note`);
  if (s.layout === 'media') {
    const h0 = s.t + (i ? 0.35 * .85 : 0);  // same as template: header starts after the crossfade
    s.mt = Math.max(resolve(s.mediaAt, `slide ${i + 1} media`) ?? h0 + .05, h0);
    await media(s);
  }
  cursor = Math.max(cursor, from);
}
const dur = DRY ? spec.slides.length * 12 : parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio]).toString());
spec.duration = dur;
const N = Math.ceil(dur * FPS);
const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;

if (args.includes('--cues')) {
  if (DRY) console.log('(no words.json yet: placeholder times)');
  for (const [i, s] of spec.slides.entries()) {
    console.log(`${fmt(s.t)}  ▶ ${i + 1}. ${s.title || s.src || ''}${s.media?.kind === 'video' ? `  [clip ${(s.media.count / FPS).toFixed(1)} s]` : ''}`);
    for (const it of s.items || []) if (it.t != null) console.log(`${fmt(it.t)}      · ${it.label}`);
    if (s.note?.t != null) console.log(`${fmt(s.note.t)}      — ${s.note.text}`);
  }
  process.exit(0);
}

// ---------- page ----------
const fontsDir = pathToFileURL(path.join(HERE, 'node_modules/@fontsource')).href;
const TPL = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8');
const TPL_HASH = crypto.createHash('sha1').update(TPL).digest('hex');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', e => { console.error('page error:', e.message); process.exit(1); });
const fileUrl = p => p && !/^(file|https?):/.test(p) ? pathToFileURL(path.resolve(dir, p)).href : p;
async function load(sp) {
  sp = { ...sp, bgImage: fileUrl(sp.bgImage) };
  // extra fontsource stylesheets, e.g. "marcellus-sc/400.css" (npm i @fontsource/marcellus-sc; must ship latin-ext for Polish)
  const links = [...new Set(sp.fonts || [])].map(f => `<link rel="stylesheet" href="FONTS/${f}">`).join('\n');
  const html = TPL.replace('<!--EXTRA_FONTS-->', links).replaceAll('FONTS/', fontsDir + '/').replace('/*SPEC*/null', JSON.stringify(sp).replace(/</g, '\\u003c'));
  const pagePath = path.join(build, 'page.html');
  fs.writeFileSync(pagePath, html);
  await page.goto(pathToFileURL(pagePath).href);
  await page.evaluate(async () => { await document.fonts.ready; window.fit(); });
}
const settle = () => page.evaluate(() => Promise.all([...document.images].map(i => i.complete ? 0 : i.decode().catch(() => 0))));
const shot = async t => { await page.evaluate(t => window.seek(t), t); await settle(); return page.screenshot({ type: 'jpeg', quality: 92 }); };
// moment when a slide is fully built (for previews/boards)
const fullAt = i => {
  const s = spec.slides[i], next = spec.slides[i + 1];
  let t = Math.max(s.t + 1.6, ...(s.items || []).map(it => (it.t ?? s.t + 2) + 1.0), (s.note?.t ?? 0) + .6, (s.mt ?? 0) + 1.0);
  return next ? Math.min(t, next.t - .02) : t;
};

const pv = arg('--preview');
if (pv) {
  await load(spec);
  for (const t of pv.split(',').map(Number)) {
    const f = path.join(build, `preview_${t.toFixed(2)}.jpg`);
    fs.writeFileSync(f, await shot(t)); console.log(f);
  }
  await browser.close(); process.exit(0);
}

const bd = arg('--board');
if (bd) {
  const idx = bd.split(',').map(n => parseInt(n, 10) - 1);
  const cells = Object.fromEntries(idx.map(i => [i, []]));
  // spec.boardThemes: up to 6 game-flavoured variants {name, base, vars, bgImage, fonts}; default = the 6 base themes
  const variants = (spec.boardThemes || THEMES.map(t => ({ name: t, base: t }))).slice(0, 6);
  for (const [k, v] of variants.entries()) {
    await load({ ...spec, theme: v.base, vars: { ...(spec.vars || {}), ...(v.vars || {}) }, bgImage: v.bgImage !== undefined ? v.bgImage : spec.bgImage, fonts: [...(spec.fonts || []), ...(v.fonts || [])] });
    await page.evaluate(b => window.badge(b), `${k + 1} · ${v.name}`);
    for (const i of idx) {
      const f = path.join(build, `cell_${i + 1}_${k + 1}.jpg`);
      fs.writeFileSync(f, await shot(fullAt(i))); cells[i].push(f);
    }
  }
  for (const i of idx) {
    const out = path.join(build, `board_${i + 1}.jpg`);
    const inputs = cells[i].flatMap(f => ['-i', f]);
    const scaled = cells[i].map((_, k) => `[${k}]scale=960:540[c${k}]`).join(';');
    const layout = '0_0|960_0|0_540|960_540|0_1080|960_1080'.split('|').slice(0, cells[i].length).join('|');
    await run(['-v', 'error', '-y', ...inputs, '-filter_complex', `${scaled};${cells[i].map((_, k) => `[c${k}]`).join('')}xstack=inputs=${cells[i].length}:layout=${layout}:fill=black`, '-q:v', '3', out]);
    console.log(out);
  }
  await browser.close(); process.exit(0);
}

if (DRY) { console.error('No words.json: transcribe the recording first (align.py), then render.'); process.exit(2); }
await load(spec);

// ---------- segments: animate only where something moves, hold stills elsewhere ----------
const wins = (await page.evaluate(() => window.timeline()))
  .map(([a, b]) => [Math.max(0, Math.floor(a * FPS)), Math.min(N, Math.ceil(b * FPS) + 1)])
  .filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
const active = [];
for (const w of wins) {
  const last = active[active.length - 1];
  if (last && w[0] <= last[1] + 3) last[1] = Math.max(last[1], w[1]); else active.push([...w]);
}
const segs = []; let f = 0;
for (const [a, b] of active) { if (a > f) segs.push({ hold: true, a: f, b: a }); segs.push({ hold: false, a: Math.max(a, f), b }); f = Math.max(f, b); }
if (f < N) segs.push({ hold: true, a: f, b: N });

const t0 = Date.now(); let shots = 0, reused = 0;
const budget = arg('--budget') ? Number(arg('--budget')) : Infinity; // seconds, for long renders split over several runs
const cache = path.join(build, 'cache'); fs.mkdirSync(cache, { recursive: true });
const list = [];
for (const [i, s] of segs.entries()) {
  const n = s.b - s.a;
  // a segment is identified by its frame range and the DOM state at start / middle / end,
  // so editing one slide re-renders only the segments that actually changed
  const probe = s.hold ? [s.a + (n >> 1)] : [s.a, s.a + (n >> 1), s.b - 1];
  const h = crypto.createHash('sha1').update(`${TPL_HASH}|${JSON.stringify([spec.theme, spec.vars, spec.bgImage, spec.fonts, spec.series])}|${s.hold}|${s.a}|${s.b}`);
  for (const k of probe) h.update(await page.evaluate(t => window.stateKey(t), k / FPS));
  const out = path.join(cache, `seg_${h.digest('hex').slice(0, 16)}.mp4`), tmp = out.replace(/\.mp4$/, '.tmp.mp4');
  if (fs.existsSync(out)) { reused++; list.push(`file '${out}'`); continue; }
  if ((Date.now() - t0) / 1000 > budget) {
    await browser.close();
    console.log(`PARTIAL ${i}/${segs.length} segments done, run the same command again to continue`);
    process.exit(3);
  }
  if (s.hold) {
    const sp = path.join(build, 'hold.jpg'); fs.writeFileSync(sp, await shot((s.a + (n >> 1)) / FPS)); shots++;
    await run(['-v', 'error', '-y', '-framerate', String(FPS), '-i', sp, '-vf', `format=yuv420p,loop=-1:1,trim=end_frame=${n}`, '-frames:v', String(n), ...X264, tmp]);
  } else {
    await run(['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-', '-frames:v', String(n), ...X264, tmp], async stdin => {
      for (let k = s.a; k < s.b; k++) { const buf = await shot(k / FPS); shots++; if (!stdin.write(buf)) await new Promise(r => stdin.once('drain', r)); }
      stdin.end();
    });
  }
  fs.renameSync(tmp, out);
  list.push(`file '${out}'`);
  process.stderr.write(`\r${i + 1}/${segs.length} segments (${reused} reused), ${shots} screenshots, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
process.stderr.write('\n');

fs.writeFileSync(path.join(build, 'list.txt'), list.join('\n') + '\n');
const silent = path.join(build, 'video.mp4');
await run(['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(build, 'list.txt'), '-c', 'copy', silent]);

// sound: narration, plus the original audio of clips marked "audio": true (ducked under the voice)
const clips = spec.slides.map((s, i) => ({ s, end: spec.slides[i + 1]?.t ?? dur })).filter(({ s }) => s.media?.kind === 'video' && s.audio);
const ain = [], af = [];
for (const [k, { s, end }] of clips.entries()) {
  const len = Math.min(s.media.count / FPS, end - s.mt);
  ain.push('-ss', String(s.media.clip[0] || 0), '-t', len.toFixed(3), '-i', s.media.file);
  af.push(`[${k + 2}:a]volume=${s.volume ?? 0.35},adelay=${Math.round(s.mt * 1000)}:all=1[c${k}]`);
}
const amap = clips.length
  ? ['-filter_complex', `${af.join(';')};[1:a]${clips.map((_, k) => `[c${k}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0:duration=first[a]`, '-map', '0:v', '-map', '[a]']
  : ['-map', '0:v', '-map', '1:a'];
const final = path.join(dir, spec.output || 'out.mp4'), ftmp = final.replace(/\.mp4$/, '.tmp.mp4');
await run(['-v', 'error', '-y', '-i', silent, '-i', audio, ...ain, ...amap, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', ftmp]);
fs.renameSync(ftmp, final);
console.log(`${final}  (${fmt(dur)}, theme ${spec.theme || 'grimoire'}, ${segs.length} segments, ${reused} reused, ${shots} screenshots for ${N} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
