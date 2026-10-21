#!/usr/bin/env python3
"""Note-level pitch tracking for hard-tune pitch correction.

Reads raw f32le mono PCM at 8000 Hz from a file path argument, runs a
frame-wise FFT-autocorrelation pitch estimate on a band favorable to
voice, groups consecutive voiced frames into notes by their nearest
semitone target, and prints a single JSON object to stdout:

  {"notes": [{"start": <seconds>, "end": <seconds>,
              "shiftCents": <float>}],
   "voicedFrames": <int>, "totalFrames": <int>,
   "confident": <bool>, "duration": <seconds>}

Each note's shiftCents is the FULL snap of the note's median pitch to
its target semitone (hard-tune: strength 100, instant retune). Unvoiced
regions are omitted from the note list — callers fill those gaps with
zero shift.

This is real pitch tracking, not a guess: the same autocorrelation
estimator as pitch-analyze.py, but per-note instead of global. On a
full mix (not an isolated vocal) the tracker follows the strongest
pitched material, so hard-tune works best on isolated vocals — the UI
copy must say so.

Requires numpy. Fails loudly (non-zero exit, stderr) when it cannot.
"""

import json
import math
import sys

import numpy as np

SAMPLE_RATE = 8000
FRAME = 2048          # 256 ms analysis window
HOP = 512             # 64 ms hop — note-boundary resolution
MIN_HZ = 80.0
MAX_HZ = 800.0        # voice-fundamental range; harmonics carry the rest
VOICED_THRESHOLD = 0.45
MIN_VOICED_FRAMES = 20
MIN_NOTE_FRAMES = 2   # shorter blips are treated as unvoiced
QUANT_CENTS = 5.0     # snap quantization — keeps the segment count sane


def estimate_frame_freq(frame: np.ndarray) -> tuple[float, bool]:
    frame = frame - frame.mean()
    windowed = frame * np.hanning(len(frame))
    n = 1
    while n < 2 * len(windowed):
        n *= 2
    spectrum = np.fft.rfft(windowed, n)
    ac = np.fft.irfft(np.abs(spectrum) ** 2, n)[: len(windowed)]
    if ac[0] <= 0:
        return 0.0, False
    ac = ac / ac[0]

    min_lag = max(1, int(SAMPLE_RATE / MAX_HZ))
    max_lag = min(len(ac) - 2, int(SAMPLE_RATE / MIN_HZ))
    if max_lag <= min_lag:
        return 0.0, False

    segment = ac[min_lag:max_lag]
    peak = int(np.argmax(segment)) + min_lag
    periodicity = float(ac[peak])
    if periodicity < VOICED_THRESHOLD:
        return 0.0, False

    # Parabolic interpolation for sub-sample lag precision.
    if 0 < peak < len(ac) - 1:
        a, b, c = ac[peak - 1], ac[peak], ac[peak + 1]
        denom = a - 2 * b + c
        if denom != 0:
            peak = peak + 0.5 * (a - c) / denom
    if peak <= 0:
        return 0.0, False
    return SAMPLE_RATE / peak, True


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: pitch-track.py <f32le-mono-8k-pcm>", file=sys.stderr)
        return 2
    with open(sys.argv[1], "rb") as fh:
        raw = fh.read()
    samples = np.frombuffer(raw, dtype="<f4")
    duration = samples.size / SAMPLE_RATE

    # Per-frame pitch + nearest-semitone target.
    frames: list[tuple[float, int]] = []  # (freq, midi target) or (0.0, -1)
    total = 0
    for start in range(0, samples.size - FRAME + 1, HOP):
        total += 1
        freq, voiced = estimate_frame_freq(samples[start:start + FRAME])
        if not voiced or freq <= 0:
            frames.append((0.0, -1))
            continue
        cents = 1200.0 * math.log2(freq / 440.0)
        midi = int(round(69 + cents / 100.0))
        frames.append((freq, midi))

    # Group consecutive voiced frames sharing a midi target into notes.
    raw_notes: list[dict] = []
    i = 0
    while i < len(frames):
        freq, midi = frames[i]
        if midi < 0:
            i += 1
            continue
        j = i
        while j < len(frames) and frames[j][1] == midi:
            j += 1
        if j - i >= MIN_NOTE_FRAMES:
            freqs = [frames[k][0] for k in range(i, j)]
            median_freq = float(np.median(np.asarray(freqs, dtype=np.float64)))
            target_cents = (midi - 69) * 100.0
            median_cents = 1200.0 * math.log2(median_freq / 440.0)
            shift = target_cents - median_cents  # full snap to the target
            shift = round(shift / QUANT_CENTS) * QUANT_CENTS
            raw_notes.append({
                "start": round(i * HOP / SAMPLE_RATE, 3),
                "end": round(j * HOP / SAMPLE_RATE, 3),
                "shiftCents": round(shift, 1),
            })
        i = j

    voiced = sum(1 for f in frames if f[1] >= 0)
    confident = voiced >= MIN_VOICED_FRAMES

    print(json.dumps({
        "notes": raw_notes,
        "voicedFrames": voiced,
        "totalFrames": total,
        "confident": confident,
        "duration": round(duration, 3),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
