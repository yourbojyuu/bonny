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
      (can.fin() ? segBtn('grid', 'ตาราง Excel') + segBtn('enter', 'ฟอร์มทีละใบ') : '') + segBtn('sum', 'สรุปรายเดือน') + segBtn('list', 'รายการใบเสร็จ') + '</div>' +
      '<div id="rv"></div>';
    if ((seg === 'enter' || seg === 'grid') && !can.fin()) seg = 'sum';
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
    if (seg === 'grid') renderGrid(dv); else if (seg === 'enter') renderEnter(dv); else if (seg === 'sum') renderSum(dv); else renderList(dv);
    observeReveal();
  }
  function refresh() { return reloadReceipts().then(function () { if (S.tab === 'income') render($('view'), null); else renderTabs(); }); }


  /* ================= ตารางกรอกแบบ Excel ================= */
  var gRows = null, gMonth = '';
  function typeIdOfName(name) { return name ? Paste.matchType(name, { types: S.st.types, aliases: S.st.aliases || [] }, true) || '' : ''; }
  function gBlank(prev) {
    return { date: prev ? prev.date : defaultDate(), book: prev ? prev.book : last.book, no: prev && prev.no ? nextNo(prev.no) : last.no, type: prev ? prev.type : '', method: prev ? prev.method : 'สด', amount: '', payer: '' };
  }
  function renderGrid(dv) {
    if (!can.fin()) { dv.innerHTML = '<div class="empty"><b>บันทึกรายรับได้เฉพาะเจ้าหน้าที่การเงิน</b></div>'; return; }
    if (!gMonth) gMonth = (S.date || defaultDate()).slice(0, 7);
    var mons = []; for (var i = 0; i < 12; i++) { var d0 = new Date(S.st.fyStart + 'T00:00:00'), x = new Date(d0.getFullYear(), d0.getMonth() + i, 1); mons.push([x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2), MONTHS_L[x.getMonth()] + ' ' + (x.getFullYear() + 543)]); }
    var cols = [
      { k: 'date', label: 'วันที่', w: 118, type: 'date', ph: 'วว/ดด/ปป' },
      { k: 'book', label: 'เล่มที่', w: 86 },
      { k: 'no', label: 'เลขที่', w: 86 },
      { k: 'type', label: 'ประเภทเงิน', w: 196, list: function () { return S.st.types.filter(function (t) { return t[4] !== 'ไม่ใช่'; }).map(function (t) { return t[1]; }); } },
      { k: 'method', label: 'วิธีรับ', w: 80, list: function () { return ['สด', 'โอน']; } },
      { k: 'amount', label: 'จำนวนเงิน', w: 128, type: 'money' },
      { k: 'payer', label: 'ผู้ชำระ (ถ้ามี)', w: 190 },
      { k: 'status', label: 'สถานะ', w: 80, ro: true }
    ];
    var pre = rows().filter(function (x) { return !gMonth || gMonth === '-' ? gMonth !== '-' : String(x[3]).slice(0, 7) === gMonth; }).sort(function (a, b) { return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0; }).map(function (x) {
      return { date: x[3], book: x[0], no: x[1] + (Number(x[2]) > 1 ? '.' + x[2] : ''), type: typeName(x[5]), method: x[6], amount: x[7], payer: x[4], status: x[8] ? 'ยกเลิก' : '' };
    });
    dv.innerHTML = '<section class="card glass xcard"><div class="xbar"><div><h2 style="margin:0">ตารางกรอกใบเสร็จ (แถวละรายการ)</h2><p class="hint" style="margin:4px 0 0">พิมพ์ต่อท้ายตาราง หรือคัดลอกจากไฟล์ใบเสร็จเดิมแล้ว Ctrl+V · เลขที่เพิ่มให้ทีละ 1 · ระบบตรวจซ้ำและวันที่ที่ปิดแล้วก่อนบันทึก</p></div>' +
      '<div class="xtools"><label class="f inl">แสดงข้อมูลเดิม<select id="rxMon"><option value="">ทั้งหมด</option>' + mons.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === gMonth ? ' selected' : '') + '>' + esc(m[1]) + '</option>'; }).join('') + '<option value="-"' + (gMonth === '-' ? ' selected' : '') + '>ซ่อน</option></select></label>' +
      '<button class="btn ghost sm" type="button" id="rxXls">ส่งออก Excel</button><button class="btn ghost sm" type="button" id="rxClear">ล้างแถวใหม่</button><button class="btn" type="button" id="rxSave">บันทึกแถวใหม่</button></div></div><div id="rxHost"></div><div class="xstat" id="rxStat"></div></section>';
    var g = Grid.create($('rxHost'), {
      cols: cols, pre: gMonth === '-' ? [] : pre, rows: gRows || [], blank: gBlank,
      isEmpty: function (r) { return !r.amount && !r.payer; },
      onRow: function () { stat(); },
      onPaste: function (text, api) {
        var res = Paste.receiptRows(Paste.parseTSV(text), { types: S.st.types, aliases: S.st.aliases || [], defaultMethod: 'สด' });
        if (!res.items.length) return false;
        api.append(res.items.map(function (it) { var t = S.st.types.filter(function (x) { return x[0] === it.type; })[0]; return { date: Grid.parseDate(it.date) || it.date, book: it.book, no: it.no, type: t ? t[1] : it.type, method: it.method || 'สด', amount: Grid.num(it.amount) || '', payer: it.payer || '' }; }));
        stat(); toast('วางแล้ว ' + res.items.length + ' แถว — กด "บันทึกแถวใหม่" เพื่อให้ระบบตรวจ', 'good'); return true;
      },
      totals: function (rs) { var s = 0; rs.forEach(function (r) { s += Math.round((Number(r.amount) || 0) * 100); }); return '<td colspan="5" class="tl">รวมแถวใหม่ ' + rs.filter(function (r) { return r.amount || r.payer; }).length + ' แถว</td><td class="mn">' + Grid.fmtN(s / 100) + '</td><td colspan="2"></td>'; }
    });
    function stat() { var n = g.filled().length; $('rxStat').textContent = n ? 'มีแถวใหม่ที่ยังไม่บันทึก ' + n + ' แถว' : ''; gRows = g.rows(); }
    stat();
    $('rxMon').onchange = function () { gMonth = this.value; gRows = g.rows(); renderGrid(dv); };
    $('rxXls').onclick = function () {
      if (!window.XlsxExport || !window.ExcelJS) { toast('ส่งออก Excel ใช้ได้ในเว็บจริงที่วางบน Netlify', 'err'); return; }
      var all = (gMonth === '-' ? [] : pre).map(function (p) { return [thaiDate(p.date), p.book, p.no, p.type, p.method, p.amount, p.payer, p.status]; });
      g.filled().forEach(function (x) { all.push([x.date ? thaiDate(x.date) : '', x.book, x.no, x.type, x.method, Number(x.amount) || 0, x.payer, '']); });
      var cc = [{ label: 'วันที่', w: 14, type: 'center' }, { label: 'เล่มที่', w: 10, type: 'center' }, { label: 'เลขที่', w: 10, type: 'center' }, { label: 'ประเภทเงิน', w: 30 }, { label: 'วิธีรับ', w: 9, type: 'center' }, { label: 'จำนวนเงิน', w: 17, type: 'money', sum: true }, { label: 'ผู้ชำระ', w: 28 }, { label: 'สถานะ', w: 10, type: 'center' }];
      busy(this, XlsxExport.sheet('ทะเบียนใบเสร็จ ปีงบ ' + S.st.fy, cc, all, 'ส่งออกจากระบบการเงินโรงเรียน · ' + thaiDateLong(defaultDate()), 'ใบเสร็จ-' + S.st.fy + '.xlsx')).then(function (n) { toast('ดาวน์โหลด ' + n + ' แล้ว', 'good'); }).catch(handleError);
    };
    $('rxClear').onclick = function () { gRows = null; g.replace([]); stat(); toast('ล้างแถวใหม่แล้ว'); };
    $('rxSave').onclick = function () {
      var rowsAll = g.rows(), items = [], idx = [];
      rowsAll.forEach(function (r, ri) {
        if (!r.amount && !r.payer) return;
        var id = typeIdOfName(r.type); idx.push(ri);
        if (!id) g.mark(ri, 'type'); if (!(Number(r.amount) > 0)) g.mark(ri, 'amount'); if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) g.mark(ri, 'date'); if (!r.book) g.mark(ri, 'book'); if (!r.no) g.mark(ri, 'no');
        items.push({ date: r.date, book: r.book, no: r.no, type: id || r.type, method: r.method, amount: String(r.amount), payer: r.payer });
      });
      if (!items.length) { toast('ยังไม่มีแถวใหม่ให้บันทึก', 'err'); return; }
      if (dv.querySelector('td.bad')) { toast('มีช่องที่ยังไม่ครบ (สีแดง)', 'err'); return; }
      var btn = this;
      busy(btn, api('importReceipts', { items: items })).then(function (pv) {
        var badRow = pv.rows.filter(function (x) { return x.status !== 'new'; });
        if (badRow.length) {
          badRow.forEach(function (x) { g.markRow(idx[x.n - 1]); });
          toast('แถวที่ ' + badRow[0].n + ': ' + (badRow[0].status === 'same' ? 'มีเล่ม/เลขที่นี้แล้ว (ข้อมูลเหมือนเดิม)' : badRow[0].status === 'changed' ? 'มีเล่ม/เลขที่นี้แล้วแต่ข้อมูลต่างกัน' : badRow[0].msg) + (badRow.length > 1 ? ' (และอีก ' + (badRow.length - 1) + ' แถว)' : ''), 'err'); return null;
        }
        return busy(btn, api('importReceipts', { items: items, commit: true })).then(function (res) {
          var lastRow = rowsAll[idx[idx.length - 1]]; last = { book: lastRow.book, no: nextNo(lastRow.no), date: lastRow.date, type: lastRow.type, method: lastRow.method };
          gRows = null; toast('บันทึกใบเสร็จ ' + res.added + ' รายการแล้ว', 'good'); return refresh();
        });
      }).catch(handleError);
    };
  }

  /* ================= บันทึกรายรับ ================= */
  function typeOptions(sel) {
    var groups = {}, order = [];
    S.st.types.forEach(function (t) {
      if (t[4] === 'ไม่ใช่') return;
      var g = t[2] || 'อื่น ๆ'; if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push('<option value="' + esc(t[0]) + '"' + (t[0] === sel ? ' selected' : '') + '>' + esc(t[1]) + '</option>');
    });
    return '<option value="">— เลือกประเภทเงิน —</option>' + order.map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].join('') + '</optgroup>'; }).join('');
  }
  function lineHtml(l, i) {
    return '<div class="line rline" data-rl><span class="i">' + (i + 1) + '</span>' +
      '<label class="f" data-c="type">ประเภทเงิน<select data-f="type"' + (l.bad ? ' class="bad"' : '') + '>' + typeOptions(l.type) + '</select></label>' +
      '<label class="f" data-c="method">วิธีรับ<select data-f="method">' + plainOpts(['สด', 'โอน'], l.method) + '</select></label>' +
      '<label class="f" data-c="gross">จำนวนเงิน<input class="money" data-f="amount" inputmode="decimal" value="' + esc(l.amount || '') + '" placeholder="0.00"></label>' +
      '<button class="del" type="button" data-del aria-label="ลบบรรทัด" data-c="del">×</button></div>';
  }
  function nextNo(no) { var m = /^(.*?)(\d+)$/.exec(String(no || '')); return m ? m[1] + String(Number(m[2]) + 1) : ''; }

  function renderEnter(dv) {
    if (!can.fin()) { dv.innerHTML = '<div class="empty"><b>บันทึกรายรับได้เฉพาะเจ้าหน้าที่การเงิน</b>ดูสรุปได้ที่แท็บ "สรุปรายเดือน"</div>'; return; }
    var dr = Draft.get('rcv'), d = dr && dr.data ? dr.data : null;
    if (d && !(d.lines || []).some(function (l) { return l.amount; })) d = null;
    var data = d || { book: last.book, no: last.no, date: last.date || defaultDate(), payer: '', lines: [{ type: last.type, method: last.method, amount: '' }] };
    dv.innerHTML =
      '<div class="card glass reveal"><h2>ใบเสร็จใบใหม่</h2>' +
      (d ? '<div class="draftbar" id="rDraft"><span>กู้ฉบับร่างที่ค้างไว้เมื่อ ' + esc(clockText(dr.at)) + ' กลับมาแล้ว</span><button class="link" type="button" id="rDraftDel">ทิ้งฉบับร่าง</button></div>' : '') +
      '<div class="form-head r3"><label class="f">เล่มที่<input id="rBook" value="' + esc(data.book) + '" placeholder="เช่น 1"></label>' +
      '<label class="f">เลขที่<input id="rNo" value="' + esc(data.no) + '" placeholder="เช่น 101"></label>' +
      '<label class="f">วันที่รับเงิน<input type="date" id="rDate" value="' + esc(data.date) + '" min="' + S.st.fyStart + '" max="' + S.st.fyEnd + '"></label></div>' +
      '<details class="more rpayer"' + (data.payer ? ' open' : '') + '><summary>ผู้ชำระ (ไม่บังคับ)</summary><label class="f"><input id="rPayer" value="' + esc(data.payer || '') + '" placeholder="ชื่อผู้ชำระเงิน"></label></details>' +
      '<div id="rLines">' + data.lines.map(lineHtml).join('') + '</div>' +
      '<div class="toolbar"><button class="btn soft" type="button" id="rAdd">' + ICON.plus + ' เพิ่มบรรทัด</button><span class="grow"></span>' +
      '<span class="hint" style="margin:0">รวม <b class="money" id="rSum">0.00</b> บาท · Ctrl+Enter เพื่อบันทึก</span>' +
      '<button class="btn" type="button" id="rSave">บันทึกใบเสร็จ</button></div></div>' +
      '<details class="card glass reveal pastecard"' + (pasted ? ' open' : '') + '><summary><h2>วางจาก Excel ทีเดียวทั้งก้อน</h2></summary>' +
      '<p class="hint">คัดลอกแถวจากไฟล์ใบเสร็จเดิม (หัวตาราง: ' + esc(Paste.RECEIPT_HEADER.join(' | ')) + ') แล้ววางด้านล่าง ระบบจะตรวจให้ก่อนบันทึกเสมอ — ใบที่มีอยู่แล้วจะไม่ถูกบันทึกซ้ำ</p>' +
      '<textarea id="rPaste" rows="4" placeholder="วางข้อมูลจาก Excel ที่นี่ (Ctrl+V)"></textarea>' +
      '<div class="actions"><button class="btn soft" type="button" id="rCheck">ตรวจข้อมูลที่วาง</button><button class="link" type="button" id="rCopyHead">คัดลอกหัวตาราง</button></div>' +
      '<div id="rPrev"></div></details>';
    var el = dv, box = el.querySelector('#rLines'), saveT = 0;
    thaiDateHint(el.querySelector('#rDate'));
    function readLines() {
      return Array.prototype.map.call(box.querySelectorAll('[data-rl]'), function (row) {
        var o = {}; Array.prototype.forEach.call(row.querySelectorAll('[data-f]'), function (f) { o[f.getAttribute('data-f')] = f.value; });
        return o;
      });
    }
    function sum() { el.querySelector('#rSum').textContent = money(sumSat(readLines(), function (l) { return cleanNum(l.amount); })); }
    function readAll() { return { book: el.querySelector('#rBook').value, no: el.querySelector('#rNo').value, date: el.querySelector('#rDate').value, payer: el.querySelector('#rPayer').value, lines: readLines() }; }
    function draft() {
      var a = readAll();
      if (a.lines.some(function (l) { return l.amount; })) Draft.set('rcv', a); else Draft.del('rcv');
    }
    function queue() { clearTimeout(saveT); saveT = setTimeout(draft, 500); sum(); }
    sum();
    el.addEventListener('input', function (e) { if (e.target.classList) e.target.classList.remove('bad'); if (e.target.id !== 'rPaste') queue(); });
    el.addEventListener('change', function (e) { if (e.target.id !== 'rPaste') queue(); });
    function addLine() {
      var ls = readLines(), p = ls[ls.length - 1] || {}, tmp = document.createElement('div');
      tmp.innerHTML = lineHtml({ type: p.type, method: p.method || 'สด', amount: '' }, ls.length);
      box.appendChild(tmp.firstChild);
      box.lastChild.querySelector('[data-f="amount"]').focus();
    }
    el.querySelector('#rAdd').onclick = addLine;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-del]'); if (!b) return;
      if (box.querySelectorAll('[data-rl]').length === 1) { toast('ต้องมีอย่างน้อย 1 บรรทัด', 'err'); return; }
      b.closest('[data-rl]').remove(); queue();
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.getAttribute('data-f') === 'amount' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        var row = e.target.closest('[data-rl]');
        if (!row.nextElementSibling && cleanNum(e.target.value)) addLine();
        else if (row.nextElementSibling) row.nextElementSibling.querySelector('[data-f="amount"]').focus();
      }
    });
    if (el.querySelector('#rDraftDel')) el.querySelector('#rDraftDel').onclick = function () {
      Draft.del('rcv'); clearTimeout(saveT); renderEnter(dv); toast('ทิ้งฉบับร่างแล้ว');
    };
    function save() {
      var a = readAll(), btn = el.querySelector('#rSave');
      var items = a.lines.filter(function (l) { return l.amount || l.type; }).map(function (l) { return { book: a.book, no: a.no, date: a.date, payer: a.payer, type: l.type, method: l.method, amount: l.amount }; });
      if (!items.length) { toast('กรอกจำนวนเงินอย่างน้อย 1 บรรทัด', 'err'); return; }
      busy(btn, api('importReceipts', { items: items })).then(function (pv) {
        var bad = pv.rows.filter(function (r) { return r.status !== 'new'; })[0];
        if (bad) {
          var i = bad.n - 1, rowEl = box.querySelectorAll('[data-rl]')[i];
          if (rowEl && bad.status === 'error' && /ประเภท/.test(bad.msg)) rowEl.querySelector('[data-f="type"]').classList.add('bad');
          toast((pv.rows.length > 1 ? 'บรรทัดที่ ' + bad.n + ': ' : '') + (bad.status === 'same' ? 'เล่ม/เลขที่นี้มีอยู่แล้ว (ข้อมูลเหมือนเดิม)' : bad.status === 'changed' ? 'เล่ม/เลขที่นี้มีอยู่แล้ว แต่ข้อมูลต่างกัน — ใช้ช่องวางจาก Excel ถ้าต้องการอัปเดต' : bad.msg), 'err');
          return null;
        }
        return busy(btn, api('importReceipts', { items: items, commit: true })).then(function (r) {
          Draft.del('rcv'); clearTimeout(saveT);
          last = { book: a.book, no: nextNo(a.no), date: a.date, type: a.lines[0].type, method: a.lines[0].method };
          toast('บันทึกใบเสร็จ เล่ม ' + a.book + ' เลขที่ ' + a.no + ' แล้ว (' + r.added + ' บรรทัด) — เลขที่ถัดไป ' + (last.no || '-'), 'good');
          return refresh().then(function () { var n = $('rNo'); if (n) n.focus(); });
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

  return { render: render, leave: leave };
})();
