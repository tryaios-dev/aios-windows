"""Cut live audio into phrases at pauses (ADR 0016: text appears phrase by phrase).

Audio is 16 kHz, mono, 16-bit little-endian PCM, as the window sends it. A phrase ends at a
pause of PAUSE_S after some speech, or at MAX_PHRASE_S, where the quietest moment of its last
seconds is chosen so a word is not cut in half. Audio with no speech is never sent to Whisper:
on silence it tends to invent words.

Pure functions and one small class, no I/O: tested on synthetic audio.
"""

import io
import math
import sys
import wave
from array import array
from dataclasses import dataclass, field

RATE = 16_000
BYTES_PER_SAMPLE = 2
FRAME_S = 0.02  # 20 ms frames for the loudness measure
FRAME = int(RATE * FRAME_S)  # samples per frame

PAUSE_S = 0.6  # silence that ends a phrase
MIN_SPEECH_S = 0.25  # less speech than this is a cough or a click
MAX_PHRASE_S = 20.0  # cut a phrase that runs on, near its quietest moment
LEAD_S = 0.3  # silence kept before speech starts
TAIL_S = 0.3  # silence kept after the last word when Done is pressed
PAD_S = 0.2  # silence added around each phrase sent to Whisper
SPEECH_FLOOR = 350.0  # RMS on the int16 scale, about -39 dBFS: below this is never speech
NOISE_RATIO = 3.0  # speech is at least this many times louder than the room


def samples(pcm: bytes) -> "array[int]":
    a: array[int] = array("h")
    a.frombytes(pcm[: len(pcm) - len(pcm) % BYTES_PER_SAMPLE])
    if sys.byteorder == "big":
        a.byteswap()
    return a


def frame_rms(pcm: bytes) -> list[float]:
    """Loudness of each whole 20 ms frame."""
    s = samples(pcm)
    out = []
    for start in range(0, len(s) - FRAME + 1, FRAME):
        chunk = s[start : start + FRAME]
        out.append(math.sqrt(sum(v * v for v in chunk) / FRAME))
    return out


def padded(pcm: bytes) -> bytes:
    """The phrase with PAD_S of silence before and after: speech that starts at the very first
    instant of the audio often loses its first word in Whisper."""
    pad = bytes(round(PAD_S * RATE) * BYTES_PER_SAMPLE)
    return pad + pcm + pad


def wav(pcm: bytes) -> bytes:
    """The phrase as a WAV file, the form whisper-server reads."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(BYTES_PER_SAMPLE)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return buf.getvalue()


def audio_ctx(pcm: bytes) -> int:
    """Whisper's window fitted to the audio (50 encoder frames per second, plus a margin), as
    measured in the spike; 1500 is the full 30 s window."""
    seconds = len(pcm) / (RATE * BYTES_PER_SAMPLE)
    return min(1500, math.ceil(seconds * 50) + 64)


def clean(text: str) -> str:
    """Whisper's own markers for non-speech ("[BLANK_AUDIO]", "(music)") are not words."""
    words = []
    for word in text.split():
        if (word.startswith("[") and word.endswith("]")) or (
            word.startswith("(") and word.endswith(")")
        ):
            continue
        words.append(word)
    return " ".join(words)


@dataclass
class Phrases:
    """Audio waiting to become phrases. ``add`` returns the phrases it completed."""

    pcm: bytearray = field(default_factory=bytearray)
    levels: list[float] = field(default_factory=list)  # one per whole frame of ``pcm``
    noise: float = SPEECH_FLOOR / NOISE_RATIO  # the room's loudness, learned as it goes

    def add(self, chunk: bytes) -> list[bytes]:
        whole = len(self.pcm) // (FRAME * BYTES_PER_SAMPLE)
        self.pcm.extend(chunk)
        tail = bytes(self.pcm[whole * FRAME * BYTES_PER_SAMPLE :])
        new = frame_rms(tail)
        for level in new:
            if level < self.threshold():
                # The room: follow it down quickly, up slowly.
                rate = 0.3 if level < self.noise else 0.02
                self.noise += (level - self.noise) * rate
        self.levels.extend(new)
        out = []
        while (cut := self._cut()) is not None:
            phrase = self._take(cut)
            if phrase:
                out.append(phrase)
        self._trim_silence()
        return out

    def flush(self) -> bytes | None:
        """What is left, if it holds speech (Done was pressed). The silence between the last
        word and Done is cut to TAIL_S: on a long silence Whisper tends to add words nobody said
        (on the VM: "Ciao, come stai? Ciao, how are you?")."""
        t = self.threshold()
        spoken = [i for i, v in enumerate(self.levels) if v >= t]
        phrase = None
        if spoken:
            end = min(len(self.levels), spoken[-1] + 1 + round(TAIL_S / FRAME_S))
            phrase = self._take(end)
        self.pcm.clear()
        self.levels.clear()
        return phrase

    def threshold(self) -> float:
        return max(SPEECH_FLOOR, self.noise * NOISE_RATIO)

    @property
    def seconds(self) -> float:
        return len(self.pcm) / (RATE * BYTES_PER_SAMPLE)

    # ---- internals ------------------------------------------------------------------------

    def _speech_frames(self, start: int, end: int) -> int:
        t = self.threshold()
        return sum(1 for v in self.levels[start:end] if v >= t)

    def _cut(self) -> int | None:
        """Frame index where the first complete phrase ends, if there is one."""
        pause = round(PAUSE_S / FRAME_S)
        min_speech = round(MIN_SPEECH_S / FRAME_S)
        longest = round(MAX_PHRASE_S / FRAME_S)
        t = self.threshold()
        quiet = 0
        for i, level in enumerate(self.levels):
            quiet = quiet + 1 if level < t else 0
            if quiet >= pause and self._speech_frames(0, i) >= min_speech:
                return i - quiet + 1 + pause // 2  # keep a little of the pause
            if i + 1 >= longest:
                # Runs on: cut at the quietest frame of the last 3 s.
                window = range(max(1, i - round(3 / FRAME_S)), i + 1)
                return min(window, key=lambda j: self.levels[j]) + 1
        return None

    def _take(self, frames: int) -> bytes | None:
        """Remove the first ``frames`` frames; return them if they hold speech."""
        has_speech = self._speech_frames(0, frames) >= round(MIN_SPEECH_S / FRAME_S)
        end = frames * FRAME * BYTES_PER_SAMPLE
        phrase = bytes(self.pcm[:end])
        del self.pcm[:end]
        del self.levels[:frames]
        return phrase if has_speech else None

    def _trim_silence(self) -> None:
        """Before any speech, keep only the last LEAD_S of silence: nothing to transcribe."""
        if self._speech_frames(0, len(self.levels)):
            return
        keep = round(LEAD_S / FRAME_S)
        drop = len(self.levels) - keep
        if drop > 0:
            del self.pcm[: drop * FRAME * BYTES_PER_SAMPLE]
            del self.levels[:drop]
