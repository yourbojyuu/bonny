/* ระบบการเงินโรงเรียน — receipts.js
   รายรับ: บันทึกใบเสร็จต่อเนื่อง · วางจาก Excel ทีเดียวทั้งก้อน · สรุปรายเดือน/วัน · ยกเลิกใบเสร็จ */

var Receipts = (function () {
  var seg = 'grid', q = '', last = { book: '', no: '', date: '', type: '', method: 'สด' }, pasted = null;

  function rows() { return (S.rcv && S.rcv.rows) || []; }
  function live() { return rows().filter(function (r) { return !r[8]; }); }
  function amountOf(list) { return sumSat(list, function (r) { return Number(r[7]) || 0; }); }
  function methodSum(list, m) { return amountOf(list.filter(function (r) { return r[6] === m; })); }
  function segBtn(id, label) { return '<button type="button" data-rseg="' + id + '" aria-pressed="' + (seg === id) + '">' + esc(label) + '</button>'; }
  function leave() {}

  function render(v, opt) {
    if (opt && opt.seg) seg = opt.seg;
    var lv = live(), today = defaultDate(), mon = today.slice(0, 7);
    var tm = lv.filter(function (r) { return String(r[3]).slice(0, 7) === mon; });
    v.innerHTML =
      '<section class="hero">' + heroDeco('income') +
      '<div class="lbl">รายรับปีงบ ' + esc(S.docs ? S.docs.fy : '') + '</div>' +
      '<div class="big money">' + money(amountOf(lv)) + '</div><div class="sub">รวมใบเสร็จที่บันทึกแล้ว ' + lv.length + ' รายการ</div>' +
      '<div class="flow">' +
      '<div class="tile"><div class="k">เดือนนี้</div><div class="v money">' + money(amountOf(tm)) + '</div><div class="s">' + tm.length + ' รายการ</div></div>' +
      '<div class="tile"><div class="k">เงินสด (ทั้งปี)</div><div class="v money">' + money(methodSum(lv, 'สด')) + '</div><div class="s">เข้าที่เก็บเงินสด</div></div>' +
      '<div class="tile"><div class="k">เงินโอน (ทั้งปี)</div><div class="v money">' + money(methodSum(lv, 'โอน')) + '</div><div class="s">เข้าบัญชีหลักของประเภทเงิน</div></div>' +
      '</div></section>' +
      '<div class="seg glass" role="group" aria-label="มุมมอง">' +
      (can.fin() && mode() === 'fin' ? segBtn('grid', 'กรอกบรรทัดเดียว') + segBtn('enter', 'ฟอร์มทีละใบ') : '') + segBtn('day', 'สรุปรายวัน') + segBtn('sum', 'สรุปรายเดือน') + segBtn('list', 'รายการใบเสร็จ') + '</div>' +
      '<div id="rv"></div>';
    if ((seg === 'enter' || seg === 'grid') && !(can.fin() && mode() === 'fin')) seg = 'day';
    Array.prototype.forEach.call(v.querySelectorAll('[data-rseg]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-rseg') === seg));
      b.onclick = function () { switchSeg(b.getAttribute('data-rseg')); };
    });
    renderSeg();
  }
  function switchSeg(id) {
    if (id === seg) return;
    var run = function () {
      seg = id;
      Array.prototype.forEach.call(document.querySelectorAll('[data-rseg]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-rseg') === seg)); });
      renderSeg();
    };
    if (document.startViewTransition && !REDUCE) { try { document.startViewTransition(run); return; } catch (e) {} }
    run();
  }
  function renderSeg() {
    var dv = $('rv'); if (!dv) return;
    dv.className = ''; void dv.offsetWidth; dv.className = 'view-in';
    if (seg === 'grid') renderGrid(dv); else if (seg === 'enter') renderEnter(dv); else if (seg === 'day') renderDay(dv); else if (seg === 'sum') renderSum(dv); else renderList(dv);
    observeReveal();
  }
  function refresh() { return reloadReceipts().then(function () { if (S.tab === 'income') render($('view'), null); else renderTabs(); }); }


  /* ================= ตารางกรอกบรรทัดเดียว: 1 แถว = 1 ใบเสร็จ (คอลัมน์ตามไฟล์ Excel เดิม) =================
     กรอก บกศ.สด · รด.สด · บกศ.โอน · รด.โอน · อื่น ๆ ระบบแยกเข้าประเภทเงินให้เองจากแพ็กเกจ/ใบเสร็จที่เคยบันทึก
     ถ้าแยกได้ไม่ชัด (ยอดเดียวกันแต่ต่างรายการ) ดับเบิลคลิกช่อง "แยกกองทุน" หรือกด F2 เพื่อแก้เอง */
  var gRows = null, gMonth = '', compKey = '', compMap = null;
  var AMT = ['bsd', 'rsd', 'bto', 'rto', 'oth'], PNAME = { B: 'บกศ.', R: 'รายได้', O: 'อื่น ๆ' }, PCODE = { 'บกศ.': 'B', 'รายได้': 'R', 'อื่น ๆ': 'O' };
  function c100(v) { var n = Grid.num(v); return isNaN(n) ? 0 : Math.round(n * 100); }
  function partTotals(r) { return { B: c100(r.bsd) + c100(r.bto), R: c100(r.rsd) + c100(r.rto), O: c100(r.oth) }; }
  function rowTotal(r) { var p = partTotals(r); return p.B + p.R + p.O; }
  function shortType(t) { return String(typeName(t)).replace(/^บกศ\.\s*/, ''); }
  function defaultRType() { var t = S.st.types.filter(function (x) { return /รายได้\s?อื่น/.test(x[1]) && x[4] !== 'ไม่ใช่'; })[0]; return t ? t[0] : ''; }
  /** รูปแบบการแยกกองทุนของแต่ละส่วน (บกศ./รายได้/อื่น ๆ) ตามยอด · มาจากแพ็กเกจ + ใบเสร็จที่เคยบันทึก เรียงตามที่พบบ่อย */
  function compIndex() {
    var sg = rows().length + '|' + (S.st.packages || []).length;
    if (compMap && compKey === sg) return compMap;
    var map = {};
    function add(p, cents, items, w) {
      var k = p + '|' + cents, list = map[k] || (map[k] = []), sig = items.map(function (x) { return x[0] + '=' + x[1]; }).sort().join(';');
      var e = list.filter(function (x) { return x.sig === sig; })[0]; if (!e) { e = { sig: sig, items: items, n: 0 }; list.push(e); } e.n += w;
    }
    function addReceipt(lines, w) {
      var by = { B: {}, R: {}, O: {} }, tot = { B: 0, R: 0, O: 0 };
      lines.forEach(function (l) { var p = PCODE[grpOf(l[0])]; by[p][l[0]] = (by[p][l[0]] || 0) + l[1]; tot[p] += l[1]; });
      ['B', 'R', 'O'].forEach(function (p) { if (tot[p] > 0) add(p, tot[p], Object.keys(by[p]).map(function (t) { return [t, by[p][t]]; }), w); });
    }
    (S.st.packages || []).forEach(function (p) { addReceipt(p[2].map(function (it) { return [it[0], Math.round(it[1] * 100)]; }), 5); });
    groupReceipts(live()).forEach(function (rc) { addReceipt(rc.lines.filter(function (l) { return !l[8]; }).map(function (l) { return [l[5], Math.round((Number(l[7]) || 0) * 100)]; }), 1); });
    Object.keys(map).forEach(function (k) { map[k].sort(function (a, b) { return b.n - a.n; }); });
    compMap = map; compKey = sg; return map;
  }
  /** แจกสด/โอนลงรายการของส่วนหนึ่ง (สดก่อน เหลือเป็นโอน) -> [{type,method,amount(สตางค์)}] */
  function allocate(items, cash, tr) {
    var out = [];
    items.forEach(function (it) {
      var a = it[1], take = Math.min(a, cash);
      if (take > 0) { out.push({ type: it[0], method: 'สด', amount: take }); cash -= take; a -= take; }
      if (a > 0) { out.push({ type: it[0], method: 'โอน', amount: a }); tr -= a; }
    });
    return out;
  }
  function partCash(r, p) { return p === 'B' ? c100(r.bsd) : p === 'R' ? c100(r.rsd) : 0; }
  function partTr(r, p) { return p === 'B' ? c100(r.bto) : p === 'R' ? c100(r.rto) : c100(r.oth); }
  /** แยกใบเสร็จหนึ่งแถวเป็นบรรทัดตามประเภทเงิน: state = ok | need (ต้องแยกเอง) | none (ไม่มียอด) | void */
  function splitRow(r) {
    if (r.st === 'ยกเลิก') return { state: 'void', items: [] };
    var P = partTotals(r), total = P.B + P.R + P.O;
    if (r.lines && r.lines.length) {
      var s = r.lines.reduce(function (a, l) { return a + c100(l.amount); }, 0);
      return { state: s === total && total > 0 && r.lines.every(function (l) { return l.type; }) ? 'ok' : 'need', items: r.lines.map(function (l) { return { type: l.type, method: l.method, amount: c100(l.amount) }; }), manual: true, alts: 0, need: [] };
    }
    var items = [], need = [], alts = 0;
    ['B', 'R', 'O'].forEach(function (p) {
      if (!P[p]) return;
      var list = compIndex()[p + '|' + P[p]], comp = list && list[(r._alt && r._alt[p]) || 0];
      if (!comp && p === 'R') { var d = defaultRType(); if (d) comp = { items: [[d, P[p]]] }; }
      if (!comp) { need.push(PNAME[p]); return; }
      if (list && list.length > 1) alts += list.length - 1;
      items = items.concat(allocate(comp.items, partCash(r, p), partTr(r, p)));
    });
    return { state: !total ? 'none' : need.length ? 'need' : 'ok', items: items, need: need, alts: alts };
  }
  function itemsText(items) {
    var by = {}, ord = [];
    items.forEach(function (it) { if (!by[it.type]) { by[it.type] = 0; ord.push(it.type); } by[it.type] += it.amount; });
    return ord.map(function (t) { return shortType(t) + ' ' + Grid.fmtN(by[t] / 100).replace(/\.00$/, ''); }).join(' + ');
  }
  function splitText(r) {
    if (r._rc) return itemsText(r._rc.lines.filter(function (l) { return !l[8]; }).map(function (l) { return { type: l[5], amount: Math.round((Number(l[7]) || 0) * 100) }; })) || (r.st ? '' : '');
    var s = splitRow(r);
    if (s.state === 'void') return 'ใบยกเลิก (เลขที่ถูกใช้ไปแล้ว)';
    if (s.state === 'none') return '';
    if (s.state === 'need') return '⚠ ต้องแยกกองทุน' + (s.need && s.need.length ? ' (' + s.need.join(', ') + ')' : '') + ' — ดับเบิลคลิก/F2';
    return itemsText(s.items) + (s.manual ? ' ✎' : s.alts ? ' · มีอีก ' + s.alts + ' แบบ (F2)' : '');
  }
  /** ใบเสร็จที่บันทึกแล้ว -> แถวตาราง */
  function oldGridRows() {
    return groupReceipts(rows().filter(function (r) { return !gMonth || gMonth === '-' ? gMonth !== '-' : String(r[3]).slice(0, 7) === gMonth; })).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.book === b.book ? (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0) : (a.book < b.book ? -1 : 1)); }).map(function (rc) {
      var s = { B: { 'สด': 0, 'โอน': 0 }, R: { 'สด': 0, 'โอน': 0 }, O: { 'สด': 0, 'โอน': 0 } };
      rc.lines.forEach(function (l) { if (l[8]) return; s[PCODE[grpOf(l[5])]][l[6] === 'โอน' ? 'โอน' : 'สด'] += Math.round((Number(l[7]) || 0) * 100); });
      function v(x) { return x ? x / 100 : ''; }
      return { _old: true, _rc: rc, _cx: rc.cancelled, date: rc.date, book: rc.book, no: rc.no, bsd: v(s.B['สด']), rsd: v(s.R['สด']), bto: v(s.B['โอน']), rto: v(s.R['โอน']), oth: v(s.O['สด'] + s.O['โอน']), st: rc.cancelled ? 'ยกเลิก' : '' };
    });
  }
  function gBlank(prev) {
    var lt = prev ? null : latestReceipt();
    return { date: prev ? prev.date : defaultDate(), book: prev ? prev.book : (lt ? lt[0] : last.book || ''), no: prev ? (prev.no ? nextNo(prev.no) : '') : (lt ? nextNo(lt[1]) : last.no || ''), bsd: '', rsd: '', bto: '', rto: '', oth: '', st: '' };
  }
  var MONTH_NAMES = /^(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)$/;
  var HEAD_KEY = { 'วันที่': 'date', 'เดือน': 'mon', 'เล่มที่': 'book', 'เลขที่': 'no', 'บกศสด': 'bsd', 'รดสด': 'rsd', 'บกศโอน': 'bto', 'รดโอน': 'rto', 'อื่นๆ': 'oth', 'รวม': 'tot', 'สถานะ': 'st', 'ส่วนต่าง': 'diff', 'บกศ': 'bsum', 'รายได้': 'rsum' };
  var POS_KEYS = ['date', 'mon', 'book', 'no', 'bsd', 'rsd', 'bto', 'rto', 'oth', 'tot', 'st', 'diff', 'bsum', 'rsum'];
  /** วางตารางจากไฟล์ Excel เดิม (มีหัวตาราง หรือเรียงคอลัมน์ตามไฟล์) -> { rows, skipped, unmapped } หรือ null */
  function parseReceiptSheet(text) {
    var tsv = Paste.parseTSV(text); if (!tsv.length) return null;
    var map = [], hasHead = false, fund = [];
    var h0 = tsv[0].map(Paste.nk);
    if (h0.indexOf('เล่มที่') >= 0 && h0.indexOf('เลขที่') >= 0 && h0.indexOf('บกศสด') >= 0) {
      hasHead = true;
      tsv[0].forEach(function (label, i) {
        var k = HEAD_KEY[Paste.nk(label)];
        if (k) map[i] = k; else if (Paste.nk(label)) { var t = Paste.guessType(String(label).trim(), { types: S.st.types, aliases: S.st.aliases || [] }); fund.push({ i: i, label: String(label).replace(/\s+/g, ' ').trim(), type: t }); }
      });
    } else if (tsv[0].length >= 12 && MONTH_NAMES.test(String(tsv[0][1] || '').trim())) { POS_KEYS.forEach(function (k, i) { map[i] = k; }); }
    else return null;
    var out = [], skipped = 0, unmapped = {}, mism = 0;
    tsv.slice(hasHead ? 1 : 0).forEach(function (c) {
      var o = {}; map.forEach(function (k, i) { if (k) o[k] = c[i] === undefined ? '' : String(c[i]).trim(); });
      var date = Grid.parseDate(o.date), book = o.book || '', no = o.no || '';
      if (!date || !book || !no || /ยอดยกมา/.test(book)) { skipped++; return; }
      var r = { date: date, book: book, no: no, st: /ยกเลิก/.test(o.st || '') ? 'ยกเลิก' : '' };
      AMT.forEach(function (k) { var n = Grid.num(o[k]); r[k] = n > 0 ? n : ''; });
      var lines = [], usable = true;
      fund.forEach(function (f) {
        var n = Grid.num(String(c[f.i] === undefined ? '' : c[f.i]).trim()); if (!(n > 0)) return;
        if (!f.type) { unmapped[f.label] = 1; usable = false; return; }
        lines.push([f.type, Math.round(n * 100)]);
      });
      if (lines.length && usable && r.st !== 'ยกเลิก') {
        var byP = { B: [], R: [], O: [] }; lines.forEach(function (l) { byP[PCODE[grpOf(l[0])]].push(l); });
        var P = partTotals(r), okAll = true, res = [];
        ['B', 'R', 'O'].forEach(function (p) {
          var s = byP[p].reduce(function (a, l) { return a + l[1]; }, 0);
          if (s !== P[p]) okAll = false; else if (s) res = res.concat(allocate(byP[p], partCash(r, p), partTr(r, p)));
        });
        if (okAll && res.length) r.lines = res.map(function (x) { return { type: x.type, method: x.method, amount: x.amount / 100 }; }); else mism++;
      }
      out.push(r);
    });
    return { rows: out, skipped: skipped, unmapped: Object.keys(unmapped), mism: mism };
  }

  function renderGrid(dv) {
    if (!can.fin()) { dv.innerHTML = '<div class="empty"><b>บันทึกรายรับได้เฉพาะเจ้าหน้าที่การเงิน</b></div>'; return; }
    if (!gMonth) gMonth = (S.date || defaultDate()).slice(0, 7);
    var mons = []; for (var i = 0; i < 12; i++) { var d0 = new Date(S.st.fyStart + 'T00:00:00'), x = new Date(d0.getFullYear(), d0.getMonth() + i, 1); mons.push([x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2), MONTHS_L[x.getMonth()] + ' ' + (x.getFullYear() + 543)]); }
    var cols = [
      { k: 'chk', label: '', w: 40, type: 'chk' },
      { k: 'date', label: 'วันที่', w: 112, type: 'date', ph: 'วว/ดด/ปป' },
      { k: 'book', label: 'เล่มที่', w: 84 }, { k: 'no', label: 'เลขที่', w: 84 },
      { k: 'bsd', label: 'บกศ.สด', w: 104, type: 'money' }, { k: 'rsd', label: 'รด.สด', w: 104, type: 'money' },
      { k: 'bto', label: 'บกศ.โอน', w: 108, type: 'money' }, { k: 'rto', label: 'รด.โอน', w: 104, type: 'money' }, { k: 'oth', label: 'อื่น ๆ', w: 112, type: 'money' },
      { k: 'tot', label: 'รวม', w: 112, type: 'money', calc: function (r) { return rowTotal(r) / 100; } },
      { k: 'split', label: 'แยกกองทุน (ดับเบิลคลิก / F2 เพื่อแก้เอง)', w: 330, calc: splitText },
      { k: 'st', label: 'สถานะ', w: 92, list: function () { return ['', 'ยกเลิก']; } }
    ];
    var pre = gMonth === '-' ? [] : oldGridRows();
    dv.innerHTML = '<section class="card glass xcard"><div class="xbar"><div><h2 style="margin:0">กรอกใบเสร็จบรรทัดเดียว</h2><p class="xhint">1 แถว = 1 ใบเสร็จ · พิมพ์ยอดช่อง บกศ./รด. สด-โอน แล้วระบบแยกกองทุนให้ · วางตารางจาก Excel เดิมได้ · แถวที่ครบบันทึกให้เองเมื่อออกจากแถว</p></div>' +
      '<div class="xtools"><label class="f inl">แสดงข้อมูลเดิม<select id="rxMon"><option value="">ทั้งหมด</option>' + mons.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === gMonth ? ' selected' : '') + '>' + esc(m[1]) + '</option>'; }).join('') + '<option value="-"' + (gMonth === '-' ? ' selected' : '') + '>ซ่อน</option></select></label>' +
      '<details class="xmore"><summary class="btn ghost sm">เพิ่มเติม ▾</summary><div class="xmenu"><button class="btn sm" type="button" id="rxSplit">แยกกองทุนแถวที่เลือก (F2)</button><button class="btn sm" type="button" id="rxPk">แพ็กเกจรับเงิน</button><hr><button class="btn sm" type="button" id="rxXls">ดูตัวอย่าง / ส่งออก Excel</button><button class="btn sm" type="button" id="rxClear">ล้างแถวใหม่</button></div></details>' +
      '<button class="btn soft" type="button" id="rxCx" disabled>ยกเลิกใบที่เลือก</button><button class="btn" type="button" id="rxSave">บันทึกตอนนี้</button></div></div>' +
      '<div id="rxHost"></div><div class="xstat" id="rxStat" aria-live="polite"></div></section>';
    var mm = dv.querySelector('.xmore'); if (mm) document.addEventListener('pointerdown', function cl(e) { if (!mm.isConnected) { document.removeEventListener('pointerdown', cl); return; } if (!mm.contains(e.target)) mm.open = false; });
    var cfgLeave = function () {}, g;
    g = Grid.create($('rxHost'), {
      cols: cols, rows: pre.concat(gRows || []), blank: gBlank, liveCalc: true,
      isEmpty: function (r) { return !r.bsd && !r.rsd && !r.bto && !r.rto && !r.oth && r.st !== 'ยกเลิก'; },
      chkOk: function (r) { return r._old && !r._cx; },
      rowCls: function (r) { return (r._cx ? 'cxd ' : '') + (r._fresh ? 'fresh' : ''); },
      onChk: function () { cxBtn(); },
      onRow: function (r, k) { if (AMT.indexOf(k) >= 0) { delete r.lines; r._alt = null; } r._badSig = ''; stat(); },
      onLeaveRow: function () { cfgLeave(); },
      onPaste: function (text, api) {
        var res = parseReceiptSheet(text); if (!res) return false;
        if (!res.rows.length) { toast('ไม่พบแถวใบเสร็จในข้อมูลที่วาง (ข้ามแถวยอดยกมา/ไม่มีวันที่)', 'err'); return true; }
        api.append(res.rows); stat();
        toast('วางแล้ว ' + res.rows.length + ' ใบ' + (res.skipped ? ' (ข้าม ' + res.skipped + ' แถว)' : '') + (res.unmapped.length ? ' · จับคู่ประเภทเงินไม่ได้: ' + res.unmapped.join(', ') + ' (เพิ่มชื่อย่อในตั้งค่า)' : '') + ' — กำลังตรวจและบันทึกที่ครบ', res.unmapped.length ? 'err' : 'good');
        cfgLeave(); return true;
      },
      totals: function (rs) {
        var s = { bsd: 0, rsd: 0, bto: 0, rto: 0, oth: 0 }, n = 0; rs.forEach(function (r) { if (r._old) return; if (rowTotal(r)) n++; AMT.forEach(function (k) { s[k] += c100(r[k]); }); });
        var tt = s.bsd + s.rsd + s.bto + s.rto + s.oth;
        return '<td colspan="3" class="tl">รวมแถวใหม่ ' + n + ' ใบ</td>' + AMT.map(function (k) { return '<td class="mn">' + Grid.fmtN(s[k] / 100) + '</td>'; }).join('') + '<td class="mn">' + Grid.fmtN(tt / 100) + '</td><td colspan="2"></td>';
      }
    });
    var msg = '';
    function stat() {
      var all = g.rows().filter(function (r) { return !r._old; }), w = all.filter(function (r) { return rowTotal(r) || r.st === 'ยกเลิก'; });
      var need = w.filter(function (r) { return r.st !== 'ยกเลิก' && splitRow(r).state === 'need'; }).length;
      $('rxStat').textContent = msg && !w.length ? msg : w.length ? (msg && /^กำลัง/.test(msg) ? msg : 'รอบันทึก ' + w.length + ' ใบ' + (need ? ' · ต้องแยกกองทุน ' + need + ' ใบ (ดับเบิลคลิกช่องแยกกองทุน)' : '') + ' — แถวที่ครบบันทึกให้เองเมื่อออกจากแถว') : '';
      gRows = all;
    }
    function cxBtn() { var n = g.selected().length, b = $('rxCx'); b.disabled = !n; b.textContent = n ? 'ยกเลิกใบที่เลือก (' + n + ')' : 'ยกเลิกใบที่เลือก'; }
    stat(); cxBtn();
    $('rxMon').onchange = function () { gMonth = this.value; stat(); renderGrid(dv); };
    $('rxPk').onclick = function () { openPackages(); };
    $('rxClear').onclick = function () { gRows = null; g.replace(g.rows().filter(function (x) { return x._old; })); stat(); toast('ล้างแถวใหม่แล้ว'); };
    $('rxXls').onclick = function () {
      var all = g.rows().filter(function (r) { return r._old || rowTotal(r) || r.st === 'ยกเลิก'; }).map(function (r) {
        return [r.date ? thaiDate(r.date) : '', r.book, r.no, c100(r.bsd) / 100, c100(r.rsd) / 100, c100(r.bto) / 100, c100(r.rto) / 100, c100(r.oth) / 100, rowTotal(r) / 100, r.st || ''];
      });
      var cc = [{ label: 'วันที่', w: 14, type: 'center' }, { label: 'เล่มที่', w: 10, type: 'center' }, { label: 'เลขที่', w: 10, type: 'center' }, { label: 'บกศ.สด', w: 14, type: 'money', sum: true }, { label: 'รด.สด', w: 14, type: 'money', sum: true }, { label: 'บกศ.โอน', w: 14, type: 'money', sum: true }, { label: 'รด.โอน', w: 14, type: 'money', sum: true }, { label: 'อื่น ๆ', w: 14, type: 'money', sum: true }, { label: 'รวม', w: 16, type: 'money', sum: true }, { label: 'สถานะ', w: 10, type: 'center' }];
      previewSheet('ทะเบียนใบเสร็จ ปีงบ ' + S.st.fy, cc, all, 'ส่งออกจากระบบการเงินโรงเรียน · ' + thaiDateLong(defaultDate()), 'ใบเสร็จ-' + S.st.fy + '.xlsx');
    };
    /* ---- บันทึกอัตโนมัติ (เข้าคิวทีละงาน ไม่ชนกัน) ---- */
    var q = Promise.resolve();
    function ready(r) {
      if (r._old || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || !r.book || !r.no) return '';
      if (r.st === 'ยกเลิก') return rowTotal(r) === 0 ? 'void' : '';
      return rowTotal(r) > 0 && splitRow(r).state === 'ok' ? 'ok' : '';
    }
    function sigOf(r) { return JSON.stringify([r.date, r.book, r.no, r.bsd, r.rsd, r.bto, r.rto, r.oth, r.st, r.lines || null]); }
    function flush(manual) { q = q.then(function () { return doFlush(manual); }).catch(function (e) { msg = ''; stat(); handleError(e); }); return q; }
    function chunk(arr, n) { var o = []; for (var i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }
    function doFlush(manual) {
      var all = g.rows(), okR = [], voidR = [], incomplete = 0;
      all.forEach(function (r, ri) {
        if (r._old || (rowTotal(r) === 0 && r.st !== 'ยกเลิก')) return;
        var rd = ready(r);
        if (!rd) {
          if (manual) { incomplete++; if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) g.mark(ri, 'date'); if (!r.book) g.mark(ri, 'book'); if (!r.no) g.mark(ri, 'no'); }
          return;
        }
        if (!manual && r._badSig === sigOf(r)) return;
        (rd === 'void' ? voidR : okR).push(r);
      });
      if (!okR.length && !voidR.length) { if (manual) toast(incomplete ? 'มี ' + incomplete + ' ใบที่ยังไม่ครบ (วันที่/เล่ม/เลขที่ หรือยังไม่ได้แยกกองทุน)' : 'ไม่มีแถวใหม่ที่ต้องบันทึก — แถวที่ครบจะบันทึกให้เองเมื่อออกจากแถว', incomplete ? 'err' : ''); return null; }
      var saved = 0, p = Promise.resolve(), bad = [];
      msg = 'กำลังบันทึกอัตโนมัติ ' + (okR.length + voidR.length) + ' ใบ…'; stat();
      chunk(okR, 120).forEach(function (grp) {
        p = p.then(function () {
          var items = [], owner = [];
          grp.forEach(function (r) { splitRow(r).items.forEach(function (it) { items.push({ date: r.date, book: r.book, no: r.no, type: it.type, method: it.method, amount: String(it.amount / 100), payer: '' }); owner.push(r); }); });
          // ตรวจและบันทึกในคำขอเดียว: เซิร์ฟเวอร์บันทึกเฉพาะใบที่ถูกทุกบรรทัด (wholeReceipt) แล้วบอกผลรายบรรทัดกลับมา
          return api('importReceipts', { items: items, commit: true, wholeReceipt: true }).then(function (pv) {
            var badR = {}; pv.rows.forEach(function (x, n) { if (x.status !== 'new') { badR[all.indexOf(owner[n])] = (x.status === 'same' ? 'เล่ม/เลขที่นี้มีอยู่แล้ว (ข้อมูลเหมือนเดิม)' : x.status === 'changed' ? 'เล่ม/เลขที่นี้มีอยู่แล้วแต่ข้อมูลต่างกัน' : x.msg); } });
            var good = grp.filter(function (r) { return badR[all.indexOf(r)] === undefined; });
            Object.keys(badR).forEach(function (ri) { var r = all[ri]; r._badSig = sigOf(r); g.markRow(Number(ri)); bad.push('เล่ม ' + r.book + ' เลขที่ ' + r.no + ': ' + badR[ri]); });
            if (!good.length) return null;
            good.forEach(function (r) { g.lock(r); }); saved += good.length; last = { book: good[good.length - 1].book, no: nextNo(good[good.length - 1].no), date: good[good.length - 1].date, type: '', method: 'สด' };
          });
        });
      });
      chunk(voidR, 300).forEach(function (grp) {
        p = p.then(function () {
          return api('voidReceipts', { items: grp.map(function (r) { return { date: r.date, book: r.book, no: r.no, reason: 'ยกเลิกตอนออกใบ' }; }) }).then(function () { grp.forEach(function (r) { g.lock(r); }); saved += grp.length; })
            .catch(function (e) { grp.forEach(function (r) { r._badSig = sigOf(r); g.markRow(all.indexOf(r)); }); bad.push(e.message); });
        });
      });
      return p.then(function () {
        msg = saved ? '✓ บันทึกอัตโนมัติแล้ว ' + saved + ' ใบ' : ''; stat();
        if (bad.length) toast(bad[0] + (bad.length > 1 ? ' (และอีก ' + (bad.length - 1) + ' ใบ)' : ''), 'err');
        return saved ? reloadReceipts().then(function () { compMap = null; }) : null;
      });
    }
    var leaveT = 0;
    cfgLeave = function () { clearTimeout(leaveT); leaveT = setTimeout(function () { flush(false); }, 1200); }; // รอสักครู่ให้หลายแถวไปในคำขอเดียว
    $('rxSave').onclick = function () { var b = this; busy(b, flush(true)); };
    /* ---- ยกเลิกใบที่เลือก ---- */
    $('rxCx').onclick = function () {
      var sel = g.selected(); if (!sel.length) return;
      askReason('ยกเลิกใบเสร็จ ' + sel.length + ' ใบ (ทุกบรรทัดของแต่ละใบ)', 'ยืนยันยกเลิก', function (reason, am, btn) {
        var p = api('cancelReceipt', { items: sel.map(function (r) { return { book: r.book, no: r.no }; }), reason: reason }); // หลายใบในคำขอเดียว
        busy(btn, p).then(function () { am.close(); toast('ยกเลิก ' + sel.length + ' ใบแล้ว', 'good'); return refresh(); }).catch(function (e) { handleError(e); refresh(); });
      });
    };
    /* ---- แยกกองทุนเอง (ดับเบิลคลิกช่องแยกกองทุน / F2) ---- */
    function splitOf(el) { var tr = el && el.closest ? el.closest('tr[data-r]') : null; return tr ? g.rows()[Number(tr.getAttribute('data-r'))] : null; }
    var host = $('rxHost');
    host.addEventListener('dblclick', function (e) { var r = splitOf(e.target); if (r && !r._old && e.target.getAttribute && e.target.getAttribute('data-k') === 'split') openSplit(r); });
    host.addEventListener('keydown', function (e) { if (e.key === 'F2') { var r = splitOf(e.target); if (r && !r._old) { e.preventDefault(); openSplit(r); } else if (r) toast('ใบที่บันทึกแล้วแก้ที่นี่ไม่ได้ — ยกเลิกใบแล้วออกใบใหม่', 'err'); } });
    $('rxSplit').onclick = function () { var r = splitOf(document.activeElement) || splitOf(host.querySelector('tr.cur input')); if (r && !r._old) openSplit(r); else toast('คลิกที่แถวใหม่ก่อน แล้วกดปุ่มนี้', 'err'); };
    function openSplit(r) {
      var P = partTotals(r), total = P.B + P.R + P.O, init = splitRow(r).items.map(function (x) { return { type: x.type, method: x.method, amount: x.amount / 100 }; });
      if (!init.length) init = [{ type: '', method: r.rsd || r.bsd ? 'สด' : 'โอน', amount: '' }];
      function typeSel(sel) {
        return '<option value="">— ประเภทเงิน —</option>' + ['บกศ.', 'รายได้', 'อื่น ๆ'].map(function (gname) {
          return '<optgroup label="' + gname + '">' + S.st.types.filter(function (t) { return t[4] !== 'ไม่ใช่' && grpOf(t[0]) === gname; }).map(function (t) { return '<option value="' + esc(t[0]) + '"' + (t[0] === sel ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('') + '</optgroup>';
        }).join('');
      }
      function lineH(l) { return '<div class="qs-line" data-ql><label class="f"><select data-f="type" aria-label="ประเภทเงิน">' + typeSel(l.type) + '</select></label><label class="f"><select data-f="method" aria-label="สด/โอน">' + plainOpts(['สด', 'โอน'], l.method) + '</select></label><label class="f"><input class="money" data-f="amount" inputmode="decimal" aria-label="จำนวนเงิน" value="' + esc(l.amount === '' ? '' : l.amount) + '" placeholder="0.00"></label><button class="del" type="button" data-del aria-label="ลบ">×</button></div>'; }
      var alt = '';
      ['B', 'R', 'O'].forEach(function (p) {
        var list = P[p] ? compIndex()[p + '|' + P[p]] : null;
        if (list && list.length) alt += '<div class="qs-alt"><span>' + PNAME[p] + ' ' + money(P[p] / 100) + '</span>' + list.slice(0, 6).map(function (c, i) { return '<button type="button" class="qchip" data-ap="' + p + '" data-ai="' + i + '">' + esc(c.items.map(function (it) { return shortType(it[0]) + ' ' + money(it[1] / 100); }).join(' + ')) + '</button>'; }).join('') + '</div>';
      });
      var m = openModal({
        title: 'แยกกองทุน · เล่ม ' + esc(r.book || '-') + ' เลขที่ ' + esc(r.no || '-'), width: 760,
        body: '<p class="hint">' + (total ? 'ยอดที่กรอกในตาราง: บกศ. ' + money(P.B / 100) + ' · รายได้ ' + money(P.R / 100) + ' · อื่น ๆ ' + money(P.O / 100) + ' = <b>' + money(total / 100) + '</b> บาท' : 'ยังไม่ได้กรอกยอดในตาราง — แยกเองที่นี่ ระบบจะใส่ยอดลงช่องให้') + '</p>' +
          (alt ? '<div class="qs-alts"><b>แบบที่เคยใช้กับยอดนี้ (กดเพื่อใช้)</b>' + alt + '</div>' : '') +
          '<div id="qsLines">' + init.map(lineH).join('') + '</div><div class="qs-diff" id="qsDiff" aria-live="polite"></div><button class="btn soft sm" type="button" id="qsAdd">+ เพิ่มบรรทัด</button>',
        footer: '<button class="btn ghost" type="button" data-close>ยกเลิก</button><button class="btn" type="button" id="qsOk">ใช้การแยกนี้</button>'
      });
      var el = m.el, box = el.querySelector('#qsLines');
      function read() { return Array.prototype.map.call(box.querySelectorAll('[data-ql]'), function (row) { var o = {}; Array.prototype.forEach.call(row.querySelectorAll('[data-f]'), function (f) { o[f.getAttribute('data-f')] = f.value; }); return o; }); }
      function diff() {
        var ls = read(), s = ls.reduce(function (a, l) { return a + c100(l.amount); }, 0), d = el.querySelector('#qsDiff');
        d.innerHTML = total ? (s === total ? '<span class="ok">✓ ตรงกับยอดในตาราง ' + money(total / 100) + '</span>' : '<span class="bad">รวมรายการ ' + money(s / 100) + ' ไม่เท่ายอดในตาราง ' + money(total / 100) + ' (ต่าง ' + money(Math.abs(total - s) / 100) + ')</span>') : '<span>รวมรายการ <b>' + money(s / 100) + '</b> บาท</span>';
      }
      box.addEventListener('input', diff); box.addEventListener('change', diff);
      box.addEventListener('click', function (e) { var b = e.target.closest('[data-del]'); if (!b) return; if (box.querySelectorAll('[data-ql]').length > 1) { b.closest('[data-ql]').remove(); diff(); } });
      el.querySelector('#qsAdd').onclick = function () { var t = document.createElement('div'); t.innerHTML = lineH({ type: '', method: 'โอน', amount: '' }); box.appendChild(t.firstChild); box.lastChild.querySelector('select').focus(); };
      el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-ap]'); if (!b) return; var p = b.getAttribute('data-ap'), c = compIndex()[p + '|' + P[p]][Number(b.getAttribute('data-ai'))];
        var keep = read().filter(function (l) { return l.type && PCODE[grpOf(l.type)] !== p; }), mine = allocate(c.items, partCash(r, p), partTr(r, p)).map(function (x) { return { type: x.type, method: x.method, amount: x.amount / 100 }; });
        box.innerHTML = keep.concat(mine).map(lineH).join(''); diff();
      });
      diff();
      el.querySelector('#qsOk').onclick = function () {
        var ls = read().filter(function (l) { return l.type || c100(l.amount); });
        if (ls.some(function (l) { return !l.type || !(c100(l.amount) > 0); })) { toast('ทุกบรรทัดต้องเลือกประเภทเงินและใส่จำนวนเงิน', 'err'); return; }
        var s = ls.reduce(function (a, l) { return a + c100(l.amount); }, 0);
        if (total && s !== total) { toast('รวมรายการ ' + money(s / 100) + ' ไม่เท่ายอดในตาราง ' + money(total / 100), 'err'); return; }
        var sums = { bsd: 0, rsd: 0, bto: 0, rto: 0, oth: 0 };
        ls.forEach(function (l) { var p = PCODE[grpOf(l.type)], a = c100(l.amount); if (p === 'O') sums.oth += a; else sums[(p === 'B' ? 'b' : 'r') + (l.method === 'โอน' ? 'to' : 'sd')] += a; });
        var ri = g.rows().indexOf(r);
        AMT.forEach(function (k) { g.set(ri, k, sums[k] ? sums[k] / 100 : ''); });
        r.lines = ls.map(function (l) { return { type: l.type, method: l.method, amount: c100(l.amount) / 100 }; }); r._badSig = '';
        g.set(ri, 'st', r.st || ''); m.close(); stat(); cfgLeave();
      };
    }
  }

  /* ================= บันทึกใบเสร็จ (กรอกเอง + แพ็กเกจ) ================= */
  var GRPS = ['บกศ.', 'รายได้', 'อื่น ๆ'];
  /** ส่วนของเงินตามไฟล์ Excel เดิม: บกศ. · รายได้ (รายได้ SMS/ศูนย์กีฬา/อื่น ๆ) · อื่น ๆ (E-donation บริจาค อุดหนุน ฯลฯ) */
  function grpOf(tid) { var t = tid ? typeById(tid) : null; if (!t) return 'อื่น ๆ'; if (/บกศ/.test(t[2])) return 'บกศ.'; if (/^รายได้/.test(t[1])) return 'รายได้'; return 'อื่น ๆ'; }
  function typeOpts(g, sel) {
    return '<option value="">— ประเภทเงิน —</option>' + S.st.types.filter(function (t) { return t[4] !== 'ไม่ใช่' && grpOf(t[0]) === g; }).map(function (t) {
      return '<option value="' + esc(t[0]) + '"' + (t[0] === sel ? ' selected' : '') + '>' + esc(t[1]) + '</option>';
    }).join('');
  }
  function lineHtml(l, i) {
    var g = l.type ? grpOf(l.type) : (l.grp || 'บกศ.');
    return '<div class="line rline qr-line' + (l.drop ? ' drop' : '') + '" data-rl style="--i:' + Math.min(i, 8) + '"><span class="i">' + (i + 1) + '</span>' +
      '<div class="qr-g" role="group" aria-label="กลุ่มเงิน">' + GRPS.map(function (x) { return '<button type="button" class="qchip" data-g="' + x + '" aria-pressed="' + (x === g) + '">' + x + '</button>'; }).join('') + '</div>' +
      '<label class="f" data-c="type"><select data-f="type" aria-label="ประเภทเงิน"' + (l.bad ? ' class="bad"' : '') + '>' + typeOpts(g, l.type) + '</select></label>' +
      '<label class="f" data-c="method"><select data-f="method" aria-label="วิธีรับ">' + plainOpts(['สด', 'โอน'], l.method) + '</select></label>' +
      '<label class="f" data-c="gross"><input class="money" data-f="amount" aria-label="จำนวนเงิน" inputmode="decimal" value="' + esc(l.amount || '') + '" placeholder="0.00"></label>' +
      '<button class="del" type="button" data-del aria-label="ลบบรรทัด" data-c="del">×</button></div>';
  }
  function nextNo(no) { var m = /^(.*?)(\d+)$/.exec(String(no || '')); return m ? m[1] + String(Number(m[2]) + 1) : ''; }
  /** ใบเสร็จล่าสุดที่บันทึกในระบบ (วันที่มากสุด แล้วเลขที่มากสุด) */
  function latestReceipt() {
    var best = null;
    live().forEach(function (r) {
      if (!best || r[3] > best[3] || (r[3] === best[3] && (parseInt(r[1], 10) || 0) > (parseInt(best[1], 10) || 0))) best = r;
    });
    return best;
  }
  /** แถวใบเสร็จ (ต่อบรรทัด) -> ใบเสร็จ (ต่อใบ) เรียงเลขที่ */
  function groupReceipts(list) {
    var by = {}, order = [];
    list.forEach(function (r) {
      var k = r[0] + '|' + r[1];
      if (!by[k]) { by[k] = { book: r[0], no: r[1], date: r[3], payer: r[4], lines: [], total: 0, cancelled: !!r[8], note: r[9] }; order.push(k); }
      by[k].lines.push(r); if (!r[8]) by[k].total += Math.round((Number(r[7]) || 0) * 100);
    });
    return order.map(function (k) { by[k].total /= 100; return by[k]; }).sort(function (a, b) { return a.book === b.book ? (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0) : (a.book < b.book ? -1 : 1); });
  }
  function cancelFlow(rc) {
    askReason('ยกเลิกใบเสร็จ เล่ม ' + rc.book + ' เลขที่ ' + rc.no + ' (ทุกบรรทัดของใบนี้)', 'ยืนยันยกเลิก', function (reason, am, btn) {
      busy(btn, api('cancelReceipt', { book: rc.book, no: rc.no, reason: reason })).then(function () {
        am.close(); toast('ยกเลิกใบเสร็จแล้ว', 'good'); return refresh();
      }).catch(handleError);
    });
  }
  function rcSummary(rc) { return rc.lines.filter(function (l) { return !l[8]; }).map(function (l) { return typeName(l[5]) + ' ' + money(l[7]) + (l[6] === 'โอน' ? ' (โอน)' : ''); }).join(' · '); }
  function rcRowHtml(rc, ix, canCx) {
    return '<div class="qr-rc' + (rc.cancelled ? ' cx' : '') + '"><b class="no">' + esc(rc.book) + '/' + esc(rc.no) + '</b><span class="sm">' + (rc.payer ? esc(rc.payer) + ' · ' : '') + esc(rcSummary(rc) || (rc.note || 'ยกเลิก')) + '</span>' +
      '<span class="am money">' + (rc.cancelled ? '<span class="badge cancel">ยกเลิก</span>' : money(rc.total)) + '</span>' +
      (canCx && !rc.cancelled ? '<button class="btn ghost sm" type="button" data-cxr="' + ix + '">ยกเลิก</button>' : '<span></span>') + '</div>';
  }
  function pkLabel(p) {
    return (p[1] ? p[1] + ': ' : '') + p[2].map(function (it) { var t = typeById(it[0]); return (t ? t[1] : it[0]) + ' ' + money(it[1]); }).join(' + ');
  }

  function renderEnter(dv) {
    if (!can.fin()) { dv.innerHTML = '<div class="empty"><b>บันทึกรายรับได้เฉพาะเจ้าหน้าที่การเงิน</b>ดูสรุปได้ที่แท็บ "สรุปรายวัน"</div>'; return; }
    if (!last.no) { var lr = latestReceipt(); if (lr) last = { book: lr[0], no: nextNo(lr[1]), date: '', type: '', method: 'สด' }; }
    var dr = Draft.get('rcv'), d = dr && dr.data ? dr.data : null;
    if (d && !(d.lines || []).some(function (l) { return l.amount; })) d = null;
    var data = d || { book: last.book, no: last.no, date: last.date || defaultDate(), payer: '', total: '', method: last.method || 'สด', lines: [{ type: '', method: last.method || 'สด', amount: '' }] };
    var rm = data.method || 'สด', lt = latestReceipt(), pkN = (S.st.packages || []).length;
    dv.innerHTML =
      '<div class="card glass reveal qr-card"><div class="qr-head"><h2>บันทึกใบเสร็จ</h2>' +
      '<span class="qr-last">' + (lt ? 'ใบล่าสุดในระบบ: เล่ม ' + esc(lt[0]) + ' เลขที่ ' + esc(lt[1]) + ' (' + esc(thaiDate(lt[3])) + ')' : 'ยังไม่มีใบเสร็จในระบบ') + '</span></div>' +
      (d ? '<div class="draftbar" id="rDraft"><span>กู้ฉบับร่างที่ค้างไว้เมื่อ ' + esc(clockText(dr.at)) + ' กลับมาแล้ว</span><button class="link" type="button" id="rDraftDel">ทิ้งฉบับร่าง</button></div>' : '') +
      '<div class="form-head r3"><label class="f">เล่มที่<input id="rBook" value="' + esc(data.book) + '" placeholder="เช่น 1"></label>' +
      '<label class="f">เลขที่<input id="rNo" value="' + esc(data.no) + '" placeholder="เช่น 101"></label>' +
      '<label class="f">วันที่รับเงิน<input type="date" id="rDate" value="' + esc(data.date) + '" min="' + S.st.fyStart + '" max="' + S.st.fyEnd + '"></label></div>' +
      '<div class="qr-total"><label class="f qr-tot">ยอดรวมใบเสร็จ (ไม่บังคับ — ใส่แล้วระบบหาแพ็กเกจให้)<input id="rTotal" class="money" inputmode="decimal" autocomplete="off" placeholder="เช่น 1,325" value="' + esc(data.total || '') + '"></label>' +
      '<div class="qr-cg"><span>วิธีรับ</span><div id="rMeth">' + ['สด', 'โอน'].map(function (m) { return '<button type="button" class="qchip" data-m="' + m + '" aria-pressed="' + (m === rm) + '">' + m + '</button>'; }).join('') + '</div></div></div>' +
      '<div class="qr-pk" id="rPk" aria-live="polite"></div>' +
      '<details class="more rpayer"' + (data.payer ? ' open' : '') + '><summary>ผู้ชำระ (ไม่บังคับ)</summary><label class="f"><input id="rPayer" value="' + esc(data.payer || '') + '" placeholder="ชื่อผู้ชำระเงิน"></label></details>' +
      '<div id="rLines">' + data.lines.map(lineHtml).join('') + '</div>' +
      '<div class="qr-diff" id="rDiff" aria-live="polite"></div>' +
      '<div class="toolbar"><button class="btn soft" type="button" id="rAdd">' + ICON.plus + ' เพิ่มบรรทัด</button><button class="link" type="button" id="rPkMgr">แพ็กเกจรับเงิน (' + pkN + ')</button><span class="grow"></span>' +
      '<span class="hint" style="margin:0">Ctrl+Enter เพื่อบันทึก</span><button class="btn" type="button" id="rSave">บันทึกใบเสร็จ</button></div></div>' +
      '<div class="card glass reveal qr-card" id="rToday"></div>' +
      '<details class="card glass reveal pastecard"' + (pasted ? ' open' : '') + '><summary><h2>วางจาก Excel ทีเดียวทั้งก้อน</h2></summary>' +
      '<p class="hint">คัดลอกแถวจากไฟล์ใบเสร็จเดิม (หัวตาราง: ' + esc(Paste.RECEIPT_HEADER.join(' | ')) + ') แล้ววางด้านล่าง ระบบจะตรวจให้ก่อนบันทึกเสมอ — ใบที่มีอยู่แล้วจะไม่ถูกบันทึกซ้ำ</p>' +
      '<textarea id="rPaste" rows="4" placeholder="วางข้อมูลจาก Excel ที่นี่ (Ctrl+V)"></textarea>' +
      '<div class="actions"><button class="btn soft" type="button" id="rCheck">ตรวจข้อมูลที่วาง</button><button class="link" type="button" id="rCopyHead">คัดลอกหัวตาราง</button></div>' +
      '<div id="rPrev"></div></details>';
    var el = dv, box = el.querySelector('#rLines'), saveT = 0, curPk = -1, dirty = false;
    thaiDateHint(el.querySelector('#rDate'));
    function lineEls() { return box.querySelectorAll('[data-rl]'); }
    function readLines() {
      return Array.prototype.map.call(lineEls(), function (row) {
        var o = {}; Array.prototype.forEach.call(row.querySelectorAll('[data-f]'), function (f) { o[f.getAttribute('data-f')] = f.value; });
        return o;
      });
    }
    function totalVal() { return cleanNum(el.querySelector('#rTotal').value); }
    function lineSum() { return sumSat(readLines(), function (l) { return cleanNum(l.amount); }); }
    function renumber() { Array.prototype.forEach.call(lineEls(), function (r, i) { r.querySelector('.i').textContent = i + 1; }); }
    function diff() {
      var t = totalVal(), s = lineSum(), box2 = el.querySelector('#rDiff'), df = Math.round((t - s) * 100) / 100;
      if (!t) box2.innerHTML = '<span>รวมรายการ <b class="money">' + money(s) + '</b> บาท</span>';
      else if (df === 0) box2.innerHTML = '<span class="ok">✓ ตรงกับยอดรวม <b class="money">' + money(t) + '</b> บาท</span>';
      else box2.innerHTML = '<span class="bad">' + (df > 0 ? 'ยังขาดอีก ' : 'เกินยอดรวม ') + '<b class="money">' + money(Math.abs(df)) + '</b> บาท (รวมรายการ ' + money(s) + ' / ยอดรวม ' + money(t) + ')</span>' + (df > 0 ? '<button class="link" type="button" id="rFill">เติมส่วนต่างให้บรรทัดสุดท้าย</button>' : '');
    }
    function readAll() { return { book: el.querySelector('#rBook').value, no: el.querySelector('#rNo').value, date: el.querySelector('#rDate').value, payer: el.querySelector('#rPayer').value, total: el.querySelector('#rTotal').value, method: rm, lines: readLines() }; }
    function draft() {
      var a = readAll();
      if (a.lines.some(function (l) { return l.amount; })) Draft.set('rcv', a); else Draft.del('rcv');
    }
    function queue() { clearTimeout(saveT); saveT = setTimeout(draft, 500); diff(); }
    /* ---- แพ็กเกจตามยอดรวม ---- */
    function showPk(auto) {
      var t = totalVal(), host = el.querySelector('#rPk');
      if (!t) { host.innerHTML = ''; curPk = -1; return; }
      var c = Math.round(t * 100), hits = []; (S.st.packages || []).forEach(function (p, i) { if (Math.round(p[0] * 100) === c) hits.push(i); });
      if (!hits.length) { host.innerHTML = '<span class="qr-pkn">ไม่มีแพ็กเกจยอด ' + money(t) + ' — เพิ่มรายการเองด้านล่างได้เลย</span>'; curPk = -1; return; }
      host.innerHTML = '<span class="qr-pkn">แพ็กเกจยอด ' + money(t) + (hits.length > 1 ? ' (' + hits.length + ' แบบ — เลือกให้ตรงกับใบนี้)' : '') + '</span>' +
        hits.map(function (i) { return '<button type="button" class="qchip pk" data-pk="' + i + '" aria-pressed="' + (i === curPk) + '">' + esc(pkLabel(S.st.packages[i])) + '</button>'; }).join('');
      var empty = !readLines().some(function (l) { return cleanNum(l.amount); });
      if (auto && hits.length === 1 && (empty || !dirty)) applyPk(hits[0]);
    }
    function applyPk(i) {
      var p = S.st.packages[i]; if (!p) return; curPk = i; dirty = false;
      box.innerHTML = p[2].map(function (it, k) { return lineHtml({ type: it[0], method: rm, amount: it[1], drop: true }, k); }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('#rPk [data-pk]'), function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-pk')) === i)); });
      queue();
    }
    el.querySelector('#rPk').addEventListener('click', function (e) { var b = e.target.closest('[data-pk]'); if (b) applyPk(Number(b.getAttribute('data-pk'))); });
    el.querySelector('#rTotal').addEventListener('input', function () { curPk = -1; clearTimeout(el._pkT); el._pkT = setTimeout(function () { showPk(true); diff(); }, 250); queue(); });
    el.querySelector('#rMeth').addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return; rm = b.getAttribute('data-m');
      Array.prototype.forEach.call(el.querySelectorAll('#rMeth [data-m]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      Array.prototype.forEach.call(el.querySelectorAll('[data-f="method"]'), function (s) { s.value = rm; }); queue();
    });
    /* ---- รายการ ---- */
    el.addEventListener('input', function (e) { if (e.target.classList) e.target.classList.remove('bad'); if (box.contains(e.target)) dirty = true; if (e.target.id !== 'rPaste') queue(); });
    el.addEventListener('change', function (e) {
      if (e.target.id === 'rDate') today();
      if (box.contains(e.target)) dirty = true;
      if (e.target.id !== 'rPaste') queue();
    });
    function addLine(type) {
      var ls = readLines(), p = ls[ls.length - 1] || {}, tmp = document.createElement('div');
      tmp.innerHTML = lineHtml({ type: type || '', grp: type ? '' : (p.type ? grpOf(p.type) : 'บกศ.'), method: rm, amount: '', drop: true }, ls.length);
      box.appendChild(tmp.firstChild); renumber();
      box.lastChild.querySelector('[data-f="amount"]').focus(); diff();
    }
    el.querySelector('#rAdd').onclick = function () { addLine(''); };
    el.querySelector('#rPkMgr').onclick = function () { openPackages(); };
    el.querySelector('#rDiff').addEventListener('click', function (e) {
      if (!e.target.closest('#rFill')) return;
      var ls = lineEls(), t = totalVal(), others = 0, lastEl = ls[ls.length - 1], amtEl = lastEl.querySelector('[data-f="amount"]');
      Array.prototype.forEach.call(ls, function (r, i) { if (i < ls.length - 1) others += Math.round(cleanNum(r.querySelector('[data-f="amount"]').value) * 100); });
      amtEl.value = String(Math.round(t * 100 - others) / 100); queue();
    });
    box.addEventListener('click', function (e) {
      var g = e.target.closest('[data-g]');
      if (g) { // เปลี่ยนกลุ่มเงิน = เปลี่ยนรายการประเภทเงินที่เลือกได้
        var row = g.closest('[data-rl]'), sel = row.querySelector('[data-f="type"]');
        Array.prototype.forEach.call(row.querySelectorAll('[data-g]'), function (x) { x.setAttribute('aria-pressed', String(x === g)); });
        sel.innerHTML = typeOpts(g.getAttribute('data-g'), ''); sel.focus(); queue(); return;
      }
      var b = e.target.closest('[data-del]'); if (!b) return;
      if (lineEls().length === 1) { toast('ต้องมีอย่างน้อย 1 บรรทัด', 'err'); return; }
      b.closest('[data-rl]').remove(); renumber(); queue();
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.getAttribute('data-f') === 'amount' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        var row = e.target.closest('[data-rl]');
        if (!row.nextElementSibling && cleanNum(e.target.value)) addLine('');
        else if (row.nextElementSibling) row.nextElementSibling.querySelector('[data-f="amount"]').focus();
      }
    });
    if (el.querySelector('#rDraftDel')) el.querySelector('#rDraftDel').onclick = function () {
      Draft.del('rcv'); clearTimeout(saveT); renderEnter(dv); toast('ทิ้งฉบับร่างแล้ว');
    };
    /* ---- ใบของวันที่เลือก (ยกเลิกได้ทันที) ---- */
    function today() {
      var dt = el.querySelector('#rDate').value, host = el.querySelector('#rToday');
      var rcs = groupReceipts(rows().filter(function (r) { return r[3] === dt; }));
      host.innerHTML = '<div class="qr-head"><h3>ใบเสร็จวันที่ ' + esc(dt ? thaiDate(dt) : '') + '</h3><span class="qr-last">' + (rcs.length ? rcs.length + ' ใบ · ' + money(sumSat(rcs.filter(function (x) { return !x.cancelled; }), function (x) { return x.total; })) + ' บาท' : 'ยังไม่มีใบในวันนี้') + '</span></div>' +
        (rcs.length ? '<div class="qr-rcs">' + rcs.slice().reverse().slice(0, 12).map(function (rc, i) { return rcRowHtml(rc, i, true); }).join('') + '</div>' + (rcs.length > 12 ? '<p class="hint">แสดง 12 ใบล่าสุด — ดูทั้งหมดที่แท็บ "สรุปรายวัน"</p>' : '') : '');
      var shown = rcs.slice().reverse().slice(0, 12);
      Array.prototype.forEach.call(host.querySelectorAll('[data-cxr]'), function (b) { b.onclick = function () { cancelFlow(shown[Number(b.getAttribute('data-cxr'))]); }; });
    }
    today(); diff(); if (totalVal()) showPk(false);
    function save() {
      var a = readAll(), btn = el.querySelector('#rSave');
      var items = a.lines.filter(function (l) { return l.amount || l.type; }).map(function (l) { return { book: a.book, no: a.no, date: a.date, payer: a.payer, type: l.type, method: l.method, amount: l.amount }; });
      if (!items.length) { toast('กรอกจำนวนเงินอย่างน้อย 1 บรรทัด', 'err'); return; }
      var t = totalVal(), s = lineSum();
      if (t && Math.round((t - s) * 100) !== 0) { toast('ยอดรวมใบเสร็จ ' + money(t) + ' ไม่ตรงกับผลรวมรายการ ' + money(s) + ' — ปรับรายการ หรือลบยอดรวมออก', 'err'); return; }
      busy(btn, api('importReceipts', { items: items })).then(function (pv) {
        var bad = pv.rows.filter(function (r) { return r.status !== 'new'; })[0];
        if (bad) {
          var i = bad.n - 1, rowEl = lineEls()[i];
          if (rowEl && bad.status === 'error' && /ประเภท/.test(bad.msg)) rowEl.querySelector('[data-f="type"]').classList.add('bad');
          toast((pv.rows.length > 1 ? 'บรรทัดที่ ' + bad.n + ': ' : '') + (bad.status === 'same' ? 'เล่ม/เลขที่นี้มีอยู่แล้ว (ข้อมูลเหมือนเดิม)' : bad.status === 'changed' ? 'เล่ม/เลขที่นี้มีอยู่แล้วแต่ข้อมูลต่างกัน' : bad.msg), 'err');
          return null;
        }
        return busy(btn, api('importReceipts', { items: items, commit: true })).then(function (r) {
          Draft.del('rcv'); clearTimeout(saveT);
          last = { book: a.book, no: nextNo(a.no), date: a.date, type: '', method: rm };
          toast('บันทึกใบเสร็จ เล่ม ' + a.book + ' เลขที่ ' + a.no + ' แล้ว (' + r.added + ' บรรทัด) — ใบถัดไป เลขที่ ' + (last.no || '-'), 'good');
          return refresh().then(function () { var n = $('rTotal'); if (n) n.focus(); });
        });
      }).catch(handleError);
    }
    el.querySelector('#rSave').onclick = save;
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && el.querySelector('#rSave')) { e.preventDefault(); save(); } });

    /* ---- วางจาก Excel ---- */
    var ta = el.querySelector('#rPaste'), prev = el.querySelector('#rPrev');
    function check() {
      var p = Paste.receiptRows(Paste.parseTSV(ta.value), { types: S.st.types, aliases: S.st.aliases || [], defaultMethod: 'สด' });
      if (!p.items.length) { toast('ไม่พบแถวใบเสร็จในข้อมูลที่วาง', 'err'); prev.innerHTML = ''; return; }
      busy(el.querySelector('#rCheck'), api('importReceipts', { items: p.items })).then(function (pv) {
        pasted = { items: p.items, pv: pv, skipped: p.skipped };
        showPreview(prev);
      }).catch(handleError);
    }
    ta.addEventListener('paste', function () { setTimeout(check, 30); });
    el.querySelector('#rCheck').onclick = check;
    el.querySelector('#rCopyHead').onclick = function () {
      var t = Paste.RECEIPT_HEADER.join('\t');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('คัดลอกหัวตารางแล้ว', 'good'); }, function () { toast(t); });
      else toast(t);
    };
  }

  /* ================= สรุปรายวัน: ใช้ใบเสร็จเล่ม/เลขที่ใด · แยก บกศ. / รายได้ / อื่น ๆ · สด / โอน ================= */
  var dayMon = '';
  function noRanges(list) { // เลขที่ -> "101–118, 120"
    var by = {}, order = [];
    list.forEach(function (rc) { if (!by[rc.book]) { by[rc.book] = []; order.push(rc.book); } by[rc.book].push(rc.no); });
    return order.map(function (b) {
      var nums = by[b].filter(function (n) { return /^\d+$/.test(n); }).map(Number).sort(function (x, y) { return x - y; }), other = by[b].filter(function (n) { return !/^\d+$/.test(n); }), parts = [], s = null, p = null;
      nums.forEach(function (n) { if (s === null) { s = p = n; } else if (n === p + 1) p = n; else { parts.push(s === p ? String(s) : s + '–' + p); s = p = n; } });
      if (s !== null) parts.push(s === p ? String(s) : s + '–' + p);
      return 'เล่ม ' + b + ' เลขที่ ' + parts.concat(other).join(', ');
    }).join(' · ');
  }
  function renderDay(dv) {
    var all = rows();
    if (!all.length) { dv.innerHTML = '<div class="empty"><b>ยังไม่มีใบเสร็จในปีงบนี้</b>' + (can.fin() ? 'เริ่มจากแท็บ "บันทึกใบเสร็จ"' : '') + '</div>'; return; }
    var mons = {}; all.forEach(function (r) { mons[String(r[3]).slice(0, 7)] = 1; });
    var mk = Object.keys(mons).sort().reverse();
    if (!dayMon || (dayMon !== '-' && !mons[dayMon])) dayMon = mons[defaultDate().slice(0, 7)] ? defaultDate().slice(0, 7) : mk[0];
    var sel = all.filter(function (r) { return dayMon === '-' || String(r[3]).slice(0, 7) === dayMon; });
    var byDay = {}, dk = []; sel.forEach(function (r) { if (!byDay[r[3]]) { byDay[r[3]] = []; dk.push(r[3]); } byDay[r[3]].push(r); }); dk.sort().reverse();
    var canCx = can.fin() && mode() === 'fin', gtot = { 'บกศ.': 0, 'รายได้': 0, 'อื่น ๆ': 0 };
    function gsum(list) {
      var s = { 'บกศ.': { 'สด': 0, 'โอน': 0 }, 'รายได้': { 'สด': 0, 'โอน': 0 }, 'อื่น ๆ': { 'สด': 0, 'โอน': 0 } };
      list.forEach(function (r) { if (r[8]) return; var g = grpOf(r[5]), m = r[6] === 'โอน' ? 'โอน' : 'สด'; s[g][m] += Math.round((Number(r[7]) || 0) * 100); });
      return s;
    }
    var cards = dk.map(function (d, di) {
      var list = byDay[d], rcs = groupReceipts(list), live = rcs.filter(function (x) { return !x.cancelled; }), s = gsum(list), tot = 0, gh = '';
      GRPS.forEach(function (g) {
        var c = s[g]['สด'] + s[g]['โอน']; tot += c; gtot[g] += c;
        gh += '<div class="qr-gb' + (c ? '' : ' z') + '"><span class="gl">' + esc(g) + '</span><b class="money">' + money(c / 100) + '</b><small>สด ' + money(s[g]['สด'] / 100) + ' · โอน ' + money(s[g]['โอน'] / 100) + '</small></div>';
      });
      var cx = rcs.length - live.length;
      return '<details class="card glass qr-day" data-d="' + esc(d) + '"' + (di === 0 ? ' open' : '') + '><summary><div class="qd-top"><b class="qd-date">' + esc(thaiDate(d)) + '</b><span class="qd-no">' + esc(noRanges(rcs)) + '</span>' +
        '<span class="qd-n">' + live.length + ' ใบ' + (cx ? ' · ยกเลิก ' + cx : '') + '</span><span class="sp"></span><b class="money tot">' + money(tot / 100) + '</b></div></summary>' +
        '<div class="qr-gsum">' + gh + '</div><div class="qr-rcs" data-day="' + di + '">' + rcs.map(function (rc, i) { return rcRowHtml(rc, i, canCx); }).join('') + '</div></details>';
    }).join('');
    var gt = GRPS.map(function (g) { return '<div class="qr-gb"><span class="gl">' + esc(g) + '</span><b class="money">' + money(gtot[g] / 100) + '</b></div>'; }).join('');
    dv.innerHTML = '<div class="toolbar"><label class="f inl">เดือน<select id="dayMon">' + mk.map(function (m) { return '<option value="' + m + '"' + (m === dayMon ? ' selected' : '') + '>' + esc(MONTHS_L[Number(m.slice(5)) - 1] + ' ' + (Number(m.slice(0, 4)) + 543)) + '</option>'; }).join('') + '<option value="-"' + (dayMon === '-' ? ' selected' : '') + '>ทั้งปีงบ</option></select></label>' +
      '<span class="grow"></span><span class="hint" style="margin:0">กดที่วันเพื่อดูใบเสร็จแต่ละใบ และยกเลิกใบที่ผิด</span></div>' +
      '<div class="card glass qr-mon"><span class="gl">รวม' + (dayMon === '-' ? 'ทั้งปีงบ' : 'เดือนนี้') + '</span><div class="qr-gsum">' + gt + '</div></div>' +
      '<div class="stagger">' + (cards || '<div class="empty"><b>ไม่มีใบเสร็จในเดือนนี้</b></div>') + '</div>';
    $('dayMon').onchange = function () { dayMon = this.value; renderDay(dv); };
    Array.prototype.forEach.call(dv.querySelectorAll('.qr-rcs[data-day]'), function (host) {
      var rcs = groupReceipts(byDay[dk[Number(host.getAttribute('data-day'))]]);
      Array.prototype.forEach.call(host.querySelectorAll('[data-cxr]'), function (b) { b.onclick = function () { cancelFlow(rcs[Number(b.getAttribute('data-cxr'))]); }; });
    });
  }

  /* ================= แพ็กเกจรับเงิน (ตั้งค่า: วางตารางจาก Excel แล้วจับคู่คอลัมน์กับประเภทเงิน) ================= */
  function openPackages() {
    var pk = S.st.packages || [], parsed = null;
    var m = openModal({
      title: 'แพ็กเกจรับเงิน', width: 980,
      body: '<p class="hint">แพ็กเกจ = ยอดรวมของใบเสร็จหนึ่งใบ แบ่งเข้าประเภทเงินใดเท่าใด · ตอนบันทึกใบเสร็จ ใส่ยอดรวมแล้วระบบเสนอแพ็กเกจให้ (ยอดเท่ากันแต่ต่างรายการได้ — เลือกเองหรือแก้ทีละบรรทัดได้)</p>' +
        '<div class="qr-pkcur">ตอนนี้มีแพ็กเกจ <b>' + pk.length + '</b> แบบ' + (pk.length ? ' (ยอด ' + money(pk[0][0]) + ' – ' + money(pk[pk.length - 1][0]) + ' บาท)' : ' — ยังไม่ได้ตั้งค่า') + '</div>' +
        '<label class="f">วางตารางแพ็กเกจจาก Excel (หัวตาราง: รวม | … | ชื่อประเภทเงินแต่ละคอลัมน์)<textarea id="kpText" rows="5" placeholder="คัดลอกทั้งตาราง รวมแถวหัวตาราง แล้ววางที่นี่ (Ctrl+V)"></textarea></label>' +
        '<div id="kpMap"></div>',
      footer: '<button class="btn ghost" type="button" data-close>ปิด</button><button class="btn" type="button" id="kpSave" disabled>บันทึกแพ็กเกจ (แทนที่ของเดิมทั้งหมด)</button>'
    });
    var el = m.el, ta = el.querySelector('#kpText'), host = el.querySelector('#kpMap'), t0 = 0;
    function typeSel(i, cur) {
      return '<select data-ci="' + i + '"><option value="">— ไม่ใช้คอลัมน์นี้ —</option>' + S.st.types.filter(function (t) { return t[4] !== 'ไม่ใช่'; }).map(function (t) { return '<option value="' + esc(t[0]) + '"' + (t[0] === cur ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('') + '</select>';
    }
    function build() {
      if (!parsed) return [];
      var out = [], seen = {};
      parsed.rows.forEach(function (r) {
        var items = r.items.filter(function (it) { return parsed.cols[it.ci].type; }).map(function (it) { return { type: parsed.cols[it.ci].type, amount: it.amount }; });
        var s = Math.round(items.reduce(function (a, b) { return a + b.amount * 100; }, 0));
        r.ok = items.length && s === Math.round(r.total * 100) && items.length === r.items.length;
        if (r.ok) { var k = r.total + '|' + items.map(function (x) { return x.type + '=' + x.amount; }).sort().join(';'); if (!seen[k]) { seen[k] = 1; out.push({ total: r.total, items: items }); } }
      });
      return out;
    }
    function refreshStat() {
      var good = build(), bad = parsed.rows.filter(function (r) { return !r.ok; }).length, byTot = {}; good.forEach(function (g) { byTot[g.total] = (byTot[g.total] || 0) + 1; });
      var same = Object.keys(byTot).filter(function (k) { return byTot[k] > 1; }).length;
      el.querySelector('#kpStat').innerHTML = '<span class="qe-tag ok">พร้อมบันทึก ' + good.length + ' แพ็กเกจ</span>' + (same ? ' ยอดเดียวกันแต่ต่างรายการ ' + same + ' ยอด (ตอนบันทึกใบเสร็จจะให้เลือก)' : '') + (bad ? ' · <em class="qe-miss">ข้าม ' + bad + ' แถว (คอลัมน์ที่มียอดยังไม่ได้จับคู่ หรือผลรวมไม่เท่ายอดรวม)</em>' : '');
      el.querySelector('#kpSave').disabled = !good.length; el.querySelector('#kpSave').textContent = 'บันทึก ' + good.length + ' แพ็กเกจ (แทนที่ของเดิมทั้งหมด)';
    }
    function parse() {
      var res = Paste.packageRows(Paste.parseTSV(ta.value), { types: S.st.types, aliases: S.st.aliases || [] });
      if (!ta.value.trim()) { host.innerHTML = ''; parsed = null; el.querySelector('#kpSave').disabled = true; return; }
      if (!res || !res.rows.length) { host.innerHTML = '<p class="qe-miss">ไม่พบหัวตาราง "รวม" หรือไม่มีแถวข้อมูล — คัดลอกให้มีแถวหัวตารางที่เริ่มด้วยคำว่า "รวม"</p>'; parsed = null; el.querySelector('#kpSave').disabled = true; return; }
      parsed = res;
      var used = {}; res.rows.forEach(function (r) { r.items.forEach(function (it) { used[it.ci] = 1; }); });
      host.innerHTML = '<div class="qr-map"><h4>จับคู่คอลัมน์กับประเภทเงิน</h4><div class="qr-maprows">' + res.cols.filter(function (c, i) { return used[i]; }).map(function (c) { var i = res.cols.indexOf(c);
        return '<label class="qr-mr' + (c.type ? '' : ' un') + '"><span>' + esc(c.label) + '</span>' + typeSel(i, c.type) + '</label>'; }).join('') + '</div></div><div class="qr-pkstat" id="kpStat" aria-live="polite"></div>';
      Array.prototype.forEach.call(host.querySelectorAll('select[data-ci]'), function (s) {
        s.onchange = function () { parsed.cols[Number(s.getAttribute('data-ci'))].type = s.value; s.closest('.qr-mr').classList.toggle('un', !s.value); refreshStat(); };
      });
      refreshStat();
    }
    ta.addEventListener('input', function () { clearTimeout(t0); t0 = setTimeout(parse, 150); });
    el.querySelector('#kpSave').onclick = function () {
      var good = build(); if (!good.length) return;
      busy(this, api('savePackages', { rows: good })).then(function (r) { return reloadSettings().then(function () { m.close(); toast('บันทึกแพ็กเกจ ' + r.saved + ' แบบแล้ว', 'good'); if (S.tab === 'income') Receipts.render($('view'), null); }); }).catch(handleError);
    };
  }

  var STATUS_TXT = { 'new': ['ใหม่', 'paid'], same: ['มีแล้ว', 'cancel'], changed: ['ต่างจากเดิม', 'wait'], error: ['ผิดพลาด', 'bad'] };
  function showPreview(prev) {
    var pv = pasted.pv, c = pv.count;
    var h = '<div class="pvsum"><span class="badge paid">ใหม่ ' + c['new'] + '</span><span class="badge cancel">มีแล้ว ' + c.same + '</span>' +
      '<span class="badge wait">ต่างจากเดิม ' + c.changed + '</span><span class="badge bad">ผิดพลาด ' + c.error + '</span>' +
      (pasted.skipped ? '<span class="hint" style="margin:0">ข้าม ' + pasted.skipped + ' แถวที่ไม่ใช่ใบเสร็จ</span>' : '') + '</div>' +
      '<div class="pvtable"><table><thead><tr><th>#</th><th>สถานะ</th><th>วันที่</th><th>เล่ม/เลขที่</th><th>ประเภท</th><th>วิธี</th><th class="r">จำนวน</th><th>หมายเหตุ</th></tr></thead><tbody>' +
      pv.rows.map(function (r) {
        var s = STATUS_TXT[r.status];
        return '<tr class="' + r.status + '"><td>' + r.n + '</td><td><span class="badge ' + s[1] + '">' + s[0] + '</span></td><td>' + (r.date ? esc(thaiDate(r.date)) : '') + '</td><td>' + esc(r.book) + '/' + esc(r.no) + '</td><td>' +
          esc(r.type ? typeName(r.type) : '') + '</td><td>' + esc(r.method) + '</td><td class="r money">' + (r.amount == null ? '' : money(r.amount)) + '</td><td>' + esc(r.msg) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (c.changed ? '<label class="chk"><input type="checkbox" id="rUpd"> อัปเดตใบที่ต่างจากเดิม ' + c.changed + ' ใบ ให้เป็นตามที่วาง</label>' : '') +
      '<div class="actions"><button class="btn" type="button" id="rCommit">บันทึก' + (c.error ? 'เฉพาะแถวที่ถูกต้อง' : '') + '</button><button class="link" type="button" id="rClear">ล้างข้อมูลที่วาง</button></div>';
    prev.innerHTML = h;
    prev.querySelector('#rClear').onclick = function () { pasted = null; prev.innerHTML = ''; var t = $('rPaste'); if (t) t.value = ''; };
    prev.querySelector('#rCommit').onclick = function () {
      var upd = !!(prev.querySelector('#rUpd') && prev.querySelector('#rUpd').checked);
      if (!c['new'] && !(upd && c.changed)) { toast('ไม่มีแถวใหม่ให้บันทึก' + (c.changed ? ' (ติ๊ก "อัปเดต" ถ้าต้องการแก้ใบเดิม)' : ''), 'err'); return; }
      busy(this, api('importReceipts', { items: pasted.items, commit: true, updateChanged: upd })).then(function (r) {
        pasted = null;
        toast('บันทึกใหม่ ' + r.added + (r.updated ? ' · อัปเดต ' + r.updated : '') + ' ใบเสร็จแล้ว', 'good');
        return refresh();
      }).catch(handleError);
    };
    prev.scrollIntoView({ block: 'nearest', behavior: REDUCE ? 'auto' : 'smooth' });
  }

  /* ================= สรุปรายเดือน ================= */
  function renderSum(dv) {
    var lv = live();
    if (!lv.length) { dv.innerHTML = '<div class="empty"><b>ยังไม่มีใบเสร็จในปีงบนี้</b>' + (can.fin() ? 'เริ่มจากแท็บ "บันทึกรายรับ"' : '') + '</div>'; return; }
    var by = {}, keys = [];
    lv.forEach(function (r) { var k = String(r[3]).slice(0, 7); if (!by[k]) { by[k] = []; keys.push(k); } by[k].push(r); });
    keys.sort().reverse();
    dv.innerHTML = '<div class="stagger">' + keys.map(function (k, i) {
      var list = by[k], days = {}, dk = [];
      list.forEach(function (r) { if (!days[r[3]]) { days[r[3]] = []; dk.push(r[3]); } days[r[3]].push(r); });
      dk.sort().reverse();
      return '<details class="card glass mon"' + (i === 0 ? ' open' : '') + ' style="--i:' + Math.min(i, 12) + '"><summary><b>' + esc(MONTHS_L[Number(k.slice(5)) - 1] + ' ' + (Number(k.slice(0, 4)) + 543)) + '</b>' +
        '<span class="meta">' + list.length + ' รายการ</span><span class="sp"></span><span class="money tot">' + money(amountOf(list)) + '</span></summary>' +
        '<div class="mrow head"><span>วันที่</span><span class="r">เงินสด</span><span class="r">เงินโอน</span><span class="r">รวม</span></div>' +
        dk.map(function (d) {
          return '<div class="mrow"><span>' + esc(thaiDate(d)) + '</span><span class="r money">' + moneyCell(methodSum(days[d], 'สด')) + '</span><span class="r money">' + moneyCell(methodSum(days[d], 'โอน')) +
            '</span><span class="r money"><b>' + money(amountOf(days[d])) + '</b></span></div>';
        }).join('') +
        '<div class="mrow foot"><span>รวมเดือน</span><span class="r money">' + money(methodSum(list, 'สด')) + '</span><span class="r money">' + money(methodSum(list, 'โอน')) + '</span><span class="r money">' + money(amountOf(list)) + '</span></div></details>';
    }).join('') + '</div>';
  }

  /* ================= รายการใบเสร็จ ================= */
  function renderList(dv) {
    var all = rows().slice().sort(function (a, b) { return a[3] < b[3] ? 1 : a[3] > b[3] ? -1 : 0; });
    var ql = q.toLowerCase();
    var list = all.filter(function (r) {
      return !ql || (r[0] + '/' + r[1] + ' ' + r[4] + ' ' + typeName(r[5]) + ' ' + r[6] + ' ' + r[7] + ' ' + r[3]).toLowerCase().indexOf(ql) >= 0;
    });
    var h = '<div class="toolbar"><input class="grow" type="search" id="rq" placeholder="ค้นหา เล่ม/เลขที่ / ผู้ชำระ / ประเภทเงิน" value="' + esc(q) + '" aria-label="ค้นหา"></div>';
    if (!list.length) h += '<div class="empty"><b>' + (all.length ? 'ไม่พบใบเสร็จที่ตรงเงื่อนไข' : 'ยังไม่มีใบเสร็จในปีงบนี้') + '</b></div>';
    else h += '<div class="rows stagger">' + list.slice(0, 300).map(function (r, i) {
      return '<div class="row rrow' + (r[8] ? ' cancelled' : '') + '" style="--i:' + Math.min(i, 12) + '"><span class="no">' + esc(r[0]) + '/' + esc(r[1]) + (Number(r[2]) > 1 ? '.' + esc(r[2]) : '') + '</span>' +
        '<span><span class="who2">' + esc(typeName(r[5])) + '</span><br><span class="tag">' + esc(thaiDate(r[3])) + ' · ' + esc(r[6]) + (r[4] ? ' · ' + esc(r[4]) : '') + (r[8] ? ' · ' + esc(r[9] || 'ยกเลิก') : '') + '</span></span>' +
        '<span class="amt">' + money(r[7]) + '</span>' +
        (can.fin() && !r[8] ? '<button class="btn ghost sm" type="button" data-cx="' + i + '">ยกเลิก</button>' : '<span>' + (r[8] ? '<span class="badge cancel">ยกเลิก</span>' : '') + '</span>') + '</div>';
    }).join('') + (list.length > 300 ? '<p class="hint">แสดง 300 รายการแรก — ใช้ช่องค้นหาเพื่อกรอง</p>' : '') + '</div>';
    dv.innerHTML = h;
    $('rq').oninput = function () { q = this.value; var pos = this.selectionStart; renderList(dv); var e = $('rq'); e.focus(); e.setSelectionRange(pos, pos); };
    Array.prototype.forEach.call(dv.querySelectorAll('[data-cx]'), function (b) {
      b.onclick = function () {
        var r = list[Number(b.getAttribute('data-cx'))];
        askReason('ยกเลิกใบเสร็จ เล่ม ' + r[0] + ' เลขที่ ' + r[1] + ' (ทุกบรรทัดของใบนี้)', 'ยืนยันยกเลิก', function (reason, am, btn) {
          busy(btn, api('cancelReceipt', { book: r[0], no: r[1], reason: reason })).then(function () {
            am.close(); toast('ยกเลิกใบเสร็จแล้ว', 'good'); return refresh();
          }).catch(handleError);
        });
      };
    });
  }

  return { render: render, leave: leave, openPackages: openPackages };
})();
