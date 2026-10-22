#!/usr/bin/env python3
"""Convert the deck's slide HTML (source/slides) into HyperFrames sub-compositions and write
index.html: scene schedule driven by the narration, per-element reveal motion, voice tracks and
sound effects. Frame 7 (demo clip) is hand-built in compositions/frames/07.html.

Pipeline: scripts/edit_clip.py -> scripts/process_voice.py -> scripts/build_frames.py
Background music is left to the editor: add it as its own <audio> track (see the BGM note in index.html)."""
import re, subprocess, json, os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
FONTS = open('assets/fonts/fonts.css', encoding='utf8').read()
# (frame, slide id, narration number or None)
FRAMES = [(1,'cover','01'),(2,'ep1','02'),(3,'at-a-glance','03'),(4,'cca-pic','04'),(5,'cca-ph-why','05'),
 (6,'cca-hoc','06'),(7,'cca-ph-demo',None),(8,'prn-cca-fit','07'),(9,'cca-ph-fit','08'),(10,'prn-cca-outer','09'),
 (11,'cca-tab-outer','10'),(12,'prn-cca-struct','11'),(13,'cca-tab-struct','12'),(14,'cca-tab-src','13'),
 (15,'cca-tab-sum','14'),(16,'cca-ph-sum','15')]
def probe(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
CLIP = probe('assets/video/EP1-CCA-edit.mp4')   # edited demo clip (scripts/edit_clip.py)
T_PLAY = 5.0                                     # frame 7: clip starts after click + expand
LEAD, TAIL, XFADE = 0.4, 0.6, 0.6                # voice lead-in / tail inside a scene; scene overlap
REVEAL_AT, MAX_SFX_PER_SCENE = 0.7, 6
SFX_DUR = {'whoosh-short': 0.57, 'whoosh': 0.57, 'whoosh-cinematic': 5.54, 'pop': 0.72, 'click': 0.37,
           'click-soft': 0.37, 'ping': 1.32, 'chime': 2.5, 'sparkle': 1.8, 'impact-bass-1': 2.12, 'impact-bass-2': 2.59}

# ---------- minimal tag scanner: find element spans without reserialising the markup (keeps SVG casing) ----------
TAG = re.compile(r'<(/?)([a-zA-Z][\w-]*)((?:"[^"]*"|\'[^\']*\'|[^>"\'])*?)(/?)>')
VOID = {'img', 'br', 'hr', 'input', 'meta', 'link', 'source'}
def children(html, lo=0, hi=None):
    """Direct child elements of the fragment html[lo:hi] -> [(start, open_end, end, tag, attrs)]."""
    hi = len(html) if hi is None else hi
    out, depth, cur = [], 0, None
    for m in TAG.finditer(html, lo, hi):
        close, tag, attrs, selfc = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if close:
            depth -= 1
            if depth == 0 and cur: out.append((cur[0], cur[1], m.end(), cur[2], cur[3])); cur = None
        elif selfc or tag in VOID:
            if depth == 0: out.append((m.start(), m.end(), m.end(), tag, attrs))
        else:
            if depth == 0: cur = (m.start(), m.end(), tag, attrs)
            depth += 1
    return out
def style_of(attrs):
    m = re.search(r'style="([^"]*)"', attrs); return (m.group(1) if m else '').replace(' ', '').lower()
def text_of(fragment): return re.sub(r'<[^>]+>', '', fragment).strip()

def tag_reveals(body, A):
    """Pick the elements that reveal one by one, decide each one's treatment and time, and tag them."""
    items = []
    for c in children(body):
        s0, oe, e, tag, attrs = c; st = style_of(attrs); frag = body[s0:e]
        if 'data-deco' in attrs or tag in ('svg', 'aside'): continue
        if 'position:absolute' in st and not text_of(frag) and '<img' not in frag: continue
        if 'display:grid' in st: items += children(body, oe, e - len(f'</{tag}>'))
        else: items.append(c)
    n = len(items); win = min(0.2 * A, 5.0); step = win / n if n > 1 else 0
    plan, edits = [], []
    for i, (s0, oe, e, tag, attrs) in enumerate(items):
        frag, st = body[s0:e], style_of(attrs)
        if tag == 'p' and 'position:absolute' in st and text_of(frag).isdigit(): kind = 'badge'
        elif re.search(r'<h[12][ >]', frag) and frag.count('<div') < 4: kind = 'head'
        elif '<img' in frag: kind = 'img'
        elif 'background' in st: kind = 'card'
        else: kind = 'text'
        t = round(REVEAL_AT + i * step, 3)
        plan.append({'kind': kind, 't': t, 'html': frag})
        edits.append((s0 + 1 + len(tag), f' data-reveal="{kind}" data-t="{t}"'))
    for pos, ins in sorted(edits, reverse=True): body = body[:pos] + ins + body[pos:]
    return body, plan

MOTION = '''
  const stage = document.getElementById("{id}-stage"), shell = document.getElementById("{id}-shell");
  const D = {D:.3f}, V = {variant};
  // scene entrance: zoom / slide / rise, then a slow camera push for the rest of the scene
  const enter = [{{ scale: 1.07 }}, {{ x: 160 }}, {{ y: 110 }}][V];
  if ({fade_in}) tl.fromTo(shell, {{ opacity: 0, ...enter }}, {{ opacity: 1, scale: 1, x: 0, y: 0, duration: 0.75, ease: "expo.out" }}, 0);
  tl.fromTo(stage, {{ scale: 1 }}, {{ scale: 1.03, duration: D, ease: "none" }}, 0);
  // decorations drift in and float
  stage.querySelectorAll("[data-deco]").forEach((d, i) => {{
    tl.fromTo(d, {{ opacity: 0 }}, {{ opacity: 1, duration: 1.2, ease: "power1.out" }}, 0.1);
    const per = 2.6 + (i % 3) * 0.5; tl.to(d, {{ y: i % 2 ? 12 : -12, duration: per, ease: "sine.inOut", yoyo: true, repeat: Math.max(1, Math.floor(D / per) - 1) }}, 0.3);
  }});
  // element reveals
  const FX = {{
    head:  [{{ opacity: 0, x: -60, clipPath: "inset(0% 100% 0% 0%)" }}, {{ opacity: 1, x: 0, clipPath: "inset(0% 0% 0% 0%)", duration: 0.85, ease: "power3.out" }}],
    card:  [{{ opacity: 0, y: 56, scale: 0.9 }}, {{ opacity: 1, y: 0, scale: 1, duration: 0.8, ease: "back.out(1.6)" }}],
    img:   [{{ opacity: 0, y: 30, scale: 1.12 }}, {{ opacity: 1, y: 0, scale: 1, duration: 1.0, ease: "expo.out" }}],
    text:  [{{ opacity: 0, y: 26 }}, {{ opacity: 1, y: 0, duration: 0.65, ease: "power2.out" }}],
    badge: [{{ opacity: 0, scale: 0.4 }}, {{ opacity: 1, scale: 1, duration: 0.6, ease: "back.out(3)" }}],
  }};
  stage.querySelectorAll("[data-reveal]").forEach(el => {{
    const t = +el.dataset.t, [from, to] = FX[el.dataset.reveal];
    tl.fromTo(el, from, to, t);
    const rows = el.querySelectorAll("tr");
    if (rows.length > 2) tl.fromTo(rows, {{ opacity: 0, x: -24 }}, {{ opacity: 1, x: 0, duration: 0.45, ease: "power2.out", stagger: 0.07 }}, t + 0.3);
    el.querySelectorAll("p").forEach(p => {{                     // big integers count up
      const txt = p.textContent.trim(), fs = parseFloat(getComputedStyle(p).fontSize);
      if (!/^[0-9]{{1,4}}$/.test(txt) || fs < 52 || el.dataset.reveal === "badge") return;
      const o = {{ v: 0 }}, v = +txt;
      tl.to(o, {{ v, duration: 1.2, ease: "power2.out", onUpdate: () => {{ p.textContent = Math.round(o.v); }} }}, t + 0.15);
    }});
    el.querySelectorAll("svg line").forEach((ln, i) => {{        // diagram arrows draw on
      const L = ln.getTotalLength();
      tl.fromTo(ln, {{ strokeDasharray: L, strokeDashoffset: L }}, {{ strokeDashoffset: 0, duration: 0.7, ease: "power2.inOut" }}, t + 0.45 + i * 0.18);
    }});
  }});
  {fadeout}'''

def convert(n, slide, A, D, last):
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
    body, plan = tag_reveals(body, A)
    fid = f'f{n:02d}'
    fadeout = f'tl.to(shell, {{ opacity: 0, duration: 0.8, ease: "power1.inOut" }}, D - 0.8);' if last else ''
    js = MOTION.format(id=fid, D=D, variant=n % 3, fade_in='true' if n != 1 else 'false', fadeout=fadeout)
    html = f'''<!doctype html>
<html><head><meta charset="UTF-8" /></head>
<body>
<template>
<style>
{FONTS}
#{fid}-root{{position:absolute;inset:0;overflow:hidden}}
#{fid}-shell{{position:absolute;inset:0}}
#{fid}-stage{{position:absolute;inset:0;{style}}}
</style>
<div id="{fid}-root" data-composition-id="{fid}" data-width="1920" data-height="1080">
<div id="{fid}-shell">
<div id="{fid}-stage">
{body}
</div>
</div>
<script>
  const tl = gsap.timeline({{ paused: true }});
{js}
  window.__timelines["{fid}"] = tl;
</script>
</div>
</template>
</body></html>
'''
    open(f'compositions/frames/{n:02d}.html', 'w', encoding='utf8').write(html)
    return plan

def scene_sfx(n, start, plan):
    """Sound design for one scene: a transition swish, then accents on the reveals that matter."""
    ev = []
    if n == 1: ev.append((start + 0.55, 'impact-bass-1', 0.45))
    elif n == 8: ev.append((start, 'whoosh', 0.55))
    else: ev.append((start, 'whoosh-short' if n % 2 else 'whoosh', 0.42))
    count = 0
    for i, it in enumerate(plan):
        t = start + it['t']
        if n == 2 and it['kind'] == 'card' and count == 0: ev.append((t + 0.1, 'impact-bass-2', 0.4)); count += 1; continue
        if it['kind'] in ('card', 'img') and count < MAX_SFX_PER_SCENE:
            ev.append((t + 0.05, 'pop' if it['kind'] == 'card' else 'click-soft', 0.26 if it['kind'] == 'card' else 0.35)); count += 1
        if re.search(r'font-size:\s*(5[2-9]|[6-9]\d|1\d\d)px[^>]*>\s*\d{1,4}\s*<', it['html']):
            ev.append((t + 1.35, 'ping', 0.22))
    if n == 15: ev.append((start + plan[-2]['t'] + 0.2, 'chime', 0.32))
    if n == 16: ev.append((start + plan[2]['t'] + 0.1, 'sparkle', 0.3))
    return ev

def patch_frame7():
    p = 'compositions/frames/07.html'; s = open(p, encoding='utf8').read()
    s = re.sub(r'const CLIP = [0-9.]+;', f'const CLIP = {CLIP:.3f};', s)
    s = re.sub(r'(id="f07-video"[^>]*data-duration=")[0-9.]+"', lambda m: m.group(1) + f'{CLIP:.3f}"', s)
    s = s.replace(' data-has-audio="true" data-volume="1"', ' muted')   # its voice plays from assets/audio/voice/clip.m4a
    open(p, 'w', encoding='utf8').write(s)

starts, durs, voices, sfx = {}, {}, [], []
t = 0.0
for n, slide, a in FRAMES:
    if a is None:
        d = T_PLAY + CLIP; overlap = 0.8
        voices.append(('clip', round(t + T_PLAY, 3), round(min(probe('assets/audio/voice/clip.m4a'), CLIP - 0.5), 3)))  # stop before page 8's narration
        sfx += [(t, 'whoosh-short', 0.42), (t + 3.55, 'click', 0.6), (t + 3.9, 'whoosh-cinematic', 0.4), (t + T_PLAY + 0.4, 'pop', 0.22)]
    else:
        A = probe(f'assets/audio/voice/{a}.m4a'); d = LEAD + A + TAIL; overlap = XFADE
        voices.append((a, round(t + LEAD, 3), round(A, 3)))
        plan = convert(n, slide, A, d, last=(n == 16))
        sfx += scene_sfx(n, t, plan)
    starts[n], durs[n] = round(t, 3), round(d, 3)
    t += d - overlap
patch_frame7()
total = round(starts[16] + durs[16], 3)
hosts = [f'      <div id="f{n:02d}" class="clip" data-composition-id="f{n:02d}" data-composition-src="compositions/frames/{n:02d}.html" data-start="{starts[n]}" data-duration="{durs[n]}" data-track-index="{1 + n % 2}" data-width="1920" data-height="1080"></div>' for n, _, _ in FRAMES]
vo = [f'      <audio id="vo-{a}" src="assets/audio/voice/{a}.m4a" data-start="{st}" data-duration="{A}" data-track-index="4"></audio>' for a, st, A in voices]
sfx.sort()
fx, lane_free = [], [0.0] * 8                    # spread effects over tracks 6-13 so none overlap on a track
for i, (st, name, vol) in enumerate(sfx):
    if st + 0.05 >= total: continue
    d = min(SFX_DUR[name], round(total - st, 3)); lane = next((k for k in range(8) if lane_free[k] <= st), 0); lane_free[lane] = st + d
    fx.append(f'      <audio id="sfx-{i:03d}" src="assets/sfx/{name}.mp3" data-start="{round(st, 3)}" data-duration="{d}" data-volume="{vol}" data-track-index="{6 + lane}"></audio>')
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
      <!-- scenes (tracks 1-2) -->
{chr(10).join(hosts)}
      <!-- voice (track 4): narration + demo-clip voice, one shared chain (scripts/process_voice.py) -->
{chr(10).join(vo)}
      <!-- BGM (track 5): add your music here, e.g.
      <audio id="bgm" src="assets/audio/bgm.mp3" data-start="0" data-duration="{total}" data-volume="0.12" data-track-index="5"></audio> -->
      <!-- sound effects (tracks 6-13) -->
{chr(10).join(fx)}
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
'''
open('index.html', 'w', encoding='utf8').write(idx)
json.dump({'starts': starts, 'durs': durs, 'total': total, 'sfx': len(fx)}, open('scripts/schedule.json', 'w'), indent=1)
print('total', total, 'min', round(total / 60, 2), 'sfx', len(fx))
