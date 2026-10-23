#!/usr/bin/env python3
"""One voice for every spoken track, so the narration sounds like a single session:
1. tone match — each file is EQ'd toward one shared spectral curve (the files were recorded with very
   different brightness), clamped so nothing is pushed more than +10 / -8 dB in any band
2. light denoise, clean low end, gentle compression, de-ess
3. two-pass loudness normalisation to the same -16 LUFS (linear, so the delivery is not squashed)
4. narration only: leading/trailing silence trimmed and pauses longer than 0.7 s shortened to 0.45 s,
   so no page carries dead air (the demo clip keeps its timing: its pauses are handled in edit_clip.py)
Narration: source/audio-raw/EP2-SEM-NN.mp3 -> assets/audio/voice/NN.m4a
Demo clip voice: assets/video/EP2-SEM-edit.mp4 -> assets/audio/voice/clip.m4a"""
import subprocess, os, glob, tempfile, json, re
import numpy as np
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
os.makedirs('assets/audio/voice', exist_ok=True)
BANDS = [125, 250, 500, 1000, 2000, 4000, 8000]
TARGET = [10.5, 4.0, 1.5, 0.0, -3.5, -10.5, -19.5]       # dB relative to 1 kHz: the brighter half of the takes, a clear spoken voice
CLEAN = 'highpass=f=80,afftdn=nr=8:nf=-45'
DYN = 'acompressor=threshold=-22dB:ratio=2.5:attack=8:release=160:makeup=2,deesser=i=0.3'
PAUSES = ('silenceremove=start_periods=1:start_duration=0:start_threshold=-42dB:start_silence=0.05:'
          'stop_periods=-1:stop_duration=0.7:stop_threshold=-42dB:stop_silence=0.45')
FADE_IN, FADE_OUT = 0.04, 0.18

def probe(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
def ff(src, dst, af): subprocess.run(['ffmpeg','-y','-loglevel','error','-i',src,'-vn','-ac','1','-ar','48000','-af',af,'-c:a','pcm_s16le',dst], check=True)
def tilt(f):
    """Average speech spectrum per band, dB relative to 1 kHz (quiet frames ignored)."""
    x = np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','1','-ar','32000','-f','f32le','-'], capture_output=True).stdout, np.float32)
    n = 2048; fr = np.array([np.abs(np.fft.rfft(x[i:i + n] * np.hanning(n))) ** 2 for i in range(0, len(x) - n, n)])
    fr = fr[fr.sum(1) > np.percentile(fr.sum(1), 40)]; p = fr.mean(0); fq = np.fft.rfftfreq(n, 1 / 32000)
    v = np.array([10 * np.log10(p[(fq >= b / 1.41) & (fq < b * 1.41)].mean()) for b in BANDS]); return v - v[3]
def match_eq(f):
    g = np.clip(np.array(TARGET) - tilt(f), -8, 10)
    return 'firequalizer=gain_entry=\'' + ';'.join(f'entry({b},{v:.1f})' for b, v in zip(BANDS, g)) + '\''
def loudnorm(src, dst):
    """Two-pass EBU R128 to -16 LUFS, linear gain."""
    r = subprocess.run(['ffmpeg','-hide_banner','-i',src,'-af','loudnorm=I=-16:TP=-2:LRA=7:print_format=json','-f','null','-'], capture_output=True, text=True).stderr
    m = json.loads(r[r.rindex('{'):r.rindex('}') + 1])
    ff(src, dst, f"loudnorm=I=-16:TP=-2:LRA=7:linear=true:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}")

def run(src, dst, pre='', trim=True):
    with tempfile.TemporaryDirectory() as d:
        a, b, c = f'{d}/a.wav', f'{d}/b.wav', f'{d}/c.wav'
        ff(src, a, (pre + ',' if pre else '') + CLEAN)
        ff(a, b, match_eq(a) + ',' + DYN)
        loudnorm(b, c)
        if trim: ff(c, a, PAUSES); c = a
        dur = probe(c)
        fades = f'afade=t=in:d={FADE_IN},afade=t=out:st={dur - FADE_OUT:.3f}:d={FADE_OUT}'
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',c,'-af',fades,'-c:a','aac','-b:a','160k',dst], check=True)
    return dur

for f in sorted(glob.glob('source/audio-raw/EP2-SEM-*.mp3')):
    print(f[-6:-4], round(probe(f), 1), '->', round(run(f, f'assets/audio/voice/{f[-6:-4]}.m4a'), 1))
if os.path.exists('assets/video/EP2-SEM-edit.mp4'):
    run('assets/video/EP2-SEM-edit.mp4', 'assets/audio/voice/clip.m4a', pre='afftdn=nr=12:nf=-42', trim=False)
print('voice ok')
