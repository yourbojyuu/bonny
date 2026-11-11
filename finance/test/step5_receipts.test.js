import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env3, approved, E } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

function env5({ noA = false } = {}) {
  const e = env3();
  const admin = e.as('admin');
  admin.users.create({ name: 'กรรมการ', email: E('cmt'), roles: ['cash_committee'], appointment_ref: 'x' });
  const sub = (code, group, has_collectible = false) => admin.subfunds.create({ code, name: `ชนิด ${code}`, group, has_collectible });
  sub('ก/20', 'บกศ.'); sub('ข/3', 'บกศ.'); sub('SMS', 'รายได้', true); sub('ศูนย์กีฬา', 'รายได้');
  const fin = e.u('finance');
  const pk = (total, label, lines, channels = []) => fin.packages.create({ total, label, lines, channels });
  const pA = noA ? null : pk(232500, 'แพ็กเกจ A', ['ก/20=100000', 'ข/3=100000', 'ศูนย์กีฬา=32500']);
  const r = (o) => fin.receipts.issue({ book_no: '18655', date: '2026-11-10', payer: 'ผู้ชำระสมมติ', ...o });
  return { ...e, fin, pk, pA, r, cmt: e.app.asUser(E('cmt')) };
}

test('ใบเสร็จ: เลขต่อเนื่องในเล่ม (ใบแรกเริ่มเลขใดก็ได้) · เล่มอื่นนับแยก · ยอดรวมคำนวณจาก 5 ช่อง', () => {
  const e = env5();
  const a = e.r({ receipt_no: '833', bks_cash: 200000, inc_cash: 32500 });
  assert.equal(a.total, 232500);
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '835', bks_cash: 200000, inc_cash: 32500 })), ['receipt_no']); // ข้ามเลข
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '833', bks_cash: 200000, inc_cash: 32500 })), ['receipt_no']); // ซ้ำ
  assert.equal(e.fin.receipts.nextNo('18655'), '834');
  assert.ok(e.r({ receipt_no: '834', bks_cash: 200000, inc_cash: 32500 }));
  assert.ok(e.r({ book_no: '18656', receipt_no: '1', bks_cash: 200000, inc_cash: 32500 }));
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '835', bks_cash: 0 })), ['total']); // ยอดรวมต้อง > 0
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '835', bks_cash: -5, inc_cash: 232505 })), ['bks_cash']);
});

test('เงินโอนออกใบเสร็จได้เมื่อมีเลขอ้างอิง Kcorp (block) · เงินสดไม่ต้อง', () => {
  const e = env5();
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '1', bks_transfer: 200000, inc_cash: 32500 })), ['kcorp_ref']);
  assert.equal(e.r({ receipt_no: '1', bks_transfer: 200000, inc_cash: 32500, kcorp_ref: 'K6911100045' }).kcorp_ref, 'K6911100045');
});

test('รวมยอด → หาแพ็กเกจ → แยกชนิดเงินย่อยอัตโนมัติ · Σ ที่แยก = ยอดใบเสร็จ · ลง Ledger แยกชนิดและที่เก็บเงิน', () => {
  const e = env5();
  const a = e.r({ receipt_no: '1', bks_transfer: 200000, inc_cash: 32500, kcorp_ref: 'K1' });
  assert.deepEqual([a.split_mode, a.package_id], ['auto', e.pA.id]);
  const sp = e.fin.receipts.splits(a.id);
  assert.deepEqual(sp.map((x) => [x.subfund_code, x.amount, x.cash_amount, x.transfer_amount]), [['ก/20', 100000, 0, 100000], ['ข/3', 100000, 0, 100000], ['ศูนย์กีฬา', 32500, 32500, 0]]);
  assert.equal(sp.reduce((s, x) => s + x.amount, 0), a.total);
  const led = e.fin.ledger.list().filter((x) => x.source_type === 'receipt_split');
  assert.equal(led.reduce((s, x) => s + x.debit, 0), a.total);
  const sav = e.as('admin').bank_accounts.list().find((x) => x.type === 'ออมทรัพย์' && x.fund_group === 'บกศ.');
  assert.deepEqual(led.map((x) => x.location), [sav.id, sav.id, 'cash']); // โอน → บัญชีออมทรัพย์ของกลุ่ม · สด → เงินสด
});

test('ใบเสร็จยอด 2,325 ที่รายละเอียดต่างจากแพ็กเกจ → กด "กำหนดเอง": ต้องใส่เหตุผล และ Σ ต้องเท่า 2,325', () => {
  const e = env5({ noA: true });
  e.pk(232500, 'แพ็กเกจเฉพาะเงินสดรายได้', ['SMS=232500'], ['inc_cash=232500']);
  const input = { receipt_no: '1', bks_cash: 232500 }; // ยอดเท่ากัน แต่ช่องเงินต่างจากแพ็กเกจ
  assert.equal(e.fin.receipts.preview(input).status, 'detail_mismatch');
  assert.deepEqual(fieldsOf(() => e.r(input)), ['split']); // อัตโนมัติไม่ได้ ต้องกำหนดเอง
  const half = [{ subfund_code: 'ก/20', amount: 100000 }, { subfund_code: 'ข/3', amount: 132500 }];
  assert.deepEqual(fieldsOf(() => e.r({ ...input, split: { mode: 'manual', reason: '', splits: half } })), ['manual_reason']);
  assert.deepEqual(fieldsOf(() => e.r({ ...input, split: { mode: 'manual', reason: 'จ่ายคนละรายการ', splits: [half[0]] } })), ['splits']); // Σ ≠ 2,325
  const ok = e.r({ ...input, split: { mode: 'manual', reason: 'จ่ายคนละรายการ', splits: half } });
  assert.deepEqual([ok.split_mode, ok.manual_reason], ['manual', 'จ่ายคนละรายการ']);
  assert.equal(e.fin.receipts.splits(ok.id).reduce((s, x) => s + x.amount, 0), 232500);
});

test('ยอดเท่ากันหลายแพ็กเกจ → กำหนดเองโดยเลือกแพ็กเกจอื่น (ต้องยอดเท่ากัน) · ไม่พบแพ็กเกจ → กรอกแยกเอง', () => {
  const e = env5({ noA: true });
  const p1 = e.pk(50000, 'ตัวเลือก 1', ['ก/20=50000']);
  const p2 = e.pk(50000, 'ตัวเลือก 2', ['ข/3=50000']);
  const pOther = e.pk(60000, 'ยอดอื่น', ['ก/20=60000']);
  assert.equal(e.fin.receipts.preview({ bks_cash: 50000 }).status, 'ambiguous');
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '1', bks_cash: 50000 })), ['split']);
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '1', bks_cash: 50000, split: { mode: 'manual', reason: 'x', package_id: pOther.id } })), ['package_id']);
  const a = e.r({ receipt_no: '1', bks_cash: 50000, split: { mode: 'manual', reason: 'ผู้ปกครองระบุ', package_id: p2.id } });
  assert.deepEqual([a.split_mode, a.package_id], ['manual', p2.id]);
  assert.equal(e.fin.receipts.preview({ bks_cash: 99900 }).status, 'none');
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '2', bks_cash: 99900 })), ['split']);
  assert.ok(e.r({ receipt_no: '2', bks_cash: 99900, split: { mode: 'manual', reason: 'ไม่มีแพ็กเกจ', splits: [{ subfund_code: 'ก/20', amount: 99900 }] } }));
  assert.equal(p1.total, 50000);
});

test('ชนิดที่ตั้งยอดที่ต้องเก็บ: ต้องระบุนักเรียน · ตัดยอดค้างรายคน · รับเกินยอดค้างไม่ได้ (block)', () => {
  const e = env5({ noA: true });
  e.pk(300000, 'SMS งวด', ['SMS=300000'], []);
  assert.deepEqual(fieldsOf(() => e.fin.collectibles.set({ student_id: 'S001', subfund_code: 'ก/20', academic_year: 2569, term: '1', amount_due: 100 })), ['subfund_code']); // ไม่ตั้งยอด
  e.fin.collectibles.set({ student_id: 'S001', subfund_code: 'SMS', academic_year: 2569, term: '1', amount_due: 960000 });
  assert.deepEqual(fieldsOf(() => e.fin.collectibles.set({ student_id: 'S001', subfund_code: 'SMS', academic_year: 2569, term: '1', amount_due: 5 })), ['student_id']); // ซ้ำ
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '1', inc_cash: 300000 })), ['student_id']);
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '1', inc_cash: 300000, student_id: 'S999' })), ['splits']); // ไม่มียอดที่ต้องเก็บของคนนี้
  for (const n of ['1', '2', '3']) e.r({ receipt_no: n, inc_cash: 300000, student_id: 'S001' });
  const row = e.fin.collectibles.list()[0];
  assert.deepEqual([row.amount_due, row.paid, row.outstanding], [960000, 900000, 60000]);
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '4', inc_cash: 300000, student_id: 'S001' })), ['splits']); // เกินยอดค้าง
  e.pk(60000, 'SMS ที่เหลือ', ['SMS=60000']);
  assert.ok(e.r({ receipt_no: '4', inc_cash: 60000, student_id: 'S001' })); // พอดียอดค้าง
  assert.equal(e.fin.collectibles.list()[0].outstanding, 0);
});

test('ใบผิด: ยกเลิกด้วยสถานะ+เหตุผล (ไม่ลบ) → Ledger ตีกลับ · ยอดค้างรายคนคืน · ออกใบ "แทนใบเดิม" อ้างใบเดิม', () => {
  const e = env5({ noA: true });
  e.pk(300000, 'SMS งวด', ['SMS=300000']);
  e.fin.collectibles.set({ student_id: 'S001', subfund_code: 'SMS', academic_year: 2569, term: '1', amount_due: 960000 });
  const a = e.r({ receipt_no: '1', inc_cash: 300000, student_id: 'S001' });
  assert.deepEqual(fieldsOf(() => e.fin.receipts.cancel(a.id, '')), ['reason']);
  assert.equal(e.fin.receipts.cancel(a.id, 'พิมพ์ชื่อผิด').status, 'ยกเลิก');
  assert.throws(() => e.fin.receipts.cancel(a.id, 'ซ้ำ'), /ยกเลิกแล้ว/);
  assert.equal(e.fin.collectibles.list()[0].paid, 0);
  const led = e.fin.ledger.list().filter((x) => x.source_type.startsWith('receipt'));
  assert.deepEqual([led.reduce((s, x) => s + x.debit, 0), led.reduce((s, x) => s + x.credit, 0)], [300000, 300000]); // ตีกลับยอดเท่าเดิม
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '2', inc_cash: 300000, student_id: 'S001', replaces: 'ไม่มี' })), ['replaces']);
  const b = e.r({ receipt_no: '2', inc_cash: 300000, student_id: 'S001', replaces: a.id });
  assert.deepEqual([b.status, b.replaces], ['แทนใบเดิม', a.id]);
  assert.equal(e.fin.receipts.list().length, 2); // ไม่ลบแถว
  assert.equal(e.fin.receipts.delete, undefined);
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '3', inc_cash: 300000, student_id: 'S001', replaces: b.id })), ['replaces']); // ใบที่ใช้อยู่ไม่ได้ยกเลิก
});

test('เงินยืม: คืนเงินสดด้วยใบเสร็จอ้างสัญญา → ครบยอด (รวมหลักฐาน) สถานะ "ส่งใช้แล้ว"', () => {
  const e = env5({ noA: true });
  const a = approved(e, { amount: 800000 });
  e.u('finance').approvals.financeReceive(a.req.id); e.u('finance').approvals.classify(a.req.id, 'เงินยืม');
  const loan = e.fin.loans.create({ approval_code: a.code, borrower: E('teacher'), amount: 800000 });
  const rc = e.r({ receipt_no: '1', other: 800000, loan_id: loan.id });
  assert.equal(rc.total, 800000);
  assert.equal(e.fin.receipts.splits(rc.id).length, 0); // คืนเงินยืมไม่ใช่รายได้
  const row = e.fin.loans.list()[0];
  assert.deepEqual([row.settled_cash, row.status], [800000, 'ส่งใช้แล้ว']);
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '2', other: 100, loan_id: 'ไม่มี' })), ['loan_id']);
});

test('สรุปรายรับรายเดือน แยกชนิดเงินย่อย: ยอดที่ต้องเก็บ · เงินสด · โอน · รับรวม · ค้างชำระ · % ที่เก็บได้', () => {
  const e = env5({ noA: true });
  e.pk(300000, 'SMS งวด', ['SMS=300000']);
  e.fin.collectibles.set({ student_id: 'S001', subfund_code: 'SMS', academic_year: 2569, term: '1', amount_due: 960000 });
  e.r({ receipt_no: '1', inc_cash: 300000, student_id: 'S001' });
  e.r({ receipt_no: '2', inc_transfer: 300000, student_id: 'S001', kcorp_ref: 'K2' });
  const s = e.fin.receipts.monthlySummary('2026-11');
  const row = s.rows.find((x) => x.subfund_code === 'SMS');
  assert.deepEqual([row.due, row.cash, row.transfer, row.total, row.outstanding, row.pct], [960000, 300000, 300000, 600000, 360000, 62.5]);
  assert.equal(s.rows.find((x) => x.subfund_code === 'ก/20'), undefined); // ไม่มีรับในเดือนนี้
  assert.equal(e.fin.receipts.monthlySummary('2026-12').rows.length, 0);
});

test('ชนิดเงินย่อยตั้งต้นจากหัวคอลัมน์ใบเสร็จ69 (รอยืนยัน 12.13) · ตั้งซ้ำไม่เพิ่ม', () => {
  const e = env3();
  const first = e.as('admin').subfunds.seedDefaults();
  assert.equal(first.created, 13);
  assert.equal(e.as('admin').subfunds.seedDefaults().created, 0);
  const sms = e.as('admin').subfunds.list().find((x) => x.code === 'SMS');
  assert.deepEqual([sms.group, sms.has_collectible], ['รายได้', true]);
  assert.equal(e.as('admin').subfunds.list().find((x) => x.code === 'ศูนย์กีฬา').has_collectible, false);
});

test('เฉพาะการเงินออกใบเสร็จ (กรรมการเก็บรักษาเงิน/ครูทำไม่ได้) · ผู้ตรวจสอบอ่านได้', () => {
  const e = env5();
  assert.throws(() => e.cmt.receipts.issue({ book_no: '1', receipt_no: '1', date: '2026-11-10', payer: 'x', bks_cash: 100 }), PermissionError);
  assert.throws(() => e.u('teacher').receipts.issue({ book_no: '1', receipt_no: '1', date: '2026-11-10', payer: 'x', bks_cash: 100 }), PermissionError);
  e.r({ receipt_no: '1', bks_cash: 200000, inc_cash: 32500 });
  assert.equal(e.as('auditor').receipts.list().length, 1);
});
