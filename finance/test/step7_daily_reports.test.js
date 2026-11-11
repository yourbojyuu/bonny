import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env4, signedKhj } from './step4_helpers.js';
import { payee, approved, line, E, SCAN } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

function env7() {
  const e = env4();
  const admin = e.as('admin');
  admin.users.create({ name: 'กรรมการ 1', email: E('cmt'), roles: ['cash_committee'], appointment_ref: 'x' });
  admin.subfunds.create({ code: 'ก/20', name: 'บัตร', group: 'บกศ.', has_collectible: false });
  const accts = admin.bank_accounts.list();
  const sav = accts.find((a) => a.type === 'ออมทรัพย์' && a.fund_group === 'บกศ.');
  const fin = e.u('finance');
  const cash = (amount, date = '2026-11-10') => fin.receipts.issue({ book_no: '1', receipt_no: fin.receipts.nextNo('1'), date, payer: 'ผู้ชำระสมมติ', bks_cash: amount, split: { mode: 'manual', reason: 't', splits: [{ subfund_code: 'ก/20', amount }] } });
  return { ...e, fin, sav, cash, cmt: e.app.asUser(E('cmt')), opening: (amount, date = '2026-11-01') => fin.ledger.opening({ account_id: sav.id, amount, date }) };
}
// ปิดวันครบขั้นตอนเมื่อไม่มีการจ่าย
function closeDay(e, date, counted) {
  e.fin.daily.open(date);
  e.cmt.daily.receiveCount(date); e.cmt.daily.recordCount(date, { counted_cash: counted }); e.cmt.daily.sign(date);
  return e.fin.daily.close(date);
}

test('รายงานเงินคงเหลือประจำวัน: ยกมา + รับ − จ่าย = คงเหลือ แยกประเภทเงิน (การย้ายเงินภายในไม่นับเป็นรับ/จ่าย)', () => {
  const e = env7();
  e.opening(500000000);
  const r = e.cash(500000);
  e.fin.deposits.create({ slip_no: 'D1', account_id: e.sav.id, date: '2026-11-10', amount: 300000, receipt_ids: [r.id] });
  const rep = e.fin.daily.report('2026-11-10');
  const g = rep.groups.find((x) => x.group === 'บกศ.');
  assert.deepEqual([g.carried, g.in, g.out, g.balance], [500000000, 500000, 0, 500500000]);
  assert.equal(rep.system_cash, 200000); // เงินสด 5,000 − นำฝาก 3,000
  const next = e.fin.daily.report('2026-11-11').groups.find((x) => x.group === 'บกศ.');
  assert.deepEqual([next.carried, next.in, next.out], [500500000, 0, 0]); // คงเหลือวันนี้ = ยกมาวันถัดไป
});

test('ปิดวัน: เปิดวัน (ส่ง → รับ กรรมการ) → กรรมการนับ → ลงนาม → การเงินปิดวัน (ล็อก) · แต่ละขั้นเฉพาะผู้มีหน้าที่', () => {
  const e = env7();
  e.cash(500000);
  e.fin.daily.open('2026-11-10');
  assert.equal(e.cmt.workflow.inbox().filter((x) => x.doc_type === 'daily').length, 1);
  assert.throws(() => e.fin.daily.receiveCount('2026-11-10'), PermissionError);
  assert.throws(() => e.cmt.daily.recordCount('2026-11-10', { counted_cash: 500000 }), /ยังไม่ได้กดรับ/);
  e.cmt.daily.receiveCount('2026-11-10');
  assert.throws(() => e.fin.daily.recordCount('2026-11-10', { counted_cash: 500000 }), PermissionError);
  const c = e.cmt.daily.recordCount('2026-11-10', { counted_cash: 500000 });
  assert.deepEqual([c.system_cash, c.counted_cash, c.diff], [500000, 500000, 0]);
  assert.throws(() => e.fin.daily.close('2026-11-10'), /ลงนาม/); // กรรมการยังไม่ลงนาม
  e.cmt.daily.sign('2026-11-10');
  assert.throws(() => e.cmt.daily.close('2026-11-10'), PermissionError);
  const done = e.fin.daily.close('2026-11-10');
  assert.deepEqual([done.locked, done.closed_by], [true, E('finance')]);
  assert.deepEqual(done.signers, [E('cmt')]);
  assert.throws(() => e.fin.daily.open('2026-11-10'), /ปิดวันแล้ว|ล็อก/);
});

test('เมื่อปิดวันแล้ว บันทึกรายการที่ลง Ledger ย้อนหลังในวันที่ล็อกไม่ได้ (ใบเสร็จ · ใบนำฝาก)', () => {
  const e = env7();
  const r = e.cash(500000);
  closeDay(e, '2026-11-10', 500000);
  assert.deepEqual(fieldsOf(() => e.cash(100000, '2026-11-10')), ['date']);
  assert.deepEqual(fieldsOf(() => e.cash(100000, '2026-11-09')), ['date']); // วันก่อนหน้าก็ล็อก
  assert.deepEqual(fieldsOf(() => e.fin.deposits.create({ slip_no: 'X', account_id: e.sav.id, date: '2026-11-10', amount: 500000, receipt_ids: [r.id] })), ['date']);
  assert.ok(e.cash(100000, '2026-11-11')); // วันถัดไปทำได้
});

test('นับเงินสดไม่ตรง → การเงินบันทึกส่วนต่างพร้อมคำอธิบาย (ธงแดง) จึงลงนามได้', () => {
  const e = env7();
  e.cash(500000);
  e.fin.daily.open('2026-11-10'); e.cmt.daily.receiveCount('2026-11-10');
  const c = e.cmt.daily.recordCount('2026-11-10', { counted_cash: 499900 });
  assert.equal(c.diff, -100);
  assert.deepEqual(fieldsOf(() => e.cmt.daily.sign('2026-11-10')), ['diff_note']);
  assert.deepEqual(fieldsOf(() => e.fin.daily.explainDiff('2026-11-10', '')), ['note']);
  e.fin.daily.explainDiff('2026-11-10', 'ทอนเงินผิด 1 บาท');
  assert.ok(e.cmt.daily.sign('2026-11-10').signed_at);
  assert.ok(e.fin.reports.executive().flags.some((f) => f.level === 'red' && f.code === 'daily_diff'));
});

test('เงินสดเกินวงเงินเก็บรักษา → ต้องนำฝากก่อนลงนาม (ค่าตั้ง รอยืนยัน 12.12)', () => {
  const e = env7();
  const r = e.cash(500000);
  e.as('admin').settings.update('cash_holding_limit', 100000, 'ทดสอบ');
  e.fin.daily.open('2026-11-10'); e.cmt.daily.receiveCount('2026-11-10'); e.cmt.daily.recordCount('2026-11-10', { counted_cash: 500000 });
  assert.deepEqual(fieldsOf(() => e.cmt.daily.sign('2026-11-10')), ['counted_cash']);
  e.fin.deposits.create({ slip_no: 'D2', account_id: e.sav.id, date: '2026-11-10', amount: 500000, receipt_ids: [r.id] });
  e.cmt.daily.recordCount('2026-11-10', { counted_cash: 0 });
  assert.ok(e.cmt.daily.sign('2026-11-10').signed_at);
});

test('วันที่มีการจ่ายต้องมีเอกสาร ผอ. ลงนามและรับคืนแล้ว จึงปิดวันได้ · ผอ. ยังไม่ลงนามทำวันถัดไปได้แต่ขึ้นธง', () => {
  const e = env7();
  const shop = payee(e, { name: 'ร้านเช็ค', pay_method: 'เช็ค', tax_form: 'ไม่มีภาษี' });
  const { khjs } = signedKhj(e, [{ fund: 'บกศ. ง/1', payee: shop, bases: [100000] }]);
  const c = e.fin.cheques.confirm({ khj_id: khjs[0].id, payee_id: shop.id, cheque_no: '00100001' });
  e.fin.cheques.sendForSignature(c.id); e.fin.cheques.markReceived(c.id); // จ่ายวันที่ 2026-11-10
  assert.equal(e.fin.daily.report('2026-11-10').payments_count, 1);
  e.fin.daily.open('2026-11-10'); e.cmt.daily.receiveCount('2026-11-10'); e.cmt.daily.recordCount('2026-11-10', { counted_cash: 0 }); e.cmt.daily.sign('2026-11-10');
  assert.deepEqual(fieldsOf(() => e.fin.daily.close('2026-11-10')), ['director_scan']);
  e.fin.daily.sendToDirector('2026-11-10');
  e.clock.set('2026-11-12T03:00:00Z');
  assert.ok(e.fin.reports.executive().flags.some((f) => f.code === 'daily_director_pending')); // ขึ้นธงแต่ยังทำงานต่อได้
  assert.ok(e.cash(100000, '2026-11-12'));
  assert.deepEqual(fieldsOf(() => e.fin.daily.receiveBack('2026-11-10', {})), ['scan_ref']);
  e.fin.daily.receiveBack('2026-11-10', SCAN);
  assert.equal(e.fin.daily.close('2026-11-10').locked, true);
});

test('รายงานผู้บริหาร: ธงแดง · งานค้างรับเกินกำหนด · เช็คค้าง ≥150/180 วัน · เงินยืมเลยกำหนด · แผนใช้เกิน 90%', () => {
  const e = env7();
  const shop = payee(e, { name: 'ร้านเช็ค', pay_method: 'เช็ค', tax_form: 'ไม่มีภาษี' });
  const { khjs } = signedKhj(e, [{ fund: 'บกศ. ง/1', payee: shop, bases: [100000] }]);
  const c = e.fin.cheques.confirm({ khj_id: khjs[0].id, payee_id: shop.id, cheque_no: '00100001' });
  e.fin.cheques.sendForSignature(c.id); e.fin.cheques.markReceived(c.id);
  // แผนใช้เกิน 90%: โครงการ 10,000 บาท อนุมัติ 9,500
  const proj = e.u('plan').plan_projects.create({ name: 'โครงการใกล้เต็ม', fund_code: 'บกศ. ง/1', budget: 1000000 });
  approved(e, { proj, amount: 950000 });
  // งานค้างรับ: ใบขออนุมัติที่ส่งแล้วไม่มีคนรับ
  e.u('teacher').approvals.submit({ project_id: proj.id, items: 'x', amount: 1000 });
  e.as('admin').settings.update('sla_days', { plan: 1 }, 'ทดสอบ');
  e.clock.set('2026-11-14T03:00:00Z');
  let ex = e.fin.reports.executive();
  const codes = (r) => r.flags.map((f) => f.code);
  assert.ok(codes(ex).includes('handoff_overdue'));
  assert.ok(codes(ex).includes('plan_over_90'));
  assert.ok(!codes(ex).includes('cheque_stale_150'));
  e.clock.set('2027-04-15T03:00:00Z'); // 156 วันหลังออกเช็ค
  ex = e.fin.reports.executive();
  assert.ok(codes(ex).includes('cheque_stale_150') && !codes(ex).includes('cheque_stale_180'));
  e.clock.set('2027-05-15T03:00:00Z'); // 186 วัน
  ex = e.fin.reports.executive();
  assert.ok(codes(ex).includes('cheque_stale_180'));
  assert.equal(ex.flags.find((f) => f.code === 'cheque_stale_180').level, 'red');
});

test('รายงานผู้บริหาร: เงินยืมเลยกำหนดและค้างชำระรายชนิด', () => {
  const e = env7();
  const a = approved(e, { amount: 800000 });
  e.fin.approvals.financeReceive(a.req.id); e.fin.approvals.classify(a.req.id, 'เงินยืม');
  e.fin.loans.create({ approval_code: a.code, borrower: E('teacher'), amount: 800000 });
  e.as('admin').subfunds.create({ code: 'SMS', name: 'SMS', group: 'รายได้', has_collectible: true });
  e.fin.packages.create({ total: 300000, label: 'SMS', lines: ['SMS=300000'] });
  e.fin.collectibles.set({ student_id: 'S001', subfund_code: 'SMS', academic_year: 2569, term: '1', amount_due: 960000 });
  e.fin.receipts.issue({ book_no: '2', receipt_no: '1', date: '2026-11-10', payer: 'x', inc_cash: 300000, student_id: 'S001' });
  e.clock.set('2026-12-20T03:00:00Z');
  const ex = e.fin.reports.executive();
  assert.ok(ex.flags.some((f) => f.code === 'loan_overdue'));
  assert.deepEqual(ex.arrears.map((x) => [x.subfund_code, x.due, x.paid, x.outstanding]), [['SMS', 960000, 300000, 660000]]);
});

test('สิ้นปีงบ: สรุปผลการใช้เงินตามแผน และยอดยกไป = ยอดยกมาของปีถัดไป (ปีงบ 1 ต.ค.–30 ก.ย.)', () => {
  const e = env7();
  e.opening(100000000, '2026-09-01');
  e.cash(500000, '2026-09-30'); e.cash(200000, '2026-10-01');
  const proj = e.u('plan').plan_projects.create({ name: 'โครงการสมมติ', fund_code: 'บกศ. ง/1', budget: 5000000 });
  approved(e, { proj, amount: 1000000 });
  const ye = e.fin.reports.yearEnd(2569);
  assert.deepEqual([ye.from, ye.to], ['2025-10-01', '2026-09-30']);
  const closing = ye.closing.find((x) => x.group === 'บกศ.').balance;
  assert.equal(closing, 100000000 + 500000);
  const open = e.fin.daily.report('2026-10-01').groups.find((x) => x.group === 'บกศ.');
  assert.equal(open.carried, closing); // ยอดยกไป = ยอดยกมา
  const ps = e.fin.reports.planSummary(2570);
  const row = ps.rows.find((x) => x.name === 'โครงการสมมติ');
  assert.deepEqual([row.budget, row.committed, row.spent, row.remaining, row.pct], [5000000, 1000000, 0, 4000000, 20]);
  assert.equal(ps.total.budget, 5000000);
});
