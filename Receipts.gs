/**
 * Receipts.gs — ใบเสร็จ (รายรับ) · นำเข้าแบบวางจาก Excel · ทะเบียนผู้รับเงิน · ชื่อย่อประเภทเงิน
 *
 * คีย์กันซ้ำ: ปีงบ + เล่ม + เลขที่ + บรรทัด
 * ผลการจัดแถวตอนนำเข้า: new (ใหม่) · same (ซ้ำ ข้าม) · changed (เปลี่ยน เลือกได้ว่าจะอัปเดตไหม) · error (บอกเหตุผล)
 * Ledger: รับ = บวก · วิธีรับ "สด" เข้าที่เก็บชนิดเงินสด · "โอน" เข้าที่เก็บหลักของประเภทเงิน
 */

/* ============ pure ============ */

function receiptKey(fy, book, no, line) { return fy + '|' + normKey(book) + '|' + normKey(no) + '|' + line; }

function normMethod(v) {
  var k = normKey(v);
  if (k === 'สด' || k === 'เงินสด' || k === 'cash') return 'สด';
  if (k === 'โอน' || k === 'เงินโอน' || k === 'transfer') return 'โอน';
  return '';
}

/** ที่เก็บที่เงินเข้า: สด -> ที่เก็บชนิดเงินสด · โอน -> ที่เก็บหลักของประเภทเงิน */
function receiptStore(method, typeRow, stores) {
  if (method === 'สด') {
    for (var i = 0; i < stores.length; i++) if (normText(stores[i][2]) === 'เงินสด') return normText(stores[i][0]);
    throw new Error('ยังไม่มีที่เก็บเงินชนิด "เงินสด" ในหน้าตั้งค่า');
  }
  var main = normText(typeRow[3]);
  if (!main) throw new Error('ประเภทเงิน "' + normText(typeRow[1]) + '" ยังไม่ได้ตั้งที่เก็บหลัก (ใช้รับเงินโอน)');
  return main;
}

/** แถวใบเสร็จดิบจากชีท -> เรคคอร์ดมาตรฐาน */
function readReceipt(r) {
  return { fy: toInt(r[0]), book: normText(r[1]), no: normText(r[2]), line: toInt(r[3]), date: parseDate(r[4]),
    payer: normText(r[5]), type: normText(r[6]), method: normText(r[7]), amount: round2(sheetNumber(r[8], 'จำนวน')),
    status: isCancelled(r[9]) ? 'ยกเลิก' : 'ปกติ', note: normText(r[10]) };
}
function receiptRow(x) {
  return [x.fy, x.book, x.no, x.line, x.date, x.payer, x.type, x.method, x.amount, x.status, x.note];
}
function sameReceipt(a, b) {
  return a.date === b.date && a.payer === b.payer && a.type === b.type && a.method === b.method && Math.round(a.amount * 100) === Math.round(b.amount * 100);
}

/**
 * จัดแถวนำเข้า items = [{date, book, no, line?, payer?, type, method, amount}]
 * existing = แถวดิบของชีท ใบเสร็จ · คืน [{status, msg, rec, n}] ตามลำดับเดิม
 */
function classifyReceipts(items, existingRows, types, aliases, stores, fy) {
  var ex = {}, seen = {}, autoLine = {}, out = [];
  existingRows.forEach(function (r) {
    var x = readReceipt(r);
    ex[receiptKey(x.fy, x.book, x.no, x.line)] = x;
  });
  items.forEach(function (it, i) {
    var n = i + 1, res = { n: n, status: 'error', msg: '', rec: null };
    try {
      var book = normText(it.book), no = normText(it.no);
      if (!book) throw new Error('ยังไม่ได้ระบุเล่มที่');
      if (!no) throw new Error('ยังไม่ได้ระบุเลขที่');
      var date = parseFyDate(it.date, fy, 'วันที่');
      var t = resolveTypeAlias(types, aliases, it.type);
      if (!t) throw new Error('ประเภทเงิน "' + normText(it.type) + '" ไม่ตรงกับชีทตั้งค่า (เพิ่มชื่อย่อได้ในหน้าตั้งค่า)');
      var trow = findById(types, t);
      if (!isActive(trow[4])) throw new Error('ประเภทเงิน "' + normText(trow[1]) + '" ปิดใช้งานแล้ว');
      var method = normMethod(it.method);
      if (!method) throw new Error('วิธีรับ "' + normText(it.method) + '" ต้องเป็น สด หรือ โอน');
      var amount = parseAmount(it.amount);
      receiptStore(method, trow, stores);
      var rk = normKey(book) + '|' + normKey(no);
      var line = normText(it.line) !== '' ? toInt(it.line) : (autoLine[rk] = (autoLine[rk] || 0) + 1);
      if (!(line > 0)) throw new Error('บรรทัดต้องเป็นเลขจำนวนเต็ม');
      var rec = { fy: fy, book: book, no: no, line: line, date: date, payer: normText(it.payer), type: t, method: method,
        amount: amount, status: 'ปกติ', note: '' };
      var key = receiptKey(fy, book, no, line);
      if (seen[key]) throw new Error('ซ้ำกับแถวที่ ' + seen[key] + ' ในข้อมูลที่วาง');
      seen[key] = n;
      res.rec = rec;
      var old = ex[key];
      if (!old) res.status = 'new';
      else if (old.status === 'ยกเลิก') { res.status = 'error'; res.msg = 'ใบเสร็จนี้ถูกยกเลิกไปแล้ว'; }
      else if (sameReceipt(old, rec)) { res.status = 'same'; res.msg = 'มีอยู่แล้ว ข้าม'; }
      else {
        res.status = 'changed';
        var diff = [];
        if (old.date !== rec.date) diff.push('วันที่ ' + thaiShortDate(old.date) + ' → ' + thaiShortDate(rec.date));
        if (old.type !== rec.type) diff.push('ประเภทเงิน');
        if (old.method !== rec.method) diff.push('วิธีรับ ' + old.method + ' → ' + rec.method);
        if (Math.round(old.amount * 100) !== Math.round(rec.amount * 100)) diff.push('จำนวน ' + fmtMoney(old.amount) + ' → ' + fmtMoney(rec.amount));
        if (old.payer !== rec.payer) diff.push('ผู้ชำระ');
        res.msg = 'ต่างจากที่บันทึกไว้: ' + diff.join(', ');
      }
    } catch (e) {
      res.status = 'error'; res.msg = e.message;
    }
    out.push(res);
  });
  return out;
}

/** ใบเสร็จที่ไม่ยกเลิก -> แถว Ledger (บวก) */
function buildReceiptLedger(receiptRows, types, stores) {
  var out = [];
  receiptRows.forEach(function (r, i) {
    var x;
    try {
      x = readReceipt(r);
      if (x.status === 'ยกเลิก') return;
      var trow = findById(types, x.type);
      if (!trow) throw new Error('ประเภทเงิน "' + x.type + '" ไม่ตรงกับชีทตั้งค่า');
      out.push([x.date, 'ใบเสร็จ เล่ม ' + x.book + ' เลขที่ ' + x.no, 'รับ', x.type, receiptStore(x.method, trow, stores), x.amount]);
    } catch (e) { throw new Error('ชีท ใบเสร็จ แถวที่ ' + (i + 2) + ': ' + e.message); }
  });
  return out;
}

/** ข้อมูลส่งหน้าเว็บ (อาร์เรย์สั้น ๆ ประหยัดขนาด) */
function serializeReceipts(rows) {
  return rows.map(function (r) {
    var x = readReceipt(r);
    return [x.book, x.no, x.line, x.date, x.payer, x.type, x.method, x.amount, x.status === 'ยกเลิก' ? 1 : 0, x.note];
  });
}

/** ทะเบียนผู้รับเงิน: รวมแถวใหม่เข้าของเดิม (ชื่อซ้ำ = อัปเดต) */
function mergePayees(oldRows, newRows, types, aliases) {
  var order = [], byKey = {};
  oldRows.forEach(function (r) {
    var k = normKey(r[0]);
    if (!k || byKey[k]) return;
    byKey[k] = [normText(r[0]), normText(r[1]) || 'ไม่มีภาษี', normText(r[2]) || 'ไม่', normText(r[3]), normText(r[4])];
    order.push(k);
  });
  var errors = [];
  newRows.forEach(function (r, i) {
    var name = normText(r[0]);
    if (!name) return;
    var tax = normText(r[1]) || 'ไม่มีภาษี';
    if (TAX_TYPES.indexOf(tax) < 0) { errors.push('แถวที่ ' + (i + 1) + ' (' + name + '): ภาษี "' + tax + '" ต้องเป็น ' + TAX_TYPES.join(' / ')); return; }
    var method = normText(r[3]);
    if (method && PAY_METHODS.indexOf(method) < 0) method = '';
    var type = normText(r[4]) ? resolveTypeAlias(types, aliases, r[4]) : '';
    var vat = isActive(r[2]) && normText(r[2]) !== '' && normText(r[2]) !== 'ไม่' ? 'ใช่' : 'ไม่';
    var k = normKey(name);
    if (!byKey[k]) order.push(k);
    byKey[k] = [name, tax, vat, method, type];
  });
  return { rows: order.map(function (k) { return byKey[k]; }), errors: errors };
}

/* ============ handlers ============ */

function h_getReceipts(p, io) {
  var rows = tableRows(io, 'ใบเสร็จ');
  return { fy: FISCAL_YEAR, rows: serializeReceipts(rows) };
}

function h_importReceipts(p, io) {
  if (!Array.isArray(p.items) || !p.items.length) throw new Error('ไม่มีข้อมูลใบเสร็จที่จะนำเข้า');
  if (p.items.length > 1500) throw new Error('นำเข้าครั้งละไม่เกิน 1,500 แถว กรุณาแบ่งวาง');
  var set = readSettings(io), aliases = tableRows(io, 'ชื่อย่อ'), existing = tableRows(io, 'ใบเสร็จ');
  var res = classifyReceipts(p.items, existing, set.types, aliases, set.stores, FISCAL_YEAR);
  var count = { new: 0, same: 0, changed: 0, error: 0 };
  res.forEach(function (x) { count[x.status]++; });
  var out = { count: count, committed: false, rows: res.map(function (x) {
    return { n: x.n, status: x.status, msg: x.msg, date: x.rec ? x.rec.date : '', book: x.rec ? x.rec.book : normText(p.items[x.n - 1].book),
      no: x.rec ? x.rec.no : normText(p.items[x.n - 1].no), type: x.rec ? x.rec.type : '', method: x.rec ? x.rec.method : '', amount: x.rec ? x.rec.amount : null,
      payer: x.rec ? x.rec.payer : '' };
  }) };
  if (!p.commit) return out;
  var keep = existing.slice(), idxByKey = {};
  existing.forEach(function (r, i) { var x = readReceipt(r); idxByKey[receiptKey(x.fy, x.book, x.no, x.line)] = i; });
  var add = [], upd = 0;
  res.forEach(function (x) {
    if (x.status === 'new') add.push(receiptRow(x.rec));
    else if (x.status === 'changed' && p.updateChanged) {
      keep[idxByKey[receiptKey(x.rec.fy, x.rec.book, x.rec.no, x.rec.line)]] = receiptRow(x.rec);
      upd++;
    }
  });
  if (!add.length && !upd) throw new Error('ไม่มีแถวที่บันทึกได้ (ใหม่ 0 · อัปเดต 0)');
  commitChanges(io, { 'ใบเสร็จ': keep.concat(add) });
  out.committed = true; out.added = add.length; out.updated = upd;
  return out;
}

function h_cancelReceipt(p, io) {
  var book = normText(p.book), no = normText(p.no), reason = normText(p.reason);
  if (!reason) throw new Error('กรุณาระบุเหตุผลที่ยกเลิก');
  var hit = 0;
  var rows = tableRows(io, 'ใบเสร็จ').map(function (r) {
    var x = readReceipt(r);
    if (x.fy !== FISCAL_YEAR || normKey(x.book) !== normKey(book) || normKey(x.no) !== normKey(no) || x.status === 'ยกเลิก') return r;
    hit++;
    x.status = 'ยกเลิก'; x.note = (x.note ? x.note + ' · ' : '') + 'ยกเลิก: ' + reason;
    return receiptRow(x);
  });
  if (!hit) throw new Error('ไม่พบใบเสร็จ เล่ม ' + book + ' เลขที่ ' + no + ' (หรือถูกยกเลิกไปแล้ว)');
  commitChanges(io, { 'ใบเสร็จ': rows });
  return { cancelled: hit };
}

function h_savePayees(p, io) {
  if (!Array.isArray(p.rows)) throw new Error('ไม่มีข้อมูลผู้รับเงิน');
  var set = readSettings(io), aliases = tableRows(io, 'ชื่อย่อ');
  var base = p.replace ? [] : tableRows(io, 'ผู้รับเงิน');
  var m = mergePayees(base, p.rows, set.types, aliases);
  if (m.errors.length) throw new Error(m.errors.slice(0, 5).join('; ') + (m.errors.length > 5 ? ' …อีก ' + (m.errors.length - 5) + ' แถว' : ''));
  io.write('ผู้รับเงิน', m.rows);
  return { saved: m.rows.length };
}

function h_saveAliases(p, io) {
  if (!Array.isArray(p.rows)) throw new Error('ไม่มีข้อมูลชื่อย่อ');
  var set = readSettings(io), out = [], seen = {};
  p.rows.forEach(function (r, i) {
    if (isBlankRow(r)) return;
    var a = normText(r[0]), t = resolveTypeAlias(set.types, [], r[1]);
    if (!a) throw new Error('ชื่อย่อแถวที่ ' + (i + 1) + ': ต้องมีชื่อย่อ');
    if (!t) throw new Error('ชื่อย่อ "' + a + '": ประเภทเงิน "' + normText(r[1]) + '" ไม่ตรงกับชีทตั้งค่า');
    if (seen[normKey(a)]) throw new Error('ชื่อย่อ "' + a + '" ซ้ำ');
    seen[normKey(a)] = true;
    out.push([a, t]);
  });
  io.write('ชื่อย่อ', out);
  return { saved: out.length };
}
