/* ระบบการเงินโรงเรียน — import.js
   นำเข้าข้อมูลเดิมจากไฟล์ Excel ของงานการเงิน (ชีต "รายการ" · "รายชื่อ" · ชีต ขจ. เช่น "1-10")
   ส่วนอ่าน/จัดแผน (parse*, buildPlan) เป็นฟังก์ชันล้วน ทดสอบใน Node ได้ · ส่วนหน้าจอ (open) อ่านไฟล์ด้วย ExcelJS ในเบราว์เซอร์
   ไฟล์ไม่ถูกส่งไปไหน: อ่านในเครื่อง แล้วเรียก action เดิมของระบบ (savePayees → saveKhb → createKhj → savePayments) ทีละขั้น */

var Importer = (function () {
  function nt(v) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); }
  function nk(v) { return nt(v).replace(/[\s.\-_,]/g, '').toLowerCase(); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var t = nt(v).replace(/,|บาท/g, ''); if (t === '' || t === '-') return 0;
    var n = Number(t); return isFinite(n) ? n : 0;
  }
  function p2(n) { return ('0' + n).slice(-2); }
  var THAI_MON = { 'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6, 'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12 };
  /** ค่าในเซลล์ -> วันที่ ISO (รับ Date จาก ExcelJS (UTC), เลขวันที่ Excel, ISO, "2 ตุลาคม 2569") หรือ '' */
  function dateISO(v) {
    if (v instanceof Date && !isNaN(v)) return v.getUTCFullYear() + '-' + p2(v.getUTCMonth() + 1) + '-' + p2(v.getUTCDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) { var d = new Date(Math.round((v - 25569) * 86400000)); return dateISO(d); }
    var s = nt(v), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /(\d{1,2})\s+([ก-๙]+)\s+(\d{4})/.exec(s);
    if (m && THAI_MON[m[2]]) return (Number(m[3]) - 543) + '-' + p2(THAI_MON[m[2]]) + '-' + p2(m[1]);
    return '';
  }
  function colIndex(head, names) {
    for (var i = 0; i < head.length; i++) { var k = nk(head[i]); for (var j = 0; j < names.length; j++) if (k.indexOf(nk(names[j])) === 0) return i; }
    return -1;
  }

  /** ชีต "รายการ" -> รายการเบิกทั้งหมด */
  function parseRegister(rows) {
    var hi = -1, i;
    for (i = 0; i < Math.min(rows.length, 8); i++) if (colIndex(rows[i], ['รายชื่อผู้รับ']) >= 0 && colIndex(rows[i], ['จำนวนที่ขอเบิก']) >= 0) { hi = i; break; }
    if (hi < 0) return null;
    var h = rows[hi], c = {
      date: colIndex(h, ['วันที่เบิก']), khb: colIndex(h, ['ขบ']), khbDate: colIndex(h, ['วันที่ ขบ', 'วันที่ขบ']), khj: colIndex(h, ['ขจ']),
      kind: colIndex(h, ['ชนิด']), loan: colIndex(h, ['เงินยืม']), payee: colIndex(h, ['รายชื่อผู้รับ']), tax: colIndex(h, ['ภาษี']),
      gross: colIndex(h, ['จำนวนที่ขอเบิก']), type: colIndex(h, ['ประเภทเงิน']), taxType: colIndex(h, ['ประเภทภาษี']), method: colIndex(h, ['หมายเหตุ']), note: colIndex(h, ['Note'])
    };
    var out = [];
    rows.slice(hi + 1).forEach(function (r, k) {
      var g = function (key) { return c[key] >= 0 ? r[c[key]] : ''; };
      var payee = nt(g('payee')), gross = toNum(g('gross'));
      if (!payee && !gross) return;
      out.push({ row: hi + k + 2, date: dateISO(g('date')), khb: nt(g('khb')), khbDate: dateISO(g('khbDate')), khj: nt(g('khj')), kind: nt(g('kind')), loan: nt(g('loan')),
        payee: payee, gross: r2(gross), tax: r2(toNum(g('tax'))), type: nt(g('type')), taxType: nt(g('taxType')), method: nt(g('method')), note: nt(g('note')) });
    });
    return out;
  }

  /** ชีตเอกสาร ขจ. (เช่น "1-10") -> { no, fy, date, total, pays:[{ref,payee,amount,note}] } หรือ null */
  function parseKhjSheet(rows) {
    var no = 0, fy = 0, date = '', total = 0, pays = [], i, started = false;
    for (i = 0; i < Math.min(rows.length, 14) && !no; i++) {
      var first = nt(rows[i][0]), m = /^ที่\s*ขจ\.\s*(\d+)\s*\/\s*(\d{4})/.exec(first);
      if (m) { no = Number(m[1]); fy = Number(m[2]); date = dateISO(rows[i][6]) || dateISO(rows[i][3]); }
    }
    if (!no) return null;
    rows.forEach(function (r) {
      var a = nt(r[0]);
      if (a === 'ที่' && /เลขที่เช็ค|เลขที่/.test(nt(r[1]))) { started = true; return; }
      if (/^รวมเป็นเงินทั้งสิ้น/.test(a)) { total = toNum(r[6]) || toNum(String(nt(r[2])).replace(/[^\d.,]/g, '')); started = false; return; }
      if (/^เป็นจำนวนเงินทั้งสิ้น/.test(a)) { started = false; return; }
      if (!started || !/^\d+$/.test(a)) return;
      var payee = nt(r[2]), amount = toNum(r[3]);
      if (payee && amount > 0) pays.push({ ref: nt(r[1]), payee: payee, amount: r2(amount), note: nt(r[4]) });
    });
    return { no: no, fy: fy, date: date, total: r2(total), pays: pays };
  }

  /** ชีต "รายชื่อ" -> ทะเบียนผู้รับ [ชื่อ, ภาษี, VAT, วิธีจ่ายหลัก, ประเภทเงินหลัก] (ตัดแถวที่ไม่ใช่ผู้รับ เช่น ชื่อกองทุน) */
  function parseRegistry(rows) {
    var out = [], seen = {};
    rows.slice(1).forEach(function (r) {
      var name = nt(r[0]), typ = nt(r[2]);
      if (!name || ['ร้านค้า', 'ครู', 'เขต'].indexOf(typ) < 0 || /^[ก-ฮ]\.\d/.test(name) || /^A-/.test(name)) return;
      var k = nk(name); if (seen[k]) return; seen[k] = 1;
      var tax = ['ภ.ง.ด.53', 'ภ.ง.ด.3', 'ไม่มีภาษี'].indexOf(nt(r[5])) >= 0 ? nt(r[5]) : 'ไม่มีภาษี';
      var pay = ['KTB', 'เช็ค'].indexOf(nt(r[4])) >= 0 ? nt(r[4]) : (typ === 'ร้านค้า' ? 'เช็ค' : typ === 'ครู' ? 'KTB' : '');
      out.push([name, tax, 'ไม่', pay, '']);
    });
    return out;
  }

  /** เลขอ้างอิงในเอกสาร ขจ. -> วิธีจ่าย: เลขเช็ค (สั้น) · เลขชุด KTB (ยาว) · "ถอนเงินสด" */
  function methodOfRef(ref) {
    var t = nt(ref).replace(/\s/g, '');
    if (/^ถอน/.test(t)) return 'ถอน';
    if (/^\d{11,}$/.test(t)) return 'KTB';
    return 'เช็ค';
  }
  function cents(n) { return Math.round(n * 100); }
  /** หาชุดรายการที่ยอดรวมตรงกับยอดจ่าย (ลองตามลำดับ ไม่เกิน 14 รายการ) */
  function subsetSum(items, target) {
    var n = Math.min(items.length, 14), best = null;
    function go(i, sum, picked) {
      if (best) return;
      if (sum === target) { best = picked.slice(); return; }
      if (i >= n || sum > target) return;
      picked.push(items[i]); go(i + 1, sum + items[i].c, picked); picked.pop();
      go(i + 1, sum, picked);
    }
    go(0, 0, []); return best;
  }

  /**
   * จัดแผนนำเข้า
   * in: { lines (parseRegister), khjSheets [parseKhjSheet], registry (parseRegistry), fy (พ.ศ. ของปีงบ), fyStart, fyEnd,
   *       types, aliases, lineKinds, taxTypes, resolveType(text)->id, storeOfType(id)->รหัสที่เก็บ }
   */
  function buildPlan(o) {
    var problems = [], lines = o.lines || [];
    var kindMap = { 'พัสดุ': 'เช็ค', 'เบิก': 'KTB', 'ค่าจ้าง': 'KTB', 'เงินยืม': 'KTB', 'ถอน': 'ถอน' };
    // 1) จัดกลุ่มตาม ขบ. (เดิม) และ ขจ.
    var khbMap = {}, khbOrder = [], khjMap = {}, khjOrder = [];
    lines.forEach(function (l) {
      var typeId = o.resolveType(l.type);
      if (!typeId) problems.push('แถว ' + l.row + ': ประเภทเงิน "' + l.type + '" ไม่ตรงกับระบบ');
      if (o.lineKinds.indexOf(l.kind) < 0) problems.push('แถว ' + l.row + ': ชนิด "' + l.kind + '" ไม่รู้จัก');
      var taxType = o.taxTypes.indexOf(l.taxType) >= 0 ? l.taxType : 'ไม่มีภาษี';
      var method = l.method === 'KTB' || l.method === 'เช็ค' || l.method === 'ถอน' || l.method === 'เงินสด' ? l.method : (kindMap[l.kind] || 'เช็ค');
      var key = l.khb || ('วันที่ ' + l.date);
      if (!khbMap[key]) { khbMap[key] = { key: key, khbDate: l.khbDate || l.date, lines: [] }; khbOrder.push(key); }
      var L = { src: l, type: typeId, payee: l.payee, kind: l.kind, method: method, gross: l.gross, tax: l.tax, taxType: taxType, net: r2(l.gross - l.tax), khj: l.khj, khbKey: key };
      khbMap[key].lines.push(L);
      if (l.khj) { if (!khjMap[l.khj]) { khjMap[l.khj] = { key: l.khj, date: '', lines: [] }; khjOrder.push(l.khj); } khjMap[l.khj].lines.push(L); if (l.date > khjMap[l.khj].date) khjMap[l.khj].date = l.date; }
    });
    // 2) ขบ.: เลขของปีงบนี้ (ตัวเลขล้วน) ก่อน เรียงเลข แล้วตามด้วยของปีก่อน เรียงวันที่ — ระบบออกเลขต่อเนื่องตามลำดับที่สร้าง
    var khbs = khbOrder.map(function (k) { return khbMap[k]; });
    khbs.forEach(function (h) {
      h.cur = /^\d+$/.test(h.key);
      h.prior = h.khbDate < o.fyStart;
      h.date = h.khbDate < o.fyStart ? o.fyStart : (h.khbDate > o.fyEnd ? o.fyEnd : h.khbDate);
      h.note = 'ขบ.' + h.key + (h.cur ? '' : ' (ปีงบก่อน ลว. ' + h.khbDate.split('-').reverse().join('/') + ')') + ' · นำเข้าจากไฟล์เดิม';
      if (h.prior && h.cur) problems.push('ขบ.' + h.key + ' ลงวันที่ก่อนเริ่มปีงบ — ใช้วันที่ ' + o.fyStart + ' แทน');
    });
    khbs.sort(function (a, b) {
      if (a.cur !== b.cur) return a.cur ? -1 : 1;
      if (a.cur) return Number(a.key) - Number(b.key);
      return a.khbDate < b.khbDate ? -1 : a.khbDate > b.khbDate ? 1 : (a.key < b.key ? -1 : 1);
    });
    khbs.forEach(function (h, i) { h.expectNo = i + 1; });
    // 3) ขจ.: ตัวเลขล้วนก่อน เรียงเลข แล้วตามด้วยรหัสอื่น (เช่น A01 เงินยืม)
    var khjs = khjOrder.map(function (k) { return khjMap[k]; });
    khjs.forEach(function (j) { j.num = /^\d+$/.test(j.key); j.note = (j.num ? '' : 'ขจ.' + j.key + ' · ') + 'นำเข้าจากไฟล์เดิม'; });
    khjs.sort(function (a, b) { if (a.num !== b.num) return a.num ? -1 : 1; return a.num ? Number(a.key) - Number(b.key) : (a.key < b.key ? -1 : 1); });
    khjs.forEach(function (j, i) {
      j.expectNo = i + 1;
      j.lines.forEach(function (L) { if (L.khbKey && khbMap[L.khbKey] && khbMap[L.khbKey].date > j.date) problems.push('ขจ.' + j.key + ': ขบ.' + L.khbKey + ' ลงวันที่หลังวันที่ ขจ.'); });
    });
    // 4) การจ่าย: จับคู่แถวในเอกสาร ขจ. (เลขเช็ค/เลขชุด KTB) กับรายการเบิกจากชื่อผู้รับ + ยอดสุทธิ
    var payments = [], unmatched = [];
    (o.khjSheets || []).forEach(function (sh) {
      if (sh.fy !== o.fy) return;
      var j = khjMap[String(sh.no)];
      if (!j) { problems.push('เอกสาร ขจ.' + sh.no + ' ไม่พบรายการเบิกที่ตรงกันในชีต "รายการ"'); return; }
      var sum = 0; j.lines.forEach(function (L) { sum += cents(L.net); });
      if (sh.total && Math.abs(sh.total - sum / 100) > 0.005) problems.push('ขจ.' + sh.no + ': ยอดในเอกสาร ' + sh.total.toFixed(2) + ' ไม่เท่ายอดรวมรายการ ' + (sum / 100).toFixed(2));
      sh.pays.forEach(function (p) {
        var cand = j.lines.filter(function (L) { return !L.paid && nk(L.payee) === nk(p.payee); }).map(function (L) { return { L: L, c: cents(L.net) }; });
        var hit = subsetSum(cand, cents(p.amount));
        if (!hit) { // ชื่อในเอกสารเขียนไม่ตรงกับทะเบียน (เช่น ส.อ. / สิบเอก) — ลองจับคู่จากยอดเงินอย่างเดียว ถ้ามีรายการเดียวที่ตรง
          var byAmt = j.lines.filter(function (L) { return !L.paid && cents(L.net) === cents(p.amount); });
          if (byAmt.length === 1) { hit = [{ L: byAmt[0], c: cents(p.amount) }]; problems.push('ขจ.' + sh.no + ': จับคู่ ' + p.ref + ' (' + p.amount.toFixed(2) + ') จากยอดเงิน เพราะชื่อผู้รับไม่ตรงกับทะเบียน — ตรวจชื่อ "' + p.payee + '"'); }
        }
        if (!hit) { unmatched.push('ขจ.' + sh.no + ' ' + p.ref + ' ' + p.payee + ' ' + p.amount.toFixed(2)); return; }
        var method = methodOfRef(p.ref);
        hit.forEach(function (x) { x.L.paid = { method: method, ref: method === 'ถอน' ? '' : nt(p.ref).replace(/\s/g, ''), date: sh.date || j.date, store: o.storeOfType(x.L.type) }; });
      });
      j.sheet = true;
    });
    khjs.forEach(function (j) { j.lines.forEach(function (L) { if (L.paid) { L.method = L.paid.method; payments.push(L); } }); });
    var tot = { lines: lines.length, gross: 0, tax: 0 };
    lines.forEach(function (l) { tot.gross += cents(l.gross); tot.tax += cents(l.tax); }); tot.gross /= 100; tot.tax /= 100;
    return { khbs: khbs, khjs: khjs, payees: o.registry || [], payments: payments, unmatched: unmatched, problems: problems, totals: tot };
  }

  /** รันแผนผ่าน action เดิมทีละขั้น · api(action,payload)->Promise · onStep(text) แจ้งความคืบหน้า */
  function run(plan, api, opt, onStep) {
    var res = { payees: 0, khbs: [], khjs: [], paid: 0, warns: [] }, p = Promise.resolve(), idx = {};
    onStep = onStep || function () {};
    if (opt.payees && plan.payees.length) p = p.then(function () { onStep('ทะเบียนผู้รับเงิน ' + plan.payees.length + ' ราย…'); return api('savePayees', { rows: plan.payees }); }).then(function (r) { res.payees = r.saved; });
    if (opt.docs) {
      plan.khbs.forEach(function (h, hi) {
        p = p.then(function () {
          onStep('ขบ. ' + (hi + 1) + ' / ' + plan.khbs.length + ' (' + h.key + ')…');
          return api('saveKhb', { no: null, date: h.date, note: h.note, paper: true, lines: h.lines.map(function (L) { return { type: L.type, payee: L.payee, kind: L.kind, method: L.method, gross: String(L.gross), tax: L.tax ? String(L.tax) : '', taxType: L.taxType, taxAuto: false }; }) });
        }).then(function (r) {
          h.no = r.no; h.fy = r.fy;
          h.lines.forEach(function (L, i) { L.ref = { fy: r.fy, no: r.no, seq: i + 1 }; });
          if (h.cur && r.no !== Number(h.key)) res.warns.push('ขบ.' + h.key + ' ได้เลข ' + r.no + ' (ไม่ตรงเลขเดิม — ระบบมี ขบ. อยู่ก่อนแล้ว)');
          res.khbs.push(r.no);
        });
      });
      plan.khjs.forEach(function (j, ji) {
        p = p.then(function () {
          onStep('ขจ. ' + (ji + 1) + ' / ' + plan.khjs.length + ' (' + j.key + ')…');
          return api('createKhj', { date: j.date, note: j.note, items: j.lines.map(function (L) { return { fy: L.ref.fy, no: L.ref.no, seq: L.ref.seq }; }) });
        }).then(function (r) {
          j.no = r.no; res.khjs.push(r.no);
        });
      });
      if (opt.pay) plan.khjs.forEach(function (j) {
        var rows = j.lines.filter(function (L) { return L.paid; });
        if (!rows.length) return;
        p = p.then(function () {
          onStep('บันทึกการจ่าย ขจ.' + j.key + ' (' + rows.length + ' รายการ)…');
          return api('savePayments', { no: j.no, rows: rows.map(function (L) { return { khbFy: L.ref.fy, khbNo: L.ref.no, seq: L.ref.seq, method: L.paid.method, ref: L.paid.ref, store: L.paid.store, date: L.paid.date }; }) });
        }).then(function (r) { res.paid += r.paid; });
      });
    }
    return p.then(function () { return res; });
  }

  /** อ่านไฟล์ .xlsx (ExcelJS) -> [{name, rows}] ค่าในเซลล์เป็น primitive (ผลสูตรใช้ค่าที่คำนวณไว้) */
  function readWorkbook(buf) {
    var wb = new ExcelJS.Workbook();
    return wb.xlsx.load(buf).then(function () {
      var out = [];
      wb.eachSheet(function (ws) {
        var rows = [];
        ws.eachRow({ includeEmpty: true }, function (row, rn) {
          var cells = [];
          for (var c = 1; c <= Math.min(ws.columnCount, 30); c++) {
            var v = row.getCell(c).value;
            if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result !== undefined ? v.result : (v.richText ? v.richText.map(function (x) { return x.text; }).join('') : (v.text !== undefined ? v.text : ''));
            if (v && typeof v === 'object' && !(v instanceof Date)) v = '';
            cells.push(v === undefined ? null : v);
          }
          rows[rn - 1] = cells;
        });
        for (var i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
        out.push({ name: ws.name, rows: rows });
      });
      return out;
    });
  }
  function analyze(sheets, ctx) {
    var reg = null, registry = [], khjSheets = [];
    sheets.forEach(function (s) {
      if (s.name === 'รายการ') reg = parseRegister(s.rows);
      else if (s.name === 'รายชื่อ') registry = parseRegistry(s.rows);
      else { var k = parseKhjSheet(s.rows); if (k) khjSheets.push(k); }
    });
    if (!reg) return null;
    return buildPlan({ lines: reg, khjSheets: khjSheets, registry: registry, fy: ctx.fy, fyStart: ctx.fyStart, fyEnd: ctx.fyEnd, lineKinds: ctx.lineKinds, taxTypes: ctx.taxTypes, resolveType: ctx.resolveType, storeOfType: ctx.storeOfType });
  }

  /* ---------------- หน้าจอ ---------------- */
  function open() {
    if (!window.ExcelJS) { toast('อ่านไฟล์ Excel ได้เฉพาะในเว็บจริง (หน้าตัวอย่างนี้ไม่มีตัวอ่านไฟล์)', 'err'); return; }
    var plan = null;
    var m = openModal({
      title: 'นำเข้าข้อมูลเดิมจากไฟล์ Excel', width: 900,
      body: '<p class="hint">เลือกไฟล์งานการเงินเดิม (ที่มีชีต "รายการ" และ "รายชื่อ") ระบบอ่านในเครื่องคุณแล้วแสดงสรุปให้ตรวจก่อนนำเข้า · ขบ. ที่นำเข้าจะเป็น "อนุมัติแล้ว/รับเรื่องแล้ว" และสร้าง ขจ. ตามเลขเดิม</p>' +
        '<label class="f">ไฟล์ .xlsx<input type="file" id="imFile" accept=".xlsx"></label><div id="imOut" aria-live="polite"></div>',
      footer: '<button class="btn ghost" type="button" data-close>ปิด</button><button class="btn" type="button" id="imGo" disabled>นำเข้า</button>'
    });
    var el = m.el, out = el.querySelector('#imOut'), go = el.querySelector('#imGo');
    function ctx() {
      return { fy: S.st.fy, fyStart: S.st.fyStart, fyEnd: S.st.fyEnd, lineKinds: S.schema.lineKinds, taxTypes: S.schema.taxTypes,
        resolveType: function (t) { return Paste.matchType(t, { types: S.st.types, aliases: S.st.aliases || [] }, true) || ''; },
        storeOfType: function (id) { var t = S.st.types.filter(function (x) { return x[0] === id; })[0]; return t ? t[3] : ''; } };
    }
    function show() {
      var t = plan.totals, nPay = plan.payments.length, ex = S.docs && S.docs.khbs ? S.docs.khbs.length : 0;
      out.innerHTML = '<div class="im-sum"><div><b>' + plan.payees.length + '</b><span>ผู้รับเงิน (ทะเบียน)</span></div><div><b>' + plan.khbs.length + '</b><span>ขบ. · ' + t.lines + ' รายการ</span></div><div><b>' + plan.khjs.length + '</b><span>ขจ.</span></div><div><b>' + nPay + '</b><span>รายการที่มีเลขเช็ค/KTB</span></div></div>' +
        '<p class="hint">ยอดขอเบิกรวม <b>' + money(t.gross) + '</b> บาท · ภาษีรวม <b>' + money(t.tax) + '</b> บาท — เทียบกับไฟล์ Excel ให้ตรงก่อนกดนำเข้า</p>' +
        '<table class="im-t"><thead><tr><th>ขบ. (เดิม)</th><th>จะได้เลข</th><th>วันที่</th><th class="r">รายการ</th><th class="r">ยอดขอเบิก</th></tr></thead><tbody>' + plan.khbs.map(function (h) {
          var s = 0; h.lines.forEach(function (L) { s += Math.round(L.gross * 100); });
          return '<tr><td>' + esc(h.key) + (h.cur ? '' : ' <em>ปีงบก่อน</em>') + '</td><td>' + h.expectNo + '</td><td>' + esc(thaiDate(h.date)) + '</td><td class="r">' + h.lines.length + '</td><td class="r money">' + money(s / 100) + '</td></tr>'; }).join('') + '</tbody></table>' +
        '<table class="im-t"><thead><tr><th>ขจ. (เดิม)</th><th>จะได้เลข</th><th>วันที่</th><th class="r">รายการ</th><th class="r">มีเลขเช็ค/KTB</th></tr></thead><tbody>' + plan.khjs.map(function (j) {
          return '<tr><td>' + esc(j.key) + '</td><td>' + j.expectNo + '</td><td>' + esc(thaiDate(j.date)) + '</td><td class="r">' + j.lines.length + '</td><td class="r">' + j.lines.filter(function (L) { return L.paid; }).length + '</td></tr>'; }).join('') + '</tbody></table>' +
        (plan.problems.length ? '<div class="im-warn"><b>ต้องตรวจ ' + plan.problems.length + ' ข้อ</b><ul>' + plan.problems.slice(0, 12).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
        (plan.unmatched.length ? '<div class="im-warn"><b>จับคู่เลขเช็คไม่ได้ ' + plan.unmatched.length + ' แถว</b> (รายการเหล่านี้จะรอบันทึกการจ่ายเอง)<ul>' + plan.unmatched.slice(0, 8).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
        (ex ? '<div class="im-warn"><b>ระบบมี ขบ. อยู่แล้ว ' + ex + ' ใบ</b> — นำเข้าซ้ำจะได้เอกสารซ้ำและเลขไม่ตรงเลขเดิม ควรนำเข้าเฉพาะตอนระบบยังว่าง</div>' : '') +
        '<div class="im-opts"><label class="chkline"><input type="checkbox" id="imP" checked> ทะเบียนผู้รับเงิน ' + plan.payees.length + ' ราย (รวมกับของเดิม)</label>' +
        '<label class="chkline"><input type="checkbox" id="imD" checked> ขบ. (อนุมัติแล้ว) และ ขจ. ตามเลขเดิม</label>' +
        '<label class="chkline"><input type="checkbox" id="imY" checked> บันทึกการจ่าย ' + nPay + ' รายการ ตามเลขเช็ค/KTB ในเอกสาร ขจ. (วันที่จ่าย = วันที่ ขจ. · ที่เก็บ = ที่เก็บหลักของประเภทเงิน)</label></div><div id="imProg" class="hint" aria-live="polite"></div>';
      go.disabled = !plan.khbs.length && !plan.payees.length;
    }
    el.querySelector('#imFile').onchange = function () {
      var f = this.files[0]; if (!f) return;
      out.innerHTML = '<p class="hint">กำลังอ่านไฟล์…</p>'; go.disabled = true;
      var fr = new FileReader();
      fr.onload = function () {
        Importer.readWorkbook(fr.result).then(function (sheets) {
          plan = analyze(sheets, ctx());
          if (!plan) { out.innerHTML = '<p class="qe-miss">ไม่พบชีต "รายการ" ที่มีคอลัมน์ รายชื่อผู้รับ / จำนวนที่ขอเบิก — ตรวจว่าเลือกไฟล์ถูกต้อง</p>'; return; }
          show();
        }).catch(function (e) { out.innerHTML = '<p class="qe-miss">อ่านไฟล์ไม่ได้: ' + esc(e.message || String(e)) + '</p>'; });
      };
      fr.readAsArrayBuffer(f);
    };
    go.onclick = function () {
      var opt = { payees: el.querySelector('#imP').checked, docs: el.querySelector('#imD').checked, pay: el.querySelector('#imY').checked && el.querySelector('#imD').checked };
      if (S.docs && S.docs.khbs.length && opt.docs && !confirm('ระบบมี ขบ. อยู่แล้ว ' + S.docs.khbs.length + ' ใบ นำเข้าซ้ำจะซ้ำและเลขไม่ตรงเดิม — ทำต่อ?')) return;
      go.disabled = true;
      var prog = el.querySelector('#imProg');
      run(plan, function (a, p) { return api(a, p); }, opt, function (t) { prog.textContent = 'กำลังนำเข้า: ' + t; }).then(function (r) {
        return Promise.all([reloadDocs(), reloadSettings()]).then(function () {
          prog.innerHTML = '<b>นำเข้าเสร็จแล้ว</b> · ผู้รับเงิน ' + r.payees + ' · ขบ. ' + r.khbs.length + ' ใบ · ขจ. ' + r.khjs.length + ' ใบ · บันทึกการจ่าย ' + r.paid + ' รายการ' + (r.warns.length ? '<br>' + r.warns.map(esc).join('<br>') : '');
          toast('นำเข้าเสร็จแล้ว — ตรวจยอดที่หน้าภาพรวมเทียบกับ Excel', 'good'); if (S.tab === 'settings') renderSettings();
        });
      }).catch(function (e) { prog.innerHTML = '<span class="qe-miss">หยุดที่: ' + esc(e.message || String(e)) + '</span> — ส่วนที่ทำไปแล้วยังอยู่ในระบบ ตรวจที่หน้ารายจ่ายก่อนลองใหม่'; reloadDocs(); go.disabled = false; });
    };
  }

  return { parseRegister: parseRegister, parseKhjSheet: parseKhjSheet, parseRegistry: parseRegistry, buildPlan: buildPlan, run: run, readWorkbook: readWorkbook, analyze: analyze, open: open, methodOfRef: methodOfRef };
})();
if (typeof module !== 'undefined') module.exports = Importer;
