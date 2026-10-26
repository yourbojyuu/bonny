/* ระบบการเงินโรงเรียน — paste.js
   อ่านข้อมูลที่วางจาก Excel (Ctrl+V) แล้วแปลงเป็นแถวรายการ ขบ. / ใบเสร็จ / ผู้รับเงิน
   ไฟล์นี้เป็น pure function ไม่แตะหน้าจอ ทดสอบด้วย Node ได้ (test.js)
   กฎภาษีและการเทียบชื่อต้องตรงกับ Util.gs — มีเทสต์เทียบทั้งสองฝั่ง */

var Paste = (function () {
  function nt(v) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); }
  function nk(v) { return nt(v).replace(/[\s.\-_,]/g, '').toLowerCase(); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function isNum(s) { var t = nt(s).replace(/,/g, '').replace(/บาท/g, '').replace(/\s/g, ''); return t !== '' && t !== '-' && isFinite(Number(t)); }
  function num(s) { var t = nt(s).replace(/,/g, '').replace(/บาท/g, '').replace(/\s/g, ''); var n = Number(t); return isFinite(n) ? n : 0; }
  function isCompany(name) { return /บริษัท|บจก|หจก|ห้างหุ้นส่วน|จำกัด|มหาชน|การไฟฟ้า|การประปา/.test(name || ''); }

  /** ภาษีหัก ณ ที่จ่าย (ต้องตรงกับ calcTax ใน Util.gs) */
  function calcTax(taxType, gross, vat) {
    var g = Number(gross);
    if (!isFinite(g) || g <= 0) return 0;
    var base = vat ? r2(g / 1.07) : r2(g);
    if (taxType === 'ภ.ง.ด.53') return r2(base * 0.01);
    if (taxType === 'ภ.ง.ด.3') return base >= 10000 ? r2(base * 0.01) : 0;
    return 0;
  }

  /** ข้อความจาก Excel (แท็บคั่นคอลัมน์ ขึ้นบรรทัดใหม่คั่นแถว ช่องที่มีเครื่องหมายคำพูดได้) */
  function parseTSV(text) {
    var s = String(text).replace(/\r\n?/g, '\n'), rows = [], row = [], cur = '', q = false, i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (q) {
        if (ch === '"') { if (s.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
      } else if (ch === '"' && cur === '') q = true;
      else if (ch === '\t') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    row.push(cur); rows.push(row);
    return rows.filter(function (r) { return r.some(function (c) { return nt(c) !== ''; }); });
  }

  /** ข้อความ -> รหัสประเภทเงิน: รหัส/ชื่อ/ชื่อย่อ ตรงทั้งคำ · fuzzy = หัวคอลัมน์ที่มีชื่อย่ออยู่ข้างใน */
  function matchType(text, ctx, fuzzy) {
    var k = nk(text), types = ctx.types || [], aliases = ctx.aliases || [], i;
    if (!k) return '';
    for (i = 0; i < types.length; i++) if (nk(types[i][0]) === k) return types[i][0];
    for (i = 0; i < types.length; i++) if (nk(types[i][1]) === k) return types[i][0];
    for (i = 0; i < aliases.length; i++) if (nk(aliases[i][0]) === k) return aliases[i][1];
    if (!fuzzy) return '';
    var best = '', bestLen = 0;
    aliases.forEach(function (a) { var ak = nk(a[0]); if (ak.length >= 3 && k.indexOf(ak) >= 0 && ak.length > bestLen) { best = a[1]; bestLen = ak.length; } });
    types.forEach(function (t) {
      [nk(t[0]), nk(t[1])].forEach(function (tk) { if (tk.length >= 3 && k.indexOf(tk) >= 0 && tk.length > bestLen) { best = t[0]; bestLen = tk.length; } });
    });
    return best;
  }

  /* ---------- หัวคอลัมน์ ---------- */
  var KHB_HEAD = {
    type: ['ประเภทเงิน', 'ประเภท', 'รหัส', 'กองทุน'],
    payee: ['ผู้รับ', 'รายการ', 'ชื่อผู้', 'ผู้เบิก', 'ผู้ยืม', 'ร้านค้า', 'ชื่อ'],
    gross: ['รวมเป็นเงิน', 'ยอดรวม', 'จำนวนเงิน', 'ยอดเงิน'],
    net: ['ขอเบิกเงิน', 'ขอเบิก', 'จ่ายจริง'],
    tax: ['ภาษี'],
    kind: ['ชนิด'],
    method: ['วิธีจ่าย', 'วิธี']
  };
  var REC_HEAD = {
    date: ['วันที่'], book: ['เล่มที่', 'เล่ม'], no: ['เลขที่'], line: ['บรรทัด'],
    payer: ['ผู้ชำระ', 'ชื่อ'], type: ['ประเภทเงิน', 'ประเภท'], method: ['วิธีรับ', 'วิธี'], amount: ['จำนวนเงิน', 'จำนวน', 'ยอด']
  };
  function headerMap(row, spec) {
    var map = {}, hit = 0;
    row.forEach(function (c, i) {
      var t = nt(c);
      if (!t) return;
      Object.keys(spec).some(function (key) {
        if (map[key] !== undefined) return false;
        return spec[key].some(function (w) { return t === w || (t.indexOf(w) === 0 && key !== 'payee') || (key === 'payee' && t.indexOf(w) >= 0 && w !== 'ชื่อ') || (w === 'ชื่อ' && t === 'ชื่อ'); }) ? ((map[key] = i), (hit++), true) : false;
      });
    });
    return hit >= 2 ? map : null;
  }
  var KINDS = ['พัสดุ', 'เบิก', 'ค่าจ้าง', 'เงินยืม', 'ถอน'];
  var METHODS = ['เช็ค', 'KTB', 'เงินสด', 'ถอน'];
  function pickKind(t) { for (var i = 0; i < KINDS.length; i++) if (nt(t) === KINDS[i]) return KINDS[i]; return ''; }
  function pickMethod(t) {
    var k = nk(t);
    if (k === 'ktb' || k === 'โอน') return 'KTB';
    if (k === 'เช็ค') return 'เช็ค';
    if (k === 'ถอนเงินสด' || k === 'ถอน') return 'ถอน';
    if (k === 'เงินสด' || k === 'สด') return 'เงินสด';
    return '';
  }
  var METHOD_BY_KIND = { 'พัสดุ': 'เช็ค', 'เบิก': 'KTB', 'ค่าจ้าง': 'KTB', 'เงินยืม': 'KTB', 'ถอน': 'ถอน' };

  /** แถว ขบ. ที่วางมา -> รายการสำหรับฟอร์ม (ctx = {types, aliases, payees: {nk(ชื่อ): {taxType, vat, method, type}}}) */
  function khbRows(rows, ctx) {
    rows = rows.filter(function (r) { return r.some(function (c) { return nt(c) !== ''; }); });
    var hm = rows.length ? headerMap(rows[0], KHB_HEAD) : null;
    if (hm && (hm.payee === undefined)) hm = null;
    if (hm) rows = rows.slice(1);
    var lines = [], skipped = 0, newPayees = 0;
    rows.forEach(function (r) {
      var o = hm ? byHeader(r, hm) : byShape(r);
      if (!o) { skipped++; return; }
      var reg = ctx.payees ? ctx.payees[nk(o.payee)] : null;
      var type = matchType(o.type, ctx, false) || (reg && reg.type) || '';
      var kind = o.kind || '';
      var method = pickMethod(o.method) || (reg && reg.method) || '';
      if (!kind) kind = method === 'KTB' ? 'เบิก' : method === 'ถอน' ? 'ถอน' : 'พัสดุ';
      if (!method) method = METHOD_BY_KIND[kind] || 'เช็ค';
      var gross = o.gross > 0 ? o.gross : (o.net > 0 ? r2(o.net + (o.tax || 0)) : 0);
      var line = { type: type, payee: o.payee, kind: kind, method: method, gross: gross ? String(gross) : '', tax: '', taxType: 'ไม่มีภาษี', taxAuto: false, bad: [], warn: '' };
      if (reg) {
        line.taxAuto = true; line.taxType = reg.taxType;
        line.tax = r2(calcTax(reg.taxType, gross, reg.vat)) ? String(calcTax(reg.taxType, gross, reg.vat)) : '';
      } else {
        newPayees++;
        if (o.tax > 0) { line.tax = String(o.tax); line.taxType = isCompany(o.payee) ? 'ภ.ง.ด.53' : 'ภ.ง.ด.3'; }
        line.warn = 'ผู้รับใหม่ (ยังไม่อยู่ในทะเบียน) ตรวจภาษีด้วย';
      }
      if (!type) line.bad.push('type');
      if (!(gross > 0)) line.bad.push('gross');
      lines.push(line);
    });
    return { lines: lines, skipped: skipped, newPayees: newPayees, header: !!hm };
  }
  function byHeader(r, hm) {
    var g = function (k) { return hm[k] === undefined ? '' : nt(r[hm[k]]); };
    var payee = g('payee');
    if (!payee || /^รวม/.test(payee) || /บาท(ถ้วน)?\)?$/.test(payee)) return null;
    return { type: g('type'), payee: payee, kind: pickKind(g('kind')), method: g('method'),
      gross: isNum(g('gross')) ? num(g('gross')) : 0, net: isNum(g('net')) ? num(g('net')) : 0, tax: isNum(g('tax')) ? num(g('tax')) : 0 };
  }
  /** ไม่มีหัวคอลัมน์: ตามแบบ ขบ. เดิม  ที่ | ประเภทเงิน | รายการ-ชื่อ | (ว่าง) | ขอเบิก | ภาษี | รวมเป็นเงิน */
  function byShape(r) {
    var cells = r.map(nt).filter(function (c) { return c !== ''; });
    if (cells.length && /^\d{1,3}$/.test(cells[0]) && cells.length > 2) cells.shift();
    var texts = cells.filter(function (c) { return !isNum(c); }), nums = cells.filter(isNum).map(num);
    if (!texts.length || !nums.length) return null;
    if (/^(รวม|\()/.test(texts[0]) || /บาท(ถ้วน)?\)?$/.test(texts[0])) return null;
    var type = '', payee = '', kind = '', method = '', i;
    var rest = [];
    texts.forEach(function (t) {
      if (!kind && pickKind(t)) kind = pickKind(t);
      else if (!method && pickMethod(t) && texts.length > 2) method = t;
      else rest.push(t);
    });
    if (rest.length >= 2) { type = rest[0]; payee = rest[1]; } else { payee = rest[0] || ''; }
    if (!payee) return null;
    var o = { type: type, payee: payee, kind: kind, method: method, gross: 0, net: 0, tax: 0 };
    if (nums.length >= 3) { o.net = nums[0]; o.tax = nums[1]; o.gross = nums[2]; }
    else if (nums.length === 2) { o.gross = nums[0]; o.tax = nums[1]; }
    else o.gross = nums[0];
    return o;
  }


  /** ตารางแพ็กเกจรับเงิน (หัวตาราง: รวม | บกศ. | รายได้ | เงินรายได้ SMS | ... | ก/20 บัตรประจำตัว | ... | ส่วนต่าง)
      -> { cols:[{i,label,type}], rows:[{total, items:[{ci,amount}], sum}] } หรือ null (ไม่พบหัวตาราง "รวม") */
  function guessType(label, ctx) {
    var types = ctx.types || [], code = /([ก-ฮ]\/\d+)/.exec(label);
    if (code) {
      var ck = nk(code[1]);
      for (var i = 0; i < types.length; i++) if (nk(types[i][1]).indexOf(ck) >= 0 && /บกศ/.test(types[i][2] || types[i][1])) return types[i][0];
    }
    return matchType(label, ctx, true);
  }
  function packageRows(rows, ctx) {
    rows = rows.filter(function (r) { return r.some(function (c) { return nt(c) !== ''; }); });
    var hi = -1, i;
    for (i = 0; i < Math.min(rows.length, 6); i++) if (nk(rows[i][0]) === 'รวม') { hi = i; break; }
    if (hi < 0) return null;
    var cols = [];
    rows[hi].forEach(function (h, ci) {
      var label = nt(h); if (ci === 0 || !label || /^(ส่วนต่าง|หมายเหตุ|note)/i.test(label)) return;
      cols.push({ i: ci, label: label, type: guessType(label, ctx) });
    });
    var out = [];
    rows.slice(hi + 1).forEach(function (r) {
      var total = isNum(r[0]) ? num(r[0]) : 0; if (!(total > 0)) return;
      var items = [], sum = 0;
      cols.forEach(function (c, ci) { var v = isNum(r[c.i]) ? num(r[c.i]) : 0; if (v > 0) { items.push({ ci: ci, amount: v }); sum += Math.round(v * 100); } });
      out.push({ total: total, items: items, sum: sum / 100 });
    });
    return { cols: cols, rows: out };
  }

  /** ใบเสร็จที่วางมา -> [{date, book, no, line?, payer, type, method, amount}] (ส่งให้เซิร์ฟเวอร์จัดแถว/ตรวจซ้ำ) */
  function receiptRows(rows, ctx) {
    rows = rows.filter(function (r) { return r.some(function (c) { return nt(c) !== ''; }); });
    var hm = rows.length ? headerMap(rows[0], REC_HEAD) : null;
    if (hm && (hm.date === undefined || hm.no === undefined)) hm = null;
    var items = [], skipped = 0, wide = false;
    if (!hm) {
      rows.forEach(function (r) {
        var c = r.map(nt);
        if (!c[0] && !c[1] && !c[2]) { skipped++; return; }
        items.push({ date: c[0], book: c[1], no: c[2], type: c[3], method: c[4], amount: c[5], payer: c[6] || '' });
      });
      return { items: items, skipped: skipped, header: false, wide: false };
    }
    var used = {};
    Object.keys(hm).forEach(function (k) { used[hm[k]] = true; });
    var fundCols = [];
    if (hm.type === undefined && hm.amount === undefined) {
      rows[0].forEach(function (h, i) {
        if (used[i]) return;
        var t = matchType(h, ctx, true);
        if (t) fundCols.push({ col: i, type: t });
      });
      wide = fundCols.length > 0;
    }
    rows.slice(1).forEach(function (r) {
      var g = function (k) { return hm[k] === undefined ? '' : nt(r[hm[k]]); };
      var book = g('book');
      if (/ยกมา|รวม/.test(book + g('no') + g('date'))) { skipped++; return; }
      var base = { date: g('date'), book: book, no: g('no'), line: g('line'), payer: g('payer') };
      if (wide) {
        var got = 0;
        fundCols.forEach(function (f) {
          if (isNum(r[f.col]) && num(r[f.col]) > 0) {
            items.push({ date: base.date, book: base.book, no: base.no, line: '', payer: base.payer, type: f.type, method: ctx.defaultMethod || 'สด', amount: String(num(r[f.col])) });
            got++;
          }
        });
        if (!got) skipped++;
      } else {
        items.push({ date: base.date, book: base.book, no: base.no, line: base.line, payer: base.payer, type: g('type'), method: g('method') || ctx.defaultMethod || 'สด', amount: g('amount') });
      }
    });
    return { items: items, skipped: skipped, header: true, wide: wide };
  }

  /** ทะเบียนผู้รับเงิน: ชื่อ | (ภาษี ภ.ง.ด.3/53 หรือ ไม่มีภาษี) | (VAT) | (เช็ค/KTB/ถอน) | (ชื่อย่อประเภทเงิน) — ช่องใดอยู่ตรงไหนก็ได้ */
  function payeeRows(rows, ctx) {
    var out = [];
    rows.forEach(function (r, i) {
      var cells = r.map(nt).filter(function (c) { return c !== ''; });
      if (!cells.length) return;
      if (i === 0 && /^(ชื่อ|ผู้รับ|รายชื่อ)/.test(cells[0]) && cells.some(function (c) { return /ภาษี/.test(c); })) return;
      var name = cells[0], tax = '', vat = '', method = '', type = '';
      cells.slice(1).forEach(function (c) {
        var k = nk(c);
        if (/ภงด53|ภ\.?ง\.?ด\.?53/.test(k) || k === 'ภงด53') tax = 'ภ.ง.ด.53';
        else if (/^ภงด3$/.test(k)) tax = 'ภ.ง.ด.3';
        else if (k === 'ไม่มีภาษี') tax = 'ไม่มีภาษี';
        else if (k === 'vat' || k === 'มีvat' || k === 'จดvat') vat = 'ใช่';
        else if (pickMethod(c) && !method) method = pickMethod(c);
        else if (!type && matchType(c, ctx, false)) type = matchType(c, ctx, false);
      });
      out.push([name, tax || 'ไม่มีภาษี', vat || 'ไม่', method, type]);
    });
    return out;
  }

  return { parseTSV: parseTSV, calcTax: calcTax, matchType: matchType, khbRows: khbRows, receiptRows: receiptRows, packageRows: packageRows, guessType: guessType, payeeRows: payeeRows, nk: nk, isCompany: isCompany,
    RECEIPT_HEADER: ['วันที่', 'เล่มที่', 'เลขที่', 'ประเภทเงิน', 'วิธีรับ', 'จำนวน', 'ผู้ชำระ'],
    KHB_HEADER: ['ประเภทเงิน', 'ผู้รับ', 'ชนิด', 'วิธีจ่าย', 'ยอดรวม', 'ภาษี'] };
})();
