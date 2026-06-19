// One verse within a continuous recitation clip. fromMs/toMs are relative to the
// start of the (sliced) clip, taken from the reciter's gapless surah recording.
export type VerseTiming = {
  ayahNumber: number;
  arabic: string;
  translation: string;
  fromMs: number;
  toMs: number;
  // Optional sub-verse phrases, split at the Quran's waqf (pause) marks, each
  // with its own timing (same recitationStartMs-relative base as fromMs/toMs).
  // Produced by the forced-alignment feature; when present and phrase mode is
  // on, AyahText reveals these one at a time instead of the whole ayah at once.
  phrases?: VersePhrase[];
};

export type VersePhrase = {
  text: string; // Arabic words of this phrase (joined)
  fromMs: number;
  toMs: number;
};

// One video = a continuous range of verses from a single surah, played from one
// gapless audio clip with the verse text synced to the recitation via timestamps.
export type VideoProps = {
  surahName: string;
  surahNumber: number;
  fromAyah: number;
  toAyah: number;
  reciter: string;
  recitationSrc: string; // continuous media for the range (audio file or video)
  // Offset (ms) into recitationSrc where the range begins. 0 when the media is
  // already sliced to the range; >0 when using a full-surah source (e.g. a video
  // marked in the marker tool). verses[].fromMs/toMs are relative to this offset.
  recitationStartMs: number;
  // Volume envelope for the recitation: ramp the voice up over the first
  // fadeInSeconds and down over the last fadeOutSeconds (0 = no fade).
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  verses: VerseTiming[];
  // Ayah typography. arabicFont/englishFont are keys into the curated font sets
  // in lib/fonts.ts (fall back to Scheherazade New / Cormorant Garamond when
  // unset). arabicFontSize/englishFontSize are px on the 1080×1920 canvas
  // (defaults 64 / 26).
  arabicFont?: string;
  englishFont?: string;
  arabicFontSize?: number;
  englishFontSize?: number;
  backgroundSrc: string;
  // When true, backgroundSrc is a pre-baked clip: already blurred/darkened and
  // paced to the recitation length, so it plays at 1× with no live filter.
  // The grade values are kept for re-editing in the Composer.
  backgroundBaked?: boolean;
  bgSource?: string; // raw clip the baked background came from (Composer re-editing)
  bgBlur?: number; // px
  bgDarken?: number; // 0..1 brightness multiplier baked in
  bgSaturation?: number; // saturation multiplier baked in
  // Background opacity ramp: fade up from black at the start of its span and
  // back to black at the end (seconds; defaults 0.9 in / 1 out).
  bgFadeInSeconds?: number;
  bgFadeOutSeconds?: number;
  // How the raw clip was fit to the recitation length when baking (kept for
  // re-editing in the Composer; the result is already burned into the file).
  // bgFit: "natural" (1× — trim if long, loop if short) | "stretch" (retime).
  // bgLoopStyle: "crossfade" | "boomerang" | "hard" (natural + short only).
  bgFit?: "natural" | "stretch";
  bgLoopStyle?: "crossfade" | "boomerang" | "hard";
  // Background composition: "single" bakes one clip across the whole recitation;
  // "collage" bakes one clip per verse (stretched if shorter than the verse,
  // trimmed if equal/longer) concatenated into a single paced file. bgCollage is
  // the per-verse list of raw clip filenames the collage was built from (kept for
  // re-editing in the Composer; the result is already burned into backgroundSrc).
  bgMode?: "single" | "collage";
  bgCollage?: string[];
  // When true, recitationSrc is also used as the (faceless) background video
  // instead of backgroundSrc.
  useVideoAsBackground: boolean;
  breathSrc: string;
  hookText: string;
  hookSubText: string;
  // Arabic counterparts shown above the English in the breath hook.
  hookTextAr?: string;
  hookSubTextAr?: string;
  // Breath intro tuning.
  // breathColor: the calm color the circle fills with (defaults to accent).
  // breathInEndSeconds: seconds into the hook where the inhale ends and the
  //   exhale begins — the circle fills during the inhale, empties during the
  //   exhale, and the "listen" line appears on the exhale.
  // breathStartDelaySeconds: stillness before the circle begins to fill.
  breathColor?: string;
  breathInEndSeconds?: number;
  breathStartDelaySeconds?: number;
  hookDurationInSeconds: number;
  // Natural duration of backgroundSrc (seconds), measured in calculateMetadata,
  // so AyahVideo can time-stretch the clip to span the whole recitation once.
  backgroundDurationInSeconds?: number;
  // Deprecated/inert: the bottom progress bar was removed — Instagram Reels and
  // TikTok draw their own seek bar across the bottom, so ours was redundant and
  // buried under the caption. Kept for back-compat with saved data; ignored at
  // render. Progress is now shown by the timer ring only (showTimerRing).
  // When true (and verses carry aligned phrases), reveal each verse one waqf
  // phrase ("sentence") at a time instead of the whole ayah at once.
  phraseMode?: boolean;
  showProgressBar: boolean;
  showTimerRing: boolean;
  // Platform safe-area insets (px on the 1080×1920 canvas) kept clear of the
  // host app's overlay UI: right = action rail (like/comment/share/profile),
  // bottom = caption + audio ticker + the platform's own seek bar, top = tabs /
  // search, left = a small breathing margin. Ayah text and the progress
  // indicators stay inside this box. Defaults: top 130 / right 150 / bottom 340
  // / left 48. Set any to 0 to reclaim the edge (e.g. a non-overlay export).
  safeTop?: number;
  safeRight?: number;
  safeBottom?: number;
  safeLeft?: number;
  tailPaddingInSeconds: number;
  accent: string;
};
