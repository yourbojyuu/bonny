/**
 * Cheques.gs — ทะเบียนคุมเช็ค (เช็คอุดหนุน / บกศ. / รายได้) ตรวจว่าเช็คใบไหนยังค้างอยู่
 *
 * หลักการ (ไม่มีตัวเลขสองชุด):
 *   - "เช็คที่ออก" = รายการจ่ายใน ขจ. ที่วิธีจ่าย "เช็ค" และระบุเลขเช็ค + วันที่จ่ายแล้ว (ชีท การจ่าย)
 *     รายการที่เลขเช็ค + ที่เก็บเงินเดียวกัน รวมเป็นเช็ค 1 ใบ · กลุ่มเงิน (อุดหนุน/บกศ./รายได้) ดูจากประเภทเงินของรายการ
 *   - "ขึ้นเงินแล้ว" = มีแถวในชีท "เช็คขึ้นเงิน" (ข้อมูลที่การเงินวางมาจากธนาคาร/ทะเบียน) · ไม่มี = ค้าง
 *   - ไม่แตะ Ledger: เงินออกจากบัญชีตั้งแต่วันที่จ่ายแล้ว การขึ้นเงินเป็นแค่การติดตามเช็ค
 *   - ยกเลิกการขึ้นเงินทางเดียวคือคอลัมน์ สถานะ (เช็คกลับเป็นค้าง)
 */
var CHEQUE_SHEET = 'เช็คขึ้นเงิน';
var CHEQUE_GROUPS = ['อุดหนุน', 'บกศ.', 'รายได้', 'อื่น ๆ'];

function chequeGroupOf(g) {
  g = normText(g);
  return g !== 'อื่น ๆ' && CHEQUE_GROUPS.indexOf(g) >= 0 ? g : 'อื่น ๆ';
}
/** เลขเช็คสำหรับเทียบ: ตัดช่องว่างและเลข 0 นำหน้า */
function chequeNoKey(s) { return normText(s).replace(/\s+/g, '').replace(/^0+(?=\d)/, ''); }

/** แถวในชีท เช็คขึ้นเงิน -> อ็อบเจ็กต์ (ชีทหายไป = ยังไม่มีข้อมูลขึ้นเงิน) */
function readClears(io) {
  if (!io.values(CHEQUE_SHEET)) return [];
  return tableRows(io, CHEQUE_SHEET).map(function (r) {
    return { fy: toInt(r[0]), store: normText(r[1]), ref: normText(r[2]), date: normText(r[3]),
      amount: normText(r[4]) === '' ? null : Number(r[4]), note: normText(r[5]), by: normText(r[6]), at: normText(r[7]), status: normText(r[8]) || 'ปกติ' };
  });
}

/**
 * สร้างทะเบียนเช็คจาก ขจ. (ข้อมูลจาก serializeDocs) + ข้อมูลขึ้นเงิน
 * คืน { rows:[เช็ค], summary:{กลุ่ม:{open,openAmt,done,doneAmt}}, unissued:[รายการเช็คที่ยังไม่ระบุเลข/วันที่] }
 */
function buildCheques(khjs, types, stores, clears, fy) {
  var by = {}, order = [], unissued = [];
  khjs.forEach(function (j) {
    if (j.status === 'ยกเลิก') return;
    j.items.forEach(function (it) {
      if (it.method !== 'เช็ค') return;
      var ref = normText(it.ref).replace(/\s+/g, '');
      if (!ref || !it.date) {
        unissued.push({ khjNo: j.no, khbNo: it.khbNo, seq: it.seq, payee: it.payee, amount: it.amount, why: !ref ? 'ยังไม่ระบุเลขเช็ค' : 'ยังไม่ระบุวันที่จ่าย' });
        return;
      }
      var key = normText(it.store) + '|' + chequeNoKey(ref), c = by[key];
      if (!c) { c = by[key] = { key: key, ref: ref, store: normText(it.store), cents: 0, date: it.date, payees: [], khjNos: [], lines: [], gcents: {} }; order.push(key); }
      var cents = Math.round(it.amount * 100), g = chequeGroupOf(typeGroup(types, it.type));
      c.cents += cents; c.gcents[g] = (c.gcents[g] || 0) + cents;
      if (it.date < c.date) c.date = it.date;
      if (c.payees.indexOf(it.payee) < 0) c.payees.push(it.payee);
      if (c.khjNos.indexOf(j.no) < 0) c.khjNos.push(j.no);
      c.lines.push({ khjNo: j.no, khbNo: it.khbNo, seq: it.seq, payee: it.payee, amount: it.amount, type: it.type });
    });
  });
  // ข้อมูลขึ้นเงินที่ใช้อยู่ (แถวล่าสุดของเช็คแต่ละใบ)
  var live = {}, liveNo = {};
  clears.forEach(function (c) {
    if (c.status === 'ยกเลิก' || (c.fy && c.fy !== fy)) return;
    live[c.store + '|' + chequeNoKey(c.ref)] = c;
    (liveNo[chequeNoKey(c.ref)] = liveNo[chequeNoKey(c.ref)] || []).push(c);
  });
  var storeName = {};
  stores.forEach(function (s) { storeName[normText(s[0])] = normText(s[1]); });
  var rank = {}; CHEQUE_GROUPS.forEach(function (g, i) { rank[g] = i; });
  var rows = order.map(function (k) {
    var c = by[k], gs = Object.keys(c.gcents).sort(function (a, b) { return (c.gcents[b] - c.gcents[a]) || (rank[a] - rank[b]); });
    var cl = live[k];
    if (!cl) { var alt = liveNo[chequeNoKey(c.ref)]; if (alt && alt.length === 1 && !alt[0].store) cl = alt[0]; } // ข้อมูลเก่าที่ไม่ได้ระบุที่เก็บ
    return { key: k, ref: c.ref, store: c.store, storeName: storeName[c.store] || c.store, group: gs[0], mixed: gs.length > 1,
      date: c.date, amount: c.cents / 100, payees: c.payees, khjNos: c.khjNos.sort(function (a, b) { return a - b; }), lines: c.lines,
      status: cl ? 'ขึ้นเงินแล้ว' : 'ค้าง', clearedDate: cl ? cl.date : '', clearedAmount: cl ? cl.amount : null, clearNote: cl ? cl.note : '',
      diff: !!(cl && cl.amount !== null && Math.round(cl.amount * 100) !== c.cents) };
  });
  rows.sort(function (a, b) {
    return (rank[a.group] - rank[b.group]) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      String(a.ref).localeCompare(String(b.ref), 'en', { numeric: true });
  });
  var summary = {};
  CHEQUE_GROUPS.concat(['ทั้งหมด']).forEach(function (g) { summary[g] = { open: 0, openSat: 0, done: 0, doneSat: 0 }; });
  rows.forEach(function (r) {
    [r.group, 'ทั้งหมด'].forEach(function (g) {
      var s = summary[g], sat = Math.round(r.amount * 100);
      if (r.status === 'ค้าง') { s.open++; s.openSat += sat; } else { s.done++; s.doneSat += sat; }
    });
  });
  Object.keys(summary).forEach(function (g) { summary[g].openAmt = summary[g].openSat / 100; summary[g].doneAmt = summary[g].doneSat / 100; delete summary[g].openSat; delete summary[g].doneSat; });
  return { rows: rows, summary: summary, unissued: unissued };
}

/**
 * ตรวจรายการขึ้นเงินที่วางมา [{ref, date, amount?, store?, note?}] กับทะเบียนเช็ค (pure)
 * status: new (บันทึกได้) · same (ขึ้นเงินแล้ว วันที่เดิม) · changed (ขึ้นเงินแล้ว แต่วันที่ต่าง) · error (บอกเหตุผล)
 */
function classifyClearings(items, cheques, fy) {
  var byNo = {}, seen = {};
  cheques.forEach(function (c) { var k = chequeNoKey(c.ref); (byNo[k] = byNo[k] || []).push(c); });
  return items.map(function (it, i) {
    var n = i + 1, out = { n: n, ref: normText(it.ref), status: 'error', msg: '' };
    try {
      var no = chequeNoKey(it.ref);
      if (!no) throw new Error('ยังไม่ระบุเลขที่เช็ค');
      var date = parseFyDate(it.date, fy, 'วันที่ขึ้นเงิน');
      var amt = normText(it.amount) === '' ? null : parseAmount(it.amount);
      var cands = byNo[no] || [];
      if (normText(it.store)) cands = cands.filter(function (c) { return c.store === normText(it.store); });
      if (!cands.length) throw new Error('ไม่พบเช็คเลขที่นี้ใน ขจ. (ตรวจเลขเช็ค หรือยังไม่ได้ระบุเลขเช็ค/วันที่จ่ายใน ขจ.)');
      if (cands.length > 1 && amt !== null) {
        var m = cands.filter(function (c) { return Math.round(c.amount * 100) === Math.round(amt * 100); });
        if (m.length) cands = m;
      }
      if (cands.length > 1) throw new Error('เลขเช็คนี้มีหลายบัญชี (' + cands.map(function (c) { return c.storeName; }).join(' / ') + ') ระบุจำนวนเงินหรือที่เก็บเงินด้วย');
      var c = cands[0];
      out.store = c.store; out.storeName = c.storeName; out.ref = c.ref; out.group = c.group; out.amount = c.amount; out.date = date;
      out.payee = c.payees[0] + (c.payees.length > 1 ? ' +' + (c.payees.length - 1) : '');
      if (amt !== null && Math.round(amt * 100) !== Math.round(c.amount * 100)) throw new Error('ยอดไม่ตรง: ในระบบ ' + fmtMoney(c.amount) + ' · ในไฟล์ ' + fmtMoney(amt));
      if (date < c.date) throw new Error('วันที่ขึ้นเงินต้องไม่ก่อนวันที่ออกเช็ค (' + thaiShortDate(c.date) + ')');
      if (seen[c.key]) throw new Error('เช็คใบนี้ซ้ำกับแถวที่ ' + seen[c.key]);
      seen[c.key] = n;
      if (c.status === 'ขึ้นเงินแล้ว') {
        out.status = c.clearedDate === date ? 'same' : 'changed';
        out.msg = out.status === 'same' ? 'ขึ้นเงินแล้ว วันที่เดิม' : 'ขึ้นเงินแล้วเมื่อ ' + thaiShortDate(c.clearedDate) + ' (ไฟล์ใหม่ ' + thaiShortDate(date) + ')';
      } else out.status = 'new';
    } catch (e) { out.status = 'error'; out.msg = e.message; }
    return out;
  });
}

function chequeContext(io) {
  var ctx = docsContext(io), ser = serializeDocs(ctx.idx);
  return { ctx: ctx, reg: buildCheques(ser.khjs, ctx.set.types, ctx.set.stores, readClears(io), FISCAL_YEAR) };
}

/* ============ handlers ============ */

function h_getCheques(p, io) {
  var r = chequeContext(io).reg;
  return { fy: FISCAL_YEAR, rows: r.rows, summary: r.summary, unissued: r.unissued, groups: CHEQUE_GROUPS };
}

/** ข้อมูลขึ้นเงิน: ดูตัวอย่าง (ไม่มี commit) หรือบันทึก (commit:true) · updateChanged = แก้วันที่ของเช็คที่ขึ้นเงินไปแล้ว */
function h_saveChequeClear(p, io, user) {
  if (!Array.isArray(p.items) || !p.items.length) throw new Error('ไม่มีรายการขึ้นเงินที่จะบันทึก');
  if (p.items.length > 800) throw new Error('ครั้งละไม่เกิน 800 รายการ กรุณาแบ่งวาง');
  if (!io.values(CHEQUE_SHEET)) throw new Error('ยังไม่มีชีท "' + CHEQUE_SHEET + '" — เปิด Apps Script แล้วรัน setupSheets() อีกครั้ง');
  var res = classifyClearings(p.items, chequeContext(io).reg.rows, FISCAL_YEAR);
  var count = { new: 0, same: 0, changed: 0, error: 0 };
  res.forEach(function (x) { count[x.status]++; });
  var out = { count: count, committed: false, rows: res };
  if (!p.commit) return out;
  var rows = tableRows(io, CHEQUE_SHEET).map(function (r) { return r.slice(); }), t = stamp(), add = 0, upd = 0;
  res.forEach(function (x, i) {
    if (x.status === 'error' || x.status === 'same' || (x.status === 'changed' && !p.updateChanged)) return;
    if (x.status === 'changed') {
      rows.forEach(function (r) {
        if (normText(r[8] || 'ปกติ') !== 'ปกติ' || toInt(r[0]) !== FISCAL_YEAR) return;
        if (chequeNoKey(r[2]) === chequeNoKey(x.ref) && (normText(r[1]) === x.store || !normText(r[1]))) { r[8] = 'ยกเลิก'; r[5] = (normText(r[5]) ? normText(r[5]) + ' · ' : '') + 'แก้วันที่เป็น ' + thaiShortDate(x.date); }
      });
      upd++;
    }
    var it = p.items[i], amt = normText(it.amount) === '' ? x.amount : parseAmount(it.amount);
    rows.push([FISCAL_YEAR, x.store, x.ref, x.date, amt, normText(it.note), user.email, t, 'ปกติ']);
    add++;
  });
  if (!add) throw new Error('ไม่มีแถวที่บันทึกได้ (ใหม่ 0 · อัปเดต 0)');
  io.write(CHEQUE_SHEET, rows);
  out.committed = true; out.added = add; out.updated = upd;
  return out;
}

/** ยกเลิกการขึ้นเงิน (เช็คกลับเป็นค้าง) [{ref, store?}] + reason */
function h_voidChequeClear(p, io, user) {
  var reason = normText(p.reason);
  if (!reason) throw new Error('กรุณาระบุเหตุผลที่ยกเลิก');
  if (!Array.isArray(p.items) || !p.items.length) throw new Error('ไม่มีเช็คที่จะยกเลิกการขึ้นเงิน');
  if (!io.values(CHEQUE_SHEET)) throw new Error('ยังไม่มีชีท "' + CHEQUE_SHEET + '" — เปิด Apps Script แล้วรัน setupSheets() อีกครั้ง');
  var rows = tableRows(io, CHEQUE_SHEET).map(function (r) { return r.slice(); }), voided = 0, miss = [];
  p.items.forEach(function (it) {
    var hit = 0;
    rows.forEach(function (r) {
      if (normText(r[8] || 'ปกติ') !== 'ปกติ' || toInt(r[0]) !== FISCAL_YEAR || chequeNoKey(r[2]) !== chequeNoKey(it.ref)) return;
      if (normText(it.store) && normText(r[1]) !== normText(it.store)) return;
      r[8] = 'ยกเลิก'; r[5] = (normText(r[5]) ? normText(r[5]) + ' · ' : '') + 'ยกเลิกการขึ้นเงิน: ' + reason; hit++;
    });
    if (hit) voided++; else miss.push(normText(it.ref));
  });
  if (miss.length) throw new Error('ไม่พบข้อมูลขึ้นเงินของเช็คเลขที่ ' + miss.join(', ') + ' (หรือยกเลิกไปแล้ว)');
  io.write(CHEQUE_SHEET, rows);
  return { voided: voided };
}
