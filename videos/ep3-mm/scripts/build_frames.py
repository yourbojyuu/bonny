#!/usr/bin/env python3
"""EP3: convert the deck's slide HTML (source/slides, pages 36-49) into HyperFrames sub-compositions and
write index.html. Every reveal, cursor drag, camera punch-in, highlight ring and arrow draw-on is timed
to the word in SCRIPT.md that mentions it (see CUES), using an estimate of when each word is spoken:
the narration text is spread over the voiced stretches of its audio file, weighted by how long each
kind of character takes to say.

Pipeline: scripts/edit_clip.py -> scripts/process_voice.py -> scripts/make_sfx.py -> scripts/build_frames.py
Background music is left to the editor: add it as its own <audio> track (see the BGM note in index.html)."""
import re, subprocess, json, os, random
import numpy as np
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
FONTS = open('assets/fonts/fonts.css', encoding='utf8').read()
SLIDES = ['ep3', 'mm-idea', 'mm-mod-rule', 'mm-ph-why', 'mm-ph-mod-demo', 'mm-ph-compare', 'prn-mm-result', 'mm-tab-result',
          'mm-ph-slopes', 'mm-tab-src', 'mm-tab-sum', 'mm-ph-sum', 'summary', 'finale']
FRAMES = [(36 + i, s, f'p{36 + i}') for i, s in enumerate(SLIDES)]         # (page, slide id, narration file: scripts/process_voice.py)
FIRST, LAST, DEMO = 36, 49, 40
def probe(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
CLIP_FILE = 'assets/video/EP3-MOD-edit.mp4'                                  # edited demo clip (scripts/edit_clip.py)
HAS_CLIP = os.path.exists(CLIP_FILE)
CLIP = probe(CLIP_FILE) if HAS_CLIP else 6.0                                 # placeholder card until the clip is in place
LEAD, TAIL, XFADE = 0.4, 0.6, 0.6                # voice lead-in / tail inside a scene; scene overlap
END_HOLD = 4.5                                   # the last page holds a little longer so its report text can be read
REVEAL_AT, MAX_SFX_PER_SCENE = 0.7, 7
DRAG_GAP, DRAG_DUR = 1.8, 0.9                    # cursor drag-and-drop: min spacing, travel time
ZOOM_IN, MAX_HOLD = 0.9, 8.0
RING = ['#FFC53D', '#F0508F', '#22B8CF', '#4C8DF8']
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

# ---------- when is a word spoken? ----------
TEXT = {int(m.group(1)): m.group(2).strip().split('\n')[0] for m in re.finditer(r'^## p(\d+) [^\n]*\n(.+?)(?=\n## |\Z)', open('SCRIPT.md', encoding='utf8').read(), re.S | re.M)}
SPOKEN = {'LEAD', 'SUPP', 'ORGA', 'KNOW', 'DIST', 'Run', 'Model', 'Weight', 'Welcome', 'Excel', 'Import', 'Export', 'Second', 'Effect', 'Effects', 'Inference', 'Indirect', 'Direct', 'Estimated'}
def weight(text):
    """Approximate speaking time of each character: Thai letters 1, tone/vowel marks 0.3, digits and symbols
    longer (they are read out as words), short capitalised acronyms spelled letter by letter."""
    w = []
    for tok in re.finditer(r'[A-Za-z]+|[0-9]|\s|.', text):
        t = tok.group(0)
        if t.isspace(): w += [1.2]
        elif re.fullmatch(r'[A-Za-z]+', t):
            per = 2.2 if (t.isupper() and len(t) <= 5 and t not in SPOKEN) or len(t) == 1 else 1.0
            w += [per] * len(t)
        elif t.isdigit(): w += [2.0]
        elif t in '.': w += [1.6]
        elif t in 'β²%': w += [4.0]
        elif t in ',()·-–': w += [0.2]
        elif 'ั' <= t <= 'ฺ' or '็' <= t <= '๎': w += [0.3]
        else: w += [1.0]
    return np.array(w)
def voiced(f):
    """Voiced stretches of a narration file: 20 ms RMS above an adaptive floor, small gaps bridged."""
    raw = subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','1','-ar','16000','-f','f32le','-'], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32); hop = 320
    rms = np.sqrt(np.array([np.mean(x[i:i + hop] ** 2) for i in range(0, len(x) - hop, hop)]) + 1e-12)
    db = 20 * np.log10(rms); thr = max(np.percentile(db, 10) + 10, np.max(db) - 38)
    on = db > thr; segs, start = [], None
    for i, v in enumerate(on):
        if v and start is None: start = i
        if not v and start is not None: segs.append([start, i]); start = None
    if start is not None: segs.append([start, len(on)])
    merged = []
    for s in segs:
        if merged and s[0] - merged[-1][1] < 9: merged[-1][1] = s[1]     # bridge gaps < 180 ms
        else: merged.append(s)
    return [(float(a * 0.02), float(b * 0.02)) for a, b in merged if b - a >= 4]
VOICED = {}
def silent_length(page):
    """A page without a recording yet: hold it about as long as its outline text takes to say."""
    return round(float(weight(TEXT[page]).sum()) / 11.5 * 1.15 + 1.0, 2)
def when(page, needle, occ=1):
    """Seconds into the page's narration file at which `needle` (its occ-th occurrence) is spoken."""
    text = TEXT[page]; pos = -1
    for _ in range(occ):
        pos = text.find(needle, pos + 1)
        if pos < 0: raise SystemExit(f'p{page}: "{needle}" not in narration')
    w = weight(text); frac = w[:pos].sum() / w.sum()
    segs = VOICED[page]; total = sum(b - a for a, b in segs); goal = frac * total
    for a, b in segs:
        if goal <= b - a: return float(a + goal)
        goal -= b - a
    return float(segs[-1][1])

# ---------- per-page cues: (item text, action, spoken words) / (target, spoken words[, hold]) ----------
# items: drag = the cursor drops the card as the words are spoken; pop = springs in on the words; others
#        reveal in the first few seconds. A target is a text inside the slide ('^x' = exact text,
#        'row:x' = its table row, '*x' = every match, 'img:N' = the Nth screenshot).
CUES = {
 36: dict(items=[('ผลแรงขึ้น', 'pop', 'Welcome back'), ('LEAD', 'drag', 'ภาวะผู้นำจะสร้าง')],
          draw=[('#C8236F', 'ภาวะผู้นำจะสร้าง')],
          zoom=[('^SUPP', 'ได้รับการสนับสนุน', 2.6)],
          hl=[('^Moderation คืออะไร', 'Moderation คืออะไร'), ('^12 คู่ → 1', 'การคัดเลือกคู่'), ('^Simple slope', 'การอ่านค่า Simple slope')]),
 37: dict(items=[('Mediation', 'drag', 'Mediation คือตัวแปร'), ('Moderation', 'drag', 'ส่วน Moderation'), ('ตอบว่า', 'pop', 'สรุปง่าย')],
          draw=[('#C8236F', 'ผลจาก X ผ่าน M'), ('#E8641B', 'ทำหน้าที่ปรับความแรง')],
          zoom=[('^W', 'ทำหน้าที่ปรับความแรง', 3.0)],
          hl=[('^อยู่บนเส้นทาง', 'ที่อยู่บนเส้นทาง'), ('^a', 'เท่ากับ a คูณ b'), ('^อยู่นอกเส้นทาง', 'อยู่นอกเส้นทาง'),
              ('^“อย่างไร”', 'ตอบว่า อย่างไร'), ('^“เมื่อไร”', 'ตอบว่า เมื่อไร')]),
 38: dict(items=[('ตรวจ Measurement', 'drag', 'หนึ่ง ตรวจ'), ('รูปแบบที่อาจพบ', 'drag', 'ผลที่เจอได้')],
          zoom=[('ให้ผ่านก่อน 2', 'สอง รันโมเดล', 8.0), ('รูปแบบที่อาจพบ เสริมแรง', 'แบบที่หนึ่ง', 7.0)],
          hl=[('รันโมเดลหลัก เก็บ', 'สอง รันโมเดล'), ('คูณ X × W', 'สาม คูณ'), ('ใส่กลับเป็นตัวแปร', 'สี่ ใส่'),
              ('bootstrap 5,000 อ่าน', 'ห้า รัน'), ('simple slope ที่ W', 'หก ดู'),
              ('เสริมแรง EnhancingW', 'แบบที่หนึ่ง'), ('บั่นทอน BufferingW', 'แบบที่สอง'), ('สลับทิศ Antagonistic', 'แบบที่สาม')]),
 39: dict(items=[('ทำไมเลือก Moderation', 'drag', 'ทำไมต้อง Moderation'), ('คู่ตัวแปรที่เป็นไปได้', 'drag', 'ได้ 12 คู่'),
                 ('คู่ที่เลือก', 'drag', 'คือ LEAD คูณ')],
          zoom=[('ตามโครงสร้างโมเดล →', 'ได้ 12 คู่', 5.0), ('^LEAD × SUPP → ORGA', 'คำถามคือ', 4.0)],
          hl=[('คำถามที่ยังเหลือ', 'แรงขึ้นในเงื่อนไขใด'), ('3โมเดลที่มีนัยสำคัญ', 'สามโมเดล'), ('1โมเดลที่ผล', 'หนึ่งโมเดล')]),
 40: dict(items=[('รันโมเดลหลัก แล้ว', 'drag', 'หากกดด้วย ADANCO')]),
 41: dict(items=[('เหตุผลที่เลือก', 'drag', 'นอกจากนี้')],
          zoom=[('row:99% CI', 'คือ .011', 3.6), ('row:SRMR (Estimated)', 'ส่วนโมเดล ORGA', 7.0), ('ไม่หลุดนัยสำคัญ', 'การปรับ Bonferroni', 5.0)],
          hl=[('^.093', 'β .093'), ('^[.011, .169]', 'คือ .011'), ('^.0772', 'SRMR .0772'), ('^[−.017, .197] ✗', 'ช่วง 99% คร่อม'),
              ('^.0816 ✗', 'SRMR .0816'), ('^.0807 ✗', 'ก็ไม่ผ่าน'), ('ไม่หลุดนัยสำคัญ', 'การปรับ Bonferroni'), ('^เลือกใช้', 'เราจึงเลือก')],
          sfx=[('chime', 'เราจึงเลือก', 0.2)]),
 42: dict(items=[('Direct Effects Inference', 'drag', 'เปิดดูสี่ตาราง')],
          zoom=[('img:0', 'Direct Effects Inference,', 1.6), ('img:1', 'Indirect Effects', 1.6), ('img:2', 'R-Squared และ', 1.4),
                ('img:3', 'Goodness of model', 2.0)],
          hl=[('แถวสีเขียว', 'แถวสีเขียว')]),
 43: dict(items=[('Direct / Indirect', 'drag', 'อ่านแถวที่ไฮไลต์'), ('อ่านแถวที่ไฮไลต์ก่อน:', 'pop', 'ส่วนสองแถวล่าง')],
          zoom=[('row:LEAD_SUPP → ORGA', 'β .093', 8.0), ('row:ORGA → RU', 'ORGA ไป RU', 6.0)],
          hl=[('row:LEAD_SUPP → ORGA', 'LEAD_SUPP ไป ORGA β'), ('^3.04', 't 3.04'), ('^[.027, .147]', '.027 ถึง'), ('^[.011, .169]', 'และ 99%'),
              ('^.024', 'f² เท่ากับ'), ('R² ORGA', 'R² ของ ORGA'), ('row:ORGA → RU', 'ORGA ไป RU'), ('row:LEAD_SUPP → RU', 'Indirect effect')]),
 44: dict(items=[('ความชันของ LEAD', 'drag', 'ภาพนี้คือ'), ('ความชัน = .355', 'drag', 'เมื่อ SUPP ต่ำ'), ('เสริมแรง · Enhancing', 'drag', 'ทุกเส้นเป็นบวก')],
          draw=[('#B9BEDA', 'ลบหนึ่ง SD'), ('#E8367F', 'ที่ระดับเฉลี่ย'), ('#C24A0A', 'บวกหนึ่ง SD')],
          zoom=[('เสริมแรง · Enhancing', 'นี่คือการกำกับ', 3.0)],
          hl=[('^.293', 'ความชัน .293'), ('^.355', 'เฉลี่ย .355'), ('^.416', 'ขึ้นเป็น .416')]),
 45: dict(items=[('1Interaction term', 'drag', 'Interaction term มีนัยสำคัญ'), ('2Bonferroni', 'pop', 'ผ่าน Bonferroni'),
                 ('3Effect size', 'drag', 'Effect size'), ('5ผลถึง RU', 'pop', 'ผลไม่ถึง RU'), ('6Model fit', 'drag', 'ส่วน Model fit')],
          zoom=[('6Model fit', 'SRMR .0772', 4.0)],
          hl=[('^.093', 'β .093'), ('α .05 ÷ 12', 'ต่ำกว่า .0042'), ('^.024', 'f² .024'), ('^.0772', 'SRMR .0772'), ('^.0339', 'HI99 ที่')]),
 46: dict(items=[('รวมทุกส่วนไว้', 'drag', 'เมื่อรวมทั้งตาราง'), ('นับรวมทุกส่วน', 'drag', 'ผ่าน 3')],
          zoom=[('ข้อจำกัด1ไม่ผ่าน', 'ผ่าน 3', 4.0)],
          hl=[('3ผ่าน', 'ผ่าน 3'), ('2ข้อจำกัด', 'ข้อจำกัด 2'), ('1ไม่ผ่าน', 'ไม่ผ่าน 1'), ('row:ถึง RU', 'คือผลที่ไม่ส่งต่อ')],
          sfx=[('chime', 'ไปแปลผลกัน', 0.24)]),
 47: dict(items=[('การได้รับการสนับสนุนกำกับ', 'drag', 'ใจความคือ'), ('ข้อจำกัดที่ต้องเขียน', 'drag', 'ต้องเขียนข้อจำกัด'),
],
          zoom=[('การได้รับการสนับสนุนกำกับ', 'ความชันของภาวะผู้นำ', 5.0), ('ข้อจำกัดที่ต้องเขียน คัด', 'โมเดลนี้คัดมาจาก', 6.0)],
          hl=[('คัดจากการทดสอบ 12 คู่', 'คัดมาจาก 12 คู่'), ('SRMR สูงกว่า HI99', 'SRMR สูงกว่า'), ('หาง', 'หางหนัก'), ('ตัดขวาง', 'ข้อมูลตัดขวาง')]),
 48: dict(items=[('RU เป็นตัวแปรแบบรวมตัว', 'drag', 'หนึ่ง ตัวแปร'), ('ปัจจัยอธิบาย RU', 'drag', 'สอง ห้าปัจจัย'),
                 ('การสนับสนุนทำให้', 'drag', 'และสาม การสนับสนุน'), ('นัยเชิงปฏิบัติ', 'drag', 'ในทางปฏิบัติ')],
          zoom=[('ผู้บริหารควรลงทุน', 'ผู้บริหารควร', 6.0)],
          hl=[('RU เป็นตัวแปรแบบรวมตัว', 'สามรูปแบบการใช้'), ('ปัจจัยอธิบาย RU', 'คุณลักษณะการวิจัยส่งผล'),
              ('การสนับสนุนทำให้', 'ได้แรงขึ้น')],
          sfx=[('chime', 'ในทางปฏิบัติ', 0.22)]),
 49: dict(hl=[('^ขอบคุณ', 'ขอบคุณที่ติดตาม')], sfx=[('chime', 'แล้วพบกันใหม่', 0.24)]),
}


# ---------- minimal tag scanner: find element spans without reserialising the markup (keeps SVG casing) ----------
TAG = re.compile(r'<(/?)([a-zA-Z][\w-]*)((?:"[^"]*"|\'[^\']*\'|[^>"\'])*?)(/?)>')
VOID = {'img', 'br', 'hr', 'input', 'meta', 'link', 'source'}
def elements(html, lo=0, hi=None):
    """Every element of html[lo:hi] -> [(start, open_end, end, tag, attrs, depth)], document order."""
    hi = len(html) if hi is None else hi
    out, stack = [], []
    for m in TAG.finditer(html, lo, hi):
        close, tag, attrs, selfc = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if close:
            while stack:
                s = stack.pop()
                if s[2] == tag: out.append((s[0], s[1], m.end(), tag, s[3], len(stack))); break
        elif selfc or tag in VOID: out.append((m.start(), m.end(), m.end(), tag, attrs, len(stack)))
        else: stack.append((m.start(), m.end(), tag, attrs))
    return sorted(out)
def children(html, lo=0, hi=None):
    els = elements(html, lo, hi)
    return [e[:5] for e in els if e[5] == min((x[5] for x in els), default=0)]
def style_of(attrs):
    m = re.search(r'style="([^"]*)"', attrs); return (m.group(1) if m else '').replace(' ', '').lower()
def text_of(fragment): return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', fragment)).strip()
def flat(fragment): return re.sub(r'<[^>]+>', '', fragment).replace('\n', ' ')

def find_targets(body, spec):
    """Spans of the element(s) a cue target names (see CUES)."""
    els = [e for e in elements(body) if e[3] not in ('svg', 'path', 'line', 'polyline', 'polygon', 'circle', 'rect', 'defs', 'marker', 'br', 'i')]
    if spec.startswith('img:'): return [[e for e in els if e[3] == 'img'][int(spec[4:])]]
    every, row, exact = spec.startswith('*'), spec.startswith('row:'), spec.startswith('^')
    needle = spec.lstrip('*^').removeprefix('row:')
    norm = lambda e: re.sub(r'\s+', ' ', flat(body[e[0]:e[2]])).strip()
    hit = [e for e in els if (norm(e) == needle if exact else needle in norm(e))]
    hit = [e for e in hit if not any(o is not e and e[0] <= o[0] and o[2] <= e[2] for o in hit)]    # innermost only
    if row:                                    # a <tr>, or the cell of a CSS-grid table (its row is joined at runtime)
        allel = elements(body); out = []
        for h in hit:
            anc = [e for e in allel if e[0] <= h[0] and h[2] <= e[2]]
            tr = [e for e in anc if e[3] == 'tr']
            if tr: out.append(max(tr)); continue
            grid = max((g for g in anc if 'display:grid' in style_of(g[4])), default=None)
            cell = next((c for c in anc if grid and c[5] == grid[5] + 1 and grid[0] < c[0] < grid[2]), None)
            if cell: out.append(cell + ('row',))
        hit = out
    if not hit: raise SystemExit(f'target "{spec}" not found')
    return hit if every else hit[:1]

def tag_reveals(page, body, A):
    """Pick the elements that reveal, decide each one's treatment and time from the cues, tag zoom/ring
    targets, and pair each hexagon outline with the label that sits on it."""
    cue = CUES.get(page, {}); at = lambda say: LEAD + when(page, say)
    items, edits = [], []
    tops = children(body)
    for k, c in enumerate(tops):
        s0, oe, e, tag, attrs = c; st = style_of(attrs); frag = body[s0:e]
        if 'data-deco' in attrs or tag in ('svg', 'aside'): continue
        if 'position:absolute' in st and not text_of(frag) and '<img' not in frag: continue
        if 'display:grid' in st: items += children(body, oe, e - len(f'</{tag}>'))
        else: items.append(c)
    n = len(items); win = min(0.2 * A, 4.0); step = win / n if n > 1 else 0
    plan, last_drag = [], -DRAG_GAP + REVEAL_AT
    specs = cue.get('items', [])
    timed = []
    for i, (s0, oe, e, tag, attrs) in enumerate(items):
        frag, st = body[s0:e], style_of(attrs); txt = flat(frag)
        if tag == 'p' and 'position:absolute' in st and text_of(frag).isdigit(): kind = 'badge'
        elif re.search(r'<h[12][ >]', frag) and frag.count('<div') < 4: kind = 'head'
        elif '<img' in frag: kind = 'img'
        elif 'background' in st or 'position:absolute' in st: kind = 'card'
        else: kind = 'text'
        spec = next((s for s in specs if (text_of(frag) == s[0][1:] if s[0].startswith('^') else s[0] in txt)), None)
        if spec: specs = [s for s in specs if s is not spec]
        act = spec[1] if spec else None
        if act == 'drag': t = at(spec[2]) - DRAG_DUR
        elif act == 'pop': t = at(spec[2]) - 0.12
        elif kind == 'head': t = 0.35
        else: t = REVEAL_AT + i * step
        timed.append([max(0.3, t), kind, act == 'drag', i, frag])
    if specs: raise SystemExit(f'p{page}: item cue(s) matched nothing: {[s[0] for s in specs]}')
    for it in sorted(timed):                                        # keep cursor drags apart
        if it[2]: it[0] = max(it[0], last_drag + DRAG_GAP); last_drag = it[0]
    for t, kind, drag, i, frag in sorted(timed, key=lambda x: x[3]):
        s0, oe, e, tag, attrs = items[i]
        plan.append({'kind': kind, 't': round(t, 3), 'html': frag, 'drag': drag, 'span': (s0, e)})
        edits.append((s0 + 1 + len(tag), f' data-reveal="{kind}" data-t="{round(t, 3)}" data-i="{i}"' + (' data-drag="1"' if drag else '')))
    # hexagon outline (absolute svg) + its label (absolute div at the same spot) reveal together
    pos = lambda a: re.search(r'left:([\d.]+)px;top:([\d.]+)px', style_of(a))
    for a, b in zip(tops, tops[1:]):
        if a[3] == 'svg' and 'data-deco' not in a[4] and pos(a[4]) and pos(b[4]) and pos(a[4]).groups() == pos(b[4]).groups():
            j = next((k for k, it in enumerate(items) if it[0] == b[0]), None)
            if j is not None: edits.append((a[0] + 4, f' data-follow="{j}"'))
    reveal_of = lambda span: max((p['t'] + (DRAG_DUR if p['drag'] else 0) for p in plan if p['span'][0] <= span[0] and span[1] <= p['span'][1]), default=0)
    zooms, rings, draws, ids = [], [], [], {}
    def mark(spec):
        out = []
        for h in find_targets(body, spec):
            if h[0] not in ids:                                     # one id per element, however many cues name it
                ids[h[0]] = len(ids) + 1
                edits.append((h[0] + 1 + len(h[3]), f' data-z="{ids[h[0]]}"' + (' data-zrow' if h[-1] == 'row' else '')))
            out.append((ids[h[0]], reveal_of((h[0], h[2]))))
        return out
    for spec, say, hold in cue.get('zoom', []):
        (z, rv), = mark(spec)
        zooms.append({'z': z, 't': round(max(at(say) - 0.35, rv + 0.7), 3), 'hold': hold})
    for k, (spec, say) in enumerate(cue.get('hl', [])):
        hs = mark(spec); t = max(at(say) - 0.1, max(rv for _, rv in hs) + 0.5)
        rings.append({'z': [z for z, _ in hs], 't': round(t, 3), 'c': RING[(page + k) % len(RING)]})
    for color, say in cue.get('draw', []): draws.append({'c': color, 't': round(at(say) - 0.1, 3)})
    zooms.sort(key=lambda z: z['t'])
    for a, b in zip(zooms, zooms[1:] + [None]):                          # return to the full slide unless the next punch-in follows soon
        end = a['t'] + ZOOM_IN + min(a['hold'], MAX_HOLD)
        a['back'] = b is None or b['t'] - end > 1.0
        if b is not None and not a['back']: a['hold'] = max(0.4, b['t'] - a['t'] - ZOOM_IN)
    for pos_, ins in sorted(edits, reverse=True): body = body[:pos_] + ins + body[pos_:]
    return body, plan, zooms, rings, draws

MOTION = '''
  const stage = document.getElementById("{id}-stage"), shell = document.getElementById("{id}-shell"), cam = document.getElementById("{id}-cam");
  const D = {D:.3f}, V = {variant}, N = {n};
  const ZOOMS = {zooms}, RINGS = {rings}, DRAWS = {draws};
  const COL = ["#4C8DF8", "#6A2EE8", "#F0508F", "#FFC53D", "#22B8CF"];
  // layout positions measured with offset* (immune to preview scaling), before any tween touches transforms
  const place = el => {{ let x = 0, y = 0, e = el; while (e && e !== stage) {{ x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }} return {{ x, y, w: el.offsetWidth, h: el.offsetHeight }}; }};
  const Z = id => stage.querySelector('[data-z="' + id + '"]');
  const drags = [...stage.querySelectorAll("[data-drag]")], rect = new Map();
  drags.forEach(el => rect.set(el, place(el)));
  const zr = new Map(); stage.querySelectorAll("[data-z]").forEach(el => {{
    let r = place(el);
    if (el.hasAttribute("data-zrow")) {{             // grid table: join every cell on this cell's line
      const cells = [...el.parentElement.children].filter(c => Math.abs(c.offsetTop - el.offsetTop) < 4).map(place);
      const x0 = Math.min(...cells.map(c => c.x)), x1 = Math.max(...cells.map(c => c.x + c.w));
      r = {{ x: x0, y: r.y, w: x1 - x0, h: r.h }};
    }}
    zr.set(el, r);
  }});
  const mk = (host, css, html) => {{ const d = document.createElement("div"); d.setAttribute("data-layout-allow-overflow", ""); d.setAttribute("data-layout-allow-overlap", ""); d.setAttribute("data-layout-allow-occlusion", ""); d.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;opacity:0;" + css; if (html) d.innerHTML = html; host.appendChild(d); return d; }};
  const STAR = c => '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z" fill="' + c + '"/></svg>';
  tl.set(cam, {{ transformOrigin: "0px 0px" }}, 0);
  // scene entrance: zoom / slide / rise, then a slow camera push for the rest of the scene
  const enter = [{{ scale: 1.07 }}, {{ x: 160 }}, {{ y: 110 }}][V % 3];
  if ({fade_in}) tl.fromTo(shell, {{ opacity: 0, ...enter }}, {{ opacity: 1, scale: 1, x: 0, y: 0, duration: 0.75, ease: "expo.out" }}, 0);
  tl.fromTo(stage, {{ scale: 1 }}, {{ scale: 1.03, duration: D, ease: "none" }}, 0);
  // decorations drift in and float
  stage.querySelectorAll("[data-deco]").forEach((d, i) => {{
    tl.fromTo(d, {{ opacity: 0 }}, {{ opacity: 1, duration: 1.2, ease: "power1.out" }}, 0.1);
    const per = 2.6 + (i % 3) * 0.5; tl.to(d, {{ y: i % 2 ? 12 : -12, duration: per, ease: "sine.inOut", yoyo: true, repeat: Math.max(1, Math.floor(D / per) - 1) }}, 0.3);
  }});
  // sticker stars pop in and bob (screen-fixed: they stay put while the camera punches in)
  [[1560, 70, 54], [1790, 210, 38], [60, 880, 46], [1740, 930, 34]].forEach(([x, y, s], i) => {{
    const st = mk(shell, "width:" + s + "px;height:" + s + "px;left:" + x + "px;top:" + y + "px;", STAR(COL[(N + i * 2) % 5]));
    const t = 0.45 + i * 0.3 + (N % 3) * 0.05;
    tl.fromTo(st, {{ opacity: 0, scale: 0, rotation: -120 }}, {{ opacity: 0.9, scale: 1, rotation: 0, duration: 0.7, ease: "back.out(3)" }}, t);
    tl.to(st, {{ rotation: 25, y: i % 2 ? 10 : -10, duration: 2.4 + i * 0.4, ease: "sine.inOut", yoyo: true, repeat: Math.max(1, Math.floor(D / (2.4 + i * 0.4)) - 1) }}, t + 0.7);
  }});
  // confetti burst from (cx, cy) at time t
  const burst = (cx, cy, t, n = 9) => {{
    for (let i = 0; i < n; i++) {{
      const a = (i / n) * Math.PI * 2 + N, r = 90 + (i % 3) * 34, sz = 14 + (i % 4) * 5;
      const p = mk(stage, "width:" + sz + "px;height:" + sz + "px;left:" + cx + "px;top:" + cy + "px;" + (i % 3 === 0 ? "border-radius:50%;background:" + COL[i % 5] : i % 3 === 1 ? "border-radius:3px;background:" + COL[(i + 2) % 5] : ""), i % 3 === 2 ? STAR(COL[(i + 1) % 5]) : "");
      tl.fromTo(p, {{ opacity: 1, scale: 0.3, x: 0, y: 0, rotation: 0 }}, {{ opacity: 0, scale: 1, x: Math.cos(a) * r, y: Math.sin(a) * r + 26, rotation: (i % 2 ? 1 : -1) * 220, duration: 0.85, ease: "power2.out", immediateRender: false }}, t);
    }}
  }};
  // arrows: lines named by a draw cue wait for their words; the rest draw on with the card that holds them
  const lineIn = (ln, t) => {{
    if (ln.getAttribute("stroke-dasharray")) {{ tl.fromTo(ln, {{ opacity: 0 }}, {{ opacity: 1, duration: 0.5, ease: "power1.out" }}, t); return; }}
    const L = ln.getTotalLength();
    tl.fromTo(ln, {{ strokeDasharray: L, strokeDashoffset: L }}, {{ strokeDashoffset: 0, duration: 0.7, ease: "power2.inOut" }}, t);
  }};
  DRAWS.forEach(d => [...stage.querySelectorAll("line, polyline")].filter(l => !l.closest("[data-deco]") && (l.getAttribute("stroke") || "").toUpperCase() === d.c.toUpperCase())
    .forEach((ln, i) => {{ ln.dataset.cued = "1"; lineIn(ln, d.t + i * 0.16); }}));
  // element reveals — bouncy, a little wobbly ("duk-dik")
  const FX = {{
    head:  [{{ opacity: 0, x: -70, rotation: -2, clipPath: "inset(0% 100% 0% 0%)" }}, {{ opacity: 1, x: 0, rotation: 0, clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: "back.out(1.4)" }}],
    card:  [{{ opacity: 0, y: 40, scale: 0.55, rotation: -5 }}, {{ opacity: 1, y: 0, scale: 1, rotation: 0, duration: 1.0, ease: "elastic.out(1, 0.55)" }}],
    img:   [{{ opacity: 0, y: 30, scale: 0.7, rotation: 3 }}, {{ opacity: 1, y: 0, scale: 1, rotation: 0, duration: 0.9, ease: "back.out(2)" }}],
    text:  [{{ opacity: 0, y: 30, scale: 0.94 }}, {{ opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(2)" }}],
    badge: [{{ opacity: 0, scale: 0.3, rotation: -40 }}, {{ opacity: 1, scale: 1, rotation: 0, duration: 0.65, ease: "back.out(3.5)" }}],
  }};
  const cur = drags.length || {demo} ? mk(stage, "width:62px;height:62px;z-index:50;filter:drop-shadow(0 8px 10px rgba(240,80,143,0.45));", '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 2 L4 19 L8.6 14.9 L11.6 21.6 L14.4 20.4 L11.4 13.8 L17.6 13.5 Z" fill="#ffffff" stroke="#1A1F36" stroke-width="1.6" stroke-linejoin="round"/></svg>') : null;
  stage.querySelectorAll("[data-reveal]").forEach(el => {{
    const t = +el.dataset.t, [from, to] = FX[el.dataset.reveal], dd = el.hasAttribute("data-drag") ? {drag_dur} : 0;
    const group = [el, ...stage.querySelectorAll('[data-follow="' + el.dataset.i + '"]')];
    if (dd) {{
      const r = rect.get(el), k = drags.indexOf(el), right = r.x + r.w / 2 > 960;
      const dx = (right ? 1 : -1) * 640, dy = k % 2 ? 260 : -210;
      const gx = r.x + Math.min(70, r.w * 0.3), gy = r.y + Math.min(60, r.h * 0.3);
      tl.fromTo(group, {{ opacity: 0 }}, {{ opacity: 1, duration: 0.18, ease: "none" }}, t);
      tl.fromTo(group, {{ x: dx, y: dy, rotation: right ? 9 : -9, scale: 1.05 }}, {{ x: 0, y: 0, rotation: 0, scale: 1, duration: dd, ease: "power3.out" }}, t);
      tl.set(cur, {{ x: gx + dx, y: gy + dy, scale: 1, opacity: 0 }}, t - 0.15);
      tl.to(cur, {{ opacity: 1, duration: 0.12 }}, t - 0.15);
      tl.to(cur, {{ scale: 0.84, duration: 0.08, ease: "power2.in" }}, t - 0.03);
      tl.to(cur, {{ x: gx, y: gy, duration: dd, ease: "power3.out" }}, t);
      tl.to(cur, {{ scale: 1, duration: 0.15, ease: "back.out(3)" }}, t + dd);
      tl.to(cur, {{ x: gx + 110, y: gy + 90, opacity: 0, duration: 0.4, ease: "power2.in" }}, t + dd + 0.18);
      tl.to(group, {{ scaleX: 1.05, scaleY: 0.93, duration: 0.07, ease: "power2.out" }}, t + dd);
      tl.to(group, {{ scaleX: 1, scaleY: 1, duration: 0.6, ease: "elastic.out(1, 0.35)" }}, t + dd + 0.07);
      burst(r.x + r.w / 2, r.y + r.h / 2, t + dd);
    }} else tl.fromTo(group, from, to, t);
    const rows = el.querySelectorAll("tr");
    if (rows.length > 2) tl.fromTo(rows, {{ opacity: 0, x: -24 }}, {{ opacity: 1, x: 0, duration: 0.45, ease: "back.out(1.7)", stagger: 0.07 }}, t + 0.3 + dd);
    el.querySelectorAll("p").forEach(p => {{                     // big numbers count up (integers, .xx, 52.9%)
      const txt = p.textContent.trim(), fs = parseFloat(getComputedStyle(p).fontSize);
      const m = txt.match(/^([0-9]{{0,4}})(\\.[0-9]{{1,3}})?(%?)$/);
      if (!m || !(m[1] || m[2]) || fs < 52 || el.dataset.reveal === "badge") return;
      const v = parseFloat(txt), dec = m[2] ? m[2].length - 1 : 0, o = {{ v: 0 }};
      const fmt = x => {{ let s = x.toFixed(dec); if (!m[1]) s = s.replace(/^0/, ""); return s + m[3]; }};
      p.textContent = fmt(0);
      tl.to(o, {{ v, duration: 1.2, ease: "power2.out", onUpdate: () => {{ p.textContent = fmt(o.v); }} }}, t + 0.15 + dd);
    }});
    el.querySelectorAll("svg line, svg polyline").forEach((ln, i) => {{ if (!ln.dataset.cued) lineIn(ln, t + 0.45 + i * 0.18 + dd); }});
  }});
  // highlight rings on the words that name them
  RINGS.forEach((g, k) => g.z.forEach((id, j) => {{
    const el = Z(id), r = zr.get(el), p = 10, c = g.c, t = g.t + j * 0.08;
    const ring = mk(stage, "left:" + (r.x - p) + "px;top:" + (r.y - p) + "px;width:" + (r.w + 2 * p) + "px;height:" + (r.h + 2 * p) + "px;border:5px solid " + c + ";border-radius:18px;box-shadow:0 0 0 6px " + c + "33,0 0 26px " + c + "99;");
    tl.fromTo(ring, {{ opacity: 0, scale: 1.25 }}, {{ opacity: 1, scale: 1, duration: 0.4, ease: "back.out(2.2)" }}, t);
    tl.to(ring, {{ scale: 1.035, duration: 0.32, ease: "sine.inOut", yoyo: true, repeat: 3 }}, t + 0.4);
    tl.to(ring, {{ opacity: 0, duration: 0.45, ease: "power1.in" }}, t + 2.3);
    const sp = mk(stage, "width:30px;height:30px;left:" + (r.x + r.w + p - 14) + "px;top:" + (r.y - p - 16) + "px;", STAR(c));
    tl.fromTo(sp, {{ opacity: 0, scale: 0, rotation: -90 }}, {{ opacity: 1, scale: 1, rotation: 0, duration: 0.45, ease: "back.out(3)" }}, t + 0.1);
    tl.to(sp, {{ opacity: 0, scale: 0.4, duration: 0.4 }}, t + 1.6);
    if (el.tagName !== "TR" && !el.hasAttribute("data-zrow") && getComputedStyle(el).display !== "inline") tl.to(el, {{ scale: 1.05, duration: 0.22, ease: "sine.inOut", yoyo: true, repeat: 1 }}, t);
  }}));
  // camera punch-ins on what is being talked about
  ZOOMS.forEach(z => {{
    const r = zr.get(Z(z.z)), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const s = Math.max(1.12, Math.min(1.5, 0.8 * 1920 / r.w, 0.8 * 1080 / r.h));
    const x = Math.min(0, Math.max(1920 - 1920 * s, 960 - s * cx)), y = Math.min(0, Math.max(1080 - 1080 * s, 540 - s * cy));
    tl.to(cam, {{ x, y, scale: s, duration: {zin}, ease: "power3.inOut" }}, z.t);
    if (z.back) tl.to(cam, {{ x: 0, y: 0, scale: 1, duration: {zin}, ease: "power3.inOut" }}, Math.min(z.t + {zin} + z.hold, D - 1.0));
  }});
  {demo_js}
  {fadeout}'''

DEMO_JS = '''
  // demo: the cursor clicks play in the clip box, the box opens to full screen and the clip plays
  const box = stage.querySelector("[data-clipbox]"), btn = box.querySelector("svg").parentElement, b = place(box), p = place(btn);   // the round play button (an HTML box: SVG has no offset*)
  const TC = {t_click}, k = 1 + 0.03 * TC / D, sx = v => 960 + (v - 960) * k, sy = v => 540 + (v - 540) * k;
  const px = p.x + p.w / 2, py = p.y + p.h / 2;
  tl.set(cur, {{ x: px + 520, y: py + 330, scale: 1, opacity: 0 }}, TC - 1.4);
  tl.to(cur, {{ opacity: 1, duration: 0.2 }}, TC - 1.4);
  tl.to(cur, {{ x: px - 6, y: py - 4, duration: 1.2, ease: "power2.inOut" }}, TC - 1.4);
  tl.to(cur, {{ scale: 0.82, duration: 0.12, ease: "power2.in" }}, TC - 0.05);
  tl.to(cur, {{ scale: 1, duration: 0.18, ease: "power2.out" }}, TC + 0.07);
  tl.to(btn, {{ scale: 0.85, duration: 0.12, ease: "power2.in" }}, TC - 0.05);
  tl.to(btn, {{ scale: 1.08, duration: 0.25, ease: "back.out(3)" }}, TC + 0.07);
  const rip = mk(stage, "left:" + (px - 60) + "px;top:" + (py - 60) + "px;width:120px;height:120px;border-radius:60px;border:6px solid #FFC53D;");
  tl.fromTo(rip, {{ opacity: 0.9, scale: 0.4 }}, {{ opacity: 0, scale: 2.4, duration: 0.6, ease: "power2.out", immediateRender: false }}, TC);
  tl.to(cur, {{ opacity: 0, duration: 0.25 }}, TC + 0.3);
  const vl = document.getElementById("{id}-vlayer");
  tl.fromTo(vl, {{ opacity: 1, clipPath: "inset(" + sy(b.y) + "px " + (1920 - sx(b.x + b.w)) + "px " + (1080 - sy(b.y + b.h)) + "px " + sx(b.x) + "px round 32px)" }},
                {{ opacity: 1, clipPath: "inset(0px 0px 0px 0px round 0px)", duration: 1.1, ease: "power3.inOut", immediateRender: false }}, TC + 0.35);
  tl.to(cam, {{ opacity: 0, duration: 0.3, ease: "none" }}, TC + 1.5);          // slide steps away once the clip fills the frame
  tl.to([...shell.children].filter(c => c !== cam && c !== vl), {{ opacity: 0, duration: 0.3, ease: "none" }}, TC + 0.35);   // stickers leave the clip uncovered
  tl.fromTo("#{id}-prog", {{ scaleX: 0 }}, {{ scaleX: 1, duration: {clip:.3f}, ease: "none" }}, {t_play});'''

def demo_layer(fid, t_play):
    """Full-frame clip layer for the demo page (revealed from the clip box by DEMO_JS)."""
    if HAS_CLIP:
        media = f'<video id="{fid}-video" class="clip" src="{CLIP_FILE}" data-start="{t_play:.3f}" data-duration="{CLIP:.3f}" data-hf-media-start-basis="local" data-track-index="1" muted playsinline style="position:absolute;left:0;top:0;width:1920px;height:1080px;object-fit:contain;background:#0d1020"></video>'
    else:
        media = (f'<div style="position:absolute;left:0;top:0;width:1920px;height:1080px;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center">'
                 f'<p style="font-family:\'Prompt\',sans-serif;font-size:56px;font-weight:600;color:#FCFCFD">คลิปสาธิต ADANCO</p>'
                 f'<p style="font-family:\'Anuphan\',sans-serif;font-size:30px;color:#C9B5FF">รอไฟล์ assets/video/EP3-MOD.mp4</p></div>')
    return (f'<div id="{fid}-vlayer" data-layout-allow-overflow data-layout-allow-overlap style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:#0d1020;overflow:hidden;opacity:0">{media}'
            f'<div style="position:absolute;left:0;bottom:0;width:1920px;height:6px;background:rgba(255,255,255,0.12)"><div id="{fid}-prog" style="width:100%;height:100%;background:linear-gradient(90deg,#4C8DF8,#6A2EE8,#F0508F);transform-origin:left center"></div></div></div>')

def convert(n, slide, A, D, t_click=None, t_play=None):
    s = open(f'source/slides/{slide}.html', encoding='utf8').read()
    m = re.match(r'\s*<section id="[^"]+"[^>]*?style="([^"]*)"[^>]*>', s)
    style = m.group(1); body = s[m.end():]
    body = body[:body.rindex('</section>')]
    body = re.sub(r'<aside>.*?</aside>', '', body, flags=re.S)
    body = re.sub(r'/_blob/([0-9a-f]+)', r'assets/img/\1.png', body)
    body = body.replace('data-deco="1"', 'data-deco="1" data-layout-allow-overflow')
    if n == DEMO: body = body.replace('<div style="grid-column:span 7;', '<div data-clipbox style="grid-column:span 7;', 1)
    for old in set(re.findall(r'\sid="([^"]+)"', body)):
        body = body.replace(f'url(#{old})', f'url(#f{n}-{old})')
    body = re.sub(r'\sid="([^"]+)"', lambda mm: f' id="f{n}-{mm.group(1)}"', body)
    body, plan, zooms, rings, draws = tag_reveals(n, body, A)
    fid = f'f{n}'
    fadeout = f'tl.to(shell, {{ opacity: 0, duration: 0.8, ease: "power1.inOut" }}, D - 0.8);' if n == LAST else ''
    demo_js = DEMO_JS.format(id=fid, t_click=t_click, t_play=t_play, clip=CLIP) if n == DEMO else ''
    js = MOTION.format(id=fid, D=D, n=n, drag_dur=DRAG_DUR, variant=n % 3, fade_in='true' if n != FIRST else 'false', fadeout=fadeout,
                       zooms=json.dumps([{k: z[k] for k in ('z', 't', 'hold', 'back')} for z in zooms]), rings=json.dumps(rings),
                       draws=json.dumps(draws), zin=ZOOM_IN, demo='true' if n == DEMO else 'false', demo_js=demo_js)
    html = f'''<!doctype html>
<html><head><meta charset="UTF-8" /></head>
<body>
<template>
<style>
{FONTS}
#{fid}-root{{position:absolute;inset:0;overflow:hidden}}
#{fid}-shell{{position:absolute;inset:0}}
#{fid}-cam{{position:absolute;inset:0}}
#{fid}-stage{{position:absolute;inset:0;{style}}}
</style>
<div id="{fid}-root" data-composition-id="{fid}" data-width="1920" data-height="1080">
<div id="{fid}-shell">
<div id="{fid}-cam">
<div id="{fid}-stage">
{body}
</div>
</div>
{demo_layer(fid, t_play) if n == DEMO else ''}
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
    open(f'compositions/frames/{n}.html', 'w', encoding='utf8').write(html)
    return plan, zooms, rings, draws

def scene_sfx(n, start, plan, zooms, rings, draws):
    """Sound design for one scene: transition swish, grab/drop for dragged cards, pops, punch-in whooshes,
    highlight dings and arrow scribbles — each picked from its shuffle bag so neighbours differ."""
    ev = [(start + 0.55, 'impact', 0.3)] if n == FIRST else [(start, 'swish', 0.32)]
    ev.append((start + 0.5, 'sparkle', 0.1))                       # stickers pop in
    count = 0
    for it in plan:
        t = start + it['t']
        if it['drag']:
            ev += [(t - 0.05, 'grab', 0.28), (t + 0.05, 'swish', 0.16), (t + DRAG_DUR, 'drop', 0.46)]
            continue
        if it['kind'] in ('card', 'img') and count < MAX_SFX_PER_SCENE:
            ev.append((t + 0.05, 'pop', 0.32)); count += 1
        if re.search(r'font-size:\s*(5[2-9]|[6-9]\d|1\d\d)px[^>]*>\s*[0-9.]{1,5}%?\s*<', it['html']):
            ev.append((t + (DRAG_DUR if it['drag'] else 0) + 1.35, 'ping', 0.28))
    for z in zooms:
        ev.append((start + z['t'], 'zoomin', 0.2))
        if z['back']: ev.append((start + z['t'] + ZOOM_IN + z['hold'], 'zoomout', 0.12))
    for r in rings: ev.append((start + r['t'], 'hl', 0.2))
    for d in draws: ev.append((start + d['t'], 'draw', 0.13))
    for cat, say, vol in CUES.get(n, {}).get('sfx', []): ev.append((start + LEAD + when(n, say), cat, vol))
    return ev

starts, durs, voices, sfx, silent = {}, {}, [], [], []
t = 0.0
for n, slide, a in FRAMES:
    vf = f'assets/audio/voice/{a}.m4a'
    if os.path.exists(vf):
        A = probe(vf); VOICED[n] = voiced(vf)
        voices.append((a, round(t + LEAD, 3), round(A, 3)))
    else:                                                          # not recorded yet: silent page, cues on the estimate
        A = silent_length(n); VOICED[n] = [(0.3, A)]; silent.append(n)
    if n == DEMO:
        t_click = round(LEAD + A + 0.5, 3); t_play = round(t_click + 1.5, 3)
        d = t_play + CLIP; overlap = 0.8
        plan, zooms, rings, draws = convert(n, slide, A, d, t_click, t_play)
        sfx += scene_sfx(n, t, plan, zooms, rings, draws)
        sfx += [(t + t_click, 'click', 0.5), (t + t_click + 0.35, 'expand', 0.3), (t + t_play + 0.4, 'pop', 0.2)]
        if HAS_CLIP and os.path.exists('assets/audio/voice/clip.m4a'):
            voices.append(('clip', round(t + t_play, 3), round(min(probe('assets/audio/voice/clip.m4a'), CLIP - 0.5), 3)))
    else:
        d = LEAD + A + (END_HOLD if n == LAST else TAIL); overlap = XFADE
        plan, zooms, rings, draws = convert(n, slide, A, d)
        sfx += scene_sfx(n, t, plan, zooms, rings, draws)
    starts[n], durs[n] = round(t, 3), round(d, 3)
    t += d - overlap
total = round(starts[LAST] + durs[LAST], 3)
hosts = [f'      <div id="f{n}" class="clip" data-composition-id="f{n}" data-composition-src="compositions/frames/{n}.html" data-start="{starts[n]}" data-duration="{durs[n]}" data-track-index="{1 + n % 2}" data-track-kind="graphics" data-width="1920" data-height="1080"></div>' for n, _, _ in FRAMES]
vo = [f'      <audio id="vo-{a}" src="assets/audio/voice/{a}.m4a" data-start="{st}" data-duration="{A}" data-track-index="4"></audio>' for a, st, A in voices]
sfx.sort()
fx, lane_free = [], [0.0] * 8                    # spread effects over tracks 6-13 so none overlap on a track
for i, (st, name, vol) in enumerate(sfx):
    if st + 0.05 >= total or st < 0: continue
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
      <!-- scenes (tracks 1-2): pages 36-49 -->
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
json.dump({'starts': starts, 'durs': durs, 'total': total, 'sfx': len(fx), 'clip': HAS_CLIP, 'silent': silent}, open('scripts/schedule.json', 'w'), indent=1)
print('total', total, 'min', round(total / 60, 2), 'sfx', len(fx), 'clip', 'yes' if HAS_CLIP else 'placeholder', 'silent pages', silent)
