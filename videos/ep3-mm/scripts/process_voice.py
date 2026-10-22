#!/usr/bin/env python3
"""One voice chain for every spoken track so the narration sounds like a single session:
clean low end, tame mud, add presence, gentle compression + de-ess, same loudness, soft edges.
Narration: source/audio-raw/EP3-MOD-NN.mp3 -> assets/audio/voice/pPP.m4a (PP = page, see VOICE / SCRIPT.md)
Demo clip voice: assets/video/EP3-MOD-edit.mp4 -> assets/audio/voice/clip.m4a (extra denoise, only once the clip is in place)"""
import subprocess, os, tempfile
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
os.makedirs('assets/audio/voice', exist_ok=True)
CHAIN = ('highpass=f=80,equalizer=f=220:t=q:w=1.2:g=-2.5,equalizer=f=3200:t=q:w=1.0:g=2.5,'
         'equalizer=f=9000:t=h:w=2000:g=1.5,acompressor=threshold=-22dB:ratio=3:attack=6:release=140:makeup=3,'
         'deesser=i=0.35,loudnorm=I=-16:TP=-2:LRA=7,aresample=48000')
FADE_IN, FADE_OUT = 0.04, 0.18
def probe(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
# page -> (recording, cut from, cut to); pages 42-43 share one take, cut at the pause before "อ่านแถวที่ไฮไลต์"
VOICE = {36: ('01', 0, None), 37: ('02', 0, None), 38: ('03', 0, None), 39: ('04', 0, None), 40: ('06', 0, None),
         41: ('05', 0, None), 42: ('07', 0, 21.38), 43: ('07', 21.38, None), 44: ('08', 0, None),
         45: ('12', 0, None), 46: ('13', 0, None), 47: ('14', 0, None),            # not recorded yet
         48: ('10', 0, None), 49: ('11', 0, None)}
def run(src, dst, pre='', cut=(0, None)):
    af = (pre + ',' if pre else '') + CHAIN
    span = ['-ss', str(cut[0])] + (['-to', str(cut[1])] if cut[1] else [])
    with tempfile.NamedTemporaryFile(suffix='.wav', dir='/tmp') as tmp:
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',src] + span + ['-vn','-ac','1','-af',af,'-c:a','pcm_s16le',tmp.name],check=True)
        d = probe(tmp.name)
        fades = f'afade=t=in:d={FADE_IN},afade=t=out:st={d - FADE_OUT:.3f}:d={FADE_OUT}'
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',tmp.name,'-af',fades,'-c:a','aac','-b:a','160k',dst],check=True)
for page, (nn, a, b) in VOICE.items():
    f = f'source/audio-raw/EP3-MOD-{nn}.mp3'
    if os.path.exists(f): run(f, f'assets/audio/voice/p{page}.m4a', cut=(a, b))
    else: print(f'p{page}: {f} not found, page stays silent')
if os.path.exists('assets/video/EP3-MOD-edit.mp4'):
    run('assets/video/EP3-MOD-edit.mp4', 'assets/audio/voice/clip.m4a', pre='afftdn=nr=14:nf=-42,agate=threshold=0.008:ratio=2:attack=5:release=200,volume=2dB')
print('voice ok')
