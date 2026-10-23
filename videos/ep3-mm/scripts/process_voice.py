#!/usr/bin/env python3
"""One voice chain for every spoken track so the narration sounds like a single session:
clean low end, tame mud, add presence, gentle compression + de-ess, same loudness, soft edges.
EP3 adds: long pauses tightened and speech nudged faster (TEMPO, pitch kept) so the narration feels brisk,
two-pass loudness so every file lands on the same level, and the demo-clip voice is levelled harder and
EQ-matched to the narration's average spectrum so the two microphones sound alike.
Narration: source/audio-raw/EP3-MOD-NN.mp3 -> assets/audio/voice/pPP.m4a (PP = page, see VOICE / SCRIPT.md)
Demo clip voice: assets/video/EP3-MOD-edit.mp4 -> assets/audio/voice/clip.m4a (its pauses are tightened by edit_clip.py,
together with the picture)"""
import subprocess, os, json, tempfile
import numpy as np
from scipy.io import wavfile
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
os.makedirs('assets/audio/voice', exist_ok=True)
SR = 48000
CHAIN = ('highpass=f=80,equalizer=f=220:t=q:w=1.2:g=-2.5,equalizer=f=3200:t=q:w=1.0:g=2.5,'
         'equalizer=f=9000:t=h:w=2000:g=1.5,acompressor=threshold=-22dB:ratio=3:attack=6:release=140:makeup=3,'
         'deesser=i=0.35')
TARGET = dict(I=-16.0, TP=-2.0, LRA=7.0)
TEMPO = 1.07                      # narration speed (atempo keeps the pitch)
MAX_PAUSE, KEEP_PAUSE = 0.38, 0.30   # pauses longer than MAX_PAUSE are shortened to KEEP_PAUSE
EDGE = 0.12                       # silence kept before the first and after the last word
FADE_IN, FADE_OUT = 0.04, 0.18
# page -> (recording, cut from, cut to); pages 42-43 share one take, cut at the pause before "อ่านแถวที่ไฮไลต์"
VOICE = {36: ('01', 0, None), 37: ('02', 0, None), 38: ('03', 0, None), 39: ('04', 0, None), 40: ('06', 0, None),
         41: ('05', 0, None), 42: ('07', 0, 21.38), 43: ('07', 21.38, None), 44: ('08', 0, None),
         45: ('12', 0, None), 46: ('13', 0, None), 47: ('14', 0, None),            # not recorded yet
         48: ('10', 0, None), 49: ('11', 0, None)}

def ff(*args): subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)
def load(src, cut=(0, None), af=None):
    span = ['-ss', str(cut[0])] + (['-to', str(cut[1])] if cut[1] else [])
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, *span, '-vn', '-ac', '1', '-ar', str(SR)] + (['-af', af] if af else [])
                         + ['-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()
def save(x, path): wavfile.write(path, SR, np.clip(x, -1, 1).astype(np.float32))

def voiced_mask(x, hop=480):
    """10 ms frames above an adaptive floor, with gaps under 120 ms bridged (keeps stops and soft consonants)."""
    n = len(x) // hop; f = x[:n * hop].reshape(n, hop)
    db = 10 * np.log10(np.mean(f ** 2, 1) + 1e-12)
    on = db > max(np.percentile(db, 10) + 10, db.max() - 40)
    idx = np.flatnonzero(on)
    for a, b in zip(idx, idx[1:]):
        if 1 < b - a <= 12: on[a:b] = True
    return on, hop

def tighten(x):
    """Shorten every pause longer than MAX_PAUSE to KEEP_PAUSE and trim the edges, with 15 ms crossfades."""
    on, hop = voiced_mask(x)
    idx = np.flatnonzero(on)
    if not len(idx): return x
    first, last = idx[0] * hop, (idx[-1] + 1) * hop
    keep, start, i = [], max(0, first - int(EDGE * SR)), idx[0]
    runs, s = [], None                                  # silent runs inside the speech
    for k in range(idx[0], idx[-1] + 1):
        if not on[k] and s is None: s = k
        if on[k] and s is not None: runs.append((s, k)); s = None
    for a, b in runs:
        if (b - a) * hop / SR > MAX_PAUSE:
            half = int(KEEP_PAUSE * SR / 2)
            keep.append((start, a * hop + half)); start = b * hop - half
    keep.append((start, min(len(x), last + int(EDGE * SR))))
    xf = int(0.015 * SR); out = x[keep[0][0]:keep[0][1]].copy()
    for a, b in keep[1:]:
        seg = x[a:b].copy(); ramp = np.linspace(0, 1, xf)
        out[-xf:] = out[-xf:] * (1 - ramp) + seg[:xf] * ramp
        out = np.concatenate([out, seg[xf:]])
    return out

def loudnorm(src, dst, extra=''):
    """Two-pass EBU R128 so every file lands on exactly the same integrated loudness, then soft edges -> AAC."""
    tgt = f"loudnorm=I={TARGET['I']}:TP={TARGET['TP']}:LRA={TARGET['LRA']}"
    log = subprocess.run(['ffmpeg', '-hide_banner', '-i', src, '-af', (extra + ',' if extra else '') + tgt + ':print_format=json', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    m = json.loads(log[log.rindex('{'):log.rindex('}') + 1])
    d = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]))
    af = ((extra + ',') if extra else '') + (f"{tgt}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
          f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample={SR},"
          f"afade=t=in:d={FADE_IN},afade=t=out:st={max(0, d - FADE_OUT):.3f}:d={FADE_OUT}")
    ff('-i', src, '-af', af, '-c:a', 'aac', '-b:a', '160k', dst)

def spectrum(x):
    """Long-term average spectrum (dB) of the voiced frames, on 1/3-octave bands 100 Hz - 10 kHz."""
    on, hop = voiced_mask(x); n = 4096
    frames = [x[i * hop:i * hop + n] for i in np.flatnonzero(on)[::3] if i * hop + n <= len(x)]
    p = np.mean([np.abs(np.fft.rfft(f * np.hanning(n))) ** 2 for f in frames], 0)
    fr = np.fft.rfftfreq(n, 1 / SR); bands = 100 * 2 ** (np.arange(0, 20) / 3)
    return bands, np.array([10 * np.log10(p[(fr >= b / 2 ** (1 / 6)) & (fr < b * 2 ** (1 / 6))].mean() + 1e-12) for b in bands])

tmp = tempfile.mkdtemp(dir='/tmp')
narr = []
for page, (nn, a, b) in VOICE.items():
    f = f'source/audio-raw/EP3-MOD-{nn}.mp3'
    if not os.path.exists(f): print(f'p{page}: {f} not found, page stays silent'); continue
    x = tighten(load(f, (a, b)))
    save(x, f'{tmp}/t.wav')
    ff('-i', f'{tmp}/t.wav', '-af', f'atempo={TEMPO},{CHAIN}', '-c:a', 'pcm_f32le', f'{tmp}/c{page}.wav')
    loudnorm(f'{tmp}/c{page}.wav', f'assets/audio/voice/p{page}.m4a')
    narr.append(load(f'{tmp}/c{page}.wav'))
    print(f'p{page}: {(b or len(load(f))/SR) - a:.1f}s -> {len(narr[-1]) / SR:.1f}s')

if os.path.exists('assets/video/EP3-MOD-edit.mp4'):
    pre = 'afftdn=nr=14:nf=-42,agate=threshold=0.008:ratio=2:attack=5:release=200,' + CHAIN + ',dynaudnorm=f=150:g=9:m=12:p=0.7,acompressor=threshold=-24dB:ratio=4:attack=5:release=120:makeup=4'
    ff('-i', 'assets/video/EP3-MOD-edit.mp4', '-vn', '-ac', '1', '-ar', str(SR), '-af', pre, '-c:a', 'pcm_f32le', f'{tmp}/clip.wav')
    bands, ref = spectrum(np.concatenate(narr)); _, got = spectrum(load(f'{tmp}/clip.wav'))
    diff = (ref - ref.mean()) - (got - got.mean())
    diff = np.clip(np.convolve(diff, np.ones(3) / 3, 'same'), -6, 6)        # smooth, never more than +-6 dB
    eq = 'firequalizer=gain_entry=\'' + ';'.join(f'entry({b:.0f},{g:.2f})' for b, g in zip(bands, diff)) + '\''
    loudnorm(f'{tmp}/clip.wav', 'assets/audio/voice/clip.m4a', extra=eq)
    print('clip voice EQ match (dB):', ' '.join(f'{b:.0f}:{g:+.1f}' for b, g in zip(bands, diff)))
subprocess.run(['rm', '-rf', tmp])
print('voice ok')
