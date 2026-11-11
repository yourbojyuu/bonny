import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, EMAILS, fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';
import { isAccountRecentlyChanged } from '../src/services/payees.js';

const shop = (o = {}) => ({ name: 'ร้านสมมติ ก', short_name: 'ร้าน ก', cheque_print_name: 'ร้านสมมติ ก', type: 'นิติบุคคล', tax_form: 'ภ.ง.ด.53', pay_method: 'เช็ค', ...o });

test('ผู้รับเงิน: วิธีจ่ายต้องระบุเอง ไม่มีค่าเริ่มต้นเป็นเช็ค', () => {
  const fin = setup().as('finance');
  const { pay_method, ...noMethod } = shop();
  assert.deepEqual(fieldsOf(() => fin.payees.create(noMethod)), ['pay_method']);
  assert.deepEqual(fieldsOf(() => fin.payees.create(shop({ pay_method: 'check' }))), ['pay_method']);
});

test('ผู้รับเงิน: ประเภทภาษีต้องอยู่ในรายการ · ชื่อห้ามซ้ำ · ชี้ช่องที่ผิด', () => {
  const fin = setup().as('finance');
  assert.deepEqual(fieldsOf(() => fin.payees.create(shop({ tax_form: 'ภงด53' }))), ['tax_form']);
  assert.deepEqual(fieldsOf(() => fin.payees.create(shop({ name: '', tax_form: 'x' }))), ['name', 'tax_form']);
  fin.payees.create(shop());
  assert.deepEqual(fieldsOf(() => fin.payees.create(shop({ name: ' ร้านสมมติ ก ' }))), ['name']);
});

test('วิธีจ่ายเพิ่มได้จาก settings (ไม่ hardcode)', () => {
  const env = setup();
  const fin = env.as('finance');
  assert.ok(fin.payees.create(shop({ name: 'การไฟฟ้าสมมติ', pay_method: 'ออนไลน์' })));
  assert.deepEqual(fieldsOf(() => fin.payees.create(shop({ name: 'ร้าน ข', pay_method: 'พร้อมเพย์' }))), ['pay_method']);
  env.as('admin').settings.update('pay_methods', ['KTB', 'เช็ค', 'ออนไลน์', 'พร้อมเพย์'], 'เพิ่มช่องทาง');
  assert.ok(fin.payees.create(shop({ name: 'ร้าน ข', pay_method: 'พร้อมเพย์' })));
});

test('เลขบัญชีใส่ตอนสร้างหรือแก้ตรงไม่ได้ ต้องผ่านคำขอเปลี่ยนบัญชี', () => {
  const fin = setup().as('finance');
  assert.deepEqual(fieldsOf(() => fin.payees.create(shop({ account_no: '1234567890' }))), ['account_no']);
  const p = fin.payees.create(shop());
  assert.deepEqual(fieldsOf(() => fin.payees.update(p.id, { account_no: '1234567890' }, 'x')), ['account_no']);
  assert.ok(fin.payees.update(p.id, { short_name: 'ร้าน ก ใหม่' }, 'แก้ชื่อย่อ'));
});

test('แก้เลขบัญชี: การเงินยื่นคำขอ · ผู้อนุมัติต้องไม่ใช่คนยื่น · อนุมัติแล้วจึงมีผล', () => {
  const env = setup();
  const head = env.as('head'); // การเงิน + หัวหน้าการเงิน
  const p = head.payees.create(shop({ pay_method: 'KTB' }));
  const req = head.payees.requestAccountChange(p.id, { bank: 'ธนาคารสมมติ', account_no: '000-0-12345-6', reason: 'ร้านแจ้งเปลี่ยนบัญชี (หนังสือสมมติ)' });
  assert.equal(req.status, 'รออนุมัติ');
  assert.equal(head.payees.get(p.id).account_no, ''); // ยังไม่มีผล
  assert.throws(() => head.payees.approveAccountChange(req.id), /ผู้ยื่น/); // คนยื่นอนุมัติเองไม่ได้
  assert.throws(() => env.as('finance').payees.approveAccountChange(req.id), PermissionError); // ไม่มีสิทธิ์อนุมัติ
  const done = env.as('reviewer1').payees.approveAccountChange(req.id);
  assert.equal(done.status, 'อนุมัติแล้ว');
  const after = head.payees.get(p.id);
  assert.equal(after.account_no, '0000123456');
  assert.equal(after.account_changed_at, '2026-11-10');
  assert.equal(after.account_change_approved_by, EMAILS.reviewer1);
  assert.throws(() => env.as('reviewer1').payees.approveAccountChange(req.id), /ตัดสินแล้ว/);
});

test('คำขอเปลี่ยนบัญชี: ต้องมีเหตุผล · ค้างได้ทีละคำขอ · ไม่อนุมัติต้องมีเหตุผล', () => {
  const env = setup();
  const fin = env.as('finance');
  const p = fin.payees.create(shop());
  assert.deepEqual(fieldsOf(() => fin.payees.requestAccountChange(p.id, { bank: 'ก', account_no: '1', reason: '' })), ['reason']);
  const r = fin.payees.requestAccountChange(p.id, { bank: 'ก', account_no: '1', reason: 'x' });
  assert.throws(() => fin.payees.requestAccountChange(p.id, { bank: 'ก', account_no: '2', reason: 'y' }), /รออนุมัติ/);
  assert.deepEqual(fieldsOf(() => env.as('reviewer1').payees.rejectAccountChange(r.id, '')), ['reason']);
  assert.equal(env.as('reviewer1').payees.rejectAccountChange(r.id, 'เอกสารไม่ครบ').status, 'ไม่อนุมัติ');
  assert.equal(fin.payees.get(p.id).account_no, '');
});

test('ผู้มีสิทธิ์อนุมัติเปลี่ยนบัญชีตั้งค่าได้ [รอยืนยัน]', () => {
  const env = setup();
  const fin = env.as('finance');
  const p = fin.payees.create(shop());
  const r = fin.payees.requestAccountChange(p.id, { bank: 'ก', account_no: '1', reason: 'x' });
  assert.throws(() => env.as('plan').payees.approveAccountChange(r.id), PermissionError);
  env.as('admin').settings.update('payee_account_approver_roles', ['plan'], 'ทดสอบ');
  assert.equal(env.as('plan').payees.approveAccountChange(r.id).status, 'อนุมัติแล้ว');
});

test('บัญชีที่แก้ภายใน 30 วันขึ้นธง (นับวันตามเวลาไทย · ตั้งจำนวนวันได้)', () => {
  const p = { account_changed_at: '2026-11-10' };
  assert.equal(isAccountRecentlyChanged(p, '2026-11-10', 30), true);
  assert.equal(isAccountRecentlyChanged(p, '2026-12-10', 30), true);
  assert.equal(isAccountRecentlyChanged(p, '2026-12-11', 30), false);
  assert.equal(isAccountRecentlyChanged({ account_changed_at: '' }, '2026-12-11', 30), false);
});
