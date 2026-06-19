# Forced-alignment sidecar

Auto-detects verse boundaries and sub-verse "sentence" timing from recitation
audio, so you don't mark every verse by hand. Because the composer already
knows *which* verses you picked, this is **forced alignment** (known text →
audio), not transcription — the word order is fixed, so the interior is a clean
monotonic alignment.

## What it does

1. The composer extracts the marked audio window (`/api/align`) to 16k mono wav.
2. `align.py` aligns each Arabic word to the audio with torchaudio's `MMS_FA`
   multilingual forced-alignment pipeline (+ `uroman` to romanize Arabic into
   the pipeline's dictionary). It returns per-word start/end times.
3. `map-words.mjs` maps words back to ayat and splits each ayah at its **waqf
   (pause) marks** (U+06D6–06DC) into phrases — the natural "sentences".
4. Verse boundaries are placed at the **midpoint of the silence** between ayat,
   so cuts land on a breath, not mid-word.

Word timings flow into `verses[].fromMs/toMs` (boundaries) and, when phrase mode
is on, `verses[].phrases[]` (sentence-by-sentence display in `AyahText`).

## Setup (one time)

torch has no wheels for the repo's Python 3.14, so the sidecar runs in an
isolated **Python 3.12** venv. With [uv](https://docs.astral.sh/uv/):

```sh
cd scripts/align
uv venv --python 3.12 .venv
uv pip install --python .venv torch torchaudio --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv -r requirements.txt
```

First alignment downloads the `MMS_FA` model (~1GB) into the torch hub cache.
The composer auto-detects `.venv/Scripts/python.exe` (Windows) / `.venv/bin/python`.

## How to use (in the composer)

In the **Mark** step: mark only the **first** boundary (range start) and the
**last** (range end), then click **✨ Auto-align verses**. Toggle *"Show
sentence-by-sentence"* for phrase mode. Nudge any boundary afterward with
`← →` + `U` — alignment proposes, you stay in control.

## Accuracy (measured)

Against a hand-marked Al-Imran 190–195 clip (162s, 120 words):

- Verse-boundary error: **mean ~243ms, max ~384ms** — every boundary lands
  inside the 740–1080ms silence gaps, so no word is clipped.
- 120/120 words aligned; waqf phrase splits land on the pauses.
- ~90s on CPU for 162s of audio (one-time per video; shorter clips scale down).

## Limitations

- Classical tajweed (madd elongation, idgham) can blur edges — `uroman` + MMS is
  general multilingual, not Quran-tuned.
- Riwayah mismatch (text Hafs / audio Warsh) drifts.
- Heavy verse repetition or a clip truncated mid-verse needs a manual nudge.
- Per-phrase **translation** isn't aligned yet (phrase mode shows Arabic only).

## Dev test

`_selftest.py` rebuilds the test input from `data/projects/al-emran.json` and
compares aligned boundaries to the hand-marked truth. Regenerate the test wav
first (it's git-ignored):

```sh
node_modules/ffmpeg-static/ffmpeg.exe -ss 4292.609 -t 162.470 \
  -i public/media/recitations/yt_MHIVwPqXGBo.mp4 -ac 1 -ar 16000 -y \
  scripts/align/_test_003_190-195.wav
python scripts/align/_selftest.py prep
scripts/align/.venv/Scripts/python.exe scripts/align/align.py \
  --in scripts/align/_test_in.json --out scripts/align/_test_out.json
python scripts/align/_selftest.py compare
```
