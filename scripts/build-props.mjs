import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const AUDIO_DIR = join(ROOT, "public", "audio");
const CACHE_DIR = join(DATA_DIR, ".cache");

// Mishary Rashid Alafasy, gapless murattal recitation on quran.com.
const RECITER_ID = 7;
const RECITER_NAME = "Mishary Rashid Alafasy";

for (const dir of [AUDIO_DIR, CACHE_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const versesPath = join(DATA_DIR, "verses.json");
if (!existsSync(versesPath)) {
  console.error("Missing data/verses.json. Create it with continuous ranges like:");
  console.error('[{"surah": 3, "from": 190, "to": 200}]');
  process.exit(1);
}

// Accept ranges ({surah, from, to}) and legacy single verses ({surah, ayah}).
const ranges = JSON.parse(readFileSync(versesPath, "utf-8")).map((r) => ({
  surah: r.surah,
  from: r.from ?? r.ayah,
  to: r.to ?? r.ayah,
}));

const pad3 = (n) => String(n).padStart(3, "0");

// Cache the gapless verse timings + audio url per surah for this run.
const timingCache = new Map();
async function getSurahTiming(surah) {
  if (timingCache.has(surah)) return timingCache.get(surah);
  const url = `https://api.quran.com/api/qdc/audio/reciters/${RECITER_ID}/audio_files?chapter=${surah}&segments=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`timings fetch failed for surah ${surah}: ${res.status}`);
  const json = await res.json();
  const file = json.audio_files[0];
  const timings = new Map(file.verse_timings.map((v) => [v.verse_key, v]));
  const value = { audioUrl: file.audio_url, timings };
  timingCache.set(surah, value);
  return value;
}

// Cache the surah text (Uthmani + English) per surah for this run.
const textCache = new Map();
async function getSurahText(surah) {
  if (textCache.has(surah)) return textCache.get(surah);
  const url = `https://api.alquran.cloud/v1/surah/${surah}/editions/quran-uthmani,en.sahih`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`text fetch failed for surah ${surah}: ${res.status}`);
  const json = await res.json();
  const [uthmani, english] = json.data;
  const value = {
    surahName: uthmani.englishName,
    arabic: new Map(uthmani.ayahs.map((a) => [a.numberInSurah, a.text])),
    translation: new Map(english.ayahs.map((a) => [a.numberInSurah, a.text])),
  };
  textCache.set(surah, value);
  return value;
}

async function downloadFullSurah(surah, audioUrl) {
  const cachePath = join(CACHE_DIR, `surah_${pad3(surah)}.mp3`);
  if (existsSync(cachePath)) return cachePath;
  console.log(`  Downloading full surah ${surah} recitation...`);
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`audio download failed for surah ${surah}: ${res.status}`);
  writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
  return cachePath;
}

// Stream-copy slice [startMs, endMs) out of the full surah mp3 (no re-encode).
function sliceClip(fullPath, outPath, startMs, endMs) {
  const res = spawnSync(
    "npx",
    [
      "remotion",
      "ffmpeg",
      "-hide_banner",
      "-y",
      "-ss",
      (startMs / 1000).toFixed(3),
      "-to",
      (endMs / 1000).toFixed(3),
      "-i",
      fullPath,
      "-c",
      "copy",
      outPath,
    ],
    { encoding: "utf-8", shell: process.platform === "win32" }
  );
  if (res.status !== 0) {
    throw new Error(`ffmpeg slice failed:\n${res.stderr || res.stdout}`);
  }
}

const props = [];

for (const { surah, from, to } of ranges) {
  const ref = `${surah}:${from}-${to}`;
  console.log(`Building ${ref}...`);

  const { audioUrl, timings } = await getSurahTiming(surah);
  const text = await getSurahText(surah);

  const startKey = `${surah}:${from}`;
  const endKey = `${surah}:${to}`;
  if (!timings.has(startKey) || !timings.has(endKey)) {
    console.error(`  Missing timing for ${ref}; skipping.`);
    continue;
  }

  const rangeStartMs = timings.get(startKey).timestamp_from;
  const rangeEndMs = timings.get(endKey).timestamp_to;

  const fullPath = await downloadFullSurah(surah, audioUrl);
  const clipName = `${pad3(surah)}_${pad3(from)}-${pad3(to)}.mp3`;
  const clipPath = join(AUDIO_DIR, clipName);
  console.log(`  Slicing ${((rangeEndMs - rangeStartMs) / 1000).toFixed(1)}s clip...`);
  sliceClip(fullPath, clipPath, rangeStartMs, rangeEndMs);

  const verses = [];
  for (let ayah = from; ayah <= to; ayah++) {
    const t = timings.get(`${surah}:${ayah}`);
    verses.push({
      ayahNumber: ayah,
      arabic: text.arabic.get(ayah) ?? "",
      translation: text.translation.get(ayah) ?? "",
      // Rebase timestamps so the clip starts at 0.
      fromMs: t.timestamp_from - rangeStartMs,
      toMs: t.timestamp_to - rangeStartMs,
    });
  }

  props.push({
    surahName: text.surahName,
    surahNumber: surah,
    fromAyah: from,
    toAyah: to,
    reciter: RECITER_NAME,
    recitationSrc: `audio/${clipName}`,
    recitationStartMs: 0,
    verses,
    backgroundSrc: "video/bg.mp4",
    useVideoAsBackground: false,
    breathSrc: "audio/breath.mp3",
    hookText: "Take a breath",
    hookSubText: "and listen",
    hookDurationInSeconds: 3,
    showProgressBar: true,
    showTimerRing: true,
    tailPaddingInSeconds: 1.5,
    accent: "#D4A853",
  });
}

writeFileSync(join(DATA_DIR, "props.json"), JSON.stringify(props, null, 2));
console.log(`\nWrote ${props.length} video(s) to data/props.json`);
