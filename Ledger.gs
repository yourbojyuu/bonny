/**
 * Ledger.gs — ตั้งค่า, ยอดยกมา, Ledger และยอดคงเหลือ
 * Ledger สร้างใหม่ทั้งชีทจากเอกสารต้นทางเสมอ (กฎ 1) ผ่าน commitChanges()
 */

/* ============ pure: ตรวจตั้งค่า ============ */

function validateStores(rows) {
  var out = [], ids = {}, names = {};
  rows.forEach(function (r, i) {
    if (isBlankRow(r)) return;
    var n = i + 1, id = normText(r[0]), name = normText(r[1]), kind = normText(r[2]);
    if (!id) throw new Error('ที่เก็บเงินแถวที่ ' + n + ': ต้องมีรหัส');
    if (!name) throw new Error('ที่เก็บเงินแถวที่ ' + n + ': ต้องมีชื่อ');
    if (KINDS.indexOf(kind) < 0) throw new Error('ที่เก็บเงินแถวที่ ' + n + ': ชนิด "' + kind + '" ต้องเป็น ' + KINDS.join(' / '));
    if (ids[id]) throw new Error('ที่เก็บเงิน: รหัส "' + id + '" ซ้ำ');
    if (names[name]) throw new Error('ที่เก็บเงิน: ชื่อ "' + name + '" ซ้ำ');
    ids[id] = names[name] = true;
    out.push([id, name, kind]);
  });
  return out;
}

function validateTypes(rows, stores) {
  var out = [], ids = {}, names = {};
  rows.forEach(function (r, i) {
    if (isBlankRow(r)) return;
    var n = i + 1, id = normText(r[0]), name = normText(r[1]), grp = normText(r[2]), main = normText(r[3]);
    if (!id) throw new Error('ประเภทเงินแถวที่ ' + n + ': ต้องมีรหัส');
    if (!name) throw new Error('ประเภทเงินแถวที่ ' + n + ': ต้องมีชื่อ');
    if (!grp) throw new Error('ประเภทเงินแถวที่ ' + n + ': ต้องมีกลุ่ม');
    if (ids[id]) throw new Error('ประเภทเงิน: รหัส "' + id + '" ซ้ำ');
    if (names[name]) throw new Error('ประเภทเงิน: ชื่อ "' + name + '" ซ้ำ');
    ids[id] = names[name] = true;
    if (main) main = resolveRef(stores, main, 'ที่เก็บหลัก (แถวที่ ' + n + ')');
    out.push([id, name, grp, main, isActive(r[4]) ? 'ใช่' : 'ไม่']);
  });
  return out;
}

/** รหัสที่ถูกใช้แล้ว ห้ามลบหรือเปลี่ยนรหัส */
function assertUsedIdsKept(usedIds, newRows, label) {
  var keep = {};
  newRows.forEach(function (r) { keep[r[0]] = true; });
  Object.keys(usedIds).forEach(function (id) {
    if (!keep[id]) throw new Error(label + ' "' + id + '" ถูกใช้ในเอกสารหรือ Ledger แล้ว ลบหรือเปลี่ยนรหัสไม่ได้ (ให้ปิดใช้งานแทน)');
  });
}

/* ============ pure: สร้าง Ledger ============ */

/** ยอดยกมา -> [[วันที่, เอกสารต้นทาง, ชนิด, ประเภทเงิน, ที่เก็บ, จำนวน]] */
function buildOpeningLedger(openingRows, types, stores, fy) {
  var out = [], seen = {}, date = fiscalRange(fy).start;
  openingRows.forEach(function (r, i) {
    if (isBlankRow(r)) return;
    if (Number(normText(r[0])) !== fy) return;
    try {
      var t = resolveRef(types, r[1], 'ประเภทเงิน');
      var s = resolveRef(stores, r[2], 'ที่เก็บ');
      var a = parseAmount(r[3]);
      var key = t + '|' + s;
      if (seen[key]) throw new Error('ประเภทเงินและที่เก็บซ้ำกัน');
      seen[key] = true;
      out.push([date, 'ยอดยกมา/' + fy, 'ยอดยกมา', t, s, a]);
    } catch (e) {
      throw new Error('ยอดยกมาแถวที่ ' + (i + 1) + ': ' + e.message);
    }
  });
  return out;
}

/** Ledger ทั้งหมดจากเอกสารต้นทาง (ยอดยกมา + การจ่ายที่จ่ายแล้ว) */
function buildAllLedger(src, fy) {
  var ledger = buildOpeningLedger(src.opening, src.types, src.stores, fy);
  if (src.receipts) ledger = ledger.concat(buildReceiptLedger(src.receipts, src.types, src.stores));
  if (src.docs) ledger = ledger.concat(buildPaymentLedger(src.docs, src.types, src.stores));
  ledger.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  return ledger;
}

/**
 * กฎ 5: วันที่ปิดแล้ว ยอดใน Ledger ของวันนั้นต้องไม่เปลี่ยน
 * เทียบผลรวมราย (วันที่, ประเภทเงิน, ที่เก็บ) เป็นสตางค์ ระหว่าง Ledger เดิมกับที่จะสร้างใหม่
 */
function assertClosedDaysUnchanged(oldLedger, newLedger, closedRows) {
  var closed = closedDates(closedRows);
  if (!Object.keys(closed).length) return;
  function sums(rows) {
    var m = {};
    rows.forEach(function (r) {
      var d;
      try { d = parseDate(r[0]); } catch (e) { return; }
      if (!closed[d]) return;
      var k = d + '|' + normText(r[3]) + '|' + normText(r[4]);
      m[k] = (m[k] || 0) + Math.round(sheetNumber(r[5], 'จำนวน') * 100);
    });
    return m;
  }
  var a = sums(oldLedger), b = sums(newLedger), bad = {};
  Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
    if ((a[k] || 0) !== (b[k] || 0)) bad[k.split('|')[0]] = true;
  });
  var days = Object.keys(bad).sort();
  if (days.length) {
    throw fail('CLOSED', 'วันที่ ' + days.map(thaiShortDate).join(', ') +
      ' ปิดแล้ว ห้ามบันทึกย้อน ต้องให้ admin ปลดล็อกพร้อมเหตุผลก่อน');
  }
}

/**
 * คงเหลือ(ประเภท, ที่เก็บ, วัน D) = ผลรวม Ledger ที่วันที่ <= D
 * (ยอดยกมาอยู่ใน Ledger แล้วในรูปรายการ "ยอดยกมา" จึงไม่บวกซ้ำ — กฎ 1)
 * คิดเป็นสตางค์เพื่อไม่ให้เศษทศนิยมคลาดเคลื่อน
 */
function computeBalances(ledger, types, stores, dateISO) {
  var tIdx = {}, sIdx = {};
  types.forEach(function (t, k) { tIdx[normText(t[0])] = k; });
  stores.forEach(function (s, k) { sIdx[normText(s[0])] = k; });
  var sat = types.map(function () { return stores.map(function () { return 0; }); });
  var flow = { inSat: 0, outSat: 0 };

  ledger.forEach(function (r, i) {
    var d, t, s, a;
    try {
      d = parseDate(r[0]);
      t = tIdx[resolveRef(types, r[3], 'ประเภทเงิน')];
      s = sIdx[resolveRef(stores, r[4], 'ที่เก็บ')];
      a = sheetNumber(r[5], 'จำนวน');
    } catch (e) {
      throw new Error('Ledger แถวที่ ' + (i + 2) + ': ' + e.message);
    }
    if (d <= dateISO) {
      var v = Math.round(a * 100);
      sat[t][s] += v;
      if (normText(r[2]) === 'จ่าย') flow.outSat -= v;
      else if (normText(r[2]) === 'รับ') flow.inSat += v;
    }
  });

  var shown = [], cells = [], rowSat = [], colSat = stores.map(function () { return 0; }), grandSat = 0;
  types.forEach(function (t, k) {
    var rs = 0, any = false;
    sat[k].forEach(function (v, j) { rs += v; colSat[j] += v; if (v !== 0) any = true; });
    grandSat += rs;
    if (!isActive(t[4]) && !any) return;
    shown.push({ id: normText(t[0]), name: normText(t[1]), group: normText(t[2]) });
    cells.push(sat[k].map(function (v) { return v / 100; }));
    rowSat.push(rs / 100);
  });
  return {
    date: dateISO,
    types: shown,
    stores: stores.map(function (s) { return { id: normText(s[0]), name: normText(s[1]), kind: normText(s[2]) }; }),
    cells: cells,
    rowTotals: rowSat,
    colTotals: colSat.map(function (v) { return v / 100; }),
    grand: grandSat / 100,
    paidOut: flow.outSat / 100,
    receivedIn: flow.inSat / 100
  };
}

/* ============ io: อ่านทั้งชุด / บันทึกพร้อมสร้าง Ledger ใหม่ ============ */

function readSettings(io) {
  return { stores: tableRows(io, 'ที่เก็บเงิน'), types: tableRows(io, 'ประเภทเงิน'), opening: tableRows(io, 'ยอดยกมา') };
}

/** มุมมอง io ที่ทับด้วยข้อมูลใหม่ (ยังไม่เขียนจริง) */
function overlayIO(io, changes) {
  return {
    values: function (name) {
      if (changes.hasOwnProperty(name)) return [SCHEMA[name].slice()].concat(changes[name]);
      return io.values(name);
    }
  };
}

/**
 * บันทึกการเปลี่ยนแปลง + สร้าง Ledger ใหม่ทั้งชีท
 * ตรวจครบทุกอย่างก่อนเขียน (หัวคอลัมน์ / วันที่ปิด) แล้วจึงเขียนทีเดียว
 */
function commitChanges(io, changes) {
  var fy = FISCAL_YEAR;
  var view = overlayIO(io, changes);
  var set = readSettings(view);
  var docs = loadDocs(view);
  var newLedger = buildAllLedger({ opening: set.opening, types: set.types, stores: set.stores, docs: docs, receipts: tableRows(view, 'ใบเสร็จ') }, fy);
  assertClosedDaysUnchanged(tableRows(io, 'Ledger'), newLedger, tableRows(io, 'ปิดวัน'));
  Object.keys(changes).forEach(function (name) { io.write(name, changes[name]); });
  io.write('Ledger', newLedger);
  return newLedger.length;
}

/** รหัสประเภทเงิน/ที่เก็บที่ถูกใช้ใน Ledger หรือเอกสารแล้ว */
function usedIds(io, kind) {
  var used = {};
  tableRows(io, 'Ledger').forEach(function (r) { used[normText(kind === 'type' ? r[3] : r[4])] = true; });
  if (kind === 'type') {
    tableRows(io, 'ขบ_รายการ').forEach(function (r) { used[normText(r[3])] = true; });
    tableRows(io, 'ใบเสร็จ').forEach(function (r) { used[normText(r[6])] = true; });
  }
  else tableRows(io, 'การจ่าย').forEach(function (r) { if (normText(r[7])) used[normText(r[7])] = true; });
  delete used[''];
  return used;
}

/* ============ handlers ============ */

function h_getSchema() {
  return { schema: SCHEMA, kinds: KINDS, roles: ROLES, lineKinds: LINE_KINDS, payMethods: PAY_METHODS, taxTypes: TAX_TYPES, receiptMethods: RECEIPT_METHODS };
}

function h_me(p, io, user) { return user; }

function readDocSettings(io) {
  var out = {};
  DOC_SETTING_SEED.forEach(function (r) { out[r[0]] = r[1]; });
  tableRows(io, 'ตั้งค่าเอกสาร').forEach(function (r) { if (normText(r[0])) out[normText(r[0])] = normText(r[1]); });
  return out;
}

function h_getSettings(p, io) {
  var set = readSettings(io);
  var range = fiscalRange(FISCAL_YEAR);
  var op = [];
  set.opening.forEach(function (r) {
    if (Number(normText(r[0])) === FISCAL_YEAR) op.push([softRef(set.types, r[1]), softRef(set.stores, r[2]), r[3]]);
  });
  return {
    fy: FISCAL_YEAR, fyStart: range.start, fyEnd: range.end, kinds: KINDS,
    stores: set.stores.map(function (r) { return [normText(r[0]), normText(r[1]), normText(r[2])]; }),
    types: set.types.map(function (r) {
      return [normText(r[0]), normText(r[1]), normText(r[2]), softRef(set.stores, r[3]), isActive(r[4]) ? 'ใช่' : 'ไม่'];
    }),
    opening: op,
    docSettings: readDocSettings(io),
    aliases: tableRows(io, 'ชื่อย่อ').map(function (r) { return [normText(r[0]), normText(r[1])]; }),
    payees: tableRows(io, 'ผู้รับเงิน').map(function (r) { return [normText(r[0]), normText(r[1]) || 'ไม่มีภาษี', normText(r[2]) || 'ไม่', normText(r[3]), normText(r[4])]; })
  };
}

function h_saveStores(p, io) {
  if (!Array.isArray(p.rows)) throw new Error('ไม่มีข้อมูลที่เก็บเงิน');
  var rows = validateStores(p.rows);
  assertUsedIdsKept(usedIds(io, 'store'), rows, 'ที่เก็บ');
  tableRows(io, 'ประเภทเงิน').forEach(function (t) {
    var m = normText(t[3]);
    if (m) {
      try { resolveRef(rows, m, ''); } catch (e) {
        throw new Error('ที่เก็บหลักของประเภทเงิน "' + normText(t[1]) + '" ("' + m + '") ถูกลบ กรุณาแก้ประเภทเงินก่อน');
      }
    }
  });
  io.write('ที่เก็บเงิน', rows);
  return { saved: rows.length };
}

function h_saveTypes(p, io) {
  if (!Array.isArray(p.rows)) throw new Error('ไม่มีข้อมูลประเภทเงิน');
  var rows = validateTypes(p.rows, tableRows(io, 'ที่เก็บเงิน'));
  assertUsedIdsKept(usedIds(io, 'type'), rows, 'ประเภทเงิน');
  io.write('ประเภทเงิน', rows);
  return { saved: rows.length };
}

function h_saveOpening(p, io) {
  if (!Array.isArray(p.rows)) throw new Error('ไม่มีข้อมูลยอดยกมา');
  var set = readSettings(io);
  var mine = p.rows.map(function (r) { return [FISCAL_YEAR, r[0], r[1], r[2]]; });
  var ledger = buildOpeningLedger(mine, set.types, set.stores, FISCAL_YEAR);
  var other = set.opening.filter(function (r) { return Number(normText(r[0])) !== FISCAL_YEAR; });
  var rows = other.concat(ledger.map(function (r) { return [FISCAL_YEAR, r[3], r[4], r[5]]; }));
  commitChanges(io, { 'ยอดยกมา': rows });
  return { saved: ledger.length };
}

function h_rebuildLedger(p, io) {
  return { rows: commitChanges(io, {}) };
}

function h_saveDocSettings(p, io) {
  if (!p.values || typeof p.values !== 'object') throw new Error('ไม่มีข้อมูลตั้งค่าเอกสาร');
  var rows = DOC_SETTING_SEED.map(function (r) {
    var v = p.values.hasOwnProperty(r[0]) ? normText(p.values[r[0]]) : r[1];
    return [r[0], v];
  });
  io.write('ตั้งค่าเอกสาร', rows);
  return { saved: rows.length };
}

function h_getBalances(p, io) {
  var iso = parseFyDate(p.date, FISCAL_YEAR, 'วันที่');
  var set = readSettings(io);
  var ledger = tableRows(io, 'Ledger');
  var res = computeBalances(ledger, set.types, set.stores, iso);
  res.ledgerRows = ledger.length;
  return res;
}
