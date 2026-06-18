import { loadFont as loadScheherazade } from "@remotion/google-fonts/ScheherazadeNew";
import { loadFont as loadAmiriQuran } from "@remotion/google-fonts/AmiriQuran";
import { loadFont as loadAmiri } from "@remotion/google-fonts/Amiri";
import { loadFont as loadNotoNaskh } from "@remotion/google-fonts/NotoNaskhArabic";
import { loadFont as loadLateef } from "@remotion/google-fonts/Lateef";
import { loadFont as loadMarkazi } from "@remotion/google-fonts/MarkaziText";
import { loadFont as loadArefRuqaa } from "@remotion/google-fonts/ArefRuqaa";
import { loadFont as loadCormorant } from "@remotion/google-fonts/CormorantGaramond";
import { loadFont as loadEBGaramond } from "@remotion/google-fonts/EBGaramond";
import { loadFont as loadGentium } from "@remotion/google-fonts/GentiumBookPlus";
import { loadFont as loadCrimson } from "@remotion/google-fonts/CrimsonPro";
import { loadFont as loadLora } from "@remotion/google-fonts/Lora";
import { loadFont as loadMarcellus } from "@remotion/google-fonts/Marcellus";

// A curated set of typefaces appropriate for Quranic text and its translation.
// The Composer lets each video pick one of each (plus a font size); the chosen
// key is stored in props and resolved back to the loaded family at render time
// so Studio/preview and the final MP4 match exactly. Keys are stable strings
// shared with the Composer UI — do not rename without updating composer-ui.html.

export type FontDef = { key: string; label: string; note: string; family: string };

// --- Arabic faces (Naskh-family unless noted; all carry Quranic harakat) ------
const arabicFaces: { key: string; label: string; note: string; family: string }[] = [
  {
    key: "scheherazade",
    label: "Scheherazade New",
    note: "Traditional Quranic Naskh",
    family: loadScheherazade("normal", { weights: ["400", "500"], subsets: ["arabic", "latin"] }).fontFamily,
  },
  {
    key: "amiri-quran",
    label: "Amiri Quran",
    note: "Mushaf-style, tuned for tashkeel",
    family: loadAmiriQuran("normal", { weights: ["400"], subsets: ["arabic", "latin"] }).fontFamily,
  },
  {
    key: "amiri",
    label: "Amiri",
    note: "Classical Naskh, slightly bolder",
    family: loadAmiri("normal", { weights: ["400"], subsets: ["arabic", "latin"] }).fontFamily,
  },
  {
    key: "noto-naskh",
    label: "Noto Naskh Arabic",
    note: "Clean, even color — very legible",
    family: loadNotoNaskh("normal", { weights: ["400", "500"], subsets: ["arabic", "latin"] }).fontFamily,
  },
  {
    key: "lateef",
    label: "Lateef",
    note: "Warm extended Naskh",
    family: loadLateef("normal", { weights: ["400", "500"], subsets: ["arabic", "latin"] }).fontFamily,
  },
  {
    key: "markazi",
    label: "Markazi Text",
    note: "Modern, condensed Naskh",
    family: loadMarkazi("normal", { weights: ["400", "500", "600"], subsets: ["arabic", "latin"] }).fontFamily,
  },
  {
    key: "aref-ruqaa",
    label: "Aref Ruqaa",
    note: "Ornate Thuluth — display only",
    family: loadArefRuqaa("normal", { weights: ["400", "700"], subsets: ["arabic", "latin"] }).fontFamily,
  },
];

// --- Latin faces for the translation (refined serifs) -------------------------
const latinFaces: { key: string; label: string; note: string; family: string }[] = [
  {
    key: "cormorant",
    label: "Cormorant Garamond",
    note: "Airy, high-contrast serif",
    family: loadCormorant("normal", { weights: ["300", "400", "600"], subsets: ["latin"] }).fontFamily,
  },
  {
    key: "eb-garamond",
    label: "EB Garamond",
    note: "Classic book Garamond",
    family: loadEBGaramond("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily,
  },
  {
    key: "gentium",
    label: "Gentium Book Plus",
    note: "SIL serif — pairs with Scheherazade",
    family: loadGentium("normal", { weights: ["400", "700"], subsets: ["latin"] }).fontFamily,
  },
  {
    key: "crimson",
    label: "Crimson Pro",
    note: "Calm, literary serif",
    family: loadCrimson("normal", { weights: ["300", "400", "600"], subsets: ["latin"] }).fontFamily,
  },
  {
    key: "lora",
    label: "Lora",
    note: "Sturdy, contemporary serif",
    family: loadLora("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily,
  },
  {
    key: "marcellus",
    label: "Marcellus",
    note: "Inscriptional, elegant caps",
    family: loadMarcellus("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily,
  },
];

export const ARABIC_FONTS: FontDef[] = arabicFaces;
export const LATIN_FONTS: FontDef[] = latinFaces;

const arabicByKey = new Map(arabicFaces.map((f) => [f.key, f]));
const latinByKey = new Map(latinFaces.map((f) => [f.key, f]));

// Defaults preserve the original look (Scheherazade New / Cormorant Garamond).
export const ARABIC_FONT = arabicByKey.get("scheherazade")!.family;
export const LATIN_FONT = latinByKey.get("cormorant")!.family;

export const resolveArabicFont = (key?: string): string =>
  (key && arabicByKey.get(key)?.family) || ARABIC_FONT;
export const resolveLatinFont = (key?: string): string =>
  (key && latinByKey.get(key)?.family) || LATIN_FONT;

// Base sizes (px on the 1080×1920 canvas); the Composer adjusts these directly.
export const ARABIC_FONT_SIZE = 64;
export const LATIN_FONT_SIZE = 26;
