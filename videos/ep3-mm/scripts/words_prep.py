#!/usr/bin/env python3
"""Cut each processed narration file into windows of at most MAXW s, split at pauses, for scripts/words.mjs:
whisper's own 30 s chunking dropped whole windows and looped on some EP3 files; short windows cut at pauses don't."""
import subprocess, os, json, sys
import numpy as np
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
OUT, MAXW = sys.argv[1] if len(sys.argv) > 1 else '/tmp/asr/win', 18.0
os.makedirs(OUT, exist_ok=True)
man = []
for f in sorted(x for x in os.listdir('assets/audio/voice') if x.startswith('p')):
    src = f'assets/audio/voice/{f}'; page = f[:-4]
    x = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True).stdout, np.float32)
    hop = 160; n = len(x) // hop
    db = 10 * np.log10(np.mean(x[:n * hop].reshape(n, hop) ** 2, 1) + 1e-12)
    quiet = np.convolve(db < db.max() - 35, np.ones(15) / 15, 'same') > 0.99      # 150 ms of quiet
    cuts, t = [0.0], 0.0
    while len(x) / 16000 - t > MAXW:
        lo, hi = int((t + MAXW * 0.55) * 100), int((t + MAXW) * 100)
        q = np.flatnonzero(quiet[lo:hi]); c = (lo + (q[len(q) // 2] if len(q) else hi - lo)) / 100
        cuts.append(c); t = c
    cuts.append(len(x) / 16000)
    for k, (a, b) in enumerate(zip(cuts, cuts[1:])):
        w = f'{OUT}/{page}-{k}.wav'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-ss', f'{a:.2f}', '-to', f'{b:.2f}', '-ac', '1', '-ar', '16000', w], check=True)
        man.append({'page': page, 'wav': w, 'offset': round(a, 3), 'len': round(b - a, 3)})
json.dump(man, open(f'{OUT}/manifest.json', 'w'), indent=0)
print(len(man), 'windows')
