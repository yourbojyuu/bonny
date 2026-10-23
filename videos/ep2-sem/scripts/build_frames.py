#!/usr/bin/env python3
"""EP2: convert the deck's slide HTML (source/slides, pages 17-35) into HyperFrames sub-compositions and
write index.html. Every reveal, cursor drag, camera punch-in, highlight ring and arrow draw-on is timed
to the word in SCRIPT.md that mentions it (see CUES), at the moment it is actually spoken: the script is
aligned to a speech-recognition transcript of each narration file (scripts/transcribe.py -> asr.json).

Pipeline: scripts/edit_clip.py -> scripts/process_voice.py -> scripts/transcribe.py -> scripts/make_sfx.py -> scripts/build_frames.py
Background music is left to the editor: add it as its own <audio> track (see the BGM note in index.html)."""
import re, subprocess, json, os, random
import numpy as np
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
FONTS = open('assets/fonts/fonts.css', encoding='utf8').read()
SLIDES = ['ep2', 'model', 'sem-pic', 'sem-idea', 'sem-hoc', 'sem-prep', 'sem-ph-demo', 'prn-sem-fit', 'sem-tab-fit',
          'prn-sem-outer', 'sem-ph-outer', 'sem-tab-vif', 'sem-ph-map', 'prn-sem-paths', 'sem-tab-paths', 'sem-ph-ru',
          'sem-tab-src', 'sem-tab-sum', 'sem-ph-sum']
FRAMES = [(17 + i, s, f'{i + 1:02d}') for i, s in enumerate(SLIDES)]          # (page, slide id, narration file)
FIRST, LAST, DEMO = 17, 35, 23
def probe(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]))
CLIP_FILE = 'assets/video/EP2-SEM-edit.mp4'                                  # edited demo clip (scripts/edit_clip.py)
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
# scripts/asr.json (scripts/transcribe.py) holds what each narration file actually says, phrase by phrase,
# with times. The script text is aligned to that transcript character by character (global alignment), so a
# cue's words map to the phrase where they are really spoken — ad-libs, skipped words and garbled terms in
# the transcript only disturb their own neighbourhood.
TEXT = {int(m.group(1)): m.group(2).strip().split('\n')[0] for m in re.finditer(r'^## p(\d+) [^\n]*\n(.+?)(?=\n## |\Z)', open('SCRIPT.md', encoding='utf8').read(), re.S | re.M)}
ASR = json.load(open('scripts/asr.json', encoding='utf8'))
MARKS = set(chr(c) for c in list(range(0x0E31, 0x0E3B)) + list(range(0x0E47, 0x0E4F)))   # Thai vowel/tone marks: often dropped by ASR
def norm(text):
    """Comparable characters and, for each, its index in the original text."""
    out, idx = [], []
    for i, ch in enumerate(text.lower()):
        if ch in MARKS or not (ch.isalnum() or '\u0e00' <= ch <= '\u0e7f'): continue
        out.append(ch); idx.append(i)
    return out, idx
def align(a, b):
    """Needleman-Wunsch: for each position in a, the matched position in b (or -1)."""
    n, m = len(a), len(b); M, G = 2, -1
    S = np.zeros((n + 1, m + 1)); S[:, 0] = np.arange(n + 1) * G; S[0, :] = np.arange(m + 1) * G
    for i in range(1, n + 1):
        sub = S[i - 1, :-1] + np.where(np.array(b) == a[i - 1], M, -1)
        row = np.maximum(sub, S[i - 1, 1:] + G); S[i, 1:] = row
        for j in range(1, m + 1): S[i, j] = max(S[i, j], S[i, j - 1] + G)
    out, i, j = [-1] * n, n, m
    while i > 0 and j > 0:
        if S[i, j] == S[i - 1, j - 1] + (M if a[i - 1] == b[j - 1] else -1):
            if a[i - 1] == b[j - 1]: out[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif S[i, j] == S[i - 1, j] + G: i -= 1
        else: j -= 1
    return out
TIMEMAP = {}
def timemap(page, file):
    """Seconds at which each character of the page's script is spoken."""
    text = TEXT[page]; sc, sidx = norm(text)
    tc, tt = [], []
    for ph in ASR[file]:
        cs, _ = norm(ph['text']); a, b = ph['a'] + 0.08, max(ph['a'] + 0.1, ph['b'] - 0.08)
        tc += cs; tt += [a + (b - a) * k / max(1, len(cs)) for k in range(len(cs))]
    match = align(sc, tc)
    known = [(k, tt[j]) for k, j in enumerate(match) if j >= 0]
    if len(known) < 0.25 * len(sc):                                  # transcript does not follow the script
        print(f'  ! p{page}: only {len(known)}/{len(sc)} characters align — check its narration file')
    if not known: known = [(0, 0.0), (len(sc) - 1, ASR[file][-1]['b'])]
    ks, ts = zip(*known)
    per = np.interp(range(len(sc)), ks, ts)
    full = np.interp(range(len(text)), sidx, per)
    TIMEMAP[page] = np.maximum.accumulate(full)                    # never run backwards
def when(page, needle, occ=1):
    """Seconds into the page's narration file at which `needle` (its occ-th occurrence) starts being spoken.
    A number is taken as the time itself: used where the narrator ad-libs or the transcript garbles a term,
    read off scripts/asr.json."""
    if isinstance(needle, (int, float)): return float(needle)
    text = TEXT[page]; pos = -1
    for _ in range(occ):
        pos = text.find(needle, pos + 1)
        if pos < 0: raise SystemExit(f'p{page}: "{needle}" not in narration')
    return float(TIMEMAP[page][pos])

# ---------- per-page cues: (item text, action, spoken words) / (target, spoken words[, hold]) ----------
# items: drag = the cursor drops the card as the words are spoken; pop = springs in on the words; others
#        reveal in the first few seconds. A target is a text inside the slide ('^x' = exact text,
#        'row:x' = its table row, '*x' = every match, 'img:N' = the Nth screenshot).
CUES = {
 17: dict(items=[('อะไรทำให้ครู', 'pop', 'ตอนที่สอง'), ('LEAD SUPP', 'drag', 'มีห้าปัจจัย')],
          zoom=[('card:LEAD SUPP', 'สิบเอ็ดเส้นทาง', 2.6)],
          hl=[('FAM + PAM', 'ทำความเข้าใจโมเดล'), ('^เตรียมข้อมูล', 'เตรียมข้อมูล แล้ว'), ('อ่านผล 5 ขั้น', 15.4)]),
 18: dict(items=[('RUการใช้ประโยชน์', 'drag', 'นี่คือโมเดล'), ('LEADภาวะ', 'pop', 'ภาวะผู้นำ'), ('SUPPการ', 'pop', 'การสนับสนุน'),
                 ('ORGAบรรยากาศ', 'pop', 'บรรยากาศองค์กร'), ('KNOWความรู้', 'pop', 'ความรู้ทักษะวิจัย'), ('DISTคุณ', 'pop', 'คุณลักษณะวิจัย'),
                 ('เส้นชมพู', 'pop', 'เส้นสีชมพู')],
          draw=[('#C8236F', 'ห้าเส้นชี้เข้า'), ('#8A8FA3', 'ส่วนเส้นสีเทา')],
          zoom=[('RUการใช้ประโยชน์', 'ชี้เข้า RU', 2.2)],
          hl=[('เส้นเทา', 'ส่วนเส้นสีเทา')]),
 19: dict(items=[('FAMFactor', 'drag', 6.9), ('^+', 'pop', 'ส่วนที่สอง'), ('PAMPath', 'drag', 16.0),
                 ('^=', 'pop', 'SEM คือการรวม'), ('SEMStructural', 'drag', 'SEM คือการรวม'), ('อ่านผลตามลำดับ', 'pop', 'ลำดับการอ่าน')],
          zoom=[('card:SEMStructural', 'สองส่วนนี้ไว้ในโมเดลเดียว', 2.4)],
          hl=[('CFA หรือ CCA', 12.6), ('β และ R²', 23.4), ('card:อ่านผลตามลำดับ', 33.0)]),
 20: dict(items=[('OuterMeasurement', 'drag', 'ชั้นนอก'), ('InnerStructural', 'drag', 'ชั้นใน'), ('ทำไมเลือก', 'drag', 'งานนี้ใช้ PLS-SEM'),
                 ('5,000ทดสอบ', 'pop', 'เราทดสอบนัยสำคัญ')],
          zoom=[('card:ทำไมเลือก', 'เพราะ RU เป็นตัวแปร', 7.0)],
          hl=[('ตัวแปรปัจจัยร่วม', 'composite'), ('อันดับสูงทำได้', 'อันดับสูง'), ('^5,000', '5,000 รอบ')]),
 21: dict(items=[('Disjoint two-stage', 'drag', 'วิธีแรก'), ('Embedded two-stage', 'drag', 18.6), ('ขั้นที่ 2 ของทั้งสองแบบ', 'pop', 20.6)],   # recording stops before the Embedded part
          zoom=[('card:Disjoint two-stage ขั้นที่ 1', 'ยังไม่ใส่ RU', 8.0)],
          hl=[('^Disjoint two-stage', 'วิธีแรก')]),
 22: dict(items=[('Missing data', 'pop', 4.6), ('Outlier', 'drag', 'สอง ค่านอกเกณฑ์'), ('ชื่อตัวแปร', 'pop', 'สาม ชื่อตัวแปร'),
                 ('ขนาดตัวอย่าง', 'drag', 'สี่ ขนาดตัวอย่าง'), ('PLS ไม่ต้องการ', 'drag', 'สุดท้าย PLS')],
          zoom=[('card:ขนาดตัวอย่าง', 31.6, 3.0)],
          hl=[('Random imputation', 'Random imputation'), ('Disjoint ต้องมีไฟล์', 'อย่าลืมว่า Disjoint')]),
 23: dict(items=[('ขั้นที่ 1: IRU', 'drag', 'หากกดด้วย ADANCO')]),
 24: dict(items=[('Goodness of model fit (saturated', 'drag', 'เปิดตาราง')],
          zoom=[('img:0', 'ด้านซ้ายคือ', 2.0), ('img:1', 'ด้านขวาคือ', 2.6)],
          hl=[('ซ้าย = Saturated', 'ตัวเลขสีแดง')]),
 25: dict(items=[('ดัชนี Saturated', 'drag', 'Saturated ตรวจเฉพาะ'), ('อ่าน: Saturated', 'pop', 'ส่วน Estimated')],
          zoom=[('card:ดัชนี Saturated', 'SRMR ของ Saturated', 6.0)],
          hl=[('^.0383', '.0383'), ('^.0784', '.0784'), ('row:dULS', 'ถ้าดู dULS'), ('row:dG', 'และ dG')]),
 26: dict(items=[('Weights T-Values', 'drag', 'เปิดสามตาราง')],
          zoom=[('img:0', 'Weights T-Values', 1.4), ('img:1', 'Loadings และ', 1.2), ('img:2', 9.6, 3.0)]),
 27: dict(items=[('loading ต่ำสุด', 'drag', 'ตัวแปรทั้งหก'), ('คงไว้ด้วย loading', 'drag', 'ที่เหลือสองตัว'), ('Weight RU ในโมเดลเต็ม', 'drag', 'ส่วน Weight ของ RU')],
          zoom=[('card:คงไว้ด้วย loading', 'LEAD1', 5.0), ('card:Weight RU ในโมเดลเต็ม', 36.6, 5.0)],
          hl=[('LEAD1', 'LEAD1'), ('DIST3', 'DIST3'), ('row:VIF', 'VIF อยู่ระหว่าง')]),
 28: dict(items=[('VIF = 1', 'drag', 'ขั้นที่ 3'), ('ต้นเหตุ', 'drag', 'สาเหตุคือ')],
          zoom=[('card:VIF = 1', 'แต่ KNOW', 3.4), ('card:ต้นเหตุ', 'r เท่ากับ', 3.6)],
          hl=[('row:ORGA', 'ORGA 4.37'), ('row:SUPP', 'SUPP 3.63'), ('row:LEAD', 15.2), ('row:KNOW', 'KNOW 6.09'), ('row:DIST', 21.0),
              ('r = .90', 'r เท่ากับ')]),
 29: dict(items=[('R² .603', 'drag', 'แผนที่เส้นทาง'), ('มีนัยสำคัญไม่มี', 'pop', 'เส้นประสองเส้น'), ('เส้นใหญ่สุด', 'drag', 'เส้นที่แรงที่สุด'),
                 ('ถูกอธิบายได้สูงสุด', 'drag', 'ตัวแปรที่ถูกอธิบาย')],
          draw=[('#6A2EE8', 'สิบเอ็ดเส้น'), ('#A3A8BC', 'เส้นประสองเส้น')],
          zoom=[('^.83', 15.2, 2.6), ('^R² .814', 21.6, 2.4)],
          hl=[('*ns', 'LEAD ไป RU'), ('^.83', 16.1), ('^R² .814', 21.9)]),
 30: dict(items=[('Direct Effects Inference R-Squared', 'drag', 'เปิดสามตาราง')],
          zoom=[('img:0', 7.6, 4.0), ('img:2', 13.9, 2.6)],
          hl=[('แถวสี', 17.2)]),
 31: dict(items=[('Direct Effects Inference', 'drag', 'เริ่มจากหกเส้น'), ('อ่าน: 95% CI', 'pop', 8.8)],
          zoom=[('card:Direct Effects Inference', 9.3, 8.0)],
          hl=[('row:LEAD → SUPP', 9.7), ('row:KNOW → DIST', 14.0), ('row:SUPP → DIST', 22.6), ('Cohen', 31.0)]),
 32: dict(items=[('เส้นทางβ', 'drag', 'ขั้นที่ 5'), ('ระดับปานกลาง', 'drag', 'R² ของ RU'), ('ระวังตอนเทียบ', 'drag', 'สองข้อควรระวัง')],
          zoom=[('card:เส้นทางβ', 'เรียงจากแรงสุด', 7.0), ('card:ระวังตอนเทียบ', 'ค่า .5254', 3.4)],
          hl=[('row:DIST → RU', 7.6), ('row:KNOW → RU', 10.6), ('row:SUPP → RU', 12.4), ('row:LEAD → RU', 'LEAD กับ ORGA'),
              ('row:ORGA → RU', 'ORGA ไม่มี'), ('^.529', '.529 ระดับ')]),
 33: dict(items=[('Model fitผ่านบางส่วน', 'drag', 'Model fit ผ่าน'), ('Measurement modelผ่าน', 'pop', 'Measurement model ผ่าน'),
                 ('VIF ระหว่างปัจจัย', 'drag', 'VIF ระหว่าง'), ('Path coefficient', 'pop', 'Path coefficient'),
                 ('Effect size', 'drag', 'f² ของเส้น'), ('R² ของ RUปานกลาง', 'pop', 22.0)],
          zoom=[('card:VIF ระหว่างปัจจัย', 9.4, 2.4)],
          hl=[('^9/11 เส้น', '9 ใน 11'), ('^.001–.059', 18.0)]),
 34: dict(items=[('รวมทุกส่วนไว้', 'drag', 'รวมในตารางเดียว'), ('นับรวม', 'drag', 'ผ่าน 4')],
          zoom=[('card:นับรวม', 'ผ่าน 4', 4.2)],
          hl=[('^4', 'ผ่าน 4'), ('^2', 'ข้อจำกัด 2'), ('^1', 'ไม่ผ่าน 1'), ('row:Exact fit', 'คือ Exact fit')],
          sfx=[('chime', 12.8, 0.24)]),
 35: dict(items=[('52.9%', 'drag', 5.6), ('.39 คุณลักษณะ', 'drag', 10.8), ('.21 · .19', 'pop', 'รองลงมา'),
                 ('ผู้นำและบรรยากาศองค์กรไม่มีผลตรง', 'drag', 'ส่วนภาวะผู้นำและ'), ('เขียนในรายงาน', 'pop', 'ปัจจัยที่ส่งผลตรงล้วน')],
          zoom=[('card:52.9%', 6.0, 2.4), ('card:เขียนในรายงาน', 'ใกล้ตัวครู', 4.0)],
          hl=[('ผู้นำและบรรยากาศองค์กรไม่มีผลตรง', 'ส่วนภาวะผู้นำไม่มีผลตรง')],
          sfx=[('chime', 'คำถามที่ตามมา', 0.22)]),
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
        hits = find_targets(body, spec.removeprefix('card:'))
        if spec.startswith('card:'):                                 # the whole revealed card that holds the text
            hits = [next(e for e in elements(body) if e[0] == p['span'][0]) for h in hits for p in plan if p['span'][0] <= h[0] and h[2] <= p['span'][1]]
        for h in hits:
            if h[0] not in ids:                                     # one id per element, however many cues name it
                ids[h[0]] = len(ids) + 1
                edits.append((h[0] + 1 + len(h[3]), f' data-z="{ids[h[0]]}"' + (' data-zrow' if h[-1] == 'row' else '')))
            out.append((ids[h[0]], reveal_of((h[0], h[2]))))
        return out
    for spec, say, hold in cue.get('zoom', []):
        (z, rv), = mark(spec)
        zooms.append({'z': z, 't': round(max(at(say) - 0.65, rv + 0.6), 3), 'hold': hold})   # camera arrives as the word is said
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
  // arrows: lines named by a draw cue wait for their words; the rest draw on with the card that holds them.
  // The arrowhead travels with the drawing tip: the line's marker becomes a copy of its shape that is
  // moved along the line as it draws (a marker would sit at the end, waiting, before the line got there).
  const SVGNS = "http://www.w3.org/2000/svg";
  const headOf = ln => {{
    const m = (ln.getAttribute("marker-end") || "").match(/url\\(#([^)]+)\\)/), mk = m && stage.querySelector('[id="' + m[1] + '"]');
    if (!mk) return null;
    const vb = (mk.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number), mw = +mk.getAttribute("markerWidth") || 3;
    const k = (mk.getAttribute("markerUnits") === "userSpaceOnUse" ? 1 : +ln.getAttribute("stroke-width") || 1) * (vb.length === 4 ? mw / vb[2] : 1);
    const g = document.createElementNS(SVGNS, "g");
    [...mk.children].forEach(c => g.appendChild(c.cloneNode(true)));
    ln.parentNode.appendChild(g); ln.removeAttribute("marker-end");
    return {{ g, k, rx: +mk.getAttribute("refX") || 0, ry: +mk.getAttribute("refY") || 0 }};
  }};
  // the path is sampled once here, at build time; the draw tween only reads these numbers
  const track = ln => {{
    const L = ln.getTotalLength(), n = Math.max(8, Math.ceil(L / 6)), pts = [];
    for (let i = 0; i <= n; i++) pts.push(ln.getPointAtLength(L * i / n));
    return {{ L, n, pts: pts.map((p, i) => {{ const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, Math.max(1, i))]; return {{ x: p.x, y: p.y, r: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI }}; }}) }};
  }};
  const putHead = (h, tr, d) => {{
    const f = Math.max(0, Math.min(1, d / tr.L)) * tr.n, i = Math.floor(f), j = Math.min(tr.n, i + 1), u = f - i, A = tr.pts[i], B = tr.pts[j];
    h.g.setAttribute("transform", "translate(" + (A.x + (B.x - A.x) * u) + "," + (A.y + (B.y - A.y) * u) + ") rotate(" + B.r + ") scale(" + h.k + ") translate(" + -h.rx + "," + -h.ry + ")");
  }};
  const lineIn = (ln, t) => {{
    const h = headOf(ln), tr = track(ln), L = tr.L;
    if (ln.getAttribute("stroke-dasharray")) {{
      if (h) putHead(h, tr, L);
      tl.fromTo(h ? [ln, h.g] : ln, {{ opacity: 0 }}, {{ opacity: 1, duration: 0.5, ease: "power1.out" }}, t); return;
    }}
    tl.fromTo(ln, {{ strokeDasharray: L, strokeDashoffset: L }}, {{ strokeDashoffset: 0, duration: 0.7, ease: "power2.inOut" }}, t);
    if (!h) return;
    const o = {{ d: 0 }}; putHead(h, tr, 0);
    tl.fromTo(h.g, {{ opacity: 0 }}, {{ opacity: 1, duration: 0.08, ease: "none" }}, t);
    tl.fromTo(o, {{ d: 0 }}, {{ d: L, duration: 0.7, ease: "power2.inOut", onUpdate: () => putHead(h, tr, o.d) }}, t);
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
  // preview in the box: slow zoom-out on the footage, blinking chip dot, play button pulsing to invite the click
  const pz = document.getElementById("{id}-pvzoom"), dot = document.getElementById("{id}-dot");
  if (pz) {{
    tl.fromTo(pz, {{ scale: 1.14 }}, {{ scale: 1, duration: TC, ease: "sine.out" }}, 0);
    tl.fromTo("#{id}-chip", {{ opacity: 0, x: -30 }}, {{ opacity: 1, x: 0, duration: 0.6, ease: "back.out(2)" }}, 1.2);
    tl.to(dot, {{ opacity: 0.15, duration: 0.45, ease: "sine.inOut", yoyo: true, repeat: Math.max(1, Math.floor((TC - 1.2) / 0.45) | 1) }}, 1.4);
    const pr = mk(box, "left:" + (p.x - b.x - 14) + "px;top:" + (p.y - b.y - 14) + "px;width:" + (p.w + 28) + "px;height:" + (p.h + 28) + "px;border-radius:999px;border:4px solid rgba(255,255,255,0.85);");
    for (let i = 0, t0 = 1.6; t0 + 1.1 < TC - 0.3; i++, t0 += 1.25)
      tl.fromTo(pr, {{ opacity: 0.9, scale: 0.8 }}, {{ opacity: 0, scale: 1.45, duration: 1.1, ease: "power2.out", immediateRender: false }}, t0);
  }}
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

PREVIEW = 'assets/video/EP2-SEM-preview.mp4'                                  # teaser montage (scripts/make_preview.py)
def demo_box(body, t_click):
    """Page 23's clip box: a playful preview of the demo plays inside it (slow zoom, chip, pulsing play
    button) until the cursor clicks play."""
    body = body.replace('<div style="grid-column:span 7;', '<div data-clipbox style="position:relative;overflow:hidden;grid-column:span 7;', 1)
    body = body.replace('<div style="width:128px;height:128px;', '<div style="position:relative;width:128px;height:128px;', 1)
    body = body.replace('<p style="font-size:30px;font-weight:600;color:#FCFCFD">แทรกคลิป', '<p style="position:relative;font-size:30px;font-weight:600;color:#FCFCFD;text-shadow:0px 2px 10px rgba(0,0,0,0.6)">แทรกคลิป', 1)
    if not os.path.exists(PREVIEW): return body
    pv = min(probe(PREVIEW) - 0.05, t_click + 1.6)
    layer = (f'<div id="f{DEMO}-pv" data-layout-allow-overflow data-layout-allow-overlap style="position:absolute;left:0px;top:0px;width:100%;height:100%;border-radius:30px;overflow:hidden">'
             f'<div id="f{DEMO}-pvzoom" style="position:absolute;left:0px;top:0px;width:100%;height:100%">'
             f'<video id="f{DEMO}-preview" class="clip" src="{PREVIEW}" data-start="0" data-duration="{pv:.3f}" data-hf-media-start-basis="local" data-track-index="2" muted playsinline style="position:absolute;left:0px;top:0px;width:100%;height:100%;object-fit:cover"></video></div>'
             f'<div style="position:absolute;left:0px;top:0px;width:100%;height:100%;background:linear-gradient(180deg, rgba(26,31,54,0.10) 0%, rgba(26,31,54,0.35) 50%, rgba(26,31,54,0.88) 100%)"></div>'
             f'<div id="f{DEMO}-chip" style="position:absolute;left:24px;top:22px;display:flex;align-items:center;gap:10px;padding:6px 18px;border-radius:999px;background:rgba(255,255,255,0.9);box-shadow:0px 8px 18px rgba(0,0,0,0.25)">'
             f'<div id="f{DEMO}-dot" style="width:12px;height:12px;border-radius:6px;background:#F0508F"></div>'
             f'<p style="font-family:\'Prompt\', sans-serif;font-size:24px;font-weight:600;color:#1A1F36">ตัวอย่างคลิปสาธิต</p></div></div>')
    i = body.index('<div data-clipbox'); j = body.index('>', i) + 1
    return body[:j] + layer + body[j:]

def demo_layer(fid, t_play):
    """Full-frame clip layer for page 23 (revealed from the clip box by DEMO_JS)."""
    if HAS_CLIP:
        media = f'<video id="{fid}-video" class="clip" src="{CLIP_FILE}" data-start="{t_play:.3f}" data-duration="{CLIP:.3f}" data-hf-media-start-basis="local" data-track-index="1" muted playsinline style="position:absolute;left:0;top:0;width:1920px;height:1080px;object-fit:contain;background:#0d1020"></video>'
    else:
        media = (f'<div style="position:absolute;left:0;top:0;width:1920px;height:1080px;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center">'
                 f'<p style="font-family:\'Prompt\',sans-serif;font-size:56px;font-weight:600;color:#FCFCFD">คลิปสาธิต ADANCO</p>'
                 f'<p style="font-family:\'Anuphan\',sans-serif;font-size:30px;color:#C9B5FF">รอไฟล์ assets/video/EP2-SEM.mp4</p></div>')
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
    if n == DEMO: body = demo_box(body, t_click)
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

starts, durs, voices, sfx = {}, {}, [], []
t = 0.0
for n, slide, a in FRAMES:
    vf = f'assets/audio/voice/{a}.m4a'
    A = probe(vf); timemap(n, a)
    voices.append((a, round(t + LEAD, 3), round(A, 3)))
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
      <!-- scenes (tracks 1-2): pages 17-35 -->
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
json.dump({'starts': starts, 'durs': durs, 'total': total, 'sfx': len(fx), 'clip': HAS_CLIP}, open('scripts/schedule.json', 'w'), indent=1)
print('total', total, 'min', round(total / 60, 2), 'sfx', len(fx), 'clip', 'yes' if HAS_CLIP else 'placeholder')
