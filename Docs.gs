/**
 * Docs.gs — เอกสารขอเบิก (ขบ.) → เอกสารขอจ่าย (ขจ.) → การจ่าย
 *
 * โครงความเชื่อมโยง (จุดเดียวที่ถือความจริง):
 *   ขบ (หัวเอกสาร) 1 ─ n ขบ_รายการ (ผู้รับแต่ละราย)
 *   ขจ (หัวเอกสาร) 1 ─ n การจ่าย 1 ─ 1 ขบ_รายการ
 *   แถว "การจ่าย" คือเส้นเชื่อม ขบ.รายการ → ขจ. และเก็บเลขเช็ค/KTB + วันที่จ่ายจริง
 *   รายการหนึ่งอยู่ใน ขจ. ที่ยังไม่ยกเลิกได้ใบเดียว · ยอดคงเหลือลดเมื่อมี "วันที่จ่าย" เท่านั้น
 *
 * สถานะรายการ: รอจ่าย (ยังไม่อยู่ใน ขจ.) → อยู่ใน ขจ. (รอเลขเช็ค/วันที่จ่าย) → จ่ายแล้ว
 * การยกเลิกใช้ช่อง "สถานะ" ทางเดียว (กฎ 6)
 */

var LINE_STATE = { WAIT: 'รอจ่าย', IN_KHJ: 'อยู่ใน ขจ.', PAID: 'จ่ายแล้ว', CANCEL: 'ยกเลิก' };

/* ============ pure ============ */

function docKey(fy, no) { return fy + '/' + no; }
function lineKey(fy, no, seq) { return fy + '/' + no + '/' + seq; }

function nextNo(rows, fy) {
  var max = 0;
  rows.forEach(function (r) {
    if (toInt(r[0]) !== fy) return;
    var n = toInt(r[1]);
    if (n > max) max = n;
  });
  return max + 1;
}

/** ตรวจรายการใน ขบ. -> แถวมาตรฐาน (ลำดับ 1..n) */
function validateKhbLines(lines, types, registry) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('ขบ. ต้องมีอย่างน้อย 1 รายการ');
  var out = [];
  lines.forEach(function (l, i) {
    var n = i + 1;
    try {
      var t = resolveRef(types, l.type, 'ประเภทเงิน');
      if (!isActive(findById(types, t)[4])) throw new Error('ประเภทเงิน "' + normText(l.type) + '" ปิดใช้งานแล้ว');
      var payee = normText(l.payee);
      if (!payee) throw new Error('ยังไม่ได้กรอกชื่อผู้รับ');
      var kind = normText(l.kind);
      if (LINE_KINDS.indexOf(kind) < 0) throw new Error('ชนิด "' + kind + '" ต้องเป็น ' + LINE_KINDS.join(' / '));
      var method = normText(l.method);
      if (PAY_METHODS.indexOf(method) < 0) throw new Error('วิธีจ่าย "' + method + '" ต้องเป็น ' + PAY_METHODS.join(' / '));
      var gross = parseAmount(l.gross);
      var taxType = normText(l.taxType) || 'ไม่มีภาษี';
      var tax;
      var reg = registry ? registry[normKey(payee)] : null;
      if (l.taxAuto && reg) { taxType = reg.taxType; tax = calcTax(taxType, gross, reg.vat); } // ภาษีตามประเภทผู้รับในทะเบียน
      else tax = parseMoney0(l.tax);
      if (TAX_TYPES.indexOf(taxType) < 0) throw new Error('ประเภทภาษี "' + taxType + '" ต้องเป็น ' + TAX_TYPES.join(' / '));
      var auto = !!(l.taxAuto && reg);
      if (tax >= gross) throw new Error('ภาษีต้องน้อยกว่ายอดรวม');
      if (tax > 0 && taxType === 'ไม่มีภาษี') throw new Error('มีภาษีหัก ต้องเลือกประเภทภาษี (ภ.ง.ด.3 หรือ ภ.ง.ด.53)');
      if (tax === 0 && taxType !== 'ไม่มีภาษี' && !auto) throw new Error('เลือก ' + taxType + ' แต่ภาษีเป็น 0'); // อัตโนมัติ: ภ.ง.ด.3 ต่ำกว่า 10,000 ภาษี 0 ได้
      out.push({ seq: n, type: t, payee: payee, kind: kind, method: method, gross: gross, tax: tax, taxType: taxType });
    } catch (e) {
      throw new Error('รายการที่ ' + n + ': ' + e.message);
    }
  });
  return out;
}

/** ภาษีหัก ณ ที่จ่าย: อัตรา% ของฐานก่อน VAT (มี VAT = ยอดรวม/1.07) */
function calcWithholding(gross, ratePct, hasVat) {
  var base = hasVat ? gross / 1.07 : gross;
  return round2(base * ratePct / 100);
}

/** อ่านดิบทั้ง 4 ชีทเอกสาร */
function loadDocs(io) {
  return {
    khb: tableRows(io, 'ขบ'), lines: tableRows(io, 'ขบ_รายการ'),
    khj: tableRows(io, 'ขจ'), pays: tableRows(io, 'การจ่าย')
  };
}

/** สร้างดัชนีความเชื่อมโยงทั้งหมด (ตรวจความสอดคล้องไปด้วย) */
function buildDocIndex(raw) {
  var khbs = {}, khjs = {}, lines = {}, order = [], jorder = [];
  raw.khb.forEach(function (r, i) {
    var fy = toInt(r[0]), no = toInt(r[1]);
    if (!(fy > 0 && no > 0)) throw new Error('ชีท ขบ แถวที่ ' + (i + 2) + ': ปีงบ/เลข ขบ. ไม่ถูกต้อง');
    var k = docKey(fy, no);
    if (khbs[k]) throw new Error('ชีท ขบ: เลข ขบ.' + no + '/' + fy + ' ซ้ำ');
    khbs[k] = { fy: fy, no: no, date: parseDate(r[2]), note: normText(r[3]), by: normText(r[4]), at: normText(r[5]),
      status: isCancelled(r[6]) ? 'ยกเลิก' : 'ปกติ', lines: [] };
    order.push(k);
  });
  raw.lines.forEach(function (r, i) {
    var fy = toInt(r[0]), no = toInt(r[1]), seq = toInt(r[2]);
    var h = khbs[docKey(fy, no)];
    if (!h) throw new Error('ชีท ขบ_รายการ แถวที่ ' + (i + 2) + ': ไม่พบ ขบ.' + normText(r[1]) + '/' + normText(r[0]));
    var gross = sheetNumber(r[7], 'ยอดรวม'), tax = normText(r[8]) === '' ? 0 : sheetNumber(r[8], 'ภาษี');
    var l = { fy: fy, no: no, seq: seq, type: normText(r[3]), payee: normText(r[4]), kind: normText(r[5]),
      method: normText(r[6]), gross: round2(gross), tax: round2(tax), taxType: normText(r[9]) || 'ไม่มีภาษี',
      net: round2(gross - tax), pay: null };
    var lk = lineKey(fy, no, seq);
    if (lines[lk]) throw new Error('ชีท ขบ_รายการ: ขบ.' + no + '/' + fy + ' ลำดับ ' + seq + ' ซ้ำ');
    lines[lk] = l;
    h.lines.push(l);
  });
  raw.khj.forEach(function (r, i) {
    var fy = toInt(r[0]), no = toInt(r[1]);
    if (!(fy > 0 && no > 0)) throw new Error('ชีท ขจ แถวที่ ' + (i + 2) + ': ปีงบ/เลข ขจ. ไม่ถูกต้อง');
    var k = docKey(fy, no);
    if (khjs[k]) throw new Error('ชีท ขจ: เลข ขจ.' + no + '/' + fy + ' ซ้ำ');
    khjs[k] = { fy: fy, no: no, date: parseDate(r[2]), note: normText(r[3]), by: normText(r[4]), at: normText(r[5]),
      status: isCancelled(r[6]) ? 'ยกเลิก' : 'ปกติ', items: [] };
    jorder.push(k);
  });
  raw.pays.forEach(function (r, i) {
    var n = i + 2;
    var p = { fy: toInt(r[0]), no: toInt(r[1]), khbFy: toInt(r[2]), khbNo: toInt(r[3]), seq: toInt(r[4]),
      method: normText(r[5]), ref: normText(r[6]), store: normText(r[7]),
      amount: round2(sheetNumber(r[8], 'จำนวนจ่าย')), date: normText(r[9]) ? parseDate(r[9]) : '',
      status: isCancelled(r[10]) ? 'ยกเลิก' : 'ปกติ', row: i };
    var j = khjs[docKey(p.fy, p.no)];
    if (!j) throw new Error('ชีท การจ่าย แถวที่ ' + n + ': ไม่พบ ขจ.' + p.no + '/' + p.fy);
    var l = lines[lineKey(p.khbFy, p.khbNo, p.seq)];
    if (!l) throw new Error('ชีท การจ่าย แถวที่ ' + n + ': ไม่พบรายการ ขบ.' + p.khbNo + '/' + p.khbFy + ' ลำดับ ' + p.seq);
    if (p.status === 'ยกเลิก' || j.status === 'ยกเลิก') return;
    if (l.pay) throw new Error('ขบ.' + p.khbNo + '/' + p.khbFy + ' ลำดับ ' + p.seq + ' ถูกผูกกับ ขจ. 2 ใบ (ขจ.' + l.pay.no + ' และ ขจ.' + p.no + ')');
    p.line = l;
    l.pay = p;
    j.items.push(p);
  });
  order.forEach(function (k) {
    var h = khbs[k];
    h.lines.sort(function (a, b) { return a.seq - b.seq; });
    h.lines.forEach(function (l) {
      l.state = h.status === 'ยกเลิก' ? LINE_STATE.CANCEL : !l.pay ? LINE_STATE.WAIT : l.pay.date ? LINE_STATE.PAID : LINE_STATE.IN_KHJ;
    });
  });
  return { khbs: khbs, khjs: khjs, lines: lines, order: order, jorder: jorder };
}

/** การจ่ายที่มีวันที่จ่ายแล้ว -> แถว Ledger (ติดลบ) */
function buildPaymentLedger(raw, types, stores) {
  var idx = buildDocIndex(raw), out = [];
  idx.jorder.forEach(function (k) {
    var j = idx.khjs[k];
    j.items.forEach(function (p) {
      if (!p.date) return;
      var where = 'ขจ.' + j.no + '/' + j.fy + ' (ขบ.' + p.khbNo + ' ลำดับ ' + p.seq + ')';
      var t, s;
      try {
        t = resolveRef(types, p.line.type, 'ประเภทเงิน');
        s = resolveRef(stores, p.store, 'ที่เก็บ');
      } catch (e) { throw new Error(where + ': ' + e.message); }
      out.push([p.date, where, 'จ่าย', t, s, -p.amount]);
    });
  });
  return out;
}

/** ขบ. หลายใบ -> "ขบ.1-2/70 ลงวันที่ 8 ต.ค. 69 และ ขบ.4/70 ลงวันที่ 22 ต.ค. 69" */
function khbRefText(heads) {
  if (!heads.length) return 'ตามบันทึกข้อความเลขที่ ..................';
  var groups = [];
  heads.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.no - b.no; }).forEach(function (h) {
    var g = groups[groups.length - 1];
    if (!g || g.date !== h.date) { g = { date: h.date, items: [] }; groups.push(g); }
    g.items.push(h);
  });
  var parts = groups.map(function (g) {
    var runs = [];
    g.items.forEach(function (h) {
      var r = runs[runs.length - 1];
      if (r && r.fy === h.fy && h.no === r.b + 1) r.b = h.no; else runs.push({ a: h.no, b: h.no, fy: h.fy });
    });
    return runs.map(function (r) {
      return 'ขบ.' + r.a + (r.b !== r.a ? '-' + r.b : '') + '/' + String(r.fy).slice(-2);
    }).join(', ') + ' ลงวันที่ ' + thaiShortDate(g.date);
  });
  var text = parts.length <= 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' และ ' + parts[parts.length - 1];
  return 'ตามบันทึกข้อความเลขที่ ' + text;
}

function signersOf(ds, prefix) {
  var out = [];
  for (var i = 1; i <= 4; i++) out.push({ name: ds[prefix + '_ลงนาม' + i + '_ชื่อ'] || '', pos: ds[prefix + '_ลงนาม' + i + '_ตำแหน่ง'] || '' });
  return out;
}

function typeName(types, id) { var t = findById(types, id); return t ? normText(t[1]) : id; }
function typeGroup(types, id) { var t = findById(types, id); return t ? normText(t[2]) : 'อื่น ๆ'; }

/** ข้อมูลสำหรับพิมพ์ ขบ. (ยอดรวมคำนวณโดยระบบ ไม่ใช้สูตร Excel) */
function buildKhbDoc(h, ds, types) {
  var rows = h.lines.map(function (l, i) {
    return { i: i + 1, type: typeName(types, l.type), payee: l.payee, net: l.net, tax: l.tax, gross: l.gross };
  });
  var tot = { net: 0, tax: 0, gross: 0 };
  h.lines.forEach(function (l) {
    tot.net += Math.round(l.net * 100); tot.tax += Math.round(l.tax * 100); tot.gross += Math.round(l.gross * 100);
  });
  tot = { net: tot.net / 100, tax: tot.tax / 100, gross: tot.gross / 100 };
  return {
    kind: 'ขบ', cancelled: h.status === 'ยกเลิก',
    org: ds['ส่วนราชการ'], noText: 'ขบ.' + h.no + '/' + h.fy, dateLong: thaiLongDate(h.date),
    subject: 'ขออนุมัติเบิกเงิน', to: ds['เรียน'],
    paras: ['ด้วย ' + ds['ผู้เสนอ'] + ' ได้ตรวจสอบเอกสารและหลักฐานการเบิกเงิน จำนวน ' + rows.length + ' รายการ',
      'โดยงานการเงิน ได้ตรวจสอบเอกสารแล้วถูกต้องครบถ้วน จึงขออนุมัติเบิกเงินตามรายละเอียด ดังนี้'],
    rows: rows, total: tot, totalText: bahtText(tot.gross),
    signers: signersOf(ds, 'ขบ'), director: { name: ds['ผอ_ชื่อ'], pos: ds['ผอ_ตำแหน่ง'] }
  };
}

function payRefText(p) {
  if (p.method === 'ถอน') return 'ถอนเงินจากบัญชี';
  if (p.method === 'เงินสด') return p.ref || 'เงินสด';
  return p.ref;
}

/** ข้อมูลสำหรับพิมพ์ ขจ. แบ่งตามกลุ่มเงิน */
function buildKhjDoc(j, idx, ds, types) {
  var groupOrder = [];
  types.forEach(function (t) { var g = normText(t[2]); if (groupOrder.indexOf(g) < 0) groupOrder.push(g); });
  var byGroup = {};
  j.items.forEach(function (p) {
    var g = typeGroup(types, p.line.type);
    (byGroup[g] = byGroup[g] || []).push(p);
  });
  var rank = { 'เช็ค': 0, 'KTB': 1, 'ถอน': 2, 'เงินสด': 3 };
  var sections = [], grandSat = 0;
  groupOrder.concat(Object.keys(byGroup).filter(function (g) { return groupOrder.indexOf(g) < 0; })).forEach(function (g) {
    var items = byGroup[g];
    if (!items) return;
    items.sort(function (a, b) {
      return (rank[a.method] - rank[b.method]) || String(a.ref).localeCompare(String(b.ref), 'en', { numeric: true }) ||
        (a.khbNo - b.khbNo) || (a.seq - b.seq);
    });
    var sat = 0;
    var rows = items.map(function (p, i) {
      sat += Math.round(p.amount * 100);
      return { i: i + 1, ref: payRefText(p), payee: p.line.payee, amount: p.amount,
        note: p.method === 'KTB' ? 'จ่ายผ่าน KTB' : '', khb: 'ขบ.' + p.khbNo + '/' + p.khbFy + '-' + p.seq };
    });
    grandSat += sat;
    sections.push({ title: g, rows: rows, total: sat / 100, totalText: bahtText(sat / 100) });
  });
  var heads = [], seen = {};
  j.items.forEach(function (p) {
    var k = docKey(p.khbFy, p.khbNo);
    if (!seen[k]) { seen[k] = true; heads.push(idx.khbs[k]); }
  });
  var grand = grandSat / 100;
  return {
    kind: 'ขจ', cancelled: j.status === 'ยกเลิก',
    org: ds['ส่วนราชการ'], noText: 'ขจ.' + j.no + '/' + j.fy, dateLong: thaiLongDate(j.date),
    subject: 'ขออนุมัติจ่ายเงิน', to: ds['เรียน'],
    paras: ['ด้วย ' + ds['ผู้เสนอ'] + ' ได้ขออนุมัติเบิกเงิน ' + khbRefText(heads) +
      ' เป็นจำนวนเงินทั้งสิ้น ' + fmtMoney(grand) + ' บาท งานการเงินขออนุมัติจ่ายเงิน ตามรายละเอียด ดังนี้'],
    sections: sections, grand: grand, grandText: bahtText(grand),
    signers: signersOf(ds, 'ขจ'), director: { name: ds['ผอ_ชื่อ'], pos: ds['ผอ_ตำแหน่ง'] }
  };
}

/** ส่งให้หน้าเว็บ */
function serializeDocs(idx) {
  var khbs = idx.order.map(function (k) {
    var h = idx.khbs[k], tot = { gross: 0, tax: 0, net: 0 }, counts = {};
    var lines = h.lines.map(function (l) {
      tot.gross += Math.round(l.gross * 100); tot.tax += Math.round(l.tax * 100); tot.net += Math.round(l.net * 100);
      counts[l.state] = (counts[l.state] || 0) + 1;
      return { seq: l.seq, type: l.type, payee: l.payee, kind: l.kind, method: l.method, gross: l.gross, tax: l.tax,
        taxType: l.taxType, net: l.net, state: l.state,
        khjFy: l.pay ? l.pay.fy : null, khjNo: l.pay ? l.pay.no : null, ref: l.pay ? l.pay.ref : '', paidDate: l.pay ? l.pay.date : '',
        payMethod: l.pay ? l.pay.method : '', store: l.pay ? l.pay.store : '' };
    });
    return { fy: h.fy, no: h.no, date: h.date, note: h.note, by: h.by, status: h.status, lines: lines,
      total: { gross: tot.gross / 100, tax: tot.tax / 100, net: tot.net / 100 }, counts: counts };
  });
  var khjs = idx.jorder.map(function (k) {
    var j = idx.khjs[k], sat = 0, paid = 0;
    var items = j.items.map(function (p) {
      sat += Math.round(p.amount * 100);
      if (p.date) paid++;
      return { khbFy: p.khbFy, khbNo: p.khbNo, seq: p.seq, type: p.line.type, payee: p.line.payee, method: p.method,
        ref: p.ref, store: p.store, amount: p.amount, date: p.date };
    });
    return { fy: j.fy, no: j.no, date: j.date, note: j.note, by: j.by, status: j.status, items: items,
      total: sat / 100, paid: paid, count: items.length };
  });
  khbs.reverse(); khjs.reverse();
  return { khbs: khbs, khjs: khjs };
}

/* ============ handlers ============ */

function docsContext(io) {
  var set = readSettings(io);
  var raw = loadDocs(io);
  return { set: set, raw: raw, idx: buildDocIndex(raw), closed: tableRows(io, 'ปิดวัน') };
}

function stamp() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function assertOpenDay(closedRows, iso) {
  if (isDateClosed(closedRows, iso)) {
    throw fail('CLOSED', 'วันที่ ' + thaiShortDate(iso) + ' ปิดแล้ว ห้ามบันทึกย้อน ต้องให้ admin ปลดล็อกพร้อมเหตุผลก่อน');
  }
}

function getKhb(ctx, no) {
  var h = ctx.idx.khbs[docKey(FISCAL_YEAR, toInt(no))];
  if (!h) throw new Error('ไม่พบ ขบ.' + normText(no) + '/' + FISCAL_YEAR);
  return h;
}

function getKhj(ctx, no) {
  var j = ctx.idx.khjs[docKey(FISCAL_YEAR, toInt(no))];
  if (!j) throw new Error('ไม่พบ ขจ.' + normText(no) + '/' + FISCAL_YEAR);
  return j;
}

function h_getDocs(p, io) {
  var ctx = docsContext(io);
  var out = serializeDocs(ctx.idx);
  var payees = {};
  ctx.raw.lines.forEach(function (r) { var n = normText(r[4]); if (n) payees[n] = true; });
  tableRows(io, 'ผู้รับเงิน').forEach(function (r) { var n = normText(r[0]); if (n) payees[n] = true; });
  out.payees = Object.keys(payees).sort(function (a, b) { return a.localeCompare(b, 'th'); });
  out.fy = FISCAL_YEAR;
  return out;
}

function h_saveKhb(p, io, user) {
  var fy = FISCAL_YEAR, ctx = docsContext(io);
  var date = parseFyDate(p.date, fy, 'วันที่ ขบ.');
  assertOpenDay(ctx.closed, date);
  var registryRows = tableRows(io, 'ผู้รับเงิน');
  var lines = validateKhbLines(p.lines, ctx.set.types, payeeMap(registryRows));
  var no, head = ctx.raw.khb;
  if (p.no) {
    var h = getKhb(ctx, p.no);
    if (h.status === 'ยกเลิก') throw new Error('ขบ.' + h.no + ' ถูกยกเลิกแล้ว แก้ไขไม่ได้');
    var linked = h.lines.filter(function (l) { return l.pay; });
    if (linked.length) throw new Error('ขบ.' + h.no + ' มีรายการอยู่ใน ขจ. แล้ว ' + linked.length + ' รายการ แก้ไขไม่ได้ (ยกเลิก ขจ. นั้นก่อน)');
    assertOpenDay(ctx.closed, h.date);
    no = h.no;
    head = head.map(function (r) {
      if (toInt(r[0]) === fy && toInt(r[1]) === no) return [fy, no, date, normText(p.note), user.email, stamp(), 'ปกติ'];
      return r;
    });
  } else {
    no = nextNo(head, fy);
    head = head.concat([[fy, no, date, normText(p.note), user.email, stamp(), 'ปกติ']]);
  }
  var rows = ctx.raw.lines.filter(function (r) { return !(toInt(r[0]) === fy && toInt(r[1]) === no); })
    .concat(lines.map(function (l) { return [fy, no, l.seq, l.type, l.payee, l.kind, l.method, l.gross, l.tax, l.taxType]; }));
  var known = payeeMap(registryRows), learn = registryRows.slice();
  lines.forEach(function (l) {
    var k = normKey(l.payee);
    if (known[k]) return;
    known[k] = true;
    learn.push([l.payee, l.taxType, guessVat(l.taxType, l.gross, l.tax) ? 'ใช่' : 'ไม่', l.method, l.type]); // จำผู้รับใหม่ไว้ใช้ครั้งถัดไป
  });
  commitChanges(io, { 'ขบ': head, 'ขบ_รายการ': rows, 'ผู้รับเงิน': learn });
  return { fy: fy, no: no };
}

function h_cancelKhb(p, io, user) {
  var ctx = docsContext(io), h = getKhb(ctx, p.no), reason = normText(p.reason);
  if (!reason) throw new Error('กรุณาระบุเหตุผลที่ยกเลิก');
  if (h.status === 'ยกเลิก') throw new Error('ขบ.' + h.no + ' ถูกยกเลิกไปแล้ว');
  if (h.lines.some(function (l) { return l.pay; })) throw new Error('ขบ.' + h.no + ' มีรายการอยู่ใน ขจ. แล้ว ยกเลิกไม่ได้ (ยกเลิก ขจ. นั้นก่อน)');
  var head = ctx.raw.khb.map(function (r) {
    if (toInt(r[0]) !== h.fy || toInt(r[1]) !== h.no) return r;
    return [r[0], r[1], r[2], (normText(r[3]) ? normText(r[3]) + ' · ' : '') + 'ยกเลิก: ' + reason, user.email, stamp(), 'ยกเลิก'];
  });
  commitChanges(io, { 'ขบ': head });
  return { no: h.no };
}

function h_createKhj(p, io, user) {
  var fy = FISCAL_YEAR, ctx = docsContext(io);
  var date = parseFyDate(p.date, fy, 'วันที่ ขจ.');
  assertOpenDay(ctx.closed, date);
  if (!Array.isArray(p.items) || !p.items.length) throw new Error('ยังไม่ได้เลือกรายการที่จะจ่าย');
  var seen = {}, no = nextNo(ctx.raw.khj, fy), rows = [];
  p.items.forEach(function (it) {
    var lk = lineKey(toInt(it.fy), toInt(it.no), toInt(it.seq));
    var l = ctx.idx.lines[lk], label = 'ขบ.' + normText(it.no) + ' ลำดับ ' + normText(it.seq);
    if (!l) throw new Error('ไม่พบ ' + label);
    if (seen[lk]) throw new Error(label + ' ถูกเลือกซ้ำ');
    seen[lk] = true;
    var h = ctx.idx.khbs[docKey(l.fy, l.no)];
    if (h.status === 'ยกเลิก') throw new Error(label + ': ขบ. ถูกยกเลิกแล้ว');
    if (l.pay) throw new Error(label + ' อยู่ใน ขจ.' + l.pay.no + ' แล้ว');
    if (h.date > date) throw new Error(label + ': วันที่ ขจ. ต้องไม่ก่อนวันที่ ขบ. (' + thaiShortDate(h.date) + ')');
    var t = findById(ctx.set.types, l.type);
    rows.push([fy, no, l.fy, l.no, l.seq, l.method, '', t ? normText(t[3]) : '', l.net, '', 'ปกติ']);
  });
  commitChanges(io, {
    'ขจ': ctx.raw.khj.concat([[fy, no, date, normText(p.note), user.email, stamp(), 'ปกติ']]),
    'การจ่าย': ctx.raw.pays.concat(rows)
  });
  return { fy: fy, no: no, count: rows.length };
}

function h_savePayments(p, io) {
  var ctx = docsContext(io), j = getKhj(ctx, p.no);
  if (j.status === 'ยกเลิก') throw new Error('ขจ.' + j.no + ' ถูกยกเลิกแล้ว');
  if (!Array.isArray(p.rows) || !p.rows.length) throw new Error('ไม่มีข้อมูลการจ่าย');
  var byKey = {};
  j.items.forEach(function (it) { byKey[lineKey(it.khbFy, it.khbNo, it.seq)] = it; });
  var upd = {}, paid = 0;
  p.rows.forEach(function (r) {
    var it = byKey[lineKey(toInt(r.khbFy), toInt(r.khbNo), toInt(r.seq))];
    var label = 'ขบ.' + normText(r.khbNo) + ' ลำดับ ' + normText(r.seq);
    if (!it) throw new Error(label + ' ไม่อยู่ใน ขจ.' + j.no);
    try {
      var method = normText(r.method);
      if (PAY_METHODS.indexOf(method) < 0) throw new Error('วิธีจ่าย "' + method + '" ต้องเป็น ' + PAY_METHODS.join(' / '));
      var ref = normText(r.ref).replace(/\s+/g, '');
      var date = normText(r.date) ? parseFyDate(r.date, FISCAL_YEAR, 'วันที่จ่าย') : '';
      var store = normText(r.store) ? resolveRef(ctx.set.stores, r.store, 'ที่เก็บ') : '';
      if (date) {
        if (date < j.date) throw new Error('วันที่จ่ายต้องไม่ก่อนวันที่ ขจ. (' + thaiShortDate(j.date) + ')');
        if (!store) throw new Error('ต้องเลือกที่เก็บเงินที่จ่ายออก');
        if ((method === 'เช็ค' || method === 'KTB') && !ref) throw new Error('จ่ายด้วย' + method + ' ต้องกรอกเลขที่อ้างอิง');
        paid++;
      }
      upd[it.row] = [it.fy, it.no, it.khbFy, it.khbNo, it.seq, method, ref, store, it.amount, date, 'ปกติ'];
    } catch (e) { throw new Error(label + ': ' + e.message); }
  });
  var rows = ctx.raw.pays.map(function (r, i) { return upd.hasOwnProperty(i) ? upd[i] : r; });
  commitChanges(io, { 'การจ่าย': rows });
  return { saved: Object.keys(upd).length, paid: paid };
}

function h_cancelKhj(p, io, user) {
  var ctx = docsContext(io), j = getKhj(ctx, p.no), reason = normText(p.reason);
  if (!reason) throw new Error('กรุณาระบุเหตุผลที่ยกเลิก');
  if (j.status === 'ยกเลิก') throw new Error('ขจ.' + j.no + ' ถูกยกเลิกไปแล้ว');
  var head = ctx.raw.khj.map(function (r) {
    if (toInt(r[0]) !== j.fy || toInt(r[1]) !== j.no) return r;
    return [r[0], r[1], r[2], (normText(r[3]) ? normText(r[3]) + ' · ' : '') + 'ยกเลิก: ' + reason, user.email, stamp(), 'ยกเลิก'];
  });
  var pays = ctx.raw.pays.map(function (r) {
    if (toInt(r[0]) !== j.fy || toInt(r[1]) !== j.no) return r;
    var x = r.slice(); x[10] = 'ยกเลิก'; return x;
  });
  commitChanges(io, { 'ขจ': head, 'การจ่าย': pays });
  return { no: j.no };
}

function h_khbDoc(p, io) {
  var ctx = docsContext(io);
  return buildKhbDoc(getKhb(ctx, p.no), readDocSettings(io), ctx.set.types);
}

function h_khjDoc(p, io) {
  var ctx = docsContext(io);
  return buildKhjDoc(getKhj(ctx, p.no), ctx.idx, readDocSettings(io), ctx.set.types);
}
