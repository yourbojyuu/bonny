#!/usr/bin/env python3
"""Convert the deck's slide HTML (source/slides) into HyperFrames sub-compositions
and write index.html with the audio-driven schedule. Frame 7 (demo clip) is hand-built."""
import re, subprocess, json, os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
FONTS = open('assets/fonts/fonts.css', encoding='utf8').read()
# (frame, slide id, audio number or None)
FRAMES = [(1,'cover','01'),(2,'ep1','02'),(3,'at-a-glance','03'),(4,'cca-pic','04'),(5,'cca-ph-why','05'),
 (6,'cca-hoc','06'),(7,'cca-ph-demo',None),(8,'prn-cca-fit','07'),(9,'cca-ph-fit','08'),(10,'prn-cca-outer','09'),
 (11,'cca-tab-outer','10'),(12,'prn-cca-struct','11'),(13,'cca-tab-struct','12'),(14,'cca-tab-src','13'),
 (15,'cca-tab-sum','14'),(16,'cca-ph-sum','15')]
COUNTUP = '''  [["688", 688], ["8", 8], ["34", 34]].forEach(([txt, v], i) => {
    const el = [...stage.querySelectorAll("p")].find(p => p.textContent.trim() === txt);
    if (!el) return; const o = { v: 0 };
    tl.to(o, { v, duration: 1.6, ease: "power2.out", onUpdate: () => { el.textContent = Math.round(o.v); } }, 1.0 + i * 0.3);
  });
'''
FADEOUT = '''  tl.to("#f{n:02d}-stage", {{ opacity: 0, duration: 0.6, ease: "power1.inOut" }}, {d:.3f} - 0.6);
'''
CLIP = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0','assets/video/EP1-CCA-edit.mp4']))  # edited clip length (scripts/edit_clip.py)
T_PLAY = 5.0            # frame 7: clip starts after click + expand
LEAD, TAIL, XFADE = 0.4, 0.6, 0.6

def dur(n):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'assets/audio/EP1-CCA-{n}.mp3']))

def motion_js(n, A, last):
    return f'''
  const stage = document.getElementById("f{n:02d}-stage");
  const A = {A:.3f};
  const pos = el => getComputedStyle(el).position;
  const items = [];
  [...stage.children].forEach(c => {{
    if (c.hasAttribute("data-deco")) return;
    if (pos(c) === "absolute" && c.textContent.trim() === "" && !c.querySelector("img")) return;
    if (getComputedStyle(c).display === "grid") {{ [...c.children].forEach(g => items.push(g)); }} else items.push(c);
  }});
  const win = Math.min(0.3 * A, 8), step = items.length > 1 ? win / items.length : 0;
  items.forEach((el, i) => tl.fromTo(el, {{ opacity: 0, y: 30 }}, {{ opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }}, 0.6 + i * step));
  stage.querySelectorAll("[data-deco]").forEach((d, i) => tl.fromTo(d, {{ opacity: 0.0 }}, {{ opacity: 1, duration: 1.2, ease: "power1.out" }}, 0.1));
  stage.querySelectorAll("svg line").forEach((ln, i) => {{ if (ln.closest("[data-deco]")) return; const L = ln.getTotalLength(); tl.fromTo(ln, {{ strokeDasharray: L, strokeDashoffset: L }}, {{ strokeDashoffset: 0, duration: 0.8, ease: "power2.inOut" }}, 0.9 + win * 0.6 + i * 0.25); }});
{COUNTUP if n == 3 else ''}{FADEOUT.format(n=n, d=A+1.0) if last else ''}'''

def convert(n, slide, fade_in, A=0.0, last=False):
    s = open(f'source/slides/{slide}.html', encoding='utf8').read()
    m = re.match(r'\s*<section id="[^"]+"[^>]*?style="([^"]*)"[^>]*>', s)
    style = m.group(1); body = s[m.end():]
    body = body[:body.rindex('</section>')]
    body = re.sub(r'<aside>.*?</aside>', '', body, flags=re.S)
    body = re.sub(r'/_blob/([0-9a-f]+)', r'assets/img/\1.png', body)
    body = re.sub(r'<x-shape kind="arrow-down"[^>]*></x-shape>', '<svg viewBox="0 0 24 32" style="width:40px;height:52px"><path d="M12 0 L12 22 M3 14 L12 26 L21 14" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>', body)
    if slide == 'cca-pic':  # content blocks are not positioned in this slide; lift them above the absolute backdrops
        body = body.replace('<div style="display:flex; flex-direction:column; gap:12px">','<div style="position:relative; display:flex; flex-direction:column; gap:12px">',1).replace('<div style="display:grid; gap:24px;','<div style="position:relative; display:grid; gap:24px;',1)
    body = body.replace('data-deco="1"', 'data-deco="1" data-layout-allow-overflow')
    for old in set(re.findall(r'\sid="([^"]+)"', body)):
        body = body.replace(f'url(#{old})', f'url(#f{n:02d}-{old})')
    body = re.sub(r'\sid="([^"]+)"', lambda mm: f' id="f{n:02d}-{mm.group(1)}"', body)
    tl = (f'tl.fromTo("#f{n:02d}-stage", {{ opacity: 0 }}, {{ opacity: 1, duration: {XFADE}, ease: "power1.inOut" }}, 0);' if fade_in else '') + motion_js(n, A, last)
    html = f'''<!doctype html>
<html><head><meta charset="UTF-8" /></head>
<body>
<template>
<style>
{FONTS}
#f{n:02d}-root{{position:absolute;inset:0;overflow:hidden}}
#f{n:02d}-stage{{position:absolute;inset:0;{style}}}
</style>
<div id="f{n:02d}-root" data-composition-id="f{n:02d}" data-width="1920" data-height="1080">
<div id="f{n:02d}-stage">
{body}
</div>
<script>
  const tl = gsap.timeline({{ paused: true }});
  {tl}
  window.__timelines["f{n:02d}"] = tl;
</script>
</div>
</template>
</body></html>
'''
    open(f'compositions/frames/{n:02d}.html','w',encoding='utf8').write(html)

starts = {}; durs = {}; t = 0.0; audio = []
for n, slide, a in FRAMES:
    if a is None:
        d = T_PLAY + CLIP
        overlap = 0.8
    else:
        A = dur(a); d = LEAD + A + TAIL; overlap = XFADE
        audio.append((a, round(t + LEAD, 3), round(A, 3)))
    starts[n] = round(t, 3); durs[n] = round(d, 3)
    t = t + d - (0.8 if a is None else XFADE)
    if n != 7: convert(n, slide, fade_in=(n != 1), A=(d - LEAD - TAIL), last=(n == 16))
import re as _re
_p = 'compositions/frames/07.html'; _s = open(_p, encoding='utf8').read()
_s = _re.sub(r'const CLIP = [0-9.]+;', f'const CLIP = {CLIP:.3f};', _s)
_s = _re.sub(r'(id="f07-video"[^>]*data-duration=")[0-9.]+"', lambda m: m.group(1) + f'{CLIP:.3f}"', _s)
open(_p, 'w', encoding='utf8').write(_s)
total = round(starts[16] + durs[16], 3)
hosts = []
for n, slide, a in FRAMES:
    hosts.append(f'      <div id="f{n:02d}" class="clip" data-composition-id="f{n:02d}" data-composition-src="compositions/frames/{n:02d}.html" data-start="{starts[n]}" data-duration="{durs[n]}" data-track-index="{1 + n % 2}" data-width="1920" data-height="1080"></div>')
auds = [f'      <audio id="a{a}" src="assets/audio/EP1-CCA-{a}.mp3" data-start="{st}" data-duration="{A}" data-track-index="5"></audio>' for a, st, A in audio]
idx = f'''<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #eaf0fa; }}
      #root {{ width: 100%; height: 100%; position: relative; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{total}" data-width="1920" data-height="1080">
{chr(10).join(hosts)}
{chr(10).join(auds)}
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
'''
open('index.html','w',encoding='utf8').write(idx)
json.dump({'starts':starts,'durs':durs,'total':total}, open('scripts/schedule.json','w'), indent=1)
print('total', total, 'min', round(total/60,2))
