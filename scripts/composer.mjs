// Ayah Composer — local authoring studio. Ingests a source (file/YouTube),
// marks verse boundaries by ear, sets voice fades, grades the background
// (blur/darken) and bakes it to a paced clip, then writes data/props.json.
//
//   npm run compose   ->   open http://localhost:4321
//
// Drop your surah video into public/video/ first; it is served with HTTP Range
// support so the browser can scrub it frame-accurately.
import { createServer } from "node:http";
import { readFile, readdir, writeFile, stat, unlink } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { tokenizeVerses, mapTimings } from "./align/map-words.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");
// Media is separated by role under public/media/.
const MEDIA_DIR = join(PUBLIC, "media");
const BG_DIR = join(MEDIA_DIR, "backgrounds");   // background clips
const REC_DIR = join(MEDIA_DIR, "recitations");  // recitation sources (audio/video)
const BREATH_DIR = join(MEDIA_DIR, "breaths");   // breath sound effects
const BAKED_DIR = join(MEDIA_DIR, "baked");      // baked background outputs
// Public src paths (relative to public/) for props.json.
const SRC = {
  recitation: (f) => `media/recitations/${f}`,
  background: (f) => `media/backgrounds/${f}`,
  baked: (f) => `media/baked/${f}`,
  breath: (f) => `media/breaths/${f}`,
};
const DATA_DIR = join(ROOT, "data");
const PROJECTS_DIR = join(DATA_DIR, "projects");
const INDEX_PATH = join(PROJECTS_DIR, "index.json");
const PROPS_PATH = join(DATA_DIR, "props.json");
const CACHE_DIR = join(DATA_DIR, ".cache");
// Forced-alignment sidecar (isolated Python 3.12 venv — torch has no wheels for
// the repo's Python 3.14). See scripts/align/requirements.txt for setup.
const ALIGN_DIR = join(__dirname, "align");
const ALIGN_PY = join(ALIGN_DIR, "align.py");
const ALIGN_VENV_PY = join(
  ALIGN_DIR,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
);
const PORT = 4321;

// Pexels API key: env var wins, else a local (never-committed) key file.
const PEXELS_KEY_PATH = join(CACHE_DIR, "pexels.key");
async function readPexelsKey() {
  if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY.trim();
  try { return (await readFile(PEXELS_KEY_PATH, "utf-8")).trim(); } catch { return ""; }
}

const ensureDirs = async () => {
  const { mkdir } = await import("node:fs/promises");
  for (const d of [BG_DIR, REC_DIR, BREATH_DIR, BAKED_DIR, PROJECTS_DIR]) {
    await mkdir(d, { recursive: true });
  }
};

const IS_WIN = process.platform === "win32";
const YTDLP_PATH = join(CACHE_DIR, IS_WIN ? "yt-dlp.exe" : "yt-dlp");
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${IS_WIN ? "yt-dlp.exe" : "yt-dlp"}`;
// Optional Netscape-format cookie jar. When present, downloads run authenticated
// — this is what gets past YouTube's "sign in to confirm you're not a bot" wall
// and the 403 on the data stream (unauthenticated progressive URLs now want a PO
// token). Export it once with a browser extension (e.g. "Get cookies.txt
// LOCALLY") for youtube.com and drop it here. Env YTDLP_COOKIES_FROM_BROWSER
// (chrome|edge|firefox|brave) is an alternative when that browser isn't affected
// by Windows App-Bound Encryption (Chrome is — use the file instead).
const COOKIES_PATH = join(CACHE_DIR, "cookies.txt");
const COOKIES_FROM_BROWSER = (process.env.YTDLP_COOKIES_FROM_BROWSER || "").trim();
// Route the download through a proxy. Needed when this host's egress is a
// datacenter/VPN IP (YouTube bot-walls and 403s those regardless of cookies) —
// point it at a residential proxy: YTDLP_PROXY="socks5://user:pass@host:port".
const YTDLP_PROXY = (process.env.YTDLP_PROXY || "").trim();
const ytProxyArgs = () => (YTDLP_PROXY ? ["--proxy", YTDLP_PROXY] : []);
// Without cookies: tv/mweb get through extraction without a JS runtime. With
// cookies the authenticated web/tv clients hand back non-throttled stream URLs.
const ytAuthArgs = () => {
  if (existsSync(COOKIES_PATH)) {
    return ["--cookies", COOKIES_PATH, "--extractor-args", "youtube:player_client=web,tv,mweb"];
  }
  if (COOKIES_FROM_BROWSER) {
    return ["--cookies-from-browser", COOKIES_FROM_BROWSER, "--extractor-args", "youtube:player_client=web,tv,mweb"];
  }
  return ["--extractor-args", "youtube:player_client=tv,mweb,web_embedded"];
};

async function ensureYtDlp() {
  if (existsSync(YTDLP_PATH)) return YTDLP_PATH;
  await import("node:fs/promises").then((m) => m.mkdir(CACHE_DIR, { recursive: true }));
  console.log("  Fetching yt-dlp binary…");
  const r = await fetch(YTDLP_URL);
  if (!r.ok) throw new Error(`yt-dlp download failed: ${r.status}`);
  const { writeFile, chmod } = await import("node:fs/promises");
  await writeFile(YTDLP_PATH, Buffer.from(await r.arrayBuffer()));
  if (!IS_WIN) await chmod(YTDLP_PATH, 0o755);
  return YTDLP_PATH;
}

// Download a progressive (single-file, audio+video) mp4 so no ffmpeg merge is
// needed. Resolves with the saved filename in public/video/.
function ytDlpDownload(bin, url) {
  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--no-warnings",
      ...ytProxyArgs(),
      ...ytAuthArgs(),
      "-f",
      "best[acodec!=none][vcodec!=none][ext=mp4]/best[acodec!=none][vcodec!=none]",
      "-o",
      join(REC_DIR, "yt_%(id)s.%(ext)s"),
      "--print",
      "after_move:filepath",
      url,
    ];
    const proc = spawn(bin, args, { windowsHide: true });
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        const filepath = out.trim().split(/\r?\n/).filter(Boolean).pop();
        resolve(filepath ? basename(filepath) : null);
      } else {
        reject(new Error((err || out).trim().split(/\r?\n/).pop() || `yt-dlp exited ${code}`));
      }
    });
  });
}

// ---- background baking (ffmpeg) -------------------------------------------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pad3 = (n) => String(n).padStart(3, "0");

// Run the full static ffmpeg (ffmpeg-static) directly — it has the blur/grade
// filters the bundled Remotion ffmpeg lacks. No shell, so args need no quoting.
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static binary not found"));
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(err.trim().split(/\r?\n/).slice(-3).join(" ") || `ffmpeg exited ${code}`))
    );
  });
}

// Run the Python forced-alignment sidecar (in/out are JSON file paths). The
// venv lives in scripts/align/.venv; a missing venv is a clear setup error.
function runAlignSidecar(inJson, outJson) {
  return new Promise((resolve, reject) => {
    if (!existsSync(ALIGN_VENV_PY)) {
      return reject(
        new Error(
          "alignment Python venv not found — set it up once: see scripts/align/requirements.txt"
        )
      );
    }
    const proc = spawn(ALIGN_VENV_PY, [ALIGN_PY, "--in", inJson, "--out", outJson], {
      windowsHide: true,
    });
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(err.trim().split(/\r?\n/).slice(-3).join(" ") || `align exited ${code}`))
    );
  });
}

// Read a media file's duration (seconds) by parsing ffmpeg's stderr. ffmpeg
// exits non-zero with no output file, but still prints the Duration line first.
function probeDuration(inPath) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(0);
    const p = spawn(ffmpegPath, ["-i", inPath], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => resolve(0));
    p.on("close", () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      resolve(m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0);
    });
  });
}

const ENC = [
  "-r", "30",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
  "-g", "12", "-keyint_min", "12", "-sc_threshold", "0",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
];

// Crossfade duration between collage clips — half of AyahText's 0.8s text fade.
const COLLAGE_XFADE_SECONDS = 0.4;

// ---- projects (data/projects/<slug>.json + active mirror to props.json) ----
const slugify = (s) =>
  String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40) || "project";

const projectPath = (slug) => join(PROJECTS_DIR, `${slug}.json`);

async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, "utf-8")); } catch { return fallback; }
}
const readProject = (slug) => readJson(projectPath(slug), []);
const writeProject = (slug, entries) => writeFile(projectPath(slug), JSON.stringify(entries, null, 2) + "\n");

// Read the project index, migrating a legacy single props.json on first run.
async function readIndex() {
  await ensureDirs();
  if (existsSync(INDEX_PATH)) return readJson(INDEX_PATH, { active: null, projects: [] });
  const legacy = existsSync(PROPS_PATH) ? await readJson(PROPS_PATH, []) : [];
  await writeProject("project", legacy);
  const ix = { active: "project", projects: [{ slug: "project", name: "Project" }] };
  await writeFile(INDEX_PATH, JSON.stringify(ix, null, 2) + "\n");
  return ix;
}
const writeIndex = (ix) => writeFile(INDEX_PATH, JSON.stringify(ix, null, 2) + "\n");

// Mirror the active project into data/props.json (what Studio + render read).
async function mirrorActive() {
  const ix = await readIndex();
  const entries = ix.active ? await readProject(ix.active) : [];
  await writeFile(PROPS_PATH, JSON.stringify(entries, null, 2) + "\n");
  return entries;
}

// Bake a chosen clip into a graded, paced background: cover-fit to 1080x1920,
// blur + desaturate + darken (grade burned in), then fitted to targetSeconds per
// the chosen pacing so the composition plays it at 1× with no live filter.
//   fit:  "natural" (1× speed — trim if long, loop if short) | "stretch" (retime
//         to fill exactly: speed up a long clip / slow down a short one).
//   loopStyle (natural + shorter only): "crossfade" (seamless dissolve, motion
//         always forward — best for blurred ambient clips) | "boomerang"
//         (forward↔reverse, no seam but reversed motion) | "hard" (plain cut).
// Returns { outName, pacing } where pacing is a human-readable summary.
async function bakeBackground({
  inputFile, surahNumber, fromAyah, toAyah, targetSeconds,
  blur, darken, saturation, fit = "natural", loopStyle = "crossfade",
}) {
  const W = 1080, H = 1920;
  const inPath = join(BG_DIR, inputFile);
  if (!existsSync(inPath)) throw new Error(`background not found: ${inputFile}`);
  const outName = `baked_${pad3(surahNumber)}_${pad3(fromAyah)}-${pad3(toAyah)}.mp4`;
  const outPath = join(BAKED_DIR, outName);

  const sigma = clamp(blur, 0, 40);
  const sat = clamp(saturation, 0, 3);
  const k = clamp(darken, 0.02, 1); // luma/RGB multiplier (CSS brightness equiv.)
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const grade = [
    sigma > 0.05 ? `gblur=sigma=${sigma.toFixed(2)}` : null,
    `eq=saturation=${sat.toFixed(3)}`,
    `colorlevels=romax=${k.toFixed(3)}:gomax=${k.toFixed(3)}:bomax=${k.toFixed(3)}`,
  ].filter(Boolean).join(",");
  const t = Math.max(1, targetSeconds);
  const ts = t.toFixed(2);

  const clipDur = await probeDuration(inPath);
  const isLong = clipDur > 0 && clipDur >= t - 0.05;
  let pacing;

  // STRETCH — retime one playthrough to fill the whole span exactly.
  if (fit === "stretch" && clipDur > 0.1) {
    const ratio = t / clipDur; // >1 slows (stretch), <1 speeds up
    await runFfmpeg([
      "-y", "-i", inPath, "-t", ts, "-an",
      "-vf", `${cover},setpts=${ratio.toFixed(5)}*PTS,${grade}`,
      ...ENC, outPath,
    ]);
    pacing = ratio >= 1
      ? `stretched ×${ratio.toFixed(2)} (slowed to fill ${ts}s)`
      : `sped up ×${(1 / ratio).toFixed(2)} (compressed to ${ts}s)`;
    return { outName, pacing };
  }

  // NATURAL + long (or unknown-but-trimmable) — play at 1×, trim to length.
  if (isLong) {
    await runFfmpeg([
      "-y", "-i", inPath, "-t", ts, "-an",
      "-vf", `${cover},${grade}`, ...ENC, outPath,
    ]);
    return { outName, pacing: `natural 1× · trimmed (clip ${clipDur.toFixed(1)}s ≥ ${ts}s)` };
  }

  // NATURAL + short — loop to fill. Crossfade/boomerang build a seamless loop
  // unit first, then stream_loop that unit to the target length.
  const wantCross = loopStyle === "crossfade" && clipDur > 0.8;
  // reverse buffers the whole segment in RAM — only boomerang reasonably short clips.
  const wantBoom = loopStyle === "boomerang" && clipDur > 0.5 && clipDur * 30 <= 600;

  if (wantCross || wantBoom) {
    const tmp = join(BAKED_DIR, `._unit_${Date.now()}.mp4`);
    let unitFc;
    if (wantCross) {
      const x = Math.min(1.0, Math.max(0.2, clipDur * 0.25, 0)); // crossfade seconds
      const xf = Math.min(x, clipDur / 2 - 0.05);
      const body = (clipDur - xf).toFixed(3);
      unitFc =
        `[0:v]${cover},fps=30,split[a][b];` +
        `[a]trim=0:${body},setpts=PTS-STARTPTS[main];` +
        `[b]trim=${body}:${clipDur.toFixed(3)},setpts=PTS-STARTPTS[end];` +
        `[end][main]xfade=transition=fade:duration=${xf.toFixed(3)}:offset=0[xf];` +
        `[xf]${grade}[v]`;
    } else {
      unitFc =
        `[0:v]${cover},fps=30,split[f][r];[r]reverse[rr];` +
        `[f][rr]concat=n=2:v=1[cc];[cc]${grade}[v]`;
    }
    try {
      await runFfmpeg([
        "-y", "-i", inPath, "-filter_complex", unitFc, "-map", "[v]", "-an",
        "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", tmp,
      ]);
      await runFfmpeg([
        "-y", "-stream_loop", "-1", "-i", tmp, "-t", ts, "-an", ...ENC, outPath,
      ]);
    } finally {
      try { await unlink(tmp); } catch {}
    }
    const reps = clipDur > 0 ? (t / clipDur).toFixed(1) : "?";
    pacing = wantCross
      ? `natural 1× · crossfade loop ~${reps}×`
      : `natural 1× · boomerang loop ~${reps}×`;
    return { outName, pacing };
  }

  // Fallback (hard cut, or unknown duration): plain stream_loop to fill.
  await runFfmpeg([
    "-y", "-stream_loop", "-1", "-i", inPath, "-t", ts, "-an",
    "-vf", `${cover},${grade}`, ...ENC, outPath,
  ]);
  const note = loopStyle !== "hard" && clipDur > 0
    ? ` (fell back from ${loopStyle})`
    : "";
  pacing = `natural 1× · hard-cut loop${note}`;
  return { outName, pacing };
}

// Bake a COLLAGE background: one clip per verse, each graded and fit to that
// verse's on-screen duration (stretched up if shorter, trimmed if longer), then
// concatenated into a single baked clip the composition plays at 1×. The last
// segment also carries the tail padding so the background never runs dry.
async function bakeCollage({
  surahNumber, fromAyah, toAyah, clips, verseDurations,
  tailSeconds, blur, darken, saturation,
}) {
  const W = 1080, H = 1920;
  const sigma = clamp(blur, 0, 40);
  const sat = clamp(saturation, 0, 3);
  const k = clamp(darken, 0.02, 1);
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const grade = [
    sigma > 0.05 ? `gblur=sigma=${sigma.toFixed(2)}` : null,
    `eq=saturation=${sat.toFixed(3)}`,
    `colorlevels=romax=${k.toFixed(3)}:gomax=${k.toFixed(3)}:bomax=${k.toFixed(3)}`,
  ].filter(Boolean).join(",");

  const outName = `baked_${pad3(surahNumber)}_${pad3(fromAyah)}-${pad3(toAyah)}.mp4`;
  const outPath = join(BAKED_DIR, outName);
  const stamp = Date.now();
  const segs = [];
  // Crossfade between clips, half of AyahText's 0.8s text fade-in. Only with 2+
  // clips. Each non-last segment is extended by xf so the overlap consumes the
  // padding, not the verse's visible time, and the baked total is unchanged.
  const xf = clips.length > 1 ? COLLAGE_XFADE_SECONDS : 0;
  const segDurs = [];
  try {
    for (let i = 0; i < clips.length; i++) {
      const inPath = join(BG_DIR, clips[i]);
      if (!existsSync(inPath)) throw new Error(`collage clip not found: ${clips[i]}`);
      let dur = Math.max(0.3, verseDurations[i]);
      if (i === clips.length - 1) dur += Math.max(0, tailSeconds) + 0.5; // tail rides the last clip
      else dur += xf; // extra tail that the crossfade into the next clip eats
      const clipDur = await probeDuration(inPath);
      const seg = join(BAKED_DIR, `._seg_${stamp}_${i}.mp4`);
      segs.push(seg);
      // stretch up when the clip is shorter than the verse; otherwise trim.
      const vf = clipDur > 0 && clipDur < dur - 0.02
        ? `${cover},setpts=${(dur / clipDur).toFixed(5)}*PTS,${grade}`
        : `${cover},${grade}`;
      await runFfmpeg([
        "-y", "-i", inPath, "-t", dur.toFixed(3), "-an", "-vf", vf, ...ENC, seg,
      ]);
      const actual = await probeDuration(seg);
      segDurs.push(actual > 0 ? actual : dur);
    }
    if (xf > 0) {
      // Chain xfade across the segments. offset = output length so far − xf, so
      // each transition starts xf before the running output ends.
      const inputs = [];
      segs.forEach((s) => inputs.push("-i", s));
      const filt = [];
      let prev = "[0]", cum = segDurs[0];
      for (let k = 1; k < segs.length; k++) {
        const out = k === segs.length - 1 ? "[v]" : `[x${k}]`;
        const offset = Math.max(0, cum - xf);
        filt.push(`${prev}[${k}]xfade=transition=fade:duration=${xf.toFixed(3)}:offset=${offset.toFixed(3)}${out}`);
        cum = cum + segDurs[k] - xf;
        prev = out;
      }
      await runFfmpeg([
        "-y", ...inputs, "-filter_complex", filt.join(";"),
        "-map", "[v]", "-an", ...ENC, outPath,
      ]);
    } else {
      // Single clip: identical encode params → stream copy via concat.
      const listPath = join(BAKED_DIR, `._list_${stamp}.txt`);
      await writeFile(listPath, segs.map((s) => `file '${s.replace(/\\/g, "/")}'`).join("\n"));
      try {
        await runFfmpeg([
          "-y", "-f", "concat", "-safe", "0", "-i", listPath,
          "-c", "copy", "-movflags", "+faststart", outPath,
        ]);
      } finally {
        try { await unlink(listPath); } catch {}
      }
    }
  } finally {
    for (const s of segs) { try { await unlink(s); } catch {} }
  }
  const fadeNote = xf > 0 ? `, ${xf}s crossfades` : "";
  return { outName, pacing: `collage · ${clips.length} clips fitted per verse${fadeNote}` };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

const MEDIA_EXT = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4a", ".mp3", ".wav"]);

let surahCache = null;

const json = (res, code, data) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });

// Serve a file with Range support (required for video seeking).
async function serveMedia(req, res, filePath) {
  if (!existsSync(filePath)) return json(res, 404, { error: "not found" });
  const { size } = await stat(filePath);
  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    res.writeHead(206, {
      "content-type": type,
      "content-range": `bytes ${start}-${end}/${size}`,
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
    });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    createReadStream(filePath).pipe(res);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    // UI
    if (path === "/" || path === "/index.html") {
      const html = await readFile(join(__dirname, "composer-ui.html"), "utf-8");
      res.writeHead(200, { "content-type": MIME[".html"] });
      return res.end(html);
    }

    // List background clips (public/media/backgrounds).
    if (path === "/api/backgrounds") {
      await ensureDirs();
      const files = (await readdir(BG_DIR)).filter((f) => MEDIA_EXT.has(extname(f).toLowerCase()));
      return json(res, 200, { files });
    }

    // List recitation sources (public/media/recitations).
    if (path === "/api/recitations") {
      await ensureDirs();
      const files = (await readdir(REC_DIR)).filter((f) => MEDIA_EXT.has(extname(f).toLowerCase()));
      return json(res, 200, { files });
    }

    // Serve any file under public/media/ for playback (Range-enabled).
    if (path.startsWith("/media/")) {
      const rel = decodeURIComponent(path.slice("/media/".length));
      if (rel.includes("..") || rel.includes("\\")) return json(res, 400, { error: "bad name" });
      return serveMedia(req, res, join(MEDIA_DIR, rel));
    }

    // Serve the breath sound so the Breath step can audition it and mark the
    // inhale→exhale split by ear.
    if (path === "/breath-audio") {
      return serveMedia(req, res, join(BREATH_DIR, "breath.mp3"));
    }

    // Project list + the active project's saved videos (track/verses/marks).
    if (path === "/api/projects" && req.method === "GET") {
      const ix = await readIndex();
      const projects = await Promise.all(
        ix.projects.map(async (p) => ({ ...p, count: (await readProject(p.slug)).length }))
      );
      return json(res, 200, { active: ix.active, projects });
    }
    if (path === "/api/projects/create" && req.method === "POST") {
      const { name } = JSON.parse(await readBody(req));
      const ix = await readIndex();
      let slug = slugify(name), s = slug, n = 2;
      while (ix.projects.some((p) => p.slug === s)) s = `${slug}-${n++}`;
      slug = s;
      await writeProject(slug, []);
      ix.projects.push({ slug, name: (name || slug).trim() });
      ix.active = slug;
      await writeIndex(ix);
      await mirrorActive();
      return json(res, 200, { ok: true, active: slug });
    }
    if (path === "/api/projects/activate" && req.method === "POST") {
      const { slug } = JSON.parse(await readBody(req));
      const ix = await readIndex();
      if (!ix.projects.some((p) => p.slug === slug)) return json(res, 404, { error: "no such project" });
      ix.active = slug;
      await writeIndex(ix);
      await mirrorActive();
      return json(res, 200, { ok: true, active: slug });
    }
    if (path === "/api/projects/rename" && req.method === "POST") {
      const { slug, name } = JSON.parse(await readBody(req));
      const ix = await readIndex();
      const p = ix.projects.find((x) => x.slug === slug);
      if (!p) return json(res, 404, { error: "no such project" });
      p.name = (name || p.name).trim();
      await writeIndex(ix);
      return json(res, 200, { ok: true });
    }
    if (path === "/api/projects/delete" && req.method === "POST") {
      const { slug } = JSON.parse(await readBody(req));
      const ix = await readIndex();
      ix.projects = ix.projects.filter((p) => p.slug !== slug);
      try { await unlink(projectPath(slug)); } catch {}
      if (ix.active === slug) ix.active = ix.projects[0] ? ix.projects[0].slug : null;
      await writeIndex(ix);
      await mirrorActive();
      return json(res, 200, { ok: true, active: ix.active });
    }

    // The active project's saved entries (for the "open saved" list).
    if (path === "/api/props") {
      const ix = await readIndex();
      const entries = ix.active ? await readProject(ix.active) : [];
      return json(res, 200, { entries, active: ix.active });
    }

    // List of surahs (number, names, ayah count) for the dropdowns
    if (path === "/api/surahs") {
      if (!surahCache) {
        const r = await fetch("https://api.alquran.cloud/v1/surah");
        if (!r.ok) return json(res, 502, { error: `surah list ${r.status}` });
        const j = await r.json();
        surahCache = j.data.map((s) => ({
          number: s.number,
          englishName: s.englishName,
          name: s.name,
          ayahs: s.numberOfAyahs,
        }));
      }
      return json(res, 200, { surahs: surahCache });
    }

    // Download a YouTube video into public/video/ for marking
    if (path === "/api/youtube" && req.method === "POST") {
      const { url: ytUrl } = JSON.parse(await readBody(req));
      if (!ytUrl || !/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(ytUrl)) {
        return json(res, 400, { error: "not a YouTube URL" });
      }
      await ensureDirs();
      const bin = await ensureYtDlp();
      console.log(`  Downloading YouTube: ${ytUrl}`);
      let file;
      try {
        file = await ytDlpDownload(bin, ytUrl);
      } catch (e) {
        const msg = String(e.message || e);
        const blocked = /403|forbidden|sign in to confirm|not a bot|cookies/i.test(msg);
        if (blocked) {
          const hasAuth = existsSync(COOKIES_PATH) || COOKIES_FROM_BROWSER;
          const hint = hasAuth
            ? "YouTube blocked this download even with cookies. This usually means your egress " +
              "IP is a datacenter/VPN address (YouTube bot-walls those). Disable the VPN and use " +
              "a residential connection, set YTDLP_PROXY to a residential proxy, or download the " +
              "clip on another machine and drop it into public/video/."
            : "YouTube blocked this download (bot check / 403). Export youtube.com cookies to " +
              "data/.cache/cookies.txt (a 'Get cookies.txt LOCALLY' extension, signed in) and retry. " +
              "If it still blocks, your IP is likely a datacenter/VPN address — use a residential " +
              "connection or set YTDLP_PROXY.";
          return json(res, 502, { error: hint + " Details: " + msg });
        }
        return json(res, 502, { error: msg });
      }
      if (!file) return json(res, 502, { error: "download produced no file" });
      return json(res, 200, { file, title: file });
    }

    // Forced-align the known verse text to the recitation audio so the user
    // doesn't mark boundaries by hand. The user marks only the range start
    // (startMs) and end (endMs); we align everything in between and also return
    // per-verse waqf phrases with their own timing (for sentence-by-sentence
    // display). Boundaries come back absolute (source ms); phrase times are
    // relative to startMs (== the range start the save path uses as base).
    if (path === "/api/align" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const { recitationFile, verses } = body;
      const s = Math.max(0, Math.round(+body.startMs || 0));
      const e = Math.round(+body.endMs || 0);
      if (!recitationFile || !Array.isArray(verses) || verses.length === 0) {
        return json(res, 400, { error: "need recitationFile and verses" });
      }
      if (!(e > s)) {
        return json(res, 400, { error: "mark the range start and end first (endMs must be > startMs)" });
      }
      const inFile = join(REC_DIR, basename(recitationFile));
      if (!existsSync(inFile)) {
        return json(res, 404, { error: `recitation not found: ${basename(recitationFile)}` });
      }
      const tok = tokenizeVerses(verses);
      if (tok.words.length === 0) return json(res, 400, { error: "no alignable words in verses" });

      await mkdir(CACHE_DIR, { recursive: true });
      const stamp = Date.now();
      const wav = join(CACHE_DIR, `align_${stamp}.wav`);
      const inJson = join(CACHE_DIR, `align_${stamp}_in.json`);
      const outJson = join(CACHE_DIR, `align_${stamp}_out.json`);
      try {
        // Extract just the marked window as 16k mono wav.
        await runFfmpeg([
          "-hide_banner", "-loglevel", "error",
          "-ss", (s / 1000).toFixed(3), "-t", ((e - s) / 1000).toFixed(3),
          "-i", inFile, "-ac", "1", "-ar", "16000", "-y", wav,
        ]);
        await writeFile(inJson, JSON.stringify({ audio: wav, words: tok.words, lang: "ara" }), "utf-8");
        console.log(`  Aligning ${tok.words.length} words over ${((e - s) / 1000).toFixed(1)}s…`);
        await runAlignSidecar(inJson, outJson);
        const aligned = JSON.parse(await readFile(outJson, "utf-8"));
        const mapped = mapTimings(verses, tok, aligned.words);

        const boundaries = [s, ...mapped.interior.map((m) => s + m), e];
        const outVerses = mapped.verses.map((v) => ({
          ayahNumber: v.ayahNumber,
          phrases: v.phrases.map((p) => ({ text: p.text, fromMs: p.startMs, toMs: p.endMs })),
        }));
        const lowScore = aligned.words.filter((w) => w.placeholder || w.score < 0.3).length;
        return json(res, 200, {
          boundaries,
          verses: outVerses,
          diagnostics: { audioMs: aligned.audioMs, words: aligned.words.length, lowScore },
        });
      } catch (err) {
        return json(res, 502, { error: `alignment failed: ${err.message}` });
      } finally {
        for (const f of [wav, inJson, outJson]) await unlink(f).catch(() => {});
      }
    }

    // Search Pexels for vertical 1080p, 60fps+ clips. Returns only videos that
    // carry an exact 1080x1920 file at >=60fps (slow-mo of <60fps looks laggy).
    if (path === "/api/pexels/search" && req.method === "GET") {
      const key = await readPexelsKey();
      if (!key) return json(res, 400, { error: "no Pexels API key — put it in data/.cache/pexels.key" });
      const query = (url.searchParams.get("query") || "").trim();
      if (!query) return json(res, 400, { error: "empty query" });
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const per = 24;
      const api = `https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=large&per_page=${per}&page=${page}`;
      let data;
      try {
        const r = await fetch(api, { headers: { Authorization: key } });
        if (!r.ok) return json(res, 502, { error: `pexels ${r.status}` });
        data = await r.json();
      } catch (e) {
        return json(res, 502, { error: `pexels fetch failed: ${e.message}` });
      }
      const raw = data.videos || [];
      const videos = [];
      for (const v of raw) {
        const f = (v.video_files || []).find(
          (x) => x.width === 1080 && x.height === 1920 && Math.round(x.fps || 0) >= 60
        );
        if (!f) continue;
        videos.push({
          id: v.id,
          thumb: v.image,
          duration: v.duration,
          width: 1080,
          height: 1920,
          fps: Math.round(f.fps || 0),
          photographer: v.user && v.user.name,
          photographerUrl: v.user && v.user.url,
          pageUrl: v.url,
          link: f.link,
        });
      }
      return json(res, 200, { videos, page, hasMore: raw.length >= per, totalResults: data.total_results });
    }

    // Download chosen Pexels clips into public/media/backgrounds as pexels_<id>.mp4.
    if (path === "/api/pexels/import" && req.method === "POST") {
      await ensureDirs();
      const { items } = JSON.parse(await readBody(req));
      if (!Array.isArray(items) || !items.length) return json(res, 400, { error: "no items" });
      const saved = [], skipped = [], errors = [];
      for (const it of items) {
        const id = it && it.id, link = it && it.link;
        if (!id || !link) { errors.push("bad item"); continue; }
        const name = `pexels_${id}.mp4`;
        const dest = join(BG_DIR, name);
        if (existsSync(dest)) { skipped.push(name); continue; }
        try {
          const r = await fetch(link);
          if (!r.ok) throw new Error(`http ${r.status}`);
          await writeFile(dest, Buffer.from(await r.arrayBuffer()));
          saved.push(name);
        } catch (e) {
          errors.push(`${name}: ${e.message}`);
        }
      }
      return json(res, 200, { saved, skipped, errors });
    }

    // Fetch verse text (Arabic + English) for a range, proxied to avoid CORS
    if (path === "/api/verses") {
      const surah = Number(url.searchParams.get("surah"));
      const from = Number(url.searchParams.get("from"));
      const to = Number(url.searchParams.get("to"));
      if (!surah || !from || !to || to < from) return json(res, 400, { error: "bad range" });
      const r = await fetch(
        `https://api.alquran.cloud/v1/surah/${surah}/editions/quran-uthmani,en.sahih`
      );
      if (!r.ok) return json(res, 502, { error: `quran api ${r.status}` });
      const j = await r.json();
      const [uthmani, english] = j.data;
      const verses = [];
      for (let a = from; a <= to; a++) {
        const ar = uthmani.ayahs.find((x) => x.numberInSurah === a);
        const en = english.ayahs.find((x) => x.numberInSurah === a);
        if (!ar) return json(res, 400, { error: `ayah ${surah}:${a} not found` });
        verses.push({ ayahNumber: a, arabic: ar.text, translation: en ? en.text : "" });
      }
      return json(res, 200, { surahName: uthmani.englishName, verses });
    }

    // Save the marked range into data/props.json
    if (path === "/api/save" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const {
        surahNumber,
        surahName,
        fromAyah,
        toAyah,
        reciter,
        videoFile,
        useVideoAsBackground,
        backgroundFile, // chosen background clip in public/video/
        accent,
        fadeInSeconds,
        fadeOutSeconds,
        bgBlur,
        bgDarken,
        bgSaturation,
        bgFadeInSeconds,
        bgFadeOutSeconds,
        bgFit, // "natural" | "stretch"
        bgLoopStyle, // "crossfade" | "boomerang" | "hard"
        bgMode, // "single" | "collage"
        bgCollage, // [filename per verse] when bgMode === "collage"
        breathColor,
        breathInEndSeconds,
        breathStartDelaySeconds,
        arabicFont, // key into lib/fonts ARABIC_FONTS
        englishFont, // key into lib/fonts LATIN_FONTS
        arabicFontSize, // px on the 1080x1920 canvas
        englishFontSize,
        safeTop, // platform safe-area insets (px on the 1080x1920 canvas)
        safeRight,
        safeBottom,
        safeLeft,
        tailPaddingInSeconds,
        boundaries, // absolute ms in source: length = (toAyah-fromAyah) + 2
        verses, // [{ayahNumber, arabic, translation, phrases?}]
        phraseMode, // reveal verses sentence-by-sentence (waqf phrases)
        append,
      } = body;

      if (!Array.isArray(boundaries) || boundaries.length !== verses.length + 1) {
        return json(res, 400, { error: "boundaries must equal verses + 1" });
      }
      const sorted = boundaries.every((b, i) => i === 0 || b >= boundaries[i - 1]);
      if (!sorted) return json(res, 400, { error: "boundaries must be ascending" });

      const rangeStart = boundaries[0];

      // Measure the breath audio so the hook length is baked into props and the
      // render duration stays deterministic (calculateMetadata reads this value
      // instead of re-measuring at render time).
      let hookSeconds = 3;
      try {
        const d = await probeDuration(join(BREATH_DIR, "breath.mp3"));
        if (d > 0.2) hookSeconds = +d.toFixed(2);
      } catch {}

      // Grade + pacing for the background bake.
      const tail = Number.isFinite(tailPaddingInSeconds) ? Math.max(0, tailPaddingInSeconds) : 1.5;
      const blur = Number.isFinite(bgBlur) ? bgBlur : 4;
      const darken = Number.isFinite(bgDarken) ? bgDarken : 0.5;
      const saturation = Number.isFinite(bgSaturation) ? bgSaturation : 0.7;
      const recitationSeconds = (boundaries[boundaries.length - 1] - rangeStart) / 1000;
      const targetSeconds = recitationSeconds + tail + 0.5; // cover the whole span
      const fit = bgFit === "stretch" ? "stretch" : "natural";
      const loopStyle = ["crossfade", "boomerang", "hard"].includes(bgLoopStyle)
        ? bgLoopStyle
        : "crossfade";
      const mode = bgMode === "collage" ? "collage" : "single";
      const collage = Array.isArray(bgCollage) ? bgCollage.filter(Boolean) : [];

      // Bake the background unless the recitation video is itself the background.
      let backgroundSrc = SRC.background(backgroundFile || "bg.mp4");
      let backgroundBaked = false;
      let bgPacing = "";
      if (!useVideoAsBackground) {
        try {
          let baked;
          if (mode === "collage") {
            if (collage.length !== verses.length) {
              return json(res, 400, { error: `collage needs one clip per verse (${verses.length})` });
            }
            const verseDurations = verses.map((_, i) => (boundaries[i + 1] - boundaries[i]) / 1000);
            baked = await bakeCollage({
              surahNumber, fromAyah, toAyah, clips: collage, verseDurations,
              tailSeconds: tail, blur, darken, saturation,
            });
          } else if (backgroundFile) {
            baked = await bakeBackground({
              inputFile: backgroundFile,
              surahNumber, fromAyah, toAyah,
              targetSeconds, blur, darken, saturation, fit, loopStyle,
            });
          }
          if (baked) {
            backgroundSrc = SRC.baked(baked.outName);
            bgPacing = baked.pacing;
            backgroundBaked = true;
          }
        } catch (e) {
          return json(res, 500, { error: `background bake failed: ${e.message}` });
        }
      }

      const entry = {
        surahName,
        surahNumber,
        fromAyah,
        toAyah,
        reciter: reciter || "Mishary Rashid Alafasy",
        recitationSrc: SRC.recitation(videoFile),
        recitationStartMs: Math.round(rangeStart),
        fadeInSeconds: Number.isFinite(fadeInSeconds) ? Math.max(0, fadeInSeconds) : 0.6,
        fadeOutSeconds: Number.isFinite(fadeOutSeconds) ? Math.max(0, fadeOutSeconds) : 1,
        verses: verses.map((v, i) => ({
          ayahNumber: v.ayahNumber,
          arabic: v.arabic,
          translation: v.translation,
          fromMs: Math.round(boundaries[i] - rangeStart),
          toMs: Math.round(boundaries[i + 1] - rangeStart),
          // Carry auto-aligned waqf phrases through (already relative to the
          // range start, == rangeStart). Clamp into the verse window so a phrase
          // never spills past its ayah's boundaries.
          ...(Array.isArray(v.phrases) && v.phrases.length
            ? {
                phrases: v.phrases.map((p) => ({
                  text: String(p.text || ""),
                  fromMs: Math.round(p.fromMs),
                  toMs: Math.round(p.toMs),
                })),
              }
            : {}),
        })),
        arabicFont: typeof arabicFont === "string" && arabicFont ? arabicFont : "scheherazade",
        englishFont: typeof englishFont === "string" && englishFont ? englishFont : "cormorant",
        arabicFontSize: Number.isFinite(arabicFontSize) ? Math.round(arabicFontSize) : 64,
        englishFontSize: Number.isFinite(englishFontSize) ? Math.round(englishFontSize) : 26,
        safeTop: Number.isFinite(safeTop) ? Math.max(0, Math.round(safeTop)) : 130,
        safeRight: Number.isFinite(safeRight) ? Math.max(0, Math.round(safeRight)) : 150,
        safeBottom: Number.isFinite(safeBottom) ? Math.max(0, Math.round(safeBottom)) : 340,
        safeLeft: Number.isFinite(safeLeft) ? Math.max(0, Math.round(safeLeft)) : 48,
        backgroundSrc,
        backgroundBaked,
        bgMode: mode,
        bgSource: backgroundFile || "bg.mp4", // raw clip the bake came from (single mode)
        ...(mode === "collage" ? { bgCollage: collage } : {}),
        bgBlur: blur,
        bgDarken: darken,
        bgSaturation: saturation,
        bgFadeInSeconds: Number.isFinite(bgFadeInSeconds) ? Math.max(0, bgFadeInSeconds) : 0.9,
        bgFadeOutSeconds: Number.isFinite(bgFadeOutSeconds) ? Math.max(0, bgFadeOutSeconds) : 1,
        bgFit: fit,
        bgLoopStyle: loopStyle,
        useVideoAsBackground: Boolean(useVideoAsBackground),
        breathSrc: SRC.breath("breath.mp3"),
        hookText: "Take a breath",
        hookSubText: "and listen",
        hookTextAr: "خُذ نَفَسًا",
        hookSubTextAr: "وَأنصِت",
        breathColor:
          typeof breathColor === "string" && breathColor ? breathColor : (accent || "#6fb3a8"),
        ...(Number.isFinite(breathInEndSeconds)
          ? { breathInEndSeconds: Math.max(0, breathInEndSeconds) }
          : {}),
        breathStartDelaySeconds: Number.isFinite(breathStartDelaySeconds)
          ? Math.max(0, breathStartDelaySeconds)
          : 0.5,
        hookDurationInSeconds: hookSeconds,
        phraseMode: Boolean(phraseMode),
        showProgressBar: true,
        showTimerRing: true,
        tailPaddingInSeconds: tail,
        accent: accent || "#D4A853",
      };

      // Write into the active project, then mirror to props.json for Studio/render.
      const ix = await readIndex();
      if (!ix.active) return json(res, 400, { error: "no active project" });
      let all = append ? await readProject(ix.active) : [];
      // Replace any existing entry for the same surah+range, else add.
      const key = (e) => `${e.surahNumber}:${e.fromAyah}-${e.toAyah}`;
      all = all.filter((e) => key(e) !== key(entry));
      all.push(entry);
      await writeProject(ix.active, all);
      await mirrorActive();
      return json(res, 200, {
        ok: true,
        count: all.length,
        entry: key(entry),
        project: ix.active,
        baked: backgroundBaked,
        backgroundSrc,
        pacing: bgPacing,
      });
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, async () => {
  await ensureDirs();
  console.log(`\n  Ayah Composer: http://localhost:${PORT}`);
  console.log(`  Media lives in public/media/{backgrounds,recitations,breaths}.\n`);
});
