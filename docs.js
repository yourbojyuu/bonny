/* ระบบการเงินโรงเรียน — docs.js
   ขบ. (ขอเบิก) → รอจ่าย → ขจ. (ขอจ่าย) → การจ่าย · สายโยง · พิมพ์เอกสาร A4 */

var Docs = (function () {
  var seg = 'grid', q = '', filt = 'all', sel = {}, linkHover = null, resizeT = 0;

  var TAX_QUICK = [['', 'คิด'], ['1v', '1% มี VAT'], ['1', '1% ไม่มี VAT'], ['3v', '3% มี VAT'], ['3', '3% ไม่มี VAT']];
  var METHOD_BY_KIND = { 'พัสดุ': 'เช็ค', 'เบิก': 'KTB', 'ค่าจ้าง': 'KTB', 'เงินยืม': 'KTB', 'ถอน': 'ถอน' };
  var STATE_CLS = { 'รอจ่าย': 'wait', 'อยู่ใน ขจ.': 'in', 'รอจ่ายเงิน': 'in', 'จ่ายแล้ว': 'paid', 'ยกเลิก': 'cancel' };

  function fy() { return S.docs.fy; }
  function khbs() { return S.docs.khbs; }
  function khjs() { return S.docs.khjs; }
  function findKhb(no) { return khbs().filter(function (h) { return h.no === no; })[0]; }
  function findKhj(no) { return khjs().filter(function (j) { return j.no === no; })[0]; }
  function L(sheet, i) { return S.schema.schema[sheet][i]; }
  function badge(state) { return '<span class="badge ' + (STATE_CLS[state] || '') + '">' + esc(state) + '</span>'; }
  function isCompany(name) { return /บริษัท|บจก|หจก|ห้างหุ้นส่วน|จำกัด|มหาชน|การไฟฟ้า|การประปา|รัฐวิสาหกิจ/.test(name || ''); }

  /** สรุปสถานะทั้งระบบ */
  function stats() {
    var s = { wait: { n: 0, a: 0 }, in: { n: 0, a: 0 }, paid: { n: 0, a: 0 } };
    khbs().forEach(function (h) {
      h.lines.forEach(function (l) {
        var k = l.state === 'รอจ่าย' ? 'wait' : l.state === 'อยู่ใน ขจ.' ? 'in' : l.state === 'จ่ายแล้ว' ? 'paid' : '';
        if (!k) return;
        s[k].n++; s[k].a += Math.round(l.net * 100);
      });
    });
    ['wait', 'in', 'paid'].forEach(function (k) { s[k].a /= 100; });
    return s;
  }

  /* ================= หน้าหลักรายจ่าย ================= */
  function render(v, opt) {
    if (opt && opt.seg) seg = opt.seg;
    if (seg === 'grid' && !can.khb()) seg = 'khb';
    var s = stats();
    v.innerHTML =
      '<section class="hero">' + heroDeco('expense') +
      '<div class="lbl">ขอเบิก → ขอจ่าย → จ่ายเงิน</div>' +
      '<div class="big money">' + money(s.wait.a + s.in.a) + '</div><div class="sub">ยอดที่ยังไม่ได้จ่าย (หลังหักภาษี ณ ที่จ่าย)</div>' +
      '<div class="flow">' +
      flowTile('pending', 'ขบ. รอทำ ขจ.', s.wait) + '<span class="arrow" aria-hidden="true">' + ICON.arrow + '</span>' +
      flowTile('khj', 'อยู่ใน ขจ. รอจ่ายเงิน', s.in) + '<span class="arrow" aria-hidden="true">' + ICON.arrow + '</span>' +
      flowTile('khj', 'จ่ายแล้ว', s.paid) +
      '</div></section>' +
      '<div class="seg glass" role="group" aria-label="มุมมอง">' +
      (can.khb() ? segBtn('grid', 'ตาราง Excel') : '') + segBtn('khb', 'ขบ. ขอเบิก') + segBtn('pending', 'รอจ่าย' + (s.wait.n ? ' (' + s.wait.n + ')' : '')) +
      segBtn('khj', 'ขจ. ขอจ่าย') + segBtn('links', 'สายโยง') + '</div>' +
      '<div id="dv"></div>';
    Array.prototype.forEach.call(v.querySelectorAll('[data-seg]'), function (b) {
      b.onclick = function () { switchSeg(b.getAttribute('data-seg')); };
    });
    renderSeg();
    if (opt && opt.draft) openKhb(null);
    if (opt && opt.openKhj) openKhj(opt.openKhj);
  }
  function flowTile(target, label, x) {
    return '<button class="tile" type="button" data-seg="' + target + '"><div class="k">' + esc(label) + '</div>' +
      '<div class="v money">' + money(x.a) + '</div><div class="s">' + x.n + ' รายการ</div></button>';
  }
  function segBtn(id, label) {
    return '<button type="button" data-seg="' + id + '" aria-pressed="' + (seg === id) + '">' + esc(label) + '</button>';
  }
  function switchSeg(id) {
    if (id === seg) return;
    var run = function () {
      seg = id;
      Array.prototype.forEach.call(document.querySelectorAll('.seg [data-seg]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-seg') === seg));
      });
      renderSeg();
    };
    if (document.startViewTransition && !REDUCE) { try { document.startViewTransition(run); return; } catch (e) {} }
    run();
  }
  function renderSeg() {
    leave();
    var dv = $('dv'); if (!dv) return;
    dv.className = ''; void dv.offsetWidth; dv.className = 'view-in';
    if (seg === 'grid') renderGrid(dv);
    else if (seg === 'khb') renderKhbList(dv);
    else if (seg === 'pending') renderPending(dv);
    else if (seg === 'khj') renderKhjList(dv);
    else renderLinks(dv);
    observeReveal();
  }
  function rerender() {
    if (S.tab === 'expense') render($('view'), null);
    else renderTabs();
  }
  /** ออกจากหน้า: เก็บแถบล่าง */
  function leave() { var d = $('dock'); if (d) d.parentNode.removeChild(d); }


  /* ================= ตารางกรอกแบบ Excel (แถวละรายการ) ================= */
  var gridRows = null, gridMonth = '';
  var KIND_METHOD = { 'พัสดุ': 'เช็ค', 'เบิก': 'KTB', 'ค่าจ้าง': 'KTB', 'เงินยืม': 'KTB', 'ถอน': 'ถอน' };
  function typeIdOf(name) { return name ? Paste.matchType(name, pasteCtx(), true) || '' : ''; }
  function gridBlank(prev) {
    return { date: prev ? prev.date : defaultDate(), grp: prev ? prev.grp : '', kind: prev ? prev.kind : 'เบิก', payee: '', gross: '', tax: '', taxType: 'ไม่มีภาษี', type: prev ? prev.type : '', method: prev ? prev.method : 'KTB', auto: false };
  }
  function gridRecalc(r) {
    var reg = regMap()[Paste.nk(r.payee)], g = Number(r.gross) || 0;
    r.tax = g ? (Paste.calcTax(r.taxType, g, reg ? reg.vat : false) || '') : '';
  }
  function gridOnRow(r, k) {
    if (k === 'payee') {
      var reg = regMap()[Paste.nk(r.payee)];
      if (reg) { r.taxType = reg.taxType; if (reg.method) r.method = reg.method; if (reg.type && !r.type) { var t = S.st.types.filter(function (x) { return x[0] === reg.type; })[0]; if (t) r.type = t[1]; } r.auto = true; gridRecalc(r); }
    } else if (k === 'gross') { if (r.auto || (!r.tax && r.taxType !== 'ไม่มีภาษี')) { r.auto = true; gridRecalc(r); } }
    else if (k === 'taxType') { r.auto = true; gridRecalc(r); }
    else if (k === 'tax') r.auto = false;
    else if (k === 'kind' && KIND_METHOD[r.kind]) r.method = KIND_METHOD[r.kind];
  }
  function gridCols() {
    return [
      { k: 'date', label: 'วันที่เบิก', w: 118, type: 'date', ph: 'วว/ดด/ปป' },
      { k: 'grp', label: 'ขบ. (กลุ่ม)', w: 86, ph: 'อัตโนมัติ' },
      { k: 'khj', label: 'ขจ.', w: 64, ro: true },
      { k: 'kind', label: 'ชนิด', w: 92, list: function () { return S.schema.lineKinds; } },
      { k: 'payee', label: 'รายชื่อผู้รับ', w: 270, list: function () { return S.docs.payees || []; } },
      { k: 'gross', label: 'จำนวนที่ขอเบิก', w: 124, type: 'money', align: 'r' },
      { k: 'tax', label: 'ภาษี', w: 100, type: 'money' },
      { k: 'net', label: 'จำนวนเงินที่จ่าย', w: 128, type: 'money', calc: function (r) { return (Number(r.gross) || 0) - (Number(r.tax) || 0); } },
      { k: 'type', label: 'ประเภทเงิน', w: 168, list: function () { return S.st.types.filter(function (t) { return t[4] !== 'ไม่ใช่'; }).map(function (t) { return t[1]; }); } },
      { k: 'group', label: 'รายการเงิน', w: 96, calc: function (r) { var id = typeIdOf(r.type); return id ? typeGroup(id) : ''; } },
      { k: 'taxType', label: 'ประเภทภาษี', w: 112, list: function () { return S.schema.taxTypes; } },
      { k: 'method', label: 'วิธีจ่าย', w: 84, list: function () { return S.schema.payMethods; } }
    ];
  }
  function gridPre() {
    var out = [], mk = gridMonth;
    khbs().forEach(function (h) {
      if (mk && h.date.slice(0, 7) !== mk) return;
      h.lines.forEach(function (l) {
        out.push({ date: h.date, grp: 'ขบ.' + h.no, khj: l.khjNo ? 'ขจ.' + l.khjNo : (h.status === 'ยกเลิก' ? 'ยกเลิก' : ''), kind: l.kind, payee: l.payee, gross: l.gross, tax: l.tax, net: l.net, type: typeName(l.type), group: typeGroup(l.type), taxType: l.taxType, method: l.method });
      });
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  /** วางจากชีท "รายการ" เดิม (วันที่เบิก | เดือน | ขบ. | ขจ. | ชนิด | เงินยืม | รายชื่อผู้รับ | มูลค่าสินค้า | จำนวนเงินที่จ่าย | ภาษี | จำนวนที่ขอเบิก | ประเภทเงิน | รายการเงิน | ประเภทภาษี | หมายเหตุ)
      หรือแบบมีหัวตารางตามชื่อช่องในตารางนี้ · ถ้าไม่ตรงแบบ คืน null แล้วตารางวางตามตำแหน่งช่อง */
  function gridFromSheet(text, prev) {
    var rows = Paste.parseTSV(text), idx = null, start = 0;
    function find(h, names) { for (var i = 0; i < h.length; i++) { var t = Paste.nk(h[i]); for (var j = 0; j < names.length; j++) if (t.indexOf(Paste.nk(names[j])) === 0) return i; } return -1; }
    if (rows.length && find(rows[0], ['รายชื่อผู้รับ']) >= 0 && find(rows[0], ['จำนวนที่ขอเบิก', 'จำนวนเงินที่ขอเบิก']) >= 0) {
      var h = rows[0];
      idx = { date: find(h, ['วันที่เบิก', 'วันที่']), grp: find(h, ['ขบ']), kind: find(h, ['ชนิด']), payee: find(h, ['รายชื่อผู้รับ']), gross: find(h, ['จำนวนที่ขอเบิก', 'จำนวนเงินที่ขอเบิก']), tax: find(h, ['ภาษี']), type: find(h, ['ประเภทเงิน']), taxType: find(h, ['ประเภทภาษี']), method: find(h, ['หมายเหตุ', 'วิธีจ่าย']) };
      start = 1;
    } else if (rows.length && rows[0].length >= 11 && S.schema.lineKinds.indexOf(String(rows[0][4]).trim()) >= 0) {
      idx = { date: 0, grp: 2, kind: 4, payee: 6, gross: 10, tax: 9, type: 11, taxType: 13, method: 14 };
    }
    if (!idx) return null;
    var out = [], last = prev || null;
    rows.slice(start).forEach(function (c) {
      var get = function (k) { return idx[k] >= 0 && idx[k] !== undefined ? String(c[idx[k]] === undefined ? '' : c[idx[k]]).trim() : ''; };
      if (!get('payee') && !get('gross')) return;
      var id = Paste.matchType(get('type'), pasteCtx(), true), tn = id ? (S.st.types.filter(function (t) { return t[0] === id; })[0] || [0, ''])[1] : get('type');
      var row = { date: Grid.parseDate(get('date')) || (last ? last.date : defaultDate()), grp: get('grp').replace(/^ขบ\.?/, ''), kind: S.schema.lineKinds.indexOf(get('kind')) >= 0 ? get('kind') : 'เบิก', payee: get('payee'), gross: Grid.num(get('gross')) || '', tax: Grid.num(get('tax')) || '',
        taxType: S.schema.taxTypes.indexOf(get('taxType')) >= 0 ? get('taxType') : 'ไม่มีภาษี', type: tn, method: S.schema.payMethods.indexOf(get('method')) >= 0 ? get('method') : (get('method') === 'ถอนเงินสด' ? 'ถอน' : 'KTB'), auto: false };
      var reg = regMap()[Paste.nk(row.payee)];
      if (reg && !row.tax && row.taxType === 'ไม่มีภาษี' && reg.taxType !== 'ไม่มีภาษี') { row.taxType = reg.taxType; row.auto = true; gridRecalc(row); }
      out.push(row); last = row;
    });
    return out.length ? out : null;
  }
  function renderGrid(dv) {
    if (!gridMonth) gridMonth = (S.date || defaultDate()).slice(0, 7);
    var mons = []; for (var i = 0; i < 12; i++) { var d0 = new Date(S.st.fyStart + 'T00:00:00'), x = new Date(d0.getFullYear(), d0.getMonth() + i, 1); mons.push([x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2), MONTHS_L[x.getMonth()] + ' ' + (x.getFullYear() + 543)]); }
    dv.innerHTML = '<section class="card glass xcard"><div class="xbar"><div><h2 style="margin:0">ตารางกรอก ขบ. (แถวละรายการ)</h2><p class="hint" style="margin:4px 0 0">พิมพ์ต่อท้ายตาราง หรือคัดลอกหลายแถวจาก Excel แล้ว Ctrl+V · ลูกศร/Enter/Tab เลื่อนช่อง · Ctrl+D คัดลอกจากแถวบน · ภาษีเติมให้ตามทะเบียนผู้รับ</p></div>' +
      '<div class="xtools"><label class="f inl">แสดงข้อมูลเดิม<select id="xMon"><option value="">ทั้งหมด</option>' + mons.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === gridMonth ? ' selected' : '') + '>' + esc(m[1]) + '</option>'; }).join('') + '<option value="-"' + (gridMonth === '-' ? ' selected' : '') + '>ซ่อน</option></select></label>' +
      '<button class="btn ghost sm" type="button" id="xReg">ทะเบียนผู้รับ / ภาษี</button><button class="btn ghost sm" type="button" id="xXls">ส่งออก Excel</button><button class="btn ghost sm" type="button" id="xClear">ล้างแถวใหม่</button><button class="btn" type="button" id="xSave">บันทึกแถวใหม่</button></div></div>' +
      '<div id="xHost"></div><div class="xstat" id="xStat"></div></section>';
    var g = Grid.create($('xHost'), {
      cols: gridCols(), pre: gridMonth === '-' ? [] : gridPre(), rows: gridRows || [], blank: gridBlank, onRow: function (r, k) { gridOnRow(r, k); if (g) { var ri = g.rows().indexOf(r); g.set(ri, 'gross', r.gross); } stat(); gridRows = g ? g.rows() : null; },
      isEmpty: function (r) { return !r.payee && !r.gross; },
      onPaste: function (text, api) {
        var list = gridFromSheet(text, g.filled().slice(-1)[0]);
        if (!list) return false;
        api.append(list); gridRows = api.rows(); stat();
        toast('วางแล้ว ' + list.length + ' แถว — ตรวจวันที่และประเภทเงินก่อนบันทึก', 'good');
        return true;
      },
      totals: function (rows) {
        var gs = 0, ts = 0; rows.forEach(function (r) { gs += Math.round((Number(r.gross) || 0) * 100); ts += Math.round((Number(r.tax) || 0) * 100); });
        return '<td colspan="5" class="tl">รวมแถวใหม่ ' + rows.filter(function (r) { return r.payee || r.gross; }).length + ' แถว</td><td class="mn">' + Grid.fmtN(gs / 100) + '</td><td class="mn">' + Grid.fmtN(ts / 100) + '</td><td class="mn">' + Grid.fmtN((gs - ts) / 100) + '</td><td colspan="4"></td>';
      }
    });
    function stat() { var n = g.filled().length; $('xStat').textContent = n ? 'มีแถวใหม่ที่ยังไม่บันทึก ' + n + ' แถว' : ''; gridRows = g.rows(); }
    stat();
    $('xMon').onchange = function () { gridMonth = this.value; gridRows = g.rows(); renderGrid(dv); };
    $('xReg').onclick = function () { openPayees(); };
    $('xXls').onclick = function () {
      if (!window.XlsxExport || !window.ExcelJS) { toast('ส่งออก Excel ใช้ได้ในเว็บจริงที่วางบน Netlify', 'err'); return; }
      var all = (gridMonth === '-' ? [] : gridPre()).map(function (p) { return [thaiDate(p.date), p.grp, p.khj || '', p.kind, p.payee, p.gross, p.tax, p.net, p.type, p.group, p.taxType, p.method]; });
      g.filled().forEach(function (r) { var gv = Number(r.gross) || 0, tv = Number(r.tax) || 0, id = typeIdOf(r.type); all.push([r.date ? thaiDate(r.date) : '', r.grp || '', '', r.kind, r.payee, gv, tv, gv - tv, r.type, id ? typeGroup(id) : '', r.taxType, r.method]); });
      var cols = [{ label: 'วันที่เบิก', w: 14, type: 'center' }, { label: 'ขบ.', w: 11, type: 'center' }, { label: 'ขจ.', w: 8, type: 'center' }, { label: 'ชนิด', w: 10, type: 'center' }, { label: 'รายชื่อผู้รับ', w: 40 }, { label: 'จำนวนที่ขอเบิก', w: 17, type: 'money', sum: true }, { label: 'ภาษี', w: 12, type: 'money', sum: true }, { label: 'จำนวนเงินที่จ่าย', w: 17, type: 'money', sum: true }, { label: 'ประเภทเงิน', w: 22 }, { label: 'รายการเงิน', w: 12, type: 'center' }, { label: 'ประเภทภาษี', w: 14, type: 'center' }, { label: 'วิธีจ่าย', w: 10, type: 'center' }];
      busy(this, XlsxExport.sheet('ทะเบียนรายการ ขบ. ปีงบ ' + S.st.fy, cols, all, 'ส่งออกจากระบบการเงินโรงเรียน · ' + thaiDateLong(defaultDate()), 'รายการ-ขบ-' + S.st.fy + '.xlsx')).then(function (n) { toast('ดาวน์โหลด ' + n + ' แล้ว', 'good'); }).catch(handleError);
    };
    $('xClear').onclick = function () { gridRows = null; g.replace([]); stat(); toast('ล้างแถวใหม่แล้ว'); };
    $('xSave').onclick = function () {
      var rows = g.rows(), ctx = pasteCtx(), groups = {}, order = [], bad = 0, errMsg = '';
      rows.forEach(function (r, ri) {
        if (!r.payee && !r.gross) return;
        var id = typeIdOf(r.type), iso = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : '', gv = Number(r.gross) || 0;
        function m(k) { g.mark(ri, k); bad++; }
        if (!iso) m('date'); if (!r.payee) m('payee'); if (!(gv > 0)) m('gross'); if (!id) m('type');
        if (S.schema.lineKinds.indexOf(r.kind) < 0) m('kind'); if (S.schema.payMethods.indexOf(r.method) < 0) m('method');
        if (S.schema.taxTypes.indexOf(r.taxType) < 0) r.taxType = 'ไม่มีภาษี';
        var key = (r.grp && r.grp.trim()) ? 'g:' + r.grp.trim() : 'd:' + iso;
        if (!groups[key]) { groups[key] = { date: iso, rows: [], idx: [] }; order.push(key); }
        if (groups[key].date !== iso && iso) { errMsg = 'ขบ. กลุ่ม "' + (r.grp || '') + '" มีหลายวันที่ — แยกกลุ่มหรือใช้วันที่เดียวกัน'; m('date'); }
        groups[key].rows.push(r); groups[key].idx.push(ri);
      });
      if (!order.length) { toast('ยังไม่มีแถวใหม่ให้บันทึก', 'err'); return; }
      if (bad || errMsg) { toast(errMsg || 'มี ' + bad + ' ช่องที่ยังไม่ครบ (ช่องสีแดง) — วันที่ ผู้รับ จำนวนเงิน ประเภทเงิน ชนิด วิธีจ่าย', 'err'); return; }
      var btn = this, done = [], keep = rows.slice();
      var p = Promise.resolve();
      order.forEach(function (key) {
        p = p.then(function () {
          var gp = groups[key];
          return api('saveKhb', { no: null, date: gp.date, note: '', lines: gp.rows.map(function (r) { return { type: typeIdOf(r.type), payee: r.payee, kind: r.kind, method: r.method, gross: String(r.gross), tax: String(r.tax || ''), taxType: r.taxType, taxAuto: !!r.auto }; }) })
            .then(function (res) { done.push('ขบ.' + res.no); keep = keep.filter(function (r) { return gp.rows.indexOf(r) < 0; }); })
            .catch(function (e) { gp.idx.forEach(function (ri) { g.markRow(ri); }); throw e; });
        });
      });
      busy(btn, p).then(function () { toast('บันทึก ' + done.join(', ') + ' แล้ว', 'good'); }).catch(function (e) { toast((done.length ? 'บันทึกได้ ' + done.join(', ') + ' · ' : '') + e.message, 'err'); })
        .then(function () { gridRows = keep; return Promise.all([reloadDocs(), reloadSettings()]); }).then(function () { if (S.tab === 'expense' && seg === 'grid') { var dv2 = $('dv'); if (dv2) renderGrid(dv2); } });
    };
  }

  /* ================= ขบ. ================= */
  function bar(counts, total) {
    var p = counts['จ่ายแล้ว'] || 0, k = counts['อยู่ใน ขจ.'] || 0, w = counts['รอจ่าย'] || 0;
    if (!total) return '';
    return '<div class="bar" aria-hidden="true"><i class="p" style="flex-grow:' + p + '"></i><i class="k" style="flex-grow:' + k + '"></i><i class="w" style="flex-grow:' + w + '"></i></div>' +
      '<div class="legend"><span><i style="background:var(--ok)"></i>จ่ายแล้ว ' + p + '</span><span><i style="background:var(--c2)"></i>ใน ขจ. ' + k + '</span><span><i style="background:#f5b13d"></i>รอจ่าย ' + w + '</span></div>';
  }
  /** จัดกลุ่มรายการตามเดือน ยุบ/ขยายได้ จำสถานะที่กดไว้ เดือนล่าสุดเปิดเป็นค่าตั้งต้น (ค้นหาอยู่ = เปิดหมด) */
  var monOpen = {};
  function months(list, kind, dateOf, totalOf, card) {
    var by = {}, keys = [];
    list.forEach(function (x) { var k = String(dateOf(x)).slice(0, 7); if (!by[k]) { by[k] = []; keys.push(k); } by[k].push(x); });
    keys.sort().reverse();
    var n = 0;
    return keys.map(function (k, ki) {
      var arr = by[k], sat = 0, mk = kind + ':' + k;
      arr.forEach(function (x) { sat += Math.round(totalOf(x) * 100); });
      var open = q ? true : monOpen.hasOwnProperty(mk) ? monOpen[mk] : ki === 0;
      return '<details class="mgrp" data-mk="' + mk + '"' + (open ? ' open' : '') + '><summary><span class="mn">' + esc(MONTHS_L[Number(k.slice(5)) - 1] + ' ' + (Number(k.slice(0, 4)) + 543)) + '</span>' +
        '<span class="meta">' + arr.length + ' ฉบับ</span><span class="sp"></span><span class="money tot">' + money(sat / 100) + '</span><span class="chev" aria-hidden="true"></span></summary>' +
        '<div class="grid stagger">' + arr.map(function (x) { return card(x, n++); }).join('') + '</div></details>';
    }).join('');
  }
  function wireMonths(dv) {
    Array.prototype.forEach.call(dv.querySelectorAll('details.mgrp'), function (el) {
      el.addEventListener('toggle', function () { monOpen[el.getAttribute('data-mk')] = el.open; });
    });
  }

  function renderKhbList(dv) {
    var list = khbs().filter(function (h) {
      if (filt === 'open' && !(h.status !== 'ยกเลิก' && (h.counts['รอจ่าย'] || h.counts['อยู่ใน ขจ.']))) return false;
      if (filt === 'done' && !(h.status !== 'ยกเลิก' && !h.counts['รอจ่าย'] && !h.counts['อยู่ใน ขจ.'])) return false;
      if (filt === 'cancel' && h.status !== 'ยกเลิก') return false;
      if (!q) return true;
      var t = ('ขบ.' + h.no + ' ' + h.note + ' ' + h.lines.map(function (l) { return l.payee + ' ' + typeName(l.type); }).join(' ')).toLowerCase();
      return t.indexOf(q.toLowerCase()) >= 0;
    });
    var h = '<div class="toolbar"><input class="grow" type="search" id="q" placeholder="ค้นหา เลข ขบ. / ผู้รับ / ประเภทเงิน" value="' + esc(q) + '" aria-label="ค้นหา">' +
      '<select id="filt" style="width:auto" aria-label="กรอง">' +
      [['all', 'ทั้งหมด'], ['open', 'ยังจ่ายไม่ครบ'], ['done', 'จ่ายครบแล้ว'], ['cancel', 'ยกเลิก']].map(function (o) {
        return '<option value="' + o[0] + '"' + (filt === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>' +
      (can.khb() ? '<button class="btn" type="button" id="newKhb">' + ICON.plus + ' สร้าง ขบ.</button>' : '') + '</div>';
    if (!list.length) {
      h += '<div class="empty"><b>' + (khbs().length ? 'ไม่พบ ขบ. ที่ตรงเงื่อนไข' : 'ยังไม่มี ขบ. ในปีงบนี้') + '</b>' +
        (can.khb() && !khbs().length ? 'กด "สร้าง ขบ." เพื่อเริ่มกรอกรายการขอเบิกใบแรก' : 'ลองเปลี่ยนคำค้นหรือตัวกรอง') + '</div>';
    } else {
      h += months(list, 'khb', function (x) { return x.date; }, function (x) { return x.status === 'ยกเลิก' ? 0 : x.total.gross; }, function (x, i) {
        var n = x.lines.length;
        return '<button class="doc glass' + (x.status === 'ยกเลิก' ? ' cancel' : '') + '" type="button" data-khb="' + x.no + '" style="--i:' + Math.min(i, 12) + '">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="no">ขบ.' + x.no + '/' + x.fy + '</span>' +
          (x.status === 'ยกเลิก' ? badge('ยกเลิก') : (x.counts['รอจ่าย'] ? badge('รอจ่าย') : x.counts['อยู่ใน ขจ.'] ? badge('อยู่ใน ขจ.') : badge('จ่ายแล้ว'))) + '</div>' +
          '<div class="meta">' + esc(thaiDate(x.date)) + ' · ' + n + ' รายการ' + (x.note ? ' · ' + esc(x.note) : '') + '</div>' +
          '<div class="amt">' + money(x.total.gross) + ' <small class="meta">บาท</small></div>' +
          (x.status === 'ยกเลิก' ? '' : bar(x.counts, n)) + '</button>';
      });
    }
    dv.innerHTML = h; wireMonths(dv);
    $('q').oninput = function () { q = this.value; var pos = this.selectionStart; renderKhbList(dv); var qq = $('q'); qq.focus(); qq.setSelectionRange(pos, pos); };
    $('filt').onchange = function () { filt = this.value; renderKhbList(dv); };
    if ($('newKhb')) $('newKhb').onclick = function () { openKhb(null); };
    Array.prototype.forEach.call(dv.querySelectorAll('[data-khb]'), function (b) {
      b.onclick = function () { openKhb(Number(b.getAttribute('data-khb'))); };
    });
  }

  function typeOptions(sel) {
    var groups = {}, order = [];
    S.st.types.forEach(function (t) {
      if (t[4] !== 'ใช่' && t[0] !== sel) return;
      if (!groups[t[2]]) { groups[t[2]] = []; order.push(t[2]); }
      groups[t[2]].push(t);
    });
    return '<option value="">— เลือก —</option>' + order.map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (t) {
        return '<option value="' + esc(t[0]) + '"' + (t[0] === sel ? ' selected' : '') + '>' + esc(t[1]) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }
  function badCls(l, k) { return l.bad && l.bad.indexOf(k) >= 0 ? ' class="bad"' : ''; }
  function lineHtml(l, i, locked) {
    var dis = locked ? ' disabled' : '';
    var taxN = cleanNum(l.tax);
    var more =
      '<div class="morebody">' +
      '<label class="f">' + esc(L('ขบ_รายการ', 5)) + '<select data-f="kind"' + dis + '>' + plainOpts(S.schema.lineKinds, l.kind) + '</select></label>' +
      '<label class="f">' + esc(L('ขบ_รายการ', 6)) + '<select data-f="method"' + dis + '>' + plainOpts(S.schema.payMethods, l.method) + '</select></label>' +
      '<label class="f">' + esc(L('ขบ_รายการ', 8)) + ' <span class="autotag" data-autotag' + (l.taxAuto ? '' : ' hidden') + '>ตามทะเบียน</span><span class="taxrow"><input class="money" data-f="tax" inputmode="decimal" value="' + (l.tax ? esc(l.tax) : '') + '" placeholder="0.00"' + dis + '>' +
      (locked ? '' : '<select data-f="quick" aria-label="คิดภาษีอัตโนมัติ">' + TAX_QUICK.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>') + '</span></label>' +
      '<label class="f">' + esc(L('ขบ_รายการ', 9)) + '<select data-f="taxType"' + dis + '>' + plainOpts(S.schema.taxTypes, l.taxType || 'ไม่มีภาษี') + '</select></label></div>';
    return '<div class="line' + (locked ? ' locked' : '') + '" data-line' + (l.taxAuto ? ' data-auto="1"' : '') + '>' +
      '<span class="i">' + (i + 1) + '</span>' +
      '<label class="f" data-c="type">' + esc(L('ขบ_รายการ', 3)) + '<select data-f="type"' + dis + badCls(l, 'type') + '>' + typeOptions(l.type) + '</select></label>' +
      '<label class="f" data-c="payee">' + esc(L('ขบ_รายการ', 4)) + '<input data-f="payee" list="payees" value="' + esc(l.payee) + '" placeholder="ชื่อร้าน / ผู้เบิก / ผู้ยืม"' + dis + '></label>' +
      '<label class="f" data-c="gross">' + esc(L('ขบ_รายการ', 7)) + '<input class="money' + (l.bad && l.bad.indexOf('gross') >= 0 ? ' bad' : '') + '" data-f="gross" inputmode="decimal" value="' + (l.gross ? esc(l.gross) : '') + '" placeholder="0.00"' + dis + '></label>' +
      '<div class="f" data-c="net"><span class="nl">จ่ายจริง</span><span class="net" data-net>' + money(r2(cleanNum(l.gross) - taxN)) + '</span></div>' +
      (locked ? '' : '<button class="del" type="button" data-del aria-label="ลบรายการ" data-c="del">×</button>') +
      '<details class="more" data-c="more"' + (l.warn ? ' open' : '') + '><summary><span data-sum></span>' +
      (l.state ? ' ' + badge(l.state) + (l.khjNo ? ' <span class="meta" style="font-size:12.5px">ขจ.' + l.khjNo + '</span>' : '') : '') +
      (l.warn ? ' <span class="warnnote" title="' + esc(l.warn) + '">ผู้รับใหม่ ตรวจภาษี</span>' : '') + '</summary>' + more + '</details></div>';
  }
  /** สรุปสั้น ๆ ของช่องที่ยุบอยู่ */
  function sumText(row) {
    var f = function (k) { return row.querySelector('[data-f="' + k + '"]').value; };
    var t = cleanNum(f('tax'));
    return f('kind') + ' · ' + f('method') + ' · ' + (t ? 'หักภาษี ' + money(t) + ' (' + f('taxType') + ')' : 'ไม่หักภาษี') + ' ';
  }
  function readLines(box) {
    return Array.prototype.map.call(box.querySelectorAll('[data-line]'), function (row) {
      var o = {};
      Array.prototype.forEach.call(row.querySelectorAll('[data-f]'), function (f) { o[f.getAttribute('data-f')] = f.value; });
      return { type: o.type, payee: o.payee, kind: o.kind, method: o.method, gross: o.gross, tax: o.tax, taxType: o.taxType, taxAuto: row.getAttribute('data-auto') === '1' };
    });
  }
  function recalc(box) {
    var lines = readLines(box), net = 0, tax = 0, gross = 0;
    Array.prototype.forEach.call(box.querySelectorAll('[data-line]'), function (row, i) {
      var g = cleanNum(lines[i].gross), t = cleanNum(lines[i].tax);
      gross += Math.round(g * 100); tax += Math.round(t * 100); net += Math.round((g - t) * 100);
      row.querySelector('[data-net]').textContent = money(r2(g - t));
      row.querySelector('.i').textContent = i + 1;
      row.querySelector('[data-sum]').textContent = sumText(row);
    });
    var tot = box.parentNode.querySelector('[data-tot]');
    if (tot) tot.innerHTML = '<span>ขอเบิกเงิน <b>' + money(net / 100) + '</b></span><span>ภาษี <b>' + money(tax / 100) + '</b></span>' +
      '<span class="g">รวมเป็นเงิน <b>' + money(gross / 100) + '</b></span>';
  }
  function blankLine(prev) {
    return { type: prev ? prev.type : '', payee: '', kind: prev ? prev.kind : 'พัสดุ', method: prev ? prev.method : 'เช็ค', gross: '', tax: '', taxType: 'ไม่มีภาษี' };
  }

  /** ทะเบียนผู้รับเงิน -> แผนที่ค้นหาเร็ว */
  function regMap() {
    var m = {};
    (S.st.payees || []).forEach(function (p) { m[Paste.nk(p[0])] = { taxType: p[1], vat: p[2] === 'ใช่', method: p[3], type: p[4] }; });
    return m;
  }
  function pasteCtx() { return { types: S.st.types, aliases: S.st.aliases || [], payees: regMap() }; }
  /** ตั้งภาษี/วิธีจ่าย/ประเภทเงินของแถวตามทะเบียนผู้รับ */
  function applyReg(row, fill) {
    var reg = regMap()[Paste.nk(row.querySelector('[data-f="payee"]').value)];
    var tag = row.querySelector('[data-autotag]');
    if (!reg) { row.removeAttribute('data-auto'); if (tag) tag.hidden = true; return; }
    row.setAttribute('data-auto', '1'); if (tag) { tag.hidden = false; tag.textContent = 'ตามทะเบียน: ' + reg.taxType; }
    if (fill) {
      var ty = row.querySelector('[data-f="type"]'); if (!ty.value && reg.type) ty.value = reg.type;
      if (reg.method) {
        row.querySelector('[data-f="method"]').value = reg.method;
        row.querySelector('[data-f="kind"]').value = METHOD_BY_KIND_R[reg.method] || row.querySelector('[data-f="kind"]').value;
      }
    }
    var g = cleanNum(row.querySelector('[data-f="gross"]').value), t = Paste.calcTax(reg.taxType, g, reg.vat);
    row.querySelector('[data-f="tax"]').value = t ? t.toFixed(2) : '';
    row.querySelector('[data-f="taxType"]').value = reg.taxType;
  }
  var METHOD_BY_KIND_R = { 'เช็ค': 'พัสดุ', 'KTB': 'เบิก', 'ถอน': 'ถอน' };

  function openKhb(no) {
    var h = no ? findKhb(no) : null;
    var linked = h ? h.lines.filter(function (l) { return l.khjNo; }).length : 0;
    var locked = !!h && (h.status === 'ยกเลิก' || linked > 0) || !can.khb();
    var draft = !h && can.khb() ? Draft.get('khb') : null;
    if (draft && !(draft.data.lines || []).some(function (l) { return l.payee || l.gross; })) draft = null;
    var data = h || (draft ? { date: draft.data.date, note: draft.data.note, lines: draft.data.lines } : { date: defaultDate(), note: '', lines: [blankLine(null)] });
    var payees = (S.docs.payees || []).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');
    var info = '';
    if (h && h.status === 'ยกเลิก') info = '<div class="err-box" style="margin-bottom:12px">ขบ. นี้ถูกยกเลิกแล้ว · ' + esc(h.note) + '</div>';
    else if (linked) info = '<p class="hint">มีรายการอยู่ใน ขจ. แล้ว ' + linked + ' รายการ จึงแก้ไขไม่ได้ ถ้าต้องแก้ ให้ยกเลิก ขจ. นั้นก่อน (รายการจะกลับมาเป็น "รอจ่าย")</p>';
    var m = openModal({
      title: h ? 'ขบ.' + h.no + '/' + h.fy : 'สร้าง ขบ. ใหม่',
      headExtra: h ? (h.status === 'ยกเลิก' ? badge('ยกเลิก') : '') : '',
      body: info +
        (draft ? '<div class="draftbar" id="kDraft"><span>กู้ฉบับร่างที่ค้างไว้เมื่อ ' + esc(clockText(draft.at)) + ' กลับมาแล้ว</span><button class="link" type="button" id="kDraftDel">ทิ้งฉบับร่าง เริ่มใหม่</button></div>' : '') +
        '<div class="form-head"><label class="f">' + esc(L('ขบ', 2)) + '<input type="date" id="kDate" value="' + esc(data.date) + '" min="' + S.st.fyStart + '" max="' + S.st.fyEnd + '"' + (locked ? ' disabled' : '') + '></label>' +
        '<label class="f">' + esc(L('ขบ', 3)) + '<input id="kNote" value="' + esc(h ? h.note : (data.note || '')) + '" placeholder="เช่น ชุดพัสดุ ต.ค. / เงินเดือนลูกจ้าง"' + (locked ? ' disabled' : '') + '></label></div>' +
        (locked ? '' : '<div class="toolbar"><button class="btn soft sm" type="button" id="kPasteBtn">วางจาก Excel</button><button class="btn ghost sm" type="button" id="kReg">ทะเบียนผู้รับ / ภาษี</button>' +
          '<span class="hint" style="margin:0">คัดลอกแถวจากไฟล์เดิมแล้วกด Ctrl+V ได้เลย — วางกี่ครั้งก็เพิ่มต่อท้าย</span></div>' +
          '<div class="paste" id="kPaste" hidden><textarea id="kPasteTa" rows="3" placeholder="วางแถวจาก Excel ที่นี่ (ตามแบบ ขบ. เดิม: ที่ | ประเภทเงิน | รายการ-ชื่อ | ขอเบิก | ภาษี | รวมเป็นเงิน หรือมีหัวตาราง: ประเภทเงิน | ผู้รับ | ชนิด | วิธีจ่าย | ยอดรวม | ภาษี)"></textarea>' +
          '<div class="actions"><button class="btn sm" type="button" id="kPasteGo">เพิ่มลงใน ขบ.</button><button class="link" type="button" id="kPasteCopy">คัดลอกหัวตาราง</button></div></div>') +
        '<datalist id="payees">' + payees + '</datalist>' +
        '<div id="kLines">' + data.lines.map(function (l, i) { return lineHtml(l, i, locked); }).join('') + '</div>' +
        (locked ? '' : '<button class="btn soft" type="button" id="kAdd">' + ICON.plus + ' เพิ่มรายการ</button>') +
        '<div class="totals" data-tot></div>',
      footer: (h && !locked ? '<button class="btn danger" type="button" id="kCancel">ยกเลิก ขบ.</button>' : '') +
        (h ? '<button class="btn ghost" type="button" id="kPrint">' + ICON.print + ' พิมพ์</button>' : '') +
        (!h && !locked ? '<span class="hint" style="margin:0">ฉบับร่างบันทึกอัตโนมัติ ปิดหน้าไปแล้วกลับมาทำต่อได้</span>' : '') +
        '<span class="sp"></span><button class="btn ghost" type="button" data-close>ปิด</button>' +
        (locked ? '' : '<button class="btn" type="button" id="kSave">บันทึก ขบ.</button>'),
      onClose: function () { document.removeEventListener('paste', onDocPaste); clearTimeout(saveT); }
    });
    var el = m.el, box = el.querySelector('#kLines'), saveT = 0;
    thaiDateHint(el.querySelector('#kDate'));
    recalc(box);
    function onDocPaste() {}
    if (locked) {
      if (el.querySelector('#kPrint')) el.querySelector('#kPrint').onclick = function () { openPaper('khb', h.no); };
      return;
    }
    /* ---- ร่างอัตโนมัติ ---- */
    function saveDraft() {
      if (h) return;
      var ls = readLines(box);
      if (ls.some(function (l) { return l.payee || cleanNum(l.gross); })) Draft.set('khb', { date: el.querySelector('#kDate').value, note: el.querySelector('#kNote').value, lines: ls });
      else Draft.del('khb');
    }
    function queueDraft() { clearTimeout(saveT); saveT = setTimeout(saveDraft, 500); }
    el.addEventListener('input', queueDraft); el.addEventListener('change', queueDraft);
    if (el.querySelector('#kDraftDel')) el.querySelector('#kDraftDel').onclick = function () {
      Draft.del('khb'); box.innerHTML = lineHtml(blankLine(null), 0, false); el.querySelector('#kNote').value = '';
      var bar = el.querySelector('#kDraft'); bar.parentNode.removeChild(bar); recalc(box); toast('ทิ้งฉบับร่างแล้ว');
    };
    /* ---- ช่องกรอกในแถว ---- */
    box.addEventListener('input', function (e) {
      if (e.target.classList.contains('bad')) e.target.classList.remove('bad');
      var f = e.target.getAttribute('data-f'), row = e.target.closest('[data-line]');
      if (f === 'gross' && row.getAttribute('data-auto') === '1') applyReg(row, false);
      if (f === 'tax') { row.removeAttribute('data-auto'); row.querySelector('[data-autotag]').hidden = true; }
      recalc(box);
    });
    box.addEventListener('change', function (e) {
      var f = e.target, row = f.closest('[data-line]'), name = f.getAttribute('data-f');
      if (f.classList.contains('bad')) f.classList.remove('bad');
      if (name === 'payee') applyReg(row, true);
      if (name === 'kind') row.querySelector('[data-f="method"]').value = METHOD_BY_KIND[f.value] || 'เช็ค';
      if (name === 'quick' && f.value) {
        var g = cleanNum(row.querySelector('[data-f="gross"]').value);
        if (!g) { toast('กรอกยอดรวมก่อน แล้วค่อยคิดภาษี', 'err'); f.value = ''; return; }
        var rate = Number(f.value.charAt(0)), vat = f.value.indexOf('v') > 0;
        row.querySelector('[data-f="tax"]').value = r2((vat ? g / 1.07 : g) * rate / 100).toFixed(2);
        row.querySelector('[data-f="taxType"]').value = Paste.isCompany(row.querySelector('[data-f="payee"]').value) ? 'ภ.ง.ด.53' : 'ภ.ง.ด.3';
        row.removeAttribute('data-auto'); row.querySelector('[data-autotag]').hidden = true;
        f.value = '';
      }
      if (name === 'tax') { row.removeAttribute('data-auto'); row.querySelector('[data-autotag]').hidden = true; if (cleanNum(f.value) === 0) row.querySelector('[data-f="taxType"]').value = 'ไม่มีภาษี'; }
      recalc(box);
    });
    function addRow(focus) {
      var ls = readLines(box), tmp = document.createElement('div');
      tmp.innerHTML = lineHtml(blankLine(ls[ls.length - 1]), ls.length, false);
      box.appendChild(tmp.firstChild); recalc(box);
      if (focus) { var last = box.lastChild.querySelector('[data-f="payee"]'); last.focus(); last.scrollIntoView({ block: 'nearest', behavior: REDUCE ? 'auto' : 'smooth' }); }
    }
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
      var f = e.target.getAttribute('data-f'); if (f !== 'gross' && f !== 'tax') return;
      e.preventDefault();
      var row = e.target.closest('[data-line]'), next = row.nextElementSibling;
      if (!next) { if (!cleanNum(row.querySelector('[data-f="gross"]').value)) return; addRow(true); }
      else next.querySelector('[data-f="payee"]').focus();
    });
    box.addEventListener('click', function (e) {
      var d = e.target.closest('[data-del]'); if (!d) return;
      if (box.querySelectorAll('[data-line]').length === 1) { toast('ขบ. ต้องมีอย่างน้อย 1 รายการ', 'err'); return; }
      var row = d.closest('[data-line]'); row.parentNode.removeChild(row); recalc(box); queueDraft();
    });
    el.querySelector('#kAdd').onclick = function () { addRow(true); };
    /* ---- วางจาก Excel ---- */
    function addPasted(text) {
      var res = Paste.khbRows(Paste.parseTSV(text), pasteCtx());
      if (!res.lines.length) { toast('ไม่พบแถวรายการในข้อมูลที่วาง (ต้องมีชื่อผู้รับและยอดเงิน)', 'err'); return false; }
      var ls = readLines(box);
      if (ls.length === 1 && !ls[0].payee && !cleanNum(ls[0].gross)) box.innerHTML = '';
      var start = box.querySelectorAll('[data-line]').length, tmp = document.createElement('div');
      res.lines.forEach(function (l, i) { tmp.innerHTML = lineHtml(l, start + i, false); box.appendChild(tmp.firstChild); });
      recalc(box);
      var bad = res.lines.filter(function (l) { return l.bad.length; }).length, note = 'เพิ่ม ' + res.lines.length + ' รายการจาก Excel';
      if (res.skipped) note += ' (ข้าม ' + res.skipped + ' แถวที่ไม่ใช่รายการ)';
      if (bad) note += ' · ' + bad + ' รายการต้องเลือกประเภทเงิน/ยอด (ช่องสีแดง)';
      else if (res.newPayees) note += ' · ผู้รับใหม่ ' + res.newPayees + ' ราย ตรวจภาษีด้วย';
      toast(note, bad ? 'err' : 'good');
      var firstBad = box.querySelector('.bad'); if (firstBad) firstBad.scrollIntoView({ block: 'center', behavior: REDUCE ? 'auto' : 'smooth' });
      queueDraft();
      return true;
    }
    var pastePanel = el.querySelector('#kPaste'), ta = el.querySelector('#kPasteTa');
    el.querySelector('#kPasteBtn').onclick = function () { pastePanel.hidden = !pastePanel.hidden; if (!pastePanel.hidden) ta.focus(); };
    el.querySelector('#kPasteGo').onclick = function () { if (addPasted(ta.value)) { ta.value = ''; pastePanel.hidden = true; } };
    ta.addEventListener('paste', function () { setTimeout(function () { if (addPasted(ta.value)) { ta.value = ''; pastePanel.hidden = true; } }, 30); });
    el.querySelector('#kPasteCopy').onclick = function () {
      var t = Paste.KHB_HEADER.join('\t');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('คัดลอกหัวตารางแล้ว วางใน Excel ได้เลย', 'good'); }, function () { toast(t); });
      else toast(t);
    };
    onDocPaste = function (e) {
      if (!document.body.contains(el)) return;
      var tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
      var txt = (e.clipboardData || window.clipboardData).getData('text');
      if (!txt || (txt.indexOf('\t') < 0 && txt.indexOf('\n') < 0)) return;
      e.preventDefault(); addPasted(txt);
    };
    document.addEventListener('paste', onDocPaste);
    el.querySelector('#kReg').onclick = function () { openPayees(); };
    el.querySelector('#kSave').onclick = function () {
      var btn = this;
      busy(btn, api('saveKhb', { no: h ? h.no : null, date: el.querySelector('#kDate').value, note: el.querySelector('#kNote').value, lines: readLines(box) }))
        .then(function (r) {
          Draft.del('khb'); clearTimeout(saveT);
          toast('บันทึก ขบ.' + r.no + '/' + r.fy + ' แล้ว', 'good');
          m.close();
          return Promise.all([reloadDocs(), reloadSettings()]).then(function () { seg = 'khb'; rerender(); });
        }).catch(handleError);
    };
    if (el.querySelector('#kPrint')) el.querySelector('#kPrint').onclick = function () { openPaper('khb', h.no); };
    if (el.querySelector('#kCancel')) el.querySelector('#kCancel').onclick = function () {
      askReason('ยกเลิก ขบ.' + h.no + '/' + h.fy, 'ยืนยันยกเลิก ขบ.', function (reason, am, btn) {
        busy(btn, api('cancelKhb', { no: h.no, reason: reason })).then(function () {
          am.close(); m.close(); toast('ยกเลิก ขบ.' + h.no + ' แล้ว', 'good');
          return reloadDocs().then(rerender);
        }).catch(handleError);
      });
    };
  }

  /* ================= รอจ่าย → สร้าง ขจ. ================= */
  function pendingLines() {
    var out = [];
    khbs().forEach(function (h) {
      if (h.status === 'ยกเลิก') return;
      h.lines.forEach(function (l) { if (l.state === 'รอจ่าย') out.push({ h: h, l: l, key: h.fy + '/' + h.no + '/' + l.seq }); });
    });
    return out;
  }
  function renderPending(dv) {
    var list = pendingLines(), byG = {}, order = [];
    var keys = {}; list.forEach(function (x) { keys[x.key] = true; });
    Object.keys(sel).forEach(function (k) { if (!keys[k]) delete sel[k]; });
    list.forEach(function (x) {
      var g = typeGroup(x.l.type);
      if (!byG[g]) { byG[g] = []; order.push(g); }
      byG[g].push(x);
    });
    if (!list.length) {
      dv.innerHTML = '<div class="empty"><b>ไม่มีรายการรอจ่าย</b>ทุกรายการใน ขบ. ถูกนำไปทำ ขจ. แล้ว</div>';
      return;
    }
    var h = '<p class="hint">เลือกรายการที่จะจ่ายรอบนี้ แล้วกด "สร้าง ขจ." ระบบจะแยกตามกลุ่มเงินในเอกสารให้เอง</p>';
    order.forEach(function (g) {
      var items = byG[g], all = items.every(function (x) { return sel[x.key]; });
      h += '<div class="grp"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-gall="' + esc(g) + '"' + (all ? ' checked' : '') + '> ' + esc(g) + '</label>' +
        '<span class="sum money">' + money(sumSat(items, function (x) { return x.l.net; })) + '</span></div><div class="rows stagger">';
      items.forEach(function (x, i) {
        h += '<label class="row' + (sel[x.key] ? ' sel' : '') + '" style="--i:' + Math.min(i, 12) + '"><input type="checkbox" data-k="' + x.key + '"' + (sel[x.key] ? ' checked' : '') + '>' +
          '<span><span class="who2">' + esc(x.l.payee) + '</span><br><span class="tag">ขบ.' + x.h.no + '-' + x.l.seq + ' · ' + esc(thaiDate(x.h.date)) + '</span></span>' +
          '<span class="tag hide-sm">' + esc(typeName(x.l.type)) + '<br>' + esc(x.l.method) + ' · ' + esc(x.l.kind) + '</span>' +
          '<span class="amt">' + money(x.l.net) + (x.l.tax ? '<br><span class="tag">ภาษี ' + money(x.l.tax) + '</span>' : '') + '</span></label>';
      });
      h += '</div>';
    });
    dv.innerHTML = h;
    dv.onchange = function (e) {
      var t = e.target;
      if (t.hasAttribute('data-k')) { if (t.checked) sel[t.getAttribute('data-k')] = true; else delete sel[t.getAttribute('data-k')]; }
      if (t.hasAttribute('data-gall')) byG[t.getAttribute('data-gall')].forEach(function (x) { if (t.checked) sel[x.key] = true; else delete sel[x.key]; });
      renderPending(dv);
    };
    drawDock(list);
  }
  function drawDock(list) {
    leave();
    var chosen = list.filter(function (x) { return sel[x.key]; });
    var d = document.createElement('div');
    d.id = 'dock'; d.className = 'dock';
    d.innerHTML = '<div class="in glass"><div class="tot">เลือก ' + chosen.length + ' รายการ · <span class="money">' + money(sumSat(chosen, function (x) { return x.l.net; })) + '</span> บาท</div>' +
      (can.fin()
        ? '<input type="date" id="jDate" value="' + esc(defaultDate()) + '" min="' + S.st.fyStart + '" max="' + S.st.fyEnd + '" aria-label="วันที่ ขจ.">' +
          '<input id="jNote" placeholder="หมายเหตุ (ถ้ามี)" aria-label="หมายเหตุ"><button class="btn" type="button" id="jMake">สร้าง ขจ. ' + ICON.arrow + '</button>'
        : '<span class="hint" style="margin:0">เฉพาะการเงินสร้าง ขจ. ได้</span>') + '</div>';
    document.body.appendChild(d);
    requestAnimationFrame(function () { if (chosen.length) d.classList.add('on'); });
    var mk = $('jMake');
    if (mk) mk.onclick = function () {
      var items = chosen.map(function (x) { return { fy: x.h.fy, no: x.h.no, seq: x.l.seq }; });
      busy(mk, api('createKhj', { date: $('jDate').value, note: $('jNote').value, items: items })).then(function (r) {
        sel = {};
        toast('สร้าง ขจ.' + r.no + '/' + r.fy + ' แล้ว (' + r.count + ' รายการ) — บันทึกเลขเช็ค/วันที่จ่ายต่อได้เลย', 'good');
        return reloadDocs().then(function () { seg = 'khj'; rerender(); openKhj(r.no); });
      }).catch(handleError);
    };
  }

  /* ================= ขจ. และการจ่าย ================= */
  function renderKhjList(dv) {
    var list = khjs().filter(function (j) {
      if (!q) return true;
      return ('ขจ.' + j.no + ' ' + j.note + ' ' + j.items.map(function (i) { return i.payee + ' ' + i.ref; }).join(' ')).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    });
    var h = '<div class="toolbar"><input class="grow" type="search" id="q" placeholder="ค้นหา เลข ขจ. / ผู้รับ / เลขเช็ค" value="' + esc(q) + '" aria-label="ค้นหา">' +
      '<button class="btn soft" type="button" data-to="pending">' + ICON.plus + ' สร้างจากรายการรอจ่าย</button></div>';
    if (!list.length) h += '<div class="empty"><b>' + (khjs().length ? 'ไม่พบ ขจ. ที่ตรงคำค้น' : 'ยังไม่มี ขจ.') + '</b>สร้าง ขจ. ได้จากแท็บ "รอจ่าย"</div>';
    else h += months(list, 'khj', function (j) { return j.date; }, function (j) { return j.status === 'ยกเลิก' ? 0 : j.total; }, function (j, i) {
      var st = j.status === 'ยกเลิก' ? 'ยกเลิก' : j.paid === j.count ? 'จ่ายแล้ว' : 'อยู่ใน ขจ.';
      return '<button class="doc glass' + (j.status === 'ยกเลิก' ? ' cancel' : '') + '" type="button" data-khj="' + j.no + '" style="--i:' + Math.min(i, 12) + '">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="no">ขจ.' + j.no + '/' + j.fy + '</span>' +
        badge(st === 'อยู่ใน ขจ.' ? 'รอจ่ายเงิน' : st) + '</div>' +
        '<div class="meta">' + esc(thaiDate(j.date)) + ' · ' + j.count + ' รายการ' + (j.note ? ' · ' + esc(j.note) : '') + '</div>' +
        '<div class="amt">' + money(j.total) + ' <small class="meta">บาท</small></div>' +
        (j.status === 'ยกเลิก' ? '' : '<div class="bar"><i class="p" style="flex-grow:' + j.paid + '"></i><i class="k" style="flex-grow:' + (j.count - j.paid) + '"></i></div>' +
          '<div class="legend"><span><i style="background:var(--ok)"></i>จ่ายแล้ว ' + j.paid + '/' + j.count + '</span></div>') + '</button>';
    });
    dv.innerHTML = h; wireMonths(dv);
    $('q').oninput = function () { q = this.value; var pos = this.selectionStart; renderKhjList(dv); var qq = $('q'); qq.focus(); qq.setSelectionRange(pos, pos); };
    dv.querySelector('[data-to]').onclick = function () { switchSeg('pending'); };
    Array.prototype.forEach.call(dv.querySelectorAll('[data-khj]'), function (b) {
      b.onclick = function () { openKhj(Number(b.getAttribute('data-khj'))); };
    });
  }
  function storeOptions(sel_) { return opts(S.st.stores, sel_, true); }
  function openKhj(no) {
    var j = findKhj(no); if (!j) return;
    var locked = j.status === 'ยกเลิก' || !can.fin(), dis = locked ? ' disabled' : '';
    var byG = {}, order = [];
    j.items.forEach(function (it) { var g = typeGroup(it.type); if (!byG[g]) { byG[g] = []; order.push(g); } byG[g].push(it); });
    var refs = {}; j.items.forEach(function (it) { refs['ขบ.' + it.khbNo] = true; });
    var body = '<p class="hint">' + esc(thaiDateLong(j.date)) + ' · อ้างถึง ' + Object.keys(refs).join(', ') + ' · รวม <b class="money">' + money(j.total) + '</b> บาท' +
      (j.status === 'ยกเลิก' ? '<br><b style="color:var(--bad)">ยกเลิกแล้ว · ' + esc(j.note) + '</b>' : '') + '</p>';
    if (!locked) body += '<div class="erow" style="background:color-mix(in srgb,var(--c2) 6%,#fff)"><b style="grid-column:1/-1">เติมให้ทุกแถวที่ติ๊กไว้</b>' +
      '<label class="f">วิธีจ่าย<select id="bMethod"><option value="">(ไม่เปลี่ยน)</option>' + plainOpts(S.schema.payMethods, '') + '</select></label>' +
      '<label class="f">เลขเช็ค / เลขอ้างอิง KTB<input id="bRef" inputmode="numeric"></label>' +
      '<label class="f">ที่เก็บที่จ่ายออก<select id="bStore"><option value="">(ไม่เปลี่ยน)</option>' + opts(S.st.stores, '', false) + '</select></label>' +
      '<label class="f">วันที่จ่ายจริง<input type="date" id="bDate" min="' + j.date + '" max="' + S.st.fyEnd + '"></label>' +
      '<div><button class="btn soft" type="button" id="bApply">ใช้กับแถวที่เลือก</button></div></div>';
    order.forEach(function (g) {
      body += '<div class="grp">' + esc(g) + '<span class="sum money">' + money(sumSat(byG[g], function (x) { return x.amount; })) + '</span></div><div class="rows">';
      byG[g].forEach(function (it) {
        body += '<div class="erow" data-pay data-khbfy="' + it.khbFy + '" data-khbno="' + it.khbNo + '" data-seq="' + it.seq + '">' +
          '<label class="chk" style="grid-column:1/-1;padding:0">' + (locked ? '' : '<input type="checkbox" data-pick checked>') +
          '<span><b>' + esc(it.payee) + '</b> · ขบ.' + it.khbNo + '-' + it.seq + ' · ' + esc(typeName(it.type)) + '</span>' +
          '<span style="margin-left:auto" class="money"><b>' + money(it.amount) + '</b></span>' + (it.date ? badge('จ่ายแล้ว') : badge('อยู่ใน ขจ.')) + '</label>' +
          '<label class="f">วิธีจ่าย<select data-p="method"' + dis + '>' + plainOpts(S.schema.payMethods, it.method) + '</select></label>' +
          '<label class="f">เลขเช็ค / เลขอ้างอิง<input data-p="ref" value="' + esc(it.ref) + '" inputmode="numeric"' + dis + '></label>' +
          '<label class="f">ที่เก็บที่จ่ายออก<select data-p="store"' + dis + '>' + storeOptions(it.store) + '</select></label>' +
          '<label class="f">วันที่จ่ายจริง<input type="date" data-p="date" value="' + esc(it.date) + '" min="' + j.date + '" max="' + S.st.fyEnd + '"' + dis + '></label></div>';
      });
      body += '</div>';
    });
    var m = openModal({
      title: 'ขจ.' + j.no + '/' + j.fy, width: 1040, body: body,
      footer: (!locked ? '<button class="btn danger" type="button" id="jCancel">ยกเลิก ขจ.</button>' : '') +
        '<button class="btn ghost" type="button" id="jPrint">' + ICON.print + ' พิมพ์ ขจ.</button><span class="sp"></span>' +
        '<button class="btn ghost" type="button" data-close>ปิด</button>' + (!locked ? '<button class="btn" type="button" id="jSave">บันทึกการจ่าย</button>' : '')
    });
    var el = m.el;
    el.querySelector('#jPrint').onclick = function () { openPaper('khj', j.no); };
    Array.prototype.forEach.call(el.querySelectorAll('input[type="date"]'), thaiDateHint);
    if (locked) return;
    el.querySelector('#bApply').onclick = function () {
      var bm = el.querySelector('#bMethod').value, br = el.querySelector('#bRef').value.trim(), bs = el.querySelector('#bStore').value, bd = el.querySelector('#bDate').value, n = 0;
      Array.prototype.forEach.call(el.querySelectorAll('[data-pay]'), function (row) {
        if (!row.querySelector('[data-pick]').checked) return;
        n++;
        if (bm) row.querySelector('[data-p="method"]').value = bm;
        if (br) row.querySelector('[data-p="ref"]').value = br;
        if (bs) row.querySelector('[data-p="store"]').value = bs;
        if (bd) { var di = row.querySelector('[data-p="date"]'); di.value = bd; thaiDateHint(di); }
      });
      toast('เติมให้ ' + n + ' แถวแล้ว อย่าลืมกด "บันทึกการจ่าย"');
    };
    el.querySelector('#jSave').onclick = function () {
      var rows = Array.prototype.map.call(el.querySelectorAll('[data-pay]'), function (row) {
        return { khbFy: Number(row.getAttribute('data-khbfy')), khbNo: Number(row.getAttribute('data-khbno')), seq: Number(row.getAttribute('data-seq')),
          method: row.querySelector('[data-p="method"]').value, ref: row.querySelector('[data-p="ref"]').value,
          store: row.querySelector('[data-p="store"]').value, date: row.querySelector('[data-p="date"]').value };
      });
      busy(this, api('savePayments', { no: j.no, rows: rows })).then(function (r) {
        toast('บันทึกการจ่ายแล้ว · จ่ายแล้ว ' + r.paid + '/' + rows.length + ' รายการ', 'good');
        m.close();
        return reloadDocs().then(rerender);
      }).catch(handleError);
    };
    el.querySelector('#jCancel').onclick = function () {
      askReason('ยกเลิก ขจ.' + j.no + '/' + j.fy, 'ยืนยันยกเลิก ขจ.', function (reason, am, btn) {
        busy(btn, api('cancelKhj', { no: j.no, reason: reason })).then(function () {
          am.close(); m.close(); toast('ยกเลิก ขจ.' + j.no + ' แล้ว รายการกลับไปเป็น "รอจ่าย"', 'good');
          return reloadDocs().then(rerender);
        }).catch(handleError);
      });
    };
  }

  /* ================= สายโยง ขบ. → ขจ. ================= */
  function renderLinks(dv) {
    var left = khbs().filter(function (h) { return h.status !== 'ยกเลิก'; });
    var right = khjs().filter(function (j) { return j.status !== 'ยกเลิก'; });
    if (!left.length) { dv.innerHTML = '<div class="empty"><b>ยังไม่มีเอกสารให้โยง</b>สร้าง ขบ. ก่อน แล้วสายโยงจะขึ้นที่นี่</div>'; return; }
    var edges = [];
    left.forEach(function (h) {
      var agg = {};
      h.lines.forEach(function (l) {
        var to = l.khjNo ? 'j' + l.khjNo : 'wait';
        if (!agg[to]) agg[to] = { a: 0, paid: 0, n: 0 };
        agg[to].a += l.net; agg[to].n++; if (l.state === 'จ่ายแล้ว') agg[to].paid++;
      });
      Object.keys(agg).forEach(function (to) {
        var x = agg[to];
        edges.push({ from: 'b' + h.no, to: to, a: x.a, cls: to === 'wait' ? 'wait' : x.paid === x.n ? 'paid' : 'in' });
      });
    });
    var hasWait = edges.some(function (e) { return e.to === 'wait'; });
    var h = '<p class="hint">เส้นเขียวทึบ = จ่ายแล้ว · เส้นประสีแท็บ = อยู่ใน ขจ. รอจ่าย · เส้นประส้ม = ยังไม่ได้ทำ ขจ. · ความหนาตามยอดเงิน · ชี้หรือแตะที่เอกสารเพื่อดูสายของใบนั้น</p>' +
      '<div class="links" id="links"><svg id="linkSvg" aria-hidden="true"></svg><div class="col"><h4>ขบ. ขอเบิก</h4>' +
      left.map(function (x) {
        return '<button class="node glass" type="button" data-node="b' + x.no + '"><b>ขบ.' + x.no + '</b> <span class="meta">' + esc(thaiDate(x.date)) + '</span><br>' +
          '<span class="money">' + money(x.total.net) + '</span> <span class="meta">· ' + x.lines.length + ' รายการ</span></button>';
      }).join('') + '</div><div></div><div class="col"><h4>ขจ. ขอจ่าย</h4>' +
      (hasWait ? '<button class="node glass waitnode" type="button" data-node="wait"><b style="color:#b26200">ยังไม่ได้ทำ ขจ.</b><br><span class="meta">กดเพื่อเลือกทำ ขจ.</span></button>' : '') +
      right.map(function (j) {
        return '<button class="node glass" type="button" data-node="j' + j.no + '"><b>ขจ.' + j.no + '</b> <span class="meta">' + esc(thaiDate(j.date)) + '</span><br>' +
          '<span class="money">' + money(j.total) + '</span> <span class="meta">· จ่ายแล้ว ' + j.paid + '/' + j.count + '</span></button>';
      }).join('') + '</div></div>';
    dv.innerHTML = h;
    var box = $('links');
    function draw() {
      var svg = $('linkSvg'); if (!svg) return;
      var br = box.getBoundingClientRect(), max = 0, out = '';
      edges.forEach(function (e) { if (e.a > max) max = e.a; });
      edges.forEach(function (e, i) {
        var a = box.querySelector('[data-node="' + e.from + '"]'), b = box.querySelector('[data-node="' + e.to + '"]');
        if (!a || !b) return;
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        var x1 = ra.right - br.left, y1 = ra.top + ra.height / 2 - br.top, x2 = rb.left - br.left, y2 = rb.top + rb.height / 2 - br.top, mx = (x1 + x2) / 2;
        var w = 2 + 7 * (max ? e.a / max : 0);
        var dim = linkHover && linkHover !== e.from && linkHover !== e.to;
        out += '<path class="' + e.cls + (dim ? ' dim' : '') + '" stroke-width="' + w.toFixed(1) + '" d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '"><title>' +
          esc(e.from.replace('b', 'ขบ.') + ' → ' + (e.to === 'wait' ? 'ยังไม่ได้ทำ ขจ.' : e.to.replace('j', 'ขจ.')) + ' · ' + money(e.a) + ' บาท') + '</title></path>';
      });
      svg.innerHTML = out;
      Array.prototype.forEach.call(box.querySelectorAll('[data-node]'), function (n) {
        var id = n.getAttribute('data-node');
        var on = !linkHover || linkHover === id || edges.some(function (e) { return (e.from === linkHover && e.to === id) || (e.to === linkHover && e.from === id); });
        n.classList.toggle('dim', !on); n.classList.toggle('hot', linkHover === id);
      });
    }
    box.addEventListener('mouseover', function (e) { var n = e.target.closest('[data-node]'); var v = n ? n.getAttribute('data-node') : null; if (v !== linkHover) { linkHover = v; draw(); } });
    box.addEventListener('mouseleave', function () { linkHover = null; draw(); });
    box.addEventListener('focusin', function (e) { var n = e.target.closest('[data-node]'); if (n) { linkHover = n.getAttribute('data-node'); draw(); } });
    box.addEventListener('click', function (e) {
      var n = e.target.closest('[data-node]'); if (!n) return;
      var id = n.getAttribute('data-node');
      if (id === 'wait') switchSeg('pending');
      else if (id.charAt(0) === 'b') openKhb(Number(id.slice(1)));
      else openKhj(Number(id.slice(1)));
    });
    requestAnimationFrame(draw);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    window.onresize = function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if ($('links')) draw(); }, 120); };
  }

  /* ================= เอกสาร A4 ================= */
  function signHtml(d) {
    return '<div class="sign">' + d.signers.map(function (s) {
      return '<div><div class="sp"></div>' + esc(s.name) + '<br>' + esc(s.pos) + '</div>';
    }).join('') + '</div><div class="dir">ความเห็นผู้อำนวยการ<br>.............................................................................................................<br><br>' +
      esc(d.director.name) + '<br>' + esc(d.director.pos) + '</div>';
  }
  function headHtml(d) {
    return (d.cancelled ? '<div class="void">ยกเลิก</div>' : '') + '<h1>บันทึกข้อความ</h1>' +
      '<p><b>ส่วนราชการ</b> ' + esc(d.org) + '</p><div class="mh"><span><b>ที่</b> ' + esc(d.noText) + '</span><span><b>วันที่</b> ' + esc(d.dateLong) + '</span><span></span></div>' +
      '<p><b>เรื่อง</b> ' + esc(d.subject) + '</p><div class="rule"></div><p><b>เรียน</b> ' + esc(d.to) + '</p>';
  }
  function paperKhb(d) {
    return headHtml(d) + '<p class="ind" style="margin-top:6px">' + esc(d.paras[0]) + '</p><p>' + esc(d.paras[1]) + '</p>' +
      '<table style="margin-top:8px"><thead><tr><th style="width:6%">ที่</th><th style="width:18%">ประเภทเงิน</th><th>รายการ - ชื่อผู้เบิก/ผู้ยืม</th><th style="width:15%">ขอเบิกเงิน</th><th style="width:11%">ภาษี</th><th style="width:15%">รวมเป็นเงิน</th></tr></thead><tbody>' +
      d.rows.map(function (r) {
        return '<tr><td class="c">' + r.i + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.payee) + '</td><td class="r">' + money(r.net) + '</td><td class="r">' + money(r.tax) + '</td><td class="r">' + money(r.gross) + '</td></tr>';
      }).join('') +
      '<tr class="tot"><td colspan="3" style="text-align:center">รวม</td><td class="r">' + money(d.total.net) + '</td><td class="r">' + money(d.total.tax) + '</td><td class="r">' + money(d.total.gross) + '</td></tr></tbody></table>' +
      '<p class="bt">(' + esc(d.totalText) + ')</p><p class="ind" style="margin-top:8px">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ</p>' + signHtml(d);
  }
  function paperKhj(d) {
    var h = headHtml(d) + '<p class="ind" style="margin-top:6px">' + esc(d.paras[0]) + '</p>';
    d.sections.forEach(function (s, i) {
      h += '<h3>' + (i + 1) + '. ' + esc(s.title) + ' จำนวน ' + s.rows.length + ' รายการ</h3>' +
        '<table><thead><tr><th style="width:7%">ที่</th><th style="width:21%">เลขที่เช็ค</th><th>ชื่อผู้รับ</th><th style="width:17%">จำนวนเงิน</th><th style="width:15%">หมายเหตุ</th></tr></thead><tbody>' +
        s.rows.map(function (r) {
          return '<tr><td class="c">' + r.i + '</td><td class="c">' + esc(r.ref) + '</td><td>' + esc(r.payee) + '</td><td class="r">' + money(r.amount) + '</td><td class="c">' + esc(r.note) + '</td></tr>';
        }).join('') +
        '<tr class="tot"><td colspan="3" style="text-align:center">เป็นจำนวนเงินทั้งสิ้น</td><td class="r">' + money(s.total) + '</td><td></td></tr></tbody></table>' +
        '<p class="bt">(' + esc(s.totalText) + ')</p>';
    });
    return h + '<p style="margin-top:8px"><b>รวมเป็นเงินทั้งสิ้น ' + money(d.grand) + ' บาท (' + esc(d.grandText) + ')</b></p>' +
      '<p class="ind" style="margin-top:8px">จึงเรียนมาเพื่อโปรดพิจารณา</p>' + signHtml(d);
  }
  function openPaper(kind, no) {
    var m = openModal({
      title: (kind === 'khb' ? 'ขบ.' : 'ขจ.') + no + '/' + fy() + ' · ตัวอย่างก่อนพิมพ์', width: 980,
      body: '<div class="paperwrap"><div class="skel" style="min-height:400px"></div></div>',
      footer: '<span class="hint" style="margin:0">ตรวจชื่อผู้ลงนามได้ที่หน้า ตั้งค่า</span><span class="sp"></span><button class="btn ghost" type="button" data-close>ปิด</button>' +
        '<button class="btn ghost" type="button" id="pXlsx" disabled>' + ICON.down + ' ดาวน์โหลด Excel</button>' +
        '<button class="btn" type="button" id="pPrint" disabled>' + ICON.print + ' พิมพ์ / บันทึกเป็น PDF</button>',
      onClose: function () { document.body.classList.remove('printing'); }
    });
    api(kind === 'khb' ? 'khbDoc' : 'khjDoc', { no: no }).then(function (d) {
      var wrap = m.el.querySelector('.paperwrap');
      wrap.innerHTML = '<div class="paper">' + (kind === 'khb' ? paperKhb(d) : paperKhj(d)) + '</div>';
      var paper = wrap.firstChild, avail = wrap.clientWidth - 16;
      if (avail > 0 && paper.offsetWidth > avail) paper.style.zoom = String(Math.max(0.42, avail / paper.offsetWidth));
      var xb = m.el.querySelector('#pXlsx');
      xb.disabled = false;
      xb.onclick = function () {
        if (!window.XlsxExport || !window.ExcelJS) { toast('ดาวน์โหลด Excel ใช้ได้ในเว็บจริงที่วางบน Netlify (หน้าตัวอย่างนี้ปิดการดาวน์โหลด)', 'err'); return; }
        busy(xb, XlsxExport.download(d)).then(function (name) { toast('ดาวน์โหลด ' + name + ' แล้ว', 'good'); }).catch(handleError);
      };
      var pb = m.el.querySelector('#pPrint');
      pb.disabled = false;
      pb.onclick = function () {
        document.body.classList.add('printing');
        setTimeout(function () { window.print(); document.body.classList.remove('printing'); }, 60);
      };
    }).catch(function (e) { m.close(); handleError(e); });
  }

  return { render: render, leave: leave, openKhb: openKhb, openKhj: openKhj };
})();
