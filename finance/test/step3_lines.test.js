import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env3, approved, payee, line, SCAN, E } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { calcTax } from '../src/core/tax.js';
import { PermissionError } from '../src/core/errors.js';

const SETTINGS = { pnd3_gross_threshold: 1000000, pnd53_gross_threshold: 50000, vat_rate_pct: 7, wht_rate_pct: 1 };

test('ภาษี: ภ.ง.ด.53 base 467.10 → ภาษี 0 · base 467.29 → ภาษี 4.67 (เทียบจำนวนเต็ม ไม่ปัดเป็น 467)', () => {
  assert.equal(calcTax(SETTINGS, 'ภ.ง.ด.53', 46710), 0);
  assert.equal(calcTax(SETTINGS, 'ภ.ง.ด.53', 46728), 0);
  assert.equal(calcTax(SETTINGS, 'ภ.ง.ด.53', 46729), 467);
  assert.equal(calcTax(SETTINGS, 'ภ.ง.ด.3', 934579), 0); // 9,345.79 × 1.07 = 9,999.99
  assert.equal(calcTax(SETTINGS, 'ภ.ง.ด.3', 934580), 9346);
  assert.equal(calcTax(SETTINGS, 'ไม่มีภาษี', 99999999), 0);
  assert.equal(calcTax(SETTINGS, 'ภ.ง.ด.53', 845000), 8450); // 8,450.00 → 84.50
});

test('หน้ารายการ: ระบบเติมประเภทเงิน/วิธีจ่าย/ประเภทภาษี/ภาษี/ยอดเบิก ให้ (ผู้ใช้กรอกแค่ 4 อย่าง + เลือก)', () => {
  const e = env3();
  const { code } = approved(e, { amount: 2000000 });
  const p = payee(e, { tax_form: 'ภ.ง.ด.53', pay_method: 'KTB' });
  const l = line(e, code, p, { base_amount: 845000 });
  assert.deepEqual([l.fund_code, l.tax_form, l.pay_method], ['บกศ. ง/1', 'ภ.ง.ด.53', 'KTB']);
  assert.deepEqual([l.base_amount, l.tax_amount, l.pay_amount, l.request_amount], [845000, 8450, 836550, 845000]); // request = pay + tax
  assert.deepEqual([l.status, l.locked], ['บันทึกแล้ว', false]);
});

test('บันทึกแถวที่ผู้รับไม่อยู่ใน payees → ถูกปฏิเสธ พร้อมชี้ช่อง', () => {
  const e = env3();
  const { code } = approved(e);
  const r = fieldsOf(() => e.u('finance').payments.createLine({ approval_code: code, date: '2026-11-10', kind: 'เบิก', payee_id: 'ไม่มี', vendor_doc_no: 'A1', description: 'x', base_amount: 1000 }));
  assert.deepEqual(r, ['payee_id']);
});

test('เลขที่เอกสารร้านบังคับ · (ผู้รับ, เลขที่เอกสาร) ซ้ำไม่ได้ (คนละร้านใช้เลขเดียวกันได้)', () => {
  const e = env3();
  const { code } = approved(e, { amount: 2000000 });
  const a = payee(e), b = payee(e, { name: 'ร้านสมมติ ข' });
  assert.deepEqual(fieldsOf(() => line(e, code, a, { vendor_doc_no: '' })), ['vendor_doc_no']);
  line(e, code, a, { vendor_doc_no: 'IV-001' });
  assert.deepEqual(fieldsOf(() => line(e, code, a, { vendor_doc_no: ' iv-001 ' })), ['vendor_doc_no']);
  assert.ok(line(e, code, b, { vendor_doc_no: 'IV-001' }));
});

test('ยอดรวมของรหัสต้อง ≤ ยอดอนุมัติ · รหัสไม่มี/ปิดแล้วใช้ไม่ได้ · kind ต้องอยู่ในรายการ', () => {
  const e = env3();
  const { code } = approved(e, { amount: 300000 });
  const p = payee(e);
  line(e, code, p, { base_amount: 200000 });
  assert.deepEqual(fieldsOf(() => line(e, code, p, { base_amount: 100001 })), ['base_amount']);
  assert.ok(line(e, code, p, { base_amount: 100000 })); // พอดียอด
  assert.deepEqual(fieldsOf(() => line(e, 'อม.99/2570', p)), ['approval_code']);
  const fresh = approved(e, { amount: 100000 }).code;
  assert.deepEqual(fieldsOf(() => line(e, fresh, p, { kind: 'อย่างอื่น' })), ['kind']);
});

test('ค่าจ้างรายเดือน: ใช้รหัสรายปีเดียว ตัดยอดทุกเดือนจนหมด', () => {
  const e = env3();
  const { code } = approved(e, { amount: 3000000 });
  const p = payee(e, { name: 'ครูอัตราจ้างสมมติ', tax_form: 'ไม่มีภาษี', pay_method: 'KTB' });
  for (const m of ['01', '02', '03']) line(e, code, p, { kind: 'ค่าจ้าง', date: `2027-${m}-28`, vendor_doc_no: `SAL-${m}`, base_amount: 1000000 });
  assert.deepEqual(fieldsOf(() => line(e, code, p, { kind: 'ค่าจ้าง', vendor_doc_no: 'SAL-04', base_amount: 1 })), ['base_amount']);
});

test('ภาษีนำส่ง/คืนเงิน: ไม่ใช้รหัสอนุมัติ · ต้องมีเลขอ้างอิง · ไม่คำนวณภาษีซ้ำ', () => {
  const e = env3();
  const rd = payee(e, { name: 'กรมสรรพากรสมมติ', tax_form: 'ภ.ง.ด.53', pay_method: 'ออนไลน์' });
  const l = e.u('finance').payments.createLine({ date: '2026-11-15', kind: 'ภาษีนำส่ง', payee_id: rd.id, vendor_doc_no: 'P000000000001', description: 'ภาษีเดือน ต.ค.', base_amount: 123400 });
  assert.deepEqual([l.approval_code, l.tax_amount, l.request_amount], ['', 0, 123400]);
  assert.deepEqual(fieldsOf(() => e.u('finance').payments.createLine({ date: '2026-11-15', kind: 'คืนเงิน', payee_id: rd.id, vendor_doc_no: '', description: 'x', base_amount: 1 })), ['vendor_doc_no']);
});

test('เงินยืม/ส่งใช้: ต้องมีสัญญา · พัสดุ: ต้องตรวจรับแล้วจึงทำชุดเบิก (block)', () => {
  const e = env3();
  const a = approved(e, { amount: 900000 });
  e.u('finance').approvals.financeReceive(a.req.id); e.u('finance').approvals.classify(a.req.id, 'เงินยืม');
  const p = payee(e);
  assert.deepEqual(fieldsOf(() => line(e, a.code, p, { kind: 'เงินยืม' })), ['loan_id']);
  const loan = e.u('finance').loans.create({ approval_code: a.code, borrower: E('teacher'), amount: 900000 });
  assert.ok(line(e, a.code, p, { kind: 'เงินยืม', loan_id: loan.id, base_amount: 900000 }));
  const m = approved(e, { amount: 500000 });
  e.u('finance').approvals.financeReceive(m.req.id); e.u('finance').approvals.classify(m.req.id, 'วัสดุ');
  assert.deepEqual(fieldsOf(() => line(e, m.code, p, { kind: 'พัสดุ' })), ['kind']); // ยังไม่ตรวจรับ
});

test('บัญชีผู้รับที่เพิ่งแก้ภายใน 30 วัน: บันทึกได้แต่ขึ้นธง', () => {
  const e = env3();
  const { code } = approved(e);
  const p = payee(e, { pay_method: 'KTB' });
  const r = e.u('finance').payees.requestAccountChange(p.id, { bank: 'ธนาคารสมมติ', account_no: '0000000077', reason: 'ร้านแจ้งเปลี่ยน' });
  e.u('reviewer1').payees.approveAccountChange(r.id);
  assert.deepEqual(line(e, code, p).flags, ['บัญชีผู้รับเพิ่งเปลี่ยน']);
  const q = payee(e, { name: 'ร้านไม่เปลี่ยนบัญชี' });
  assert.deepEqual(line(e, code, q).flags, []);
});

test('ค่าใช้จ่ายไม่อยู่ในรายการที่ประเภทเงินอนุญาต: โหมด flag = ขึ้นธง · โหมด block = บันทึกไม่ได้', () => {
  const e = env3();
  e.as('admin').fund_allowed_expense.create({ fund_code: 'บกศ. ง/1', expense_category: 'ค่าวัสดุ' });
  const { code } = approved(e, { amount: 5000000 });
  const p = payee(e);
  assert.deepEqual(line(e, code, p, { expense_category: 'ค่าวัสดุ' }).flags, []);
  assert.deepEqual(line(e, code, p, { expense_category: 'ค่าเดินทาง' }).flags, ['ค่าใช้จ่ายไม่อยู่ในรายการอนุญาต']);
  e.as('admin').settings.update('fund_allowed_expense_mode', 'block', 'ทดสอบ');
  assert.deepEqual(fieldsOf(() => line(e, code, p, { expense_category: 'ค่าเดินทาง' })), ['expense_category']);
});

test('เฉพาะการเงินบันทึกหน้ารายการ · แก้ได้ก่อนล็อก · ผิดหลังล็อกต้องทำรายการกลับพร้อมเหตุผล (ไม่ลบ)', () => {
  const e = env3();
  const { code } = approved(e, { amount: 2000000 });
  const p = payee(e);
  assert.throws(() => line({ ...e, u: () => e.u('plan') }, code, p), PermissionError);
  const l = line(e, code, p, { base_amount: 100000 });
  const upd = e.u('finance').payments.updateLine(l.id, { base_amount: 120000 }, 'พิมพ์ยอดผิด');
  assert.equal(upd.request_amount, 120000);
  assert.deepEqual(fieldsOf(() => e.u('finance').payments.updateLine(l.id, { base_amount: 1 }, '')), ['reason']);
  assert.equal(e.u('finance').payments.delete, undefined);
});
