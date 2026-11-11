import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env4, signedKhj, bankedPayee } from './step4_helpers.js';
import { payee, E } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

const HEAD = 'Date,Teller Id,Transaction Code,Description,Cheque No.,Amount,Balance,Init Br';
// ยอดเงินมีจุลภาคคั่นหลักพัน จึงอยู่ในเครื่องหมายคำพูดแบบไฟล์ CSV จริง
const row = (d, code, desc, cheque, amt, bal) => `${d},T01,${code},${desc},${cheque},"${amt}","${bal}",001`;

function env6() {
  const e = env4();
  const admin = e.as('admin');
  admin.users.create({ name: 'หัวหน้าหน่วยงานย่อย', email: E('unit'), roles: ['unit_head'], appointment_ref: 'x' });
  admin.subfunds.create({ code: 'ก/20', name: 'บัตร', group: 'บกศ.', has_collectible: false });
  const accts = admin.bank_accounts.list();
  const sav = accts.find((a) => a.type === 'ออมทรัพย์' && a.fund_group === 'บกศ.');
  const cur = accts.find((a) => a.type === 'กระแสรายวัน' && a.fund_group === 'บกศ.');
  const fin = e.u('finance');
  let n = 0;
  const cashReceipt = (amount, date = '2026-11-03') => fin.receipts.issue({ book_no: '1', receipt_no: String(++n), date, payer: 'ผู้ชำระสมมติ', bks_cash: amount, split: { mode: 'manual', reason: 'ทดสอบ', splits: [{ subfund_code: 'ก/20', amount }] } });
  const unit = e.app.asUser(E('unit'));
  return { ...e, fin, sav, cur, cashReceipt, unit, opening: (acct, amount) => fin.ledger.opening({ account_id: acct.id, amount, date: '2026-11-01' }) };
}

test('ใบนำฝาก: ยอดควรเท่าเงินสดตามใบเสร็จที่ยังไม่ฝาก (กลุ่มเดียวกัน) · เงินสดรับ 3 ใบรวม 24,080 ฝาก 24,000 → flag ส่วนต่าง 80', () => {
  const e = env6();
  const rs = [800000, 800000, 808000].map((x) => e.cashReceipt(x));
  assert.equal(e.fin.deposits.undeposited('บกศ.').total, 2408000);
  const d = e.fin.deposits.create({ slip_no: '0012345', account_id: e.sav.id, date: '2026-11-04', amount: 2400000, receipt_ids: rs.map((r) => r.id) });
  assert.deepEqual([d.expected, d.difference], [2408000, -8000]);
  assert.deepEqual(d.flags, ['เงินสดที่ฝากไม่ตรงกับใบเสร็จ ส่วนต่าง -80.00 บาท']);
  assert.equal(e.fin.deposits.undeposited('บกศ.').total, 0); // ใบเสร็จถูกฝากแล้ว ไม่นับซ้ำ
  const r4 = e.cashReceipt(100000, '2026-11-05');
  const ok = e.fin.deposits.create({ slip_no: '0012346', account_id: e.sav.id, date: '2026-11-05', amount: 100000, receipt_ids: [r4.id] });
  assert.deepEqual([ok.difference, ok.flags], [0, []]);
});

test('ใบนำฝาก: ต้องเป็นบัญชีออมทรัพย์ของกลุ่มเงิน · เลขใบนำฝากห้ามซ้ำ · ใบเสร็จฝากซ้ำไม่ได้ · ลง Ledger เงินสด → บัญชี', () => {
  const e = env6();
  const r = e.cashReceipt(500000);
  assert.deepEqual(fieldsOf(() => e.fin.deposits.create({ slip_no: 'A1', account_id: e.cur.id, date: '2026-11-04', amount: 500000, receipt_ids: [r.id] })), ['account_id']);
  assert.deepEqual(fieldsOf(() => e.fin.deposits.create({ slip_no: '', account_id: e.sav.id, date: '2026-11-04', amount: 500000, receipt_ids: [r.id] })), ['slip_no']);
  assert.deepEqual(fieldsOf(() => e.fin.deposits.create({ slip_no: 'A1', account_id: e.sav.id, date: '2026-11-04', amount: 500000, receipt_ids: [] })), ['receipt_ids']);
  e.fin.deposits.create({ slip_no: 'A1', account_id: e.sav.id, date: '2026-11-04', amount: 500000, receipt_ids: [r.id] });
  assert.deepEqual(fieldsOf(() => e.fin.deposits.create({ slip_no: 'A2', account_id: e.sav.id, date: '2026-11-04', amount: 500000, receipt_ids: [r.id] })), ['receipt_ids']);
  assert.deepEqual(fieldsOf(() => e.fin.deposits.create({ slip_no: 'A1', account_id: e.sav.id, date: '2026-11-04', amount: 1, receipt_ids: [e.cashReceipt(1).id] })), ['slip_no']);
  const moves = e.fin.ledger.list().filter((x) => x.source_type === 'deposit_slip');
  assert.deepEqual(moves.map((x) => [x.location === 'cash' ? 'cash' : 'bank', x.debit, x.credit]), [['cash', 0, 500000], ['bank', 500000, 0]]);
  assert.throws(() => e.u('plan').deposits.create({ slip_no: 'Z', account_id: e.sav.id, date: '2026-11-04', amount: 1, receipt_ids: [r.id] }), PermissionError);
});

test('นำเข้า statement: แยกคอลัมน์ · ปีพ.ศ./ค.ศ. · ยอดติดลบ · ไม่นำเข้าบรรทัดซ้ำ · ผิดรูปแบบชี้บรรทัด', () => {
  const e = env6();
  const csv = [HEAD, row('03/11/2569', 'PBSDT', 'ฝากเงินสด', '', '5,000.00', '5,000.00'), row('2026-11-05', 'CWTPC', 'เช็คขึ้นเงิน', '00100001', '-1,000.00', '4,000.00')].join('\n');
  const r = e.fin.statements.import({ account_id: e.sav.id, text: csv });
  assert.deepEqual([r.imported, r.skipped], [2, 0]);
  const ls = e.fin.statements.lines(e.sav.id);
  assert.deepEqual(ls.map((l) => [l.line_date, l.txn_code, l.amount, l.balance]), [['2026-11-03', 'PBSDT', 500000, 500000], ['2026-11-05', 'CWTPC', -100000, 400000]]);
  assert.deepEqual(e.fin.statements.import({ account_id: e.sav.id, text: csv }), { imported: 0, skipped: 2, matched: 0 }); // ซ้ำ
  assert.deepEqual(fieldsOf(() => e.fin.statements.import({ account_id: e.sav.id, text: [HEAD, row('xx', 'PBSDT', 'x', '', '1', '1')].join('\n') })), ['text']);
  assert.deepEqual(fieldsOf(() => e.fin.statements.import({ account_id: e.sav.id, text: 'a,b\n1,2' })), ['text']);
});

test('จับคู่: ใบนำฝาก ↔ PBSDT · ดอกเบี้ย IIPS ลง Ledger · ไม่พบเอกสาร = ธงเงินเข้าที่ยังไม่ออกใบเสร็จ', () => {
  const e = env6();
  const r = e.cashReceipt(500000);
  const slip = e.fin.deposits.create({ slip_no: 'S1', account_id: e.sav.id, date: '2026-11-04', amount: 500000, receipt_ids: [r.id] });
  const csv = [HEAD, row('04/11/2569', 'PBSDT', 'ฝากเงินสด', '', '5,000.00', '5,000.00'), row('30/11/2569', 'IIPS', 'ดอกเบี้ย', '', '31.00', '5,031.00'), row('15/11/2569', 'XFER', 'โอนเข้าไม่ทราบที่มา', '', '300.00', '5,331.00')].join('\n');
  e.fin.statements.import({ account_id: e.sav.id, text: csv });
  const by = Object.fromEntries(e.fin.statements.lines(e.sav.id).map((l) => [l.txn_code, l]));
  assert.deepEqual([by.PBSDT.match_status, by.PBSDT.matched_source], ['จับคู่แล้ว', `deposit_slip:${slip.id}`]);
  assert.equal(by.IIPS.match_status, 'ดอกเบี้ย');
  assert.equal(by.XFER.match_status, 'ไม่พบเอกสาร');
  assert.ok(e.fin.ledger.list().some((x) => x.source_type === 'interest' && x.debit === 3100 && x.location === e.sav.id));
});

test('เงินโอนเข้า ↔ ใบเสร็จเงินโอน (Kcorp) จับคู่ตามเลขอ้างอิงหรือยอด', () => {
  const e = env6();
  const rc = e.fin.receipts.issue({ book_no: '1', receipt_no: '1', date: '2026-11-03', payer: 'x', bks_transfer: 250000, kcorp_ref: 'K6911030045', split: { mode: 'manual', reason: 't', splits: [{ subfund_code: 'ก/20', amount: 250000 }] } });
  e.fin.statements.import({ account_id: e.sav.id, text: [HEAD, row('03/11/2569', 'XFER', 'K6911030045 โอนเข้า', '', '2,500.00', '2,500.00')].join('\n') });
  const l = e.fin.statements.lines(e.sav.id)[0];
  assert.deepEqual([l.match_status, l.matched_source], ['จับคู่แล้ว', `receipt:${rc.id}`]);
});

test('statement มีเช็ค + OTID คู่กัน → จับคู่เช็ค หักกลบ OTID ระหว่างบัญชีกระแสรายวัน/ออมทรัพย์ → กระทบยอดแล้วไม่เหลือรายการค้าง', () => {
  const e = env6();
  const shop = payee(e, { name: 'ร้านเช็ค', pay_method: 'เช็ค', tax_form: 'ไม่มีภาษี' });
  const { khjs } = signedKhj(e, [{ fund: 'บกศ. ง/1', payee: shop, bases: [100000] }]);
  e.opening(e.sav, 500000000); e.opening(e.cur, 0);
  const c = e.fin.cheques.confirm({ khj_id: khjs[0].id, payee_id: shop.id, cheque_no: '00100001' });
  e.fin.cheques.sendForSignature(c.id); e.fin.cheques.markReceived(c.id);
  e.fin.statements.import({ account_id: e.cur.id, text: [HEAD, row('12/11/2569', 'OTID', 'Overdraft protection', '', '1,000.00', '1,000.00'), row('12/11/2569', 'CWTPC', 'เช็คขึ้นเงิน', '00100001', '-1,000.00', '0.00')].join('\n') });
  e.fin.statements.import({ account_id: e.sav.id, text: [HEAD, row('12/11/2569', 'OTID', 'Overdraft protection', '', '-1,000.00', '4,999,000.00')].join('\n') });
  assert.equal(e.fin.cheques.list().find((x) => x.id === c.id).status, 'ขึ้นเงินแล้ว');
  assert.deepEqual(e.fin.statements.lines(e.cur.id).map((l) => l.match_status).sort(), ['จับคู่แล้ว', 'หักกลบ OTID']);
  for (const [acct, bal] of [[e.cur, 0], [e.sav, 499900000]]) {
    const r = e.fin.bank.reconcile(acct.id, '2026-11');
    assert.deepEqual([r.statement_balance, r.ledger_balance, r.diff, r.ok], [bal, bal, 0, true]);
    assert.deepEqual([r.outstanding_cheques.length, r.unmatched_credits.length, r.unmatched_debits.length, r.deposits_in_transit.length], [0, 0, 0, 0]);
  }
});

test('งบกระทบยอด: ใบนำฝากที่ยังไม่เข้า statement เป็นรายการระหว่างทาง · เงินเข้าที่ยังไม่ออกใบเสร็จเป็นธงแดงและทำให้ไม่ตรง', () => {
  const e = env6();
  e.opening(e.sav, 1000000);
  const r1 = e.cashReceipt(200000);
  e.fin.deposits.create({ slip_no: 'S9', account_id: e.sav.id, date: '2026-11-28', amount: 200000, receipt_ids: [r1.id] }); // ฝากแล้วแต่ยังไม่เข้า statement
  e.fin.statements.import({ account_id: e.sav.id, text: [HEAD, row('10/11/2569', 'XFER', 'โอนเข้าไม่ทราบที่มา', '', '300.00', '10,300.00')].join('\n') });
  const r = e.fin.bank.reconcile(e.sav.id, '2026-11');
  assert.equal(r.statement_balance, 1030000);
  assert.equal(r.ledger_balance, 1200000);
  // statement 10,300 = บัญชีเดิม 10,000 + เงินเข้า 300 ที่ยังไม่อยู่ใน Ledger · ใบนำฝาก 2,000 อยู่ระหว่างทาง
  assert.deepEqual([r.unmatched_credits.length, r.deposits_in_transit.length, r.diff, r.ok], [1, 1, 30000, false]);
  assert.match(r.flags.join(' '), /เงินเข้าที่ยังไม่ออกใบเสร็จ/);
  assert.match(r.flags.join(' '), /ไม่ตรง/);
});

test('ไม่ตรง → แก้ด้วยรายการปรับปรุงที่มีผู้อนุมัติเท่านั้น (ผู้อนุมัติ ≠ ผู้ทำ) แล้วจึงตรง · ธงแดงเมื่อไม่ตรง', () => {
  const e = env6();
  e.opening(e.sav, 1000000);
  e.fin.statements.import({ account_id: e.sav.id, text: [HEAD, row('10/11/2569', 'IIPS', 'ดอกเบี้ย', '', '10.00', '10,010.00'), row('20/11/2569', 'FEE', 'ค่าธรรมเนียม', '', '-5.00', '10,005.00')].join('\n') });
  const bad = e.fin.bank.reconcile(e.sav.id, '2026-11');
  assert.deepEqual([bad.ok, bad.diff], [false, -500]); // statement หักค่าธรรมเนียมที่ Ledger ไม่มี
  assert.match(bad.flags.join(' '), /ไม่ตรง/);
  const a = e.fin.adjustments.create({ account_id: e.sav.id, date: '2026-11-20', amount: -500, reason: 'ค่าธรรมเนียมธนาคาร' });
  assert.equal(e.fin.bank.reconcile(e.sav.id, '2026-11').ok, false); // ยังไม่อนุมัติ ยังไม่มีผล
  assert.throws(() => e.fin.adjustments.approve(a.id), PermissionError); // ผู้ทำอนุมัติเองไม่ได้ (และไม่มีสิทธิ์)
  assert.throws(() => e.u('reviewer1').adjustments.approve('ไม่มี'), /ไม่พบ/);
  e.u('reviewer1').adjustments.approve(a.id);
  assert.deepEqual(fieldsOf(() => e.fin.adjustments.create({ account_id: e.sav.id, date: '2026-11-20', amount: 0, reason: 'x' })), ['amount']);
  assert.deepEqual(fieldsOf(() => e.fin.adjustments.create({ account_id: e.sav.id, date: '2026-11-20', amount: 5, reason: '' })), ['reason']);
  assert.equal(e.fin.bank.reconcile(e.sav.id, '2026-11').ok, true);
});

test('ทะเบียนเงินฝากธนาคาร (ต่อบัญชี): ประเภทเอกสาร · ที่เอกสาร · รับ · จ่าย · คงเหลือ · ยอดยกมา/ยกไป', () => {
  const e = env6();
  e.opening(e.sav, 200000000);
  const r = e.cashReceipt(500000);
  e.fin.deposits.create({ slip_no: '0012345', account_id: e.sav.id, date: '2026-11-04', amount: 500000, receipt_ids: [r.id] });
  e.fin.receipts.issue({ book_no: '1', receipt_no: '2', date: '2026-11-04', payer: 'x', bks_transfer: 682500, kcorp_ref: 'K6910030045', split: { mode: 'manual', reason: 't', splits: [{ subfund_code: 'ก/20', amount: 682500 }] } });
  e.fin.statements.import({ account_id: e.sav.id, text: [HEAD, row('30/11/2569', 'IIPS', 'ดอกเบี้ย', '', '31.00', '2,000,000.00')].join('\n') });
  const reg = e.fin.bank.register(e.sav.id, '2026-11');
  assert.equal(reg.opening, 200000000);
  assert.deepEqual(reg.rows.map((x) => [x.doc_type, x.doc_no, x.in, x.out, x.balance]), [
    ['ใบนำฝาก', '0012345', 500000, 0, 200500000], ['Kcorp', 'K6910030045', 682500, 0, 201182500], ['ดอกเบี้ย', '', 3100, 0, 201185600]]);
  assert.equal(reg.closing, 201185600);
  assert.equal(e.fin.bank.register(e.sav.id, '2026-12').opening, 201185600); // ยกมา = ยกไป
});

test('ลงนามทะเบียนรายเดือน: เฉพาะหัวหน้าหน่วยงานย่อย · เมื่อกระทบยอดตรงเท่านั้น · ลงนามซ้ำไม่ได้', () => {
  const e = env6();
  e.opening(e.sav, 1000000);
  e.fin.statements.import({ account_id: e.sav.id, text: [HEAD, row('10/11/2569', 'FEE', 'ค่าธรรมเนียม', '', '-5.00', '9,995.00')].join('\n') });
  assert.throws(() => e.fin.bank.signMonth({ account_id: e.sav.id, month: '2026-11' }), PermissionError);
  assert.deepEqual(fieldsOf(() => e.unit.bank.signMonth({ account_id: e.sav.id, month: '2026-11' })), ['month']); // ไม่ตรง
  const a = e.fin.adjustments.create({ account_id: e.sav.id, date: '2026-11-10', amount: -500, reason: 'ค่าธรรมเนียม' });
  e.u('reviewer1').adjustments.approve(a.id);
  const s = e.unit.bank.signMonth({ account_id: e.sav.id, month: '2026-11' });
  assert.equal(s.signed_by, E('unit'));
  assert.throws(() => e.unit.bank.signMonth({ account_id: e.sav.id, month: '2026-11' }), /ลงนามแล้ว/);
  assert.equal(e.fin.bank.register(e.sav.id, '2026-11').signed_by, E('unit'));
});
