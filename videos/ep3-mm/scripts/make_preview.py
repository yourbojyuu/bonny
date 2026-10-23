#!/usr/bin/env python3
"""A short silent montage of the demo clip for the clip box on the demo page, so the box shows the clip moving
(several moments, each sped up 2x, with quick crossfades) instead of an empty placeholder before the play click."""
import subprocess, os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
SRC, OUT = 'assets/video/EP3-MOD-edit.mp4', 'assets/video/EP3-MOD-preview.mp4'
SHOT, SPEED, XF = 1.6, 2.0, 0.3                   # seconds each in the montage, speed-up, crossfade
# picked from a contact sheet of the edited clip: Excel product column -> building the model -> bootstrap settings
# -> running -> the model with the interaction term (no save dialogs)
MOMENTS = [20, 66, 130, 168, 196, 290, 312, 405, 438]
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', SRC]))
starts = [min(m, dur - SHOT * SPEED - 0.5) for m in MOMENTS]; N = len(starts)
inp, fil = [], []
for i, s in enumerate(starts):
    inp += ['-ss', f'{s:.2f}', '-t', f'{SHOT * SPEED + 0.2:.2f}', '-i', SRC]
    fil.append(f'[{i}:v]setpts=(PTS-STARTPTS)/{SPEED},fps=30,scale=1280:720,trim=0:{SHOT},setpts=PTS-STARTPTS[v{i}]')
chain, off = '[v0]', 0.0
for i in range(1, N):
    off += SHOT - XF
    fil.append(f'{chain}[v{i}]xfade=transition={"fade" if i % 2 else "smoothleft"}:duration={XF}:offset={off:.2f}[x{i}]'); chain = f'[x{i}]'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inp, '-filter_complex', ';'.join(fil), '-map', chain, '-an',
                '-c:v', 'libx264', '-crf', '22', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], check=True)
print(OUT, subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT]).decode().strip(), 's')
