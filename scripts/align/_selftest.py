"""Self-test: align a known Al-Imran segment and compare ayah boundaries to the
hand-marked truth in data/projects/al-emran.json. Run with the BASE interpreter
for prep, then align.py with the venv interpreter, then this again to compare.

  python scripts/align/_selftest.py prep
  scripts/align/.venv/Scripts/python.exe scripts/align/align.py --in scripts/align/_test_in.json --out scripts/align/_test_out.json
  python scripts/align/_selftest.py compare
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALIGN = ROOT / "scripts" / "align"
PROJ = ROOT / "data" / "projects" / "al-emran.json"
WAV = ALIGN / "_test_003_190-195.wav"
IN = ALIGN / "_test_in.json"
OUT = ALIGN / "_test_out.json"


def has_letter(tok: str) -> bool:
    return any(unicodedata.category(c).startswith("L") for c in tok)


def load_verses():
    return json.load(open(PROJ, encoding="utf-8"))[0]["verses"]


def prep():
    verses = load_verses()
    words, word_ayah = [], []
    for v in verses:
        for tok in re.split(r"\s+", v["arabic"].strip()):
            if has_letter(tok):  # skip standalone waqf/punctuation marks
                words.append(tok)
                word_ayah.append(v["ayahNumber"])
    json.dump(
        {"audio": str(WAV), "words": words, "lang": "ara", "_wordAyah": word_ayah},
        open(IN, "w", encoding="utf-8"),
        ensure_ascii=False,
    )
    print(f"prep: {len(words)} words across {len(verses)} verses -> {IN.name}")


def compare():
    verses = load_verses()
    req = json.load(open(IN, encoding="utf-8"))
    res = json.load(open(OUT, encoding="utf-8"))
    word_ayah = req["_wordAyah"]
    aligned = res["words"]
    assert len(word_ayah) == len(aligned), (len(word_ayah), len(aligned))

    # predicted ayah start = first aligned word of that ayah
    first_start, last_end = {}, {}
    for ay, w in zip(word_ayah, aligned):
        if ay not in first_start:
            first_start[ay] = w["startMs"]
        last_end[ay] = w["endMs"]

    print(f"\naudioMs={res['audioMs']}  words={len(aligned)}  "
          f"placeholders={sum(w['placeholder'] for w in aligned)}")
    print(f"{'ayah':>4} {'truth_from':>10} {'pred_from':>9} {'Δstart':>7} "
          f"{'truth_to':>9} {'pred_to':>8} {'Δend':>6}")
    errs = []
    for v in verses:
        ay = v["ayahNumber"]
        ps, pe = first_start.get(ay, 0), last_end.get(ay, 0)
        ds, de = ps - v["fromMs"], pe - v["toMs"]
        errs += [abs(ds), abs(de)]
        print(f"{ay:>4} {v['fromMs']:>10} {ps:>9} {ds:>+7} "
              f"{v['toMs']:>9} {pe:>8} {de:>+6}")
    errs.sort()
    mean = sum(errs) / len(errs)
    p50 = errs[len(errs) // 2]
    p90 = errs[int(len(errs) * 0.9)]
    print(f"\nboundary error ms — mean {mean:.0f}  median {p50}  p90 {p90}  max {errs[-1]}")


if __name__ == "__main__":
    {"prep": prep, "compare": compare}[sys.argv[1]]()
