#!/usr/bin/env python3
"""Build a soft, varied SFX palette in assets/sfx/v/ so no two neighbouring accents sound the same.
- pitched / slowed / filtered variants of the bundled HyperFrames effects (assets/sfx/*.mp3)
- small synthesized tones (bubble, marimba, kalimba, soft tick) tuned to one pentatonic scale,
  so random picks still sound musical together.
Writes assets/sfx/v/palette.json: {category: [{"file": ..., "dur": ...}, ...]}."""
import json, os, subprocess
import numpy as np
from scipy.io import wavfile
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
OUT, SR = 'assets/sfx/v', 48000
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT): os.remove(os.path.join(OUT, f))
palette = {}

def probe(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
def add(cat, path): palette.setdefault(cat, []).append({'file': path, 'dur': round(probe(path), 3)})
SOFT = 'highpass=f=140,lowpass=f=6500,afade=t=in:d=0.004'
def variant(cat, src, name, semis=0.0, tempo=1.0, extra=''):
    rate = 2 ** (semis / 12)
    af = f'aresample=48000,asetrate={int(SR * rate)},aresample={SR},atempo={max(0.5, min(2.0, tempo / rate)):.4f},{SOFT}' + (',' + extra if extra else '')
    out = f'{OUT}/{name}.mp3'
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',f'assets/sfx/{src}.mp3','-af',af,'-ac','2','-b:a','128k',out], check=True)
    add(cat, out)

def write(cat, name, sig):
    sig = sig / (np.sqrt(np.mean(sig[: int(0.15 * SR)] ** 2)) + 1e-9) * 0.14   # same loudness for every synth tone
    sig = sig / max(1.0, np.max(np.abs(sig)) / 0.85)
    st = np.stack([sig, sig], 1)
    tmp = f'/tmp/{name}.wav'; wavfile.write(tmp, SR, (st * 32767).astype(np.int16))
    out = f'{OUT}/{name}.mp3'
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',tmp,'-af','lowpass=f=7000','-b:a','128k',out], check=True); os.remove(tmp)
    add(cat, out)

def mix(a, b):
    out = np.zeros(max(len(a), len(b))); out[:len(a)] += a; out[:len(b)] += b; return out
def t_(d): return np.arange(int(d * SR)) / SR
def hz(m): return 440 * 2 ** ((m - 69) / 12)
PENTA = [72, 74, 76, 79, 81, 84, 86, 88]          # C major pentatonic, C5..E6

def marimba(m, d=0.45):
    t = t_(d); f = hz(m)
    return (np.sin(2*np.pi*f*t) + 0.25*np.sin(2*np.pi*4*f*t)*np.exp(-t/0.03)) * np.exp(-t/0.12) * np.minimum(1, t/0.002)
def kalimba(m, d=0.9):
    t = t_(d); f = hz(m)
    return (np.sin(2*np.pi*f*t) + 0.4*np.sin(2*np.pi*5.4*f*t)*np.exp(-t/0.05)) * np.exp(-t/0.35) * np.minimum(1, t/0.003)
def bubble(m, d=0.16):
    t = t_(d); f0 = hz(m - 12); f = f0 * (1 + 1.4 * t / d)
    return np.sin(2*np.pi*np.cumsum(f)/SR) * np.sin(np.pi * np.minimum(1, t / d)) ** 1.5
def tick(seed, d=0.05):
    rng = np.random.default_rng(seed); t = t_(d)
    n = rng.standard_normal(len(t)); n = np.convolve(n, np.ones(6) / 6, 'same')
    return (n * 0.6 + np.sin(2*np.pi*(1800 + 300 * seed)*t)) * np.exp(-t/0.008)

# transitions: soft swishes
for i, (src, semis, tempo) in enumerate([('whoosh-short', 0, 1), ('whoosh-short', -3, 0.9), ('whoosh-short', 2, 1.1),
                                          ('whoosh', 0, 1), ('whoosh', -4, 0.85), ('whoosh', 3, 1.15)]):
    variant('swish', src, f'swish-{i}', semis, tempo, 'volume=-2dB')
# grab: gentle ticks + pitched soft clicks
for i in range(3): write('grab', f'grab-tick-{i}', tick(i))
for i, s in enumerate([-2, 3]): variant('grab', 'click-soft', f'grab-click-{i}', s)
# drop: bubbly pops + marimba hits (pentatonic)
for i, s in enumerate([-3, 0, 2, 5]): variant('drop', 'pop', f'drop-pop-{i}', s, extra='volume=-1dB')
for i, m in enumerate([72, 76, 79, 84]): write('drop', f'drop-marimba-{i}', mix(marimba(m), 0.5 * bubble(m)))
# pop (cards that pop in by themselves): bubbles + marimba
for i, m in enumerate([74, 79, 81, 86]): write('pop', f'pop-bubble-{i}', bubble(m))
for i, m in enumerate([76, 81, 88]): write('pop', f'pop-marimba-{i}', marimba(m, 0.35))
# count-up finish: kalimba notes
for i, m in enumerate([79, 84, 88, 86]): write('ping', f'ping-kalimba-{i}', kalimba(m))
# sticker sparkle + chime + soft impact
for i, (s, tp) in enumerate([(0, 1), (3, 1.1), (-2, 0.9)]): variant('sparkle', 'sparkle', f'sparkle-{i}', s, tp, 'volume=-3dB')
for i, s in enumerate([0, 5, -3]): variant('chime', 'chime', f'chime-{i}', s)
for i, src in enumerate(['impact-bass-1', 'impact-bass-2']): variant('impact', src, f'impact-{i}', 0, 1, 'lowpass=f=2500')
# demo-clip click + expand
variant('click', 'click-soft', 'click-0', 0); variant('expand', 'whoosh-cinematic', 'expand-0', -2, 1, 'volume=-3dB')
json.dump(palette, open(f'{OUT}/palette.json', 'w'), indent=1)
print({k: len(v) for k, v in palette.items()})
