import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env4, bankedPayee, signedKhj } from './step4_helpers.js';
import { payee, approved, line, E } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

function ktbEnv(bases = [500000, 300000]) {
  const e = env4();
  const p = bankedPayee(e, { name: 'ร้านโอน', tax_form: 'ภ.ง.ด.53' });
  const r = signedKhj(e, [{ fund: 'บกศ. ง/1', payee: p, bases }]);
  return { e, p, khj: r.khjs[0], ...r };
}

test('KTB: สร้างไฟล์จาก ขจ. วิธีจ่าย KTB เท่านั้น · บัญชีผู้รับต้องมีในทะเบียน (block) · ยอดโอน + ภาษี = ยอด ขจ.', () => {
  const e = env4();
  const noAcct = payee(e, { name: 'ร้านไม่มีบัญชี', pay_method: 'KTB', tax_form: 'ไม่มีภาษี' });
  const r1 = signedKhj(e, [{ fund: 'บกศ. ง/1', payee: noAcct, bases: [100000] }]);
  assert.deepEqual(fieldsOf(() => e.u('finance').ktb.createBatch(r1.khjs[0].id)), ['payee_id']);
  const { e: e2, khj } = ktbEnv();
  const b = e2.u('finance').ktb.createBatch(khj.id);
  assert.equal(b.total + b.tax_total, khj.total); // ขจ. = โอนให้ผู้รับ + ภาษีที่หักไว้
  assert.equal(b.status, 'สร้างไฟล์แล้ว');
  assert.equal(b.file_name, `KTB-${khj.khj_no.replace('/', '-')}.csv`);
  const csv = e2.u('finance').ktb.fileContent(b.id);
  assert.equal(csv.split('\n').length, 2); // หัว + 1 ผู้รับ (รวมหลายแถวของผู้รับเดียว)
  assert.match(csv, /0000000123/);
  assert.throws(() => e2.u('finance').ktb.createBatch(khj.id), /มีชุด|แล้ว/); // ซ้ำไม่ได้
});

test('KTB: ขจ. วิธีจ่ายเช็คสร้างชุด KTB ไม่ได้ · ต้องเป็น ขจ. ที่ ผอ. เซ็นแล้ว', () => {
  const e = env4();
  const shop = payee(e, { name: 'ร้านเช็ค', pay_method: 'เช็ค', tax_form: 'ไม่มีภาษี' });
  const r = signedKhj(e, [{ fund: 'บกศ. ง/1', payee: shop, bases: [100000] }]);
  assert.deepEqual(fieldsOf(() => e.u('finance').ktb.createBatch(r.khjs[0].id)), ['khj_id']);
  assert.throws(() => e.u('plan').ktb.createBatch(r.khjs[0].id), PermissionError);
});

test('KTB: ผู้ตั้ง ≠ ผู้อนุมัติ · ผู้อนุมัติต้องอยู่ในรายชื่อผู้มีสิทธิ์ · ยังไม่นับว่าจ่ายจนกรอกเลขธุรกรรม', () => {
  const { e, khj } = ktbEnv();
  const dir = e.dir;
  const k = e.u('finance').ktb;
  const b = k.createBatch(khj.id);
  assert.throws(() => k.recordApproval(b.id, dir.id), /อัปโหลด/); // ต้องอัปโหลดก่อน
  assert.equal(k.markUploaded(b.id).status, 'อัปโหลดแล้ว รอผู้บริหารอนุมัติ');
  assert.deepEqual(fieldsOf(() => k.recordApproval(b.id, 'ไม่มี')), ['approver_id']);
  // ผู้ตั้งที่อยู่ในรายชื่อผู้อนุมัติ (ผิดกฎ) → ปฏิเสธ
  const fin = e.app.store.find('users', (u) => u.email === E('finance'))[0];
  e.as('admin').settings.update('ktb_approver_user_ids', [fin.id], 'ทดสอบ');
  assert.deepEqual(fieldsOf(() => k.recordApproval(b.id, fin.id)), ['approver_id']);
  e.as('admin').settings.update('ktb_approver_user_ids', [dir.id], 'ทดสอบ');
  assert.equal(k.recordApproval(b.id, dir.id).status, 'อนุมัติแล้ว รอเลขธุรกรรม');
  assert.equal(e.u('finance').payments.listLines().some((l) => l.status === 'จ่ายแล้ว'), false); // ยังไม่จ่าย
  assert.deepEqual(fieldsOf(() => k.recordTxn(b.id, '')), ['txn_ref']);
  const paid = k.recordTxn(b.id, 'T6911100001');
  assert.equal(paid.status, 'จ่ายแล้ว');
  assert.equal(e.u('finance').payments.listLines().every((l) => l.status === 'จ่ายแล้ว' && l.ktb_ref === 'T6911100001'), true);
  assert.equal(e.u('finance').ledger.list().filter((x) => x.source_type === 'payment_line').length, 2);
});

test('ledger: ยอดต่อประเภทเงิน (รับ − จ่าย) · ตัดยอดแผน (spent) หลังจ่าย', () => {
  const { e, khj, lines } = ktbEnv([500000, 300000]);
  const b = e.u('finance').ktb.createBatch(khj.id);
  e.u('finance').ktb.markUploaded(b.id); e.u('finance').ktb.recordApproval(b.id, e.dir.id); e.u('finance').ktb.recordTxn(b.id, 'T1');
  const bal = e.u('finance').ledger.balance().find((x) => x.fund_code === 'บกศ. ง/1');
  const paid = lines.reduce((s, l) => s + l.pay_amount, 0);
  assert.deepEqual([bal.debit, bal.credit, bal.balance], [0, paid, -paid]);
  const row = e.u('plan').plan_projects.list().find((p) => p.fund_code === 'บกศ. ง/1');
  assert.equal(row.spent, lines.reduce((s, l) => s + l.request_amount, 0));
});

test('ภ.ง.ด.: สรุปภาษีที่หักรายเดือน แยก ภ.ง.ด.3 / 53 ต่อผู้รับ (จากแถวที่จ่ายแล้ว)', () => {
  const { e, khj } = ktbEnv([845000]);
  const b = e.u('finance').ktb.createBatch(khj.id);
  e.u('finance').ktb.markUploaded(b.id); e.u('finance').ktb.recordApproval(b.id, e.dir.id); e.u('finance').ktb.recordTxn(b.id, 'T1');
  const s = e.u('finance').ledger.taxSummary('2026-11');
  assert.deepEqual(s.forms.map((f) => [f.form, f.base, f.tax, f.rows.length]), [['ภ.ง.ด.53', 845000, 8450, 1]]);
  assert.equal(s.total_tax, 8450);
  assert.deepEqual(e.u('finance').ledger.taxSummary('2026-12').total_tax, 0);
});

test('ปิดรหัส: คืนยอดเหลือ (อนุมัติ − จ่ายจริง) เข้าแผนแล้วใช้รหัสนั้นอีกไม่ได้ · ค่าเริ่มปิดเอง (manual) รอยืนยัน', () => {
  const e = env4();
  const p = bankedPayee(e, { name: 'ร้านโอน', tax_form: 'ไม่มีภาษี' });
  const proj = e.u('plan').plan_projects.create({ name: 'p', fund_code: 'บกศ. ง/1', budget: 9000000 });
  const { code, req } = approved(e, { proj, amount: 1000000 });
  const l = line(e, code, p, { base_amount: 400000 });
  const k = e.u('finance').khb.create({ line_ids: [l.id] });
  e.u('finance').workflow.submit('khb', k.id);
  for (const w of ['reviewer1', 'reviewer2', 'reviewer3']) { e.u(w).workflow.receive('khb', k.id); e.u(w).workflow.pass('khb', k.id); }
  e.u('khj').workflow.receiveSigned('khb', k.id, { scan_ref: 's' });
  const [j] = e.u('khj').khj.generate(k.id);
  e.u('khj').workflow.submit('khj', j.id);
  for (const w of ['reviewer1', 'reviewer2', 'reviewer3']) { e.u(w).workflow.receive('khj', j.id); e.u(w).workflow.pass('khj', j.id); }
  e.u('finance').workflow.receiveSigned('khj', j.id, { scan_ref: 's' });
  const b = e.u('finance').ktb.createBatch(j.id);
  e.u('finance').ktb.markUploaded(b.id); e.u('finance').ktb.recordApproval(b.id, e.dir.id); e.u('finance').ktb.recordTxn(b.id, 'T9');
  assert.notEqual(e.u('plan').approvals.get(req.id).status, 'ปิดรหัส'); // ค่าเริ่ม manual: ยังไม่ปิดเอง
  const row = () => e.u('plan').plan_projects.list().find((x) => x.id === proj.id);
  assert.deepEqual([row().committed, row().spent, row().remaining], [1000000, 400000, 7600000]);
  assert.throws(() => e.u('plan').approvals.closeCode(req.id), PermissionError);
  const closed = e.u('finance').approvals.closeCode(req.id);
  assert.equal(closed.status, 'ปิดรหัส');
  assert.deepEqual([row().committed, row().spent, row().remaining], [0, 400000, 8600000]); // คืนส่วนที่เหลือ 6,000.00 เข้าแผน
  assert.deepEqual(fieldsOf(() => line(e, code, p, { base_amount: 1000, vendor_doc_no: 'AFTER' })), ['approval_code']);
});
