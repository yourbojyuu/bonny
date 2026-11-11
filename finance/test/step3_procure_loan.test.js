import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env3, approved, SCAN, E } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

function routed(e, route, opts) {
  const a = approved(e, opts);
  e.u('finance').approvals.financeReceive(a.req.id);
  e.u('finance').approvals.classify(a.req.id, route);
  return a;
}

test('วัสดุ: จัดซื้อต้อง ≤ ยอดอนุมัติ · ต้องมีเลข e-GP · เฉพาะรหัสที่จำแนกเป็นวัสดุ', () => {
  const e = env3();
  const a = routed(e, 'วัสดุ', { amount: 1000000 });
  const pr = e.u('proc').procurement;
  assert.deepEqual(fieldsOf(() => pr.purchase({ approval_code: a.code, vendor: 'ร้านสมมติ', amount: 1000001, egp_no: 'E-1' })), ['amount']);
  assert.deepEqual(fieldsOf(() => pr.purchase({ approval_code: a.code, vendor: 'ร้านสมมติ', amount: 1000, egp_no: '' })), ['egp_no']);
  const other = routed(e, 'สำรองจ่าย', { amount: 5000 });
  assert.deepEqual(fieldsOf(() => pr.purchase({ approval_code: other.code, vendor: 'ร้านสมมติ', amount: 1000, egp_no: 'E-2' })), ['approval_code']);
  const p = pr.purchase({ approval_code: a.code, vendor: 'ร้านสมมติ', amount: 900000, egp_no: 'E-3' });
  assert.equal(p.status, 'จัดซื้อแล้ว');
  assert.throws(() => e.u('finance').procurement.purchase({ approval_code: a.code, vendor: 'x', amount: 1, egp_no: 'E' }), PermissionError);
});

test('ตรวจรับ: กรรมการตรวจรับ ≠ ผู้ขอซื้อ · ส่งชุดเบิกได้หลังตรวจรับเท่านั้น → การเงินกดรับ', () => {
  const e = env3();
  const a = routed(e, 'วัสดุ');
  const p = e.u('proc').procurement.purchase({ approval_code: a.code, vendor: 'ร้านสมมติ', amount: 500000, egp_no: 'E-9' });
  assert.throws(() => e.u('proc').procurement.sendBundle(p.id), /ตรวจรับ/);
  // ผู้ขอซื้อ (ครูที่ขออนุมัติ) เป็นกรรมการตรวจรับเรื่องของตัวเองไม่ได้ · พัสดุผู้จัดซื้อตรวจรับของตัวเอง ≠ ผู้ขอ ผ่านได้ตามกฎ
  e.as('admin').users.create({ name: 'กรรมการ', email: E('insp'), roles: ['procurement'], appointment_ref: 'x' });
  const requesterAsProc = e.u('plan'); // ไม่ถือบทบาทพัสดุ
  assert.throws(() => requesterAsProc.procurement.inspect(p.id), PermissionError);
  // ผู้ขอซื้อที่ถือบทบาทพัสดุ
  e.as('admin').users.update(e.app.store.find('users', (u) => u.email === E('teacher2'))[0].id, { roles: ['requester', 'procurement'] }, 'ทดสอบ');
  const a2 = routed(e, 'วัสดุ', { requester: 'teacher2' });
  const p2 = e.u('proc').procurement.purchase({ approval_code: a2.code, vendor: 'ร้าน', amount: 1000, egp_no: 'E-10' });
  assert.throws(() => e.u('teacher2').procurement.inspect(p2.id), /ผู้ขอซื้อ/);
  e.app.asUser(E('insp')).procurement.inspect(p.id);
  const sent = e.u('proc').procurement.sendBundle(p.id);
  assert.equal(sent.status, 'ส่งชุดเบิกแล้ว');
  assert.equal(e.u('finance').workflow.inbox().some((x) => x.doc_id === p.id), true); // ส่ง → รับ
});

test('เงินยืม: ทำสัญญาได้เมื่อจำแนกเป็นเงินยืม · เลขสัญญาต่อปีงบ · ครบกำหนดตามค่าตั้ง (รอยืนยัน 12.11)', () => {
  const e = env3();
  const a = routed(e, 'เงินยืม', { amount: 800000 });
  const f = e.u('finance').loans;
  assert.deepEqual(fieldsOf(() => f.create({ approval_code: a.code, borrower: E('teacher'), amount: 900000 })), ['amount']);
  const l = f.create({ approval_code: a.code, borrower: E('teacher'), amount: 800000 });
  assert.equal(l.loan_no, '1/2570');
  assert.equal(l.date, '2026-11-10');
  assert.equal(l.due_date, '2026-12-10'); // 30 วัน (ค่าเริ่ม)
  assert.equal(l.status, 'ยืมอยู่');
  const nonLoan = routed(e, 'วัสดุ');
  assert.deepEqual(fieldsOf(() => f.create({ approval_code: nonLoan.code, borrower: E('teacher'), amount: 1000 })), ['approval_code']);
});

test('เงินยืมเลยกำหนด 3 วัน → สถานะ "เกินกำหนด" ขึ้นเองโดยไม่มีใครแก้', () => {
  const e = env3();
  const a = routed(e, 'เงินยืม', { amount: 800000 });
  const l = e.u('finance').loans.create({ approval_code: a.code, borrower: E('teacher'), amount: 800000 });
  e.clock.set('2026-12-10T03:00:00Z');
  assert.equal(e.u('finance').loans.list()[0].status, 'ยืมอยู่'); // ครบกำหนดวันนี้ ยังไม่เกิน
  e.clock.set('2026-12-13T03:00:00Z');
  const row = e.u('finance').loans.list()[0];
  assert.equal(row.status, 'เกินกำหนด'); assert.equal(row.overdue_days, 3);
  assert.equal(l.id, row.id);
});

test('ผู้มีเงินยืมเกินกำหนดค้าง ยืมใหม่ไม่ได้ (block)', () => {
  const e = env3();
  const a = routed(e, 'เงินยืม', { amount: 800000 });
  e.u('finance').loans.create({ approval_code: a.code, borrower: E('teacher'), amount: 400000 });
  e.clock.set('2026-12-20T03:00:00Z');
  const b = routed(e, 'เงินยืม', { amount: 100000 });
  assert.deepEqual(fieldsOf(() => e.u('finance').loans.create({ approval_code: b.code, borrower: E('teacher'), amount: 100000 })), ['borrower']);
  assert.ok(e.u('finance').loans.create({ approval_code: b.code, borrower: E('teacher2'), amount: 100000 })); // คนอื่นยืมได้
});

test('เงินยืม: ส่งใช้ด้วยหลักฐาน (payment_lines ส่งใช้เงินยืม) ครบยอด → ส่งใช้แล้ว · ไม่เกินกำหนดอีก', () => {
  const e = env3();
  const a = routed(e, 'เงินยืม', { amount: 800000 });
  const l = e.u('finance').loans.create({ approval_code: a.code, borrower: E('teacher'), amount: 800000 });
  const shop = e.u('finance').payees.create({ name: 'ร้านหลักฐาน', tax_form: 'ไม่มีภาษี', pay_method: 'เช็ค' });
  e.u('finance').payments.createLine({ approval_code: a.code, date: '2026-11-20', kind: 'ส่งใช้เงินยืม', payee_id: shop.id, vendor_doc_no: 'R-1', description: 'หลักฐานค่าใช้จ่าย', base_amount: 500000, loan_id: l.id });
  assert.equal(e.u('finance').loans.list()[0].settled_docs, 500000);
  assert.equal(e.u('finance').loans.list()[0].status, 'ยืมอยู่');
  e.u('finance').payments.createLine({ approval_code: a.code, date: '2026-11-21', kind: 'ส่งใช้เงินยืม', payee_id: shop.id, vendor_doc_no: 'R-2', description: 'หลักฐานค่าใช้จ่าย', base_amount: 300000, loan_id: l.id });
  e.clock.set('2027-01-20T03:00:00Z');
  const row = e.u('finance').loans.list()[0];
  assert.equal(row.status, 'ส่งใช้แล้ว'); assert.equal(row.settled_docs, 800000);
});
