#!/usr/bin/env python3
"""Forced-alignment sidecar for the Quran Shorts composer.

Given recitation audio and the *known* Arabic words (the user already picked the
surah + ayah range), align each word to the audio and return per-word start/end
times. This is forced alignment, not transcription: the word sequence is fixed,
so the interior is a clean monotonic alignment.

Stack: torchaudio's MMS_FA multilingual forced-alignment pipeline + uroman to
romanize the Arabic into the pipeline's roman-letter dictionary.

I/O is a single JSON file each way (keeps the Node side trivial):
  in : {"audio": "<16k mono wav>", "words": ["<arabic word>", ...], "lang": "ara"}
  out: {"audioMs": int, "sampleRate": int,
        "words": [{"text","startMs","endMs","score","placeholder"}...]}

Indices in `out.words` line up 1:1 with `in.words`, so the caller maps words
back to ayat / waqf phrases itself.
"""
import argparse
import json
import re
import sys
import unicodedata


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def strip_diacritics(s: str) -> str:
    """Drop tashkeel, Quranic annotation signs, tatweel, and format chars, so we
    feed uroman bare letters (matches what the roman dictionary can represent)."""
    out = []
    for ch in s:
        if ch == "ـ":  # tatweel (kashida)
            continue
        if unicodedata.category(ch) in ("Mn", "Me", "Cf"):  # marks / format
            continue
        out.append(ch)
    return "".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    args = ap.parse_args()

    with open(args.inp, encoding="utf-8") as f:
        req = json.load(f)
    audio_path = req["audio"]
    words = req["words"]
    lang = req.get("lang", "ara")
    if not words:
        raise SystemExit("no words to align")

    import torch
    import torchaudio
    from torchaudio.pipelines import MMS_FA as bundle

    log(f"[align] torch {torch.__version__}, torchaudio {torchaudio.__version__}")
    log("[align] loading MMS_FA model (first run downloads ~1GB)...")
    model = bundle.get_model()
    model.eval()
    dictionary = bundle.get_dict()
    fallback_tok = dictionary.get("a", next(iter(dictionary.values())))

    # --- romanize each word, keep only dictionary-representable letters --------
    from uroman import Uroman

    log(f"[align] romanizing {len(words)} words...")
    uro = Uroman()

    def romanize(w: str) -> str:
        bare = strip_diacritics(w).strip()
        if not bare:
            return ""
        try:
            r = uro.romanize_string(bare, lcode=lang)
        except TypeError:
            r = uro.romanize_string(bare)
        return re.sub(r"[^a-z]", "", r.lower())

    tokenized = []
    placeholder = []
    for w in words:
        toks = [dictionary[c] for c in romanize(w) if c in dictionary]
        if toks:
            placeholder.append(False)
        else:
            # Keep index alignment even if a word romanizes to nothing; flag it so
            # the caller can treat its timing as unreliable.
            toks = [fallback_tok]
            placeholder.append(True)
        tokenized.append(toks)

    # --- load + normalize audio to the model's sample rate --------------------
    # Load via soundfile (torchaudio 2.11 delegates loading to torchcodec, which
    # is awkward on Windows). The wav is already produced 16k mono by ffmpeg.
    import soundfile as sf

    data, sr = sf.read(audio_path, dtype="float32", always_2d=True)  # [frames, ch]
    wav = torch.from_numpy(data.T)  # [ch, frames]
    if wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)
    if sr != bundle.sample_rate:
        wav = torchaudio.functional.resample(wav, sr, bundle.sample_rate)
        sr = bundle.sample_rate
    audio_ms = int(wav.shape[1] / sr * 1000)

    log("[align] computing emissions...")
    with torch.inference_mode():
        emission, _ = model(wav)

    targets = torch.tensor(
        [t for toks in tokenized for t in toks], dtype=torch.int32
    ).unsqueeze(0)

    log("[align] forced_align...")
    aligned, scores = torchaudio.functional.forced_align(emission, targets, blank=0)
    scores = scores.exp()  # log-prob -> prob, for readable confidence
    token_spans = torchaudio.functional.merge_tokens(aligned[0], scores[0])

    # regroup token spans back into words by token count
    lengths = [len(t) for t in tokenized]
    word_spans = []
    i = 0
    for L in lengths:
        word_spans.append(token_spans[i : i + L])
        i += L

    ratio = wav.shape[1] / emission.shape[1]  # waveform samples per emission frame

    def span_ms(frame: float) -> int:
        return round(frame * ratio / sr * 1000)

    out_words = []
    for w, spans, ph in zip(words, word_spans, placeholder):
        if spans:
            start = span_ms(spans[0].start)
            end = span_ms(spans[-1].end)
            dur = sum(s.end - s.start for s in spans) or 1
            score = sum(s.score * (s.end - s.start) for s in spans) / dur
        else:
            start = end = 0
            score = 0.0
        out_words.append(
            {
                "text": w,
                "startMs": start,
                "endMs": end,
                "score": round(float(score), 3),
                "placeholder": ph,
            }
        )

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(
            {"audioMs": audio_ms, "sampleRate": sr, "words": out_words},
            f,
            ensure_ascii=False,
        )
    log("[align] done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
