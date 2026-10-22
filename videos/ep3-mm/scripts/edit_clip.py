#!/usr/bin/env python3
"""Tighten the ADANCO screen recording: speech stays at 1x, silent stretches (>= GAP s,
mostly clicking/waiting) are sped up, audio is loudness-normalised. Source is untouched."""
import re, subprocess, os, sys, tempfile
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
SRC, OUT = 'assets/video/EP3-MOD.mp4', 'assets/video/EP3-MOD-edit.mp4'
GAP, NOISE, TARGET = 1.4, '-38dB', 0.7     # min silent gap, silence threshold, seconds a sped-up gap should last
dur = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',SRC]))
log = subprocess.run(['ffmpeg','-hide_banner','-i',SRC,'-vn','-af',f'silencedetect=noise={NOISE}:d={GAP}','-f','null','-'],capture_output=True,text=True).stderr
st = [float(x) for x in re.findall(r'silence_start: ([0-9.]+)', log)]
en = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', log)]
gaps = []
for i, s in enumerate(st):
    e = en[i] if i < len(en) else dur
    if e - s >= GAP: gaps.append((max(0, s), min(dur, e)))
segs = []; t = 0.0
for s, e in gaps:
    if s - t > 0.05: segs.append((t, s, 1.0))
    f = min(8.0, max(2.0, (e - s) / TARGET)); segs.append((s, e, f)); t = e
if dur - t > 0.05: segs.append((t, dur, 1.0))
import tempfile, shutil
tmp = tempfile.mkdtemp(prefix='clipedit-', dir=tempfile.gettempdir())
lst = []
for i, (a, b, f) in enumerate(segs):
    o = f'{tmp}/s{i:03d}.mkv'
    vf = f'setpts=(PTS-STARTPTS)/{f:.3f},fps=30,scale=1280:720'
    af = f'asetpts=PTS-STARTPTS,atempo={f:.3f},aresample=48000'
    subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',f'{a:.3f}','-to',f'{b:.3f}','-i',SRC,'-vf',vf,'-af',af,
        '-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','pcm_s16le','-ar','48000','-shortest',o],check=True)  # PCM audio: no AAC priming drift across joins
    lst.append(f"file '{o}'")
open(f'{tmp}/list.txt','w').write('\n'.join(lst))
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',f'{tmp}/list.txt','-c','copy',f'{tmp}/joined.mkv'],check=True)
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',f'{tmp}/joined.mkv','-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-c:a','aac','-b:a','160k','-ar','48000','-movflags','+faststart',OUT],check=True)
shutil.rmtree(tmp)
new = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',OUT]))
print(f'segments={len(segs)} gaps={len(gaps)} {dur:.1f}s -> {new:.1f}s')
