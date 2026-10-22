#!/usr/bin/env python3
"""Convert the deck's slide HTML (source/slides) into HyperFrames sub-compositions and write
index.html: scene schedule driven by the narration, per-element reveal motion, voice tracks and
sound effects. Frame 7 (demo clip) is hand-built in compositions/frames/07.html.

Pipeline: scripts/edit_clip.py -> scripts/process_voice.py -> scripts/build_frames.py
Background music is left to the editor: add it as its own <audio> track (see the BGM note in index.html)."""
import re, subprocess, json, os, random
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
MAX_DRAGS, DRAG_GAP, DRAG_DUR = 3, 1.8, 0.9      # cursor drag-and-drop: cards per scene, spacing, travel time
PALETTE = json.load(open('assets/sfx/v/palette.json'))   # scripts/make_sfx.py
rnd = random.Random(20261022)
_bags, _last = {}, {}
def choose(cat):
    """Shuffle-bag pick: every variant plays once before any repeats, never the same one twice in a row."""
    if not _bags.get(cat):
        bag = PALETTE[cat][:]; rnd.shuffle(bag)
        if len(bag) > 1 and bag[-1]['file'] == _last.get(cat): bag[0], bag[-1] = bag[-1], bag[0]
        _bags[cat] = bag
    pick = _bags[cat].pop(); _last[cat] = pick['file']; return pick

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

def tag_reveals(body, A, A_SCENE=0):
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
    ndrag, ncard, last_drag = 0, 0, -DRAG_GAP + REVEAL_AT
    first_card_pops = A_SCENE == 1
    for i, (s0, oe, e, tag, attrs) in enumerate(items):
        frag, st = body[s0:e], style_of(attrs)
        if tag == 'p' and 'position:absolute' in st and text_of(frag).isdigit(): kind = 'badge'
        elif re.search(r'<h[12][ >]', frag) and frag.count('<div') < 4: kind = 'head'
        elif '<img' in frag: kind = 'img'
        elif 'background' in st: kind = 'card'
        else: kind = 'text'
        t = round(REVEAL_AT + i * step, 3)
        drag = kind in ('card', 'img') and ndrag < MAX_DRAGS and not (len(items) == 1) and not (first_card_pops and kind == 'card' and ncard == 0)
        if kind == 'card': ncard += 1
        if drag:
            t = round(max(t, last_drag + DRAG_GAP), 3); last_drag = t; ndrag += 1
        plan.append({'kind': kind, 't': t, 'html': frag, 'drag': drag})
        edits.append((s0 + 1 + len(tag), f' data-reveal="{kind}" data-t="{t}"' + (' data-drag="1"' if drag else '')))
    for pos, ins in sorted(edits, reverse=True): body = body[:pos] + ins + body[pos:]
    return body, plan

MOTION = '''
  const stage = document.getElementById("{id}-stage"), shell = document.getElementById("{id}-shell");
  const D = {D:.3f}, V = {variant}, N = {n};
  const COL = ["#4C8DF8", "#6A2EE8", "#F0508F", "#FFC53D", "#22B8CF"];
  // layout positions measured with offset* (immune to preview scaling), before any tween touches transforms
  const place = el => {{ let x = 0, y = 0, e = el; while (e && e !== stage) {{ x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }} return {{ x, y, w: el.offsetWidth, h: el.offsetHeight }}; }};
  const drags = [...stage.querySelectorAll("[data-drag]")], rect = new Map();
  drags.forEach(el => rect.set(el, place(el)));
  const mk = (css, html) => {{ const d = document.createElement("div"); d.setAttribute("data-layout-allow-overflow", ""); d.setAttribute("data-layout-allow-overlap", ""); d.setAttribute("data-layout-allow-occlusion", ""); d.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;opacity:0;" + css; if (html) d.innerHTML = html; shell.appendChild(d); return d; }};
  const STAR = c => '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z" fill="' + c + '"/></svg>';
  // scene entrance: zoom / slide / rise, then a slow camera push for the rest of the scene
  const enter = [{{ scale: 1.07 }}, {{ x: 160 }}, {{ y: 110 }}][V % 3];
  if ({fade_in}) tl.fromTo(shell, {{ opacity: 0, ...enter }}, {{ opacity: 1, scale: 1, x: 0, y: 0, duration: 0.75, ease: "expo.out" }}, 0);
  tl.fromTo(stage, {{ scale: 1 }}, {{ scale: 1.03, duration: D, ease: "none" }}, 0);
  // decorations drift in and float
  stage.querySelectorAll("[data-deco]").forEach((d, i) => {{
    tl.fromTo(d, {{ opacity: 0 }}, {{ opacity: 1, duration: 1.2, ease: "power1.out" }}, 0.1);
    const per = 2.6 + (i % 3) * 0.5; tl.to(d, {{ y: i % 2 ? 12 : -12, duration: per, ease: "sine.inOut", yoyo: true, repeat: Math.max(1, Math.floor(D / per) - 1) }}, 0.3);
  }});
  // sticker stars pop in and bob
  [[1560, 70, 54], [1790, 210, 38], [60, 880, 46], [1740, 930, 34]].forEach(([x, y, s], i) => {{
    const st = mk("width:" + s + "px;height:" + s + "px;left:" + x + "px;top:" + y + "px;", STAR(COL[(N + i * 2) % 5]));
    const t = 0.45 + i * 0.3 + (N % 3) * 0.05;
    tl.fromTo(st, {{ opacity: 0, scale: 0, rotation: -120 }}, {{ opacity: 0.9, scale: 1, rotation: 0, duration: 0.7, ease: "back.out(3)" }}, t);
    tl.to(st, {{ rotation: 25, y: i % 2 ? 10 : -10, duration: 2.4 + i * 0.4, ease: "sine.inOut", yoyo: true, repeat: Math.max(1, Math.floor(D / (2.4 + i * 0.4)) - 1) }}, t + 0.7);
  }});
  // confetti burst from (cx, cy) at time t
  const burst = (cx, cy, t, n = 9) => {{
    for (let i = 0; i < n; i++) {{
      const a = (i / n) * Math.PI * 2 + N, r = 90 + (i % 3) * 34, sz = 14 + (i % 4) * 5;
      const p = mk("width:" + sz + "px;height:" + sz + "px;left:" + cx + "px;top:" + cy + "px;" + (i % 3 === 0 ? "border-radius:50%;background:" + COL[i % 5] : i % 3 === 1 ? "border-radius:3px;background:" + COL[(i + 2) % 5] : ""), i % 3 === 2 ? STAR(COL[(i + 1) % 5]) : "");
      tl.fromTo(p, {{ opacity: 1, scale: 0.3, x: 0, y: 0, rotation: 0 }}, {{ opacity: 0, scale: 1, x: Math.cos(a) * r, y: Math.sin(a) * r + 26, rotation: (i % 2 ? 1 : -1) * 220, duration: 0.85, ease: "power2.out" }}, t);
    }}
  }};
  // element reveals — bouncy, a little wobbly ("duk-dik")
  const FX = {{
    head:  [{{ opacity: 0, x: -70, rotation: -2, clipPath: "inset(0% 100% 0% 0%)" }}, {{ opacity: 1, x: 0, rotation: 0, clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: "back.out(1.4)" }}],
    card:  [{{ opacity: 0, y: 40, scale: 0.55, rotation: -5 }}, {{ opacity: 1, y: 0, scale: 1, rotation: 0, duration: 1.0, ease: "elastic.out(1, 0.55)" }}],
    img:   [{{ opacity: 0, y: 30, scale: 0.7, rotation: 3 }}, {{ opacity: 1, y: 0, scale: 1, rotation: 0, duration: 0.9, ease: "back.out(2)" }}],
    text:  [{{ opacity: 0, y: 30, scale: 0.94 }}, {{ opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(2)" }}],
    badge: [{{ opacity: 0, scale: 0.3, rotation: -40 }}, {{ opacity: 1, scale: 1, rotation: 0, duration: 0.65, ease: "back.out(3.5)" }}],
  }};
  const cur = drags.length ? mk("width:62px;height:62px;filter:drop-shadow(0 8px 10px rgba(240,80,143,0.45));", '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 2 L4 19 L8.6 14.9 L11.6 21.6 L14.4 20.4 L11.4 13.8 L17.6 13.5 Z" fill="#ffffff" stroke="#1A1F36" stroke-width="1.6" stroke-linejoin="round"/></svg>') : null;
  stage.querySelectorAll("[data-reveal]").forEach(el => {{
    const t = +el.dataset.t, [from, to] = FX[el.dataset.reveal];
    if (el.hasAttribute("data-drag")) {{
      const r = rect.get(el), k = drags.indexOf(el), right = r.x + r.w / 2 > 960;
      const dx = (right ? 1 : -1) * 640, dy = k % 2 ? 260 : -210;
      const gx = r.x + Math.min(70, r.w * 0.3), gy = r.y + Math.min(60, r.h * 0.3);
      tl.fromTo(el, {{ opacity: 0 }}, {{ opacity: 1, duration: 0.18, ease: "none" }}, t);
      tl.fromTo(el, {{ x: dx, y: dy, rotation: right ? 9 : -9, scale: 1.05 }}, {{ x: 0, y: 0, rotation: 0, scale: 1, duration: {drag_dur}, ease: "power3.out" }}, t);
      tl.set(cur, {{ x: gx + dx, y: gy + dy, scale: 1, opacity: 0 }}, t - 0.15);
      tl.to(cur, {{ opacity: 1, duration: 0.12 }}, t - 0.15);
      tl.to(cur, {{ scale: 0.84, duration: 0.08, ease: "power2.in" }}, t - 0.03);
      tl.to(cur, {{ x: gx, y: gy, duration: {drag_dur}, ease: "power3.out" }}, t);
      tl.to(cur, {{ scale: 1, duration: 0.15, ease: "back.out(3)" }}, t + {drag_dur});
      tl.to(cur, {{ x: gx + 110, y: gy + 90, opacity: 0, duration: 0.4, ease: "power2.in" }}, t + {drag_dur} + 0.18);
      tl.to(el, {{ scaleX: 1.05, scaleY: 0.93, duration: 0.07, ease: "power2.out" }}, t + {drag_dur});
      tl.to(el, {{ scaleX: 1, scaleY: 1, duration: 0.6, ease: "elastic.out(1, 0.35)" }}, t + {drag_dur} + 0.07);
      burst(r.x + r.w / 2, r.y + r.h / 2, t + {drag_dur});
    }} else tl.fromTo(el, from, to, t);
    const rows = el.querySelectorAll("tr");
    if (rows.length > 2) tl.fromTo(rows, {{ opacity: 0, x: -24 }}, {{ opacity: 1, x: 0, duration: 0.45, ease: "back.out(1.7)", stagger: 0.07 }}, t + 0.3 + (el.hasAttribute("data-drag") ? {drag_dur} : 0));
    el.querySelectorAll("p").forEach(p => {{                     // big integers count up
      const txt = p.textContent.trim(), fs = parseFloat(getComputedStyle(p).fontSize);
      if (!/^[0-9]{{1,4}}$/.test(txt) || fs < 52 || el.dataset.reveal === "badge") return;
      const o = {{ v: 0 }}, v = +txt;
      tl.to(o, {{ v, duration: 1.2, ease: "power2.out", onUpdate: () => {{ p.textContent = Math.round(o.v); }} }}, t + 0.15 + (el.hasAttribute("data-drag") ? {drag_dur} : 0));
    }});
    el.querySelectorAll("svg line").forEach((ln, i) => {{        // diagram arrows draw on
      const L = ln.getTotalLength();
      tl.fromTo(ln, {{ strokeDasharray: L, strokeDashoffset: L }}, {{ strokeDashoffset: 0, duration: 0.7, ease: "power2.inOut" }}, t + 0.45 + i * 0.18 + (el.hasAttribute("data-drag") ? {drag_dur} : 0));
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
    body, plan = tag_reveals(body, A, n)
    fid = f'f{n:02d}'
    fadeout = f'tl.to(shell, {{ opacity: 0, duration: 0.8, ease: "power1.inOut" }}, D - 0.8);' if last else ''
    js = MOTION.format(id=fid, D=D, n=n, drag_dur=DRAG_DUR, variant=n % 3, fade_in='true' if n != 1 else 'false', fadeout=fadeout)
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
    """Sound design for one scene: a transition swish, grab/drop sounds for dragged cards, pops for the rest."""
    ev = []
    if n == 1: ev.append((start + 0.55, 'impact', 0.32))
    else: ev.append((start, 'swish', 0.34))
    ev.append((start + 0.5, 'sparkle', 0.12))                      # stickers pop in
    count = 0
    for it in plan:
        t = start + it['t']
        if it['drag']:
            ev += [(t - 0.05, 'grab', 0.3), (t + 0.05, 'swish', 0.2), (t + DRAG_DUR, 'drop', 0.5)]
            if n in (1, 3, 9, 16): ev.append((t + DRAG_DUR + 0.05, 'sparkle', 0.16))
            continue
        if n == 2 and it['kind'] == 'card' and count == 0: ev.append((t + 0.1, 'impact', 0.3)); count += 1; continue
        if it['kind'] in ('card', 'img') and count < MAX_SFX_PER_SCENE:
            ev.append((t + 0.05, 'pop', 0.34)); count += 1
        if re.search(r'font-size:\s*(5[2-9]|[6-9]\d|1\d\d)px[^>]*>\s*\d{1,4}\s*<', it['html']):
            ev.append((t + (DRAG_DUR if it['drag'] else 0) + 1.35, 'ping', 0.3))
    if n == 15: ev.append((start + plan[-2]['t'] + 0.2, 'chime', 0.26))
    if n == 16: ev.append((start + plan[2]['t'] + 0.1, 'chime', 0.24))
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
        sfx += [(t, 'swish', 0.34), (t + 3.55, 'click', 0.5), (t + 3.9, 'expand', 0.32), (t + T_PLAY + 0.4, 'pop', 0.22)]
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
    pick = choose(name); vol = round(vol * (0.85 + 0.3 * rnd.random()), 3)     # varied sound, varied level
    d = min(pick['dur'], round(total - st, 3)); lane = next((k for k in range(8) if lane_free[k] <= st), 0); lane_free[lane] = st + d
    fx.append(f'      <audio id="sfx-{i:03d}" src="{pick["file"]}" data-start="{round(st, 3)}" data-duration="{d}" data-volume="{vol}" data-track-index="{6 + lane}"></audio>')
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
