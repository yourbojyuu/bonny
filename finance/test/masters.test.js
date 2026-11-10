import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seedBankAndFund, fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

// ---------- บัญชีธนาคาร ----------

test('บัญชีธนาคาร: ชนิด/กลุ่มเงินต้องอยู่ในรายการ · เลขบัญชีเก็บเฉพาะตัวเลข · ห้ามซ้ำ', () => {
  const env = setup();
  const admin = env.as('admin');
  const base = { account_no: '111-1-11111-1', bank: 'ธนาคารสมมติ', branch: 'สาขาสมมติ', type: 'ออมทรัพย์', fund_group: 'รายได้' };
  assert.deepEqual(fieldsOf(() => admin.bank_accounts.create({ ...base, type: 'ฝากประจำ' })), ['type']);
  assert.deepEqual(fieldsOf(() => admin.bank_accounts.create({ ...base, fund_group: 'อื่น' })), ['fund_group']);
  assert.deepEqual(fieldsOf(() => admin.bank_accounts.create({ ...base, account_no: '12a' })), ['account_no']);
  const a = admin.bank_accounts.create(base);
  assert.equal(a.account_no, '1111111111');
  assert.deepEqual(fieldsOf(() => admin.bank_accounts.create(base)), ['account_no']);
});

test('บัญชีกระแสรายวันจับคู่บัญชีออมทรัพย์กลุ่มเงินเดียวกันเท่านั้น (คู่ OTID)', () => {
  const env = setup();
  const admin = env.as('admin');
  const sav = admin.bank_accounts.create({ account_no: '1', bank: 'ก', branch: 'ข', type: 'ออมทรัพย์', fund_group: 'รายได้' });
  const cur = { account_no: '2', bank: 'ก', branch: 'ข', type: 'กระแสรายวัน', linked_account_id: sav.id };
  assert.deepEqual(fieldsOf(() => admin.bank_accounts.create({ ...cur, fund_group: 'บกศ.' })), ['linked_account_id']);
  assert.deepEqual(fieldsOf(() => admin.bank_accounts.create({ ...cur, fund_group: 'รายได้', linked_account_id: 'ไม่มี' })), ['linked_account_id']);
  assert.ok(admin.bank_accounts.create({ ...cur, fund_group: 'รายได้' }));
});

// ---------- ประเภทเงิน / ชนิดเงินย่อย ----------

test('ประเภทเงิน: กลุ่มเงินต้องตรงกับบัญชีธนาคาร · รหัสห้ามซ้ำ', () => {
  const env = setup();
  const { cur } = seedBankAndFund(env);
  const admin = env.as('admin');
  assert.deepEqual(fieldsOf(() => admin.funds.create({ fund_code: 'อน.รห.', name: 'x', fund_group: 'อุดหนุน', bank_account_id: cur.id })), ['bank_account_id']);
  assert.deepEqual(fieldsOf(() => admin.funds.create({ fund_code: 'บกศ. ง/1', name: 'x', fund_group: 'บกศ.', bank_account_id: cur.id })), ['fund_code']);
  assert.throws(() => env.as('finance').funds.create({ fund_code: 'y', name: 'y', fund_group: 'บกศ.', bank_account_id: cur.id }), PermissionError);
});

test('ชนิดเงินย่อย (ฝั่งรับ): รหัสห้ามซ้ำ · กลุ่มต้องอยู่ในรายการ', () => {
  const env = setup();
  const admin = env.as('admin');
  admin.subfunds.create({ code: 'ง/1', name: 'ค่าจ้างครูสมมติ', group: 'บกศ.', has_collectible: true });
  assert.deepEqual(fieldsOf(() => admin.subfunds.create({ code: 'ง/1', name: 'ซ้ำ', group: 'บกศ.' })), ['code']);
  assert.deepEqual(fieldsOf(() => admin.subfunds.create({ code: 'x', name: 'x', group: 'ไม่มี' })), ['group']);
});

// ---------- สมุดเช็ค ----------

test('สมุดเช็ค: ต้องเป็นบัญชีกระแสรายวัน · ช่วงเลขถูกต้อง · ไม่ทับเล่มเดิม · หลายเล่มต่อบัญชีได้', () => {
  const env = setup();
  const { sav, cur } = seedBankAndFund(env);
  const fin = env.as('finance');
  assert.deepEqual(fieldsOf(() => fin.cheque_books.create({ bank_account_id: sav.id, first_no: '10000001', last_no: '10000050' })), ['bank_account_id']);
  assert.deepEqual(fieldsOf(() => fin.cheque_books.create({ bank_account_id: cur.id, first_no: '10000050', last_no: '10000001' })), ['last_no']);
  assert.deepEqual(fieldsOf(() => fin.cheque_books.create({ bank_account_id: cur.id, first_no: '1000001', last_no: '10000050' })), ['last_no']);
  assert.deepEqual(fieldsOf(() => fin.cheque_books.create({ bank_account_id: cur.id, first_no: '1000000A', last_no: '10000050' })), ['first_no']);
  const b1 = fin.cheque_books.create({ bank_account_id: cur.id, first_no: '00000001', last_no: '00000050' });
  assert.equal(b1.first_no, '00000001'); // เลข 0 นำหน้าต้องไม่หาย
  assert.deepEqual(fieldsOf(() => fin.cheque_books.create({ bank_account_id: cur.id, first_no: '00000050', last_no: '00000099' })), ['first_no']);
  assert.ok(fin.cheque_books.create({ bank_account_id: cur.id, first_no: '00000051', last_no: '00000100' }));
  const view = fin.cheque_books.list();
  assert.equal(view.length, 2);
  assert.equal(view[0].fund_group, 'บกศ.'); // คำนวณจากบัญชี ไม่ได้เก็บซ้ำ
  assert.throws(() => env.as('admin').cheque_books.create({ bank_account_id: cur.id, first_no: '1', last_no: '2' }), PermissionError);
});

// ---------- โครงการตามแผน ----------

test('โครงการตามแผน: งานแผนเท่านั้น · ต้องอ้างประเภทเงินที่มี · วงเงิน > 0 · ปีงบเติมให้', () => {
  const env = setup();
  seedBankAndFund(env);
  const plan = env.as('plan');
  assert.deepEqual(fieldsOf(() => plan.plan_projects.create({ name: 'โครงการสมมติ', fund_code: 'ไม่มี', budget: 100000 })), ['fund_code']);
  assert.deepEqual(fieldsOf(() => plan.plan_projects.create({ name: 'โครงการสมมติ', fund_code: 'บกศ. ง/1', budget: 0 })), ['budget']);
  assert.deepEqual(fieldsOf(() => plan.plan_projects.create({ name: 'โครงการสมมติ', fund_code: 'บกศ. ง/1', budget: 1.5 })), ['budget']);
  const p = plan.plan_projects.create({ name: 'โครงการสมมติ', fund_code: 'บกศ. ง/1', budget: 5000000 });
  assert.equal(p.fiscal_year, 2570);
  assert.equal(plan.plan_projects.list()[0].remaining, 5000000);
  assert.throws(() => env.as('finance').plan_projects.create({ name: 'x', fund_code: 'บกศ. ง/1', budget: 1 }), PermissionError);
});

test('ตารางรายการค่าใช้จ่ายที่ประเภทเงินอนุญาต: ตั้งค่าได้ อ้างประเภทเงินที่มี', () => {
  const env = setup();
  seedBankAndFund(env);
  const admin = env.as('admin');
  assert.deepEqual(fieldsOf(() => admin.fund_allowed_expense.create({ fund_code: 'ไม่มี', expense_category: 'ค่าวัสดุ' })), ['fund_code']);
  assert.ok(admin.fund_allowed_expense.create({ fund_code: 'บกศ. ง/1', expense_category: 'ค่าจ้าง' }));
});

test('ทุกคนที่ใช้งานอยู่อ่านข้อมูลหลักได้ แต่ผู้ตรวจสอบแก้ไม่ได้', () => {
  const env = setup();
  seedBankAndFund(env);
  assert.equal(env.as('teacher').funds.list().length, 1);
  assert.throws(() => env.as('auditor').funds.create({ fund_code: 'z', name: 'z', fund_group: 'บกศ.', bank_account_id: 'x' }), PermissionError);
});
