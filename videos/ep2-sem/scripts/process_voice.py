#!/usr/bin/env python3
"""One voice chain for every spoken track so the narration sounds like a single session:
clean low end, tame mud, add presence, gentle compression + de-ess, same loudness, soft edges.
Narration: source/audio-raw/EP2-SEM-NN.mp3 -> assets/audio/voice/NN.m4a
Demo clip voice: assets/video/EP2-SEM-edit.mp4 -> assets/audio/voice/clip.m4a (extra denoise, only once the clip is in place)"""
import subprocess, os, glob, tempfile
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
os.makedirs('assets/audio/voice', exist_ok=True)
CHAIN = ('highpass=f=80,equalizer=f=220:t=q:w=1.2:g=-2.5,equalizer=f=3200:t=q:w=1.0:g=2.5,'
         'equalizer=f=9000:t=h:w=2000:g=1.5,acompressor=threshold=-22dB:ratio=3:attack=6:release=140:makeup=3,'
         'deesser=i=0.35,loudnorm=I=-16:TP=-2:LRA=7,aresample=48000')
FADE_IN, FADE_OUT = 0.04, 0.18
def probe(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
def run(src, dst, pre=''):
    af = (pre + ',' if pre else '') + CHAIN
    with tempfile.NamedTemporaryFile(suffix='.wav', dir='/tmp') as tmp:
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',src,'-vn','-ac','1','-af',af,'-c:a','pcm_s16le',tmp.name],check=True)
        d = probe(tmp.name)
        fades = f'afade=t=in:d={FADE_IN},afade=t=out:st={d - FADE_OUT:.3f}:d={FADE_OUT}'
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',tmp.name,'-af',fades,'-c:a','aac','-b:a','160k',dst],check=True)
for f in sorted(glob.glob('source/audio-raw/EP2-SEM-*.mp3')):
    run(f, f'assets/audio/voice/{f[-6:-4]}.m4a')
if os.path.exists('assets/video/EP2-SEM-edit.mp4'):
    run('assets/video/EP2-SEM-edit.mp4', 'assets/audio/voice/clip.m4a', pre='afftdn=nr=14:nf=-42,agate=threshold=0.008:ratio=2:attack=5:release=200,volume=2dB')
print('voice ok')
