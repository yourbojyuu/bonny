#!/usr/bin/env python3
"""Teaser for the demo clip box on page 23: eight short moments from the edited clip, each played at
1.6x, joined with varied soft transitions, silent. Plays in the box while the page is narrated, until the
cursor clicks play and the real clip opens to full screen.
assets/video/EP2-SEM-edit.mp4 -> assets/video/EP2-SEM-preview.mp4"""
import subprocess, os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
SRC, OUT = 'assets/video/EP2-SEM-edit.mp4', 'assets/video/EP2-SEM-preview.mp4'
N, SEG, SPEED, X = 8, 1.9, 1.6, 0.35              # moments, seconds each (after speed-up), speed, transition length
FX = ['smoothleft', 'circleopen', 'slideup', 'fadeblack', 'smoothright', 'zoomin', 'slidedown']
dur = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',SRC]))
starts = [dur * (0.06 + 0.86 * i / (N - 1)) for i in range(N)]
args, chains = [], []
for i, s in enumerate(starts):
    args += ['-ss', f'{s:.2f}', '-t', f'{SEG * SPEED + 0.2:.2f}', '-i', SRC]
    chains.append(f'[{i}:v]setpts=PTS/{SPEED},fps=30,scale=1280:720:force_original_aspect_ratio=decrease,'
                  f'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0d1020,trim=0:{SEG},setpts=PTS-STARTPTS[v{i}]')
prev, off = 'v0', SEG - X
for i in range(1, N):
    chains.append(f'[{prev}][v{i}]xfade=transition={FX[(i - 1) % len(FX)]}:duration={X}:offset={off:.2f}[x{i}]')
    prev, off = f'x{i}', off + SEG - X
subprocess.run(['ffmpeg','-y','-v','error',*args,'-filter_complex',';'.join(chains),'-map',f'[{prev}]','-an',
                '-c:v','libx264','-preset','slow','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',OUT], check=True)
print(OUT, subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',OUT]).decode().strip())
