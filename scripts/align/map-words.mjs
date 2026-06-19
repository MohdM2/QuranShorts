// Shared tokenizer + mapper for the forced-alignment feature.
//
// The SAME tokenizer must (a) produce the word list sent to align.py and
// (b) read the per-word timings it returns, so word indices line up 1:1.
//
// Phrases come from the Quran's own pause marks (waqf): U+06D6..U+06DC. A verse
// with no waqf mark is a single phrase (== the whole ayah).

const WAQF = /[ۖ-ۜ]/u; // small high waqf signs (sad-lam-alef, jeem, ...)
const HAS_LETTER = /\p{L}/u;

// Split verses into the flat list of spoken (letter-bearing) words plus, per
// verse, the phrase groupings as [startWordIdx, endWordIdx) ranges into that
// verse's own spoken words.
export function tokenizeVerses(verses) {
  const words = []; // flat spoken words across all verses (what align.py aligns)
  const wordVerseIdx = []; // verse index for each flat word
  const versePhrases = []; // per verse: array of [start,end) into the verse's words
  const verseWordCount = [];

  verses.forEach((v, vi) => {
    const raw = String(v.arabic || "").trim().split(/\s+/).filter(Boolean);
    let inVerse = 0; // count of spoken words in this verse so far
    let phraseStart = 0;
    const phrases = [];
    for (const tok of raw) {
      const letter = HAS_LETTER.test(tok);
      if (letter) {
        words.push(tok);
        wordVerseIdx.push(vi);
        inVerse += 1;
      }
      if (WAQF.test(tok) && inVerse > phraseStart) {
        phrases.push([phraseStart, inVerse]);
        phraseStart = inVerse;
      }
    }
    if (inVerse > phraseStart) phrases.push([phraseStart, inVerse]);
    if (phrases.length === 0) phrases.push([0, inVerse]); // empty/edge guard
    versePhrases.push(phrases);
    verseWordCount.push(inVerse);
  });

  return { words, wordVerseIdx, versePhrases, verseWordCount };
}

// Map align.py's per-word timings (relative to the aligned audio window, ms)
// back onto verses + phrases. Returns relative ms; the caller adds the window
// offset to get absolute source times.
export function mapTimings(verses, tok, alignedWords) {
  const { wordVerseIdx, versePhrases, verseWordCount } = tok;
  if (alignedWords.length !== wordVerseIdx.length) {
    throw new Error(
      `aligned word count ${alignedWords.length} != tokenized ${wordVerseIdx.length}`
    );
  }
  // slice the flat aligned words per verse
  const perVerse = verses.map(() => []);
  alignedWords.forEach((w, i) => perVerse[wordVerseIdx[i]].push(w));

  const out = verses.map((v, vi) => {
    const vw = perVerse[vi];
    const phrases = versePhrases[vi].map(([s, e]) => {
      const slice = vw.slice(s, e);
      const text = slice.map((w) => w.text).join(" ");
      const startMs = slice.length ? slice[0].startMs : 0;
      const endMs = slice.length ? slice[slice.length - 1].endMs : 0;
      const minScore = slice.length ? Math.min(...slice.map((w) => w.score)) : 0;
      return { text, startMs, endMs, minScore: round3(minScore) };
    });
    const startMs = vw.length ? vw[0].startMs : 0;
    const endMs = vw.length ? vw[vw.length - 1].endMs : 0;
    return { ayahNumber: v.ayahNumber, startMs, endMs, phrases, wordCount: verseWordCount[vi] };
  });

  // Interior boundary between verse i and i+1 = midpoint of the gap (clamped so
  // it never crosses a word). This is what fills state.boundaries[1..n-1].
  const interior = [];
  for (let i = 0; i < out.length - 1; i++) {
    const gapStart = out[i].endMs;
    const gapEnd = out[i + 1].startMs;
    interior.push(Math.round(gapEnd >= gapStart ? (gapStart + gapEnd) / 2 : gapEnd));
  }
  return { verses: out, interior };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
