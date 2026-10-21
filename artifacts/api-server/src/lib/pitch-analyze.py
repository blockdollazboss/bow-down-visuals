#!/usr/bin/env python3
"""Estimate the dominant tuning drift of an audio signal.

Reads raw f32le mono PCM at 8000 Hz from stdin (ffmpeg decodes +
highpasses the source before piping it here), runs a frame-wise
FFT-autocorrelation pitch estimate on a band favorable to voice, and
prints a single JSON object to stdout:

  {"medianCentsOffset": <float>, "voicedFrames": <int>,
   "totalFrames": <int>, "confident": <bool>}

medianCentsOffset is the median deviation (in cents, -50..+50) of
voiced frames from the nearest semitone. Positive means the material
sits sharp of the nearest semitone; negative means flat.

This measures *global* tuning drift of the dominant pitched content —
it cannot do note-by-note correction. Callers scale the correction by
a user strength and apply it as one fractional-semitone shift.

Requires numpy. Fails loudly (non-zero exit, stderr) when it cannot.
"""

import json
import math
import sys

import numpy as np

SAMPLE_RATE = 8000
FRAME = 2048          # 256 ms analysis window
HOP = 1024            # 128 ms hop
MIN_HZ = 80.0
MAX_HZ = 800.0        # voice-fundamental range; harmonics carry the rest
VOICED_THRESHOLD = 0.45
MIN_VOICED_FRAMES = 20


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
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if path:
        with open(path, "rb") as fh:
            raw = fh.read()
    else:
        raw = sys.stdin.buffer.read()
    samples = np.frombuffer(raw, dtype="<f4")
    if samples.size < FRAME:
        print(json.dumps({
            "medianCentsOffset": 0.0, "voicedFrames": 0,
            "totalFrames": 0, "confident": False,
        }))
        return 0

    deviations: list[float] = []
    total = 0
    for start in range(0, samples.size - FRAME + 1, HOP):
        total += 1
        freq, voiced = estimate_frame_freq(samples[start:start + FRAME])
        if not voiced or freq <= 0:
            continue
        cents = 1200.0 * math.log2(freq / 440.0)
        # Deviation from the nearest semitone, folded to [-50, +50].
        dev = cents - round(cents / 100.0) * 100.0
        deviations.append(dev)

    voiced = len(deviations)
    if voiced < MIN_VOICED_FRAMES:
        median = 0.0
        confident = False
    else:
        median = float(np.median(np.asarray(deviations, dtype=np.float64)))
        confident = True

    print(json.dumps({
        "medianCentsOffset": round(median, 1),
        "voicedFrames": voiced,
        "totalFrames": total,
        "confident": confident,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
