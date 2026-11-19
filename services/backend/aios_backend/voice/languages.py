"""Which language a phrase is in, among the languages the person speaks (ADR 0016).

Whisper guesses the language of each phrase among all it knows. On a short phrase that guess is
often wrong ("ciao" heard as English, "Riassumi" as Latin) and the text comes out half
translated. So the person lists the languages they speak, main one first (Settings > Voice):

* one language: it is always used (also the fastest);
* several: Whisper's scores decide among those only; when no listed language is clearly ahead,
  the main one is used. A phrase long and clear enough settles the language for the rest of that
  dictation, so later phrases skip the guess.
* none listed: Whisper's own guess, as before.
"""

from collections.abc import Mapping, Sequence

# Whisper's language codes at the pinned whisper.cpp (src/whisper.cpp, g_lang).
CODES = frozenset(
    (
        "en",
        "zh",
        "de",
        "es",
        "ru",
        "ko",
        "fr",
        "ja",
        "pt",
        "tr",
        "pl",
        "ca",
        "nl",
        "ar",
        "sv",
        "it",
        "id",
        "hi",
        "fi",
        "vi",
        "he",
        "uk",
        "el",
        "ms",
        "cs",
        "ro",
        "da",
        "hu",
        "ta",
        "no",
        "th",
        "ur",
        "hr",
        "bg",
        "lt",
        "la",
        "mi",
        "ml",
        "cy",
        "sk",
        "te",
        "fa",
        "lv",
        "bn",
        "sr",
        "az",
        "sl",
        "kn",
        "et",
        "mk",
        "br",
        "eu",
        "is",
        "hy",
        "ne",
        "mn",
        "bs",
        "kk",
        "sq",
        "sw",
        "gl",
        "mr",
        "pa",
        "si",
        "km",
        "sn",
        "yo",
        "so",
        "af",
        "oc",
        "ka",
        "be",
        "tg",
        "sd",
        "gu",
        "am",
        "yi",
        "lo",
        "uz",
        "fo",
        "ht",
        "ps",
        "tk",
        "nn",
        "mt",
        "sa",
        "lb",
        "my",
        "bo",
        "tl",
        "mg",
        "as",
        "tt",
        "haw",
        "ln",
        "ha",
        "ba",
        "jw",
        "su",
        "yue",
    )
)
MAX_LANGUAGES = 5
# A listed language this far ahead of the others (share of the listed languages' scores) wins.
CLEAR = 0.6
# A phrase this long, with a clear winner, settles the language for the rest of the dictation.
SETTLE_S = 2.5


def valid(languages: Sequence[str]) -> bool:
    return (
        len(languages) <= MAX_LANGUAGES
        and len(set(languages)) == len(languages)
        and all(code in CODES for code in languages)
    )


def choose(scores: Mapping[str, float], languages: Sequence[str]) -> tuple[str, bool]:
    """(the language to transcribe in, whether it is a clear choice). ``languages``: at least
    one, main first; ``scores``: Whisper's score per language code."""
    main = languages[0]
    total = sum(scores.get(code, 0.0) for code in languages)
    if total <= 0:
        return main, False
    best = max(languages, key=lambda code: scores.get(code, 0.0))
    if scores.get(best, 0.0) / total >= CLEAR:
        return best, True
    return main, False
