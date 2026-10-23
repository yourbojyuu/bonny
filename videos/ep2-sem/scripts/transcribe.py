#!/usr/bin/env python3
"""Transcribe the processed narration (assets/audio/voice/NN.m4a) in short pause-bounded phrases and
write scripts/asr.json: {"NN": [{"a": start, "b": end, "text": ...}, ...]}. build_frames.py aligns the
script in SCRIPT.md to these phrases so each cue lands on the moment its words are actually spoken.

Needs `pip install sherpa-onnx` and the Whisper turbo model (Thai works well, small does not):
  https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2
Pass the unpacked model folder as the first argument. Re-run after process_voice.py changes the audio."""
import sys, os, glob, json, subprocess
import numpy as np, sherpa_onnx
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
M = sys.argv[1]
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f'{M}/turbo-encoder.int8.onnx', decoder=f'{M}/turbo-decoder.int8.onnx',
                                                 tokens=f'{M}/turbo-tokens.txt', language='th', task='transcribe', num_threads=os.cpu_count())
SR, HOP = 16000, 320
def load(f): return np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','1','-ar',str(SR),'-f','f32le','-'], capture_output=True).stdout, np.float32)
def phrases(x, lo=1.2, hi=5.0):
    """Cut at pauses (>= 120 ms): each phrase lo..hi seconds, cut at the longest pause available."""
    db = 20 * np.log10(np.sqrt(np.array([np.mean(x[i:i + HOP] ** 2) for i in range(0, len(x) - HOP, HOP)]) + 1e-12))
    on = db > max(np.percentile(db, 10) + 10, db.max() - 38)
    pauses, i = {}, 0
    while i < len(on):
        if not on[i]:
            j = i
            while j < len(on) and not on[j]: j += 1
            if j - i >= 6: pauses[(i + j) / 2 * HOP / SR] = (j - i) * HOP / SR
            i = j
        else: i += 1
    dur, out, a = len(x) / SR, [], 0.0
    while a < dur - 0.15:
        if dur - a <= hi: out.append((a, dur)); break
        cand = [c for c in pauses if a + lo < c <= a + hi]
        b = max(cand, key=pauses.get) if cand else a + hi
        out.append((a, b)); a = b
    return out
res = {}
for f in sorted(glob.glob('assets/audio/voice/[0-9][0-9].m4a')):
    x, k = load(f), os.path.basename(f)[:2]; res[k] = []
    for a, b in phrases(x):
        s = rec.create_stream(); s.accept_waveform(SR, x[int(a * SR):int(b * SR)]); rec.decode_stream(s)
        res[k].append({'a': round(a, 3), 'b': round(b, 3), 'text': s.result.text.strip()})
    print(k, ' / '.join(p['text'] for p in res[k])[:160], flush=True)
json.dump(res, open('scripts/asr.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
