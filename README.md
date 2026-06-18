# Quran Shorts

Faceless, voiceless Quran short-form videos for TikTok / Reels / Shorts.
Built with [Remotion](https://remotion.dev) — React-based programmatic video.

**Output:** Vertical 1080×1920, 30fps, H.264 MP4.

## Setup

```bash
npm install
```

### Required Assets

You must provide these files yourself (not included in the repo):

1. **`public/video/bg.mp4`** — A looping background video (nature, mosque, calligraphy, abstract).
   Recommended: 1080×1920, 30fps, at least 60s long, royalty-free.
   Sources: [Pexels](https://pexels.com), [Pixabay](https://pixabay.com).

2. **`public/audio/breath.mp3`** — A short (~2s) breath/inhale sound effect.
   Sources: [Freesound](https://freesound.org), [Pixabay Audio](https://pixabay.com/sound-effects/).

Recitation audio is downloaded automatically by the build script from alquran.cloud.

## Usage

### Studio (live preview)

```bash
npm run studio
```

Each video is **one continuous range of verses from a single surah**, played from
a single gapless recitation so there is no silence or cut between verses — only
the on-screen text changes, synced to per-verse timestamps.

There are two ways to produce a video's timing:

### A. Ayah Composer (recommended — your own video, composed by ear)

Use this when you have your own surah video/audio and want frame-accurate verse
boundaries and a graded background.

1. Start the Composer:
   ```bash
   npm run compose
   ```
   Open http://localhost:4321.
2. Get the source video, either:
   - **Paste a YouTube URL** and click **Fetch & load** — it downloads into
     `public/video/` (uses `yt-dlp`, fetched automatically on first use; a
     progressive mp4 so no ffmpeg is needed), or
   - drop your own media into `public/video/` and pick it from **Source video**.
3. Choose the **surah** and **from / to verse** from the dropdowns, click
   **Load verses** (Arabic + translation are fetched automatically).
4. Play and tap **Space** at the start of each verse, then once more at the end
   of the last verse. Fine-tune any boundary with **← →** (±1 frame),
   **⇧ ← →** (±10 frames), select a boundary and press **U** to set it to the
   playhead.
5. Pick an accent and set the **voice fade in / out** (seconds the recitation
   ramps up at the start and down at the end). Click **Background** in the footer
   to choose any clip in `public/video/` from a live-preview gallery and set its
   **blur** and **darken** with sliders — the preview shows exactly what renders.
6. **Save → props.json**. On save the chosen background is **baked**: blurred,
   darkened, cover-fit to 1080×1920 and **looped/paced to fill the recitation**,
   written to `public/video/baked_*.mp4`. This bakes the grade into the file so
   the composition just decodes a normal clip — smooth preview, fast render, and
   the preview matches the render exactly. Only the source's **audio** is used
   for the recitation; the background fades in from black after the breath intro.
   You'll see "✓ Baked & saved" when ffmpeg finishes (a few seconds to ~1 min).

   Re-open the Composer later and the **Open saved video** dropdown reloads any
   saved entry — its source, range, verses, breakpoints, accent, fades, and
   background grade — so you can fine-tune and re-bake.
7. Render:
   ```bash
   npm run render:all       # all videos in props.json
   # or a single one:
   npx remotion render AyahVideo out/video.mp4
   ```
   Output goes to `out/SSS_FFF-TTT.mp4` (surah, from, to — zero-padded).

### B. Automatic timings (Quran.com gapless API)

Use this to fetch a reciter's gapless recitation and verse timestamps without
marking anything yourself (Mishary Alafasy by default).

1. Edit `data/verses.json` with continuous ranges:
   ```json
   [{"surah": 3, "from": 190, "to": 200}]
   ```
2. Fetch timings, download the recitation, and slice each range:
   ```bash
   npm run build:props
   ```
3. Render:
   ```bash
   npm run render:all
   ```

## Architecture

```
src/
  index.ts          → registerRoot
  Root.tsx          → Composition; calculateMetadata derives duration from the range
  AyahVideo.tsx    → One continuous <Audio> + per-verse text synced by timestamps
  lib/
    types.ts       → VideoProps (a range) + VerseTiming (fromMs/toMs per verse)
    assets.ts      → resolveSrc (staticFile or URL)
    fonts.ts       → Amiri (Arabic) + Cormorant Garamond (Latin)
  components/
    BreatheHook.tsx    → 3s "Take a breath" intro with circle animation
    AyahText.tsx       → RTL Arabic + English translation with reveal
    BackgroundVideo.tsx → OffthreadVideo with Ken Burns zoom + gradients
    ProgressTimer.tsx  → Bottom progress bar + corner countdown ring
scripts/
  composer.mjs     → Local Ayah Composer server (npm run compose)
  composer-ui.html → The Composer UI (served by composer.mjs)
  build-props.mjs  → Quran.com gapless API → timings + sliced recitation per range
  render-all.mjs   → Bundles once, renders each range to MP4
```

**Data model:** each entry in `data/props.json` is one video — a `{surahNumber,
fromAyah, toAyah}` range with a `recitationSrc` (continuous media), a
`recitationStartMs` offset into it, and `verses[]` carrying each ayah's text plus
`fromMs`/`toMs` (relative to the range start). The composition plays the audio
once and only swaps the verse text at those timestamps, so verses never gap.

## Fonts

Default: **Amiri** (Arabic) and **Inter** (Latin) via `@remotion/google-fonts`.

To use **KFGQPC Uthmanic Script** instead:

1. Download the `.ttf` from the KFGQPC website
2. Place it in `public/fonts/UthmanicHafs.ttf`
3. In `src/lib/fonts.ts`, replace the Amiri import with:

```ts
import { staticFile } from "remotion";

const uthmanicFontFace = new FontFace(
  "KFGQPC Uthmanic Script HAFS",
  `url(${staticFile("fonts/UthmanicHafs.ttf")})`
);
uthmanicFontFace.load();

export const ARABIC_FONT = "KFGQPC Uthmanic Script HAFS";
```

## Content Constraints

- **Recitation audio:** Real human reciter only (Alafasy default). Never use AI/TTS.
- **Backgrounds:** Nature, calligraphy, mosques, or abstract only. No depictions of
  the Prophet ﷺ, other prophets, or the Sahaba.
- **Aesthetic:** Calm, dark, cinematic, restrained motion. Warm gold accent default.

## Customization

Edit `defaultProps` in `src/Root.tsx` or pass different props via `data/props.json`:

- `accent` — any CSS color for the progress bar, ring, and accents
- `hookText` / `hookSubText` — intro text (English)
- `hookTextAr` / `hookSubTextAr` — intro text (Arabic, shown above the English)
- `hookDurationInSeconds` — hook length (default 3s)
- `tailPaddingInSeconds` — silence after recitation ends (default 1.5s)
- `fadeInSeconds` / `fadeOutSeconds` — recitation volume ramp at start / end
- `showProgressBar` / `showTimerRing` — toggle UI elements
