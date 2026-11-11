import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env3, E } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

function envD() {
  const e = env3(); const admin = e.as('admin');
  admin.users.create({ name: 'งานรายรับสมมติ', email: E('inc'), roles: ['income'], appointment_ref: 'x' });
  const sub = (code, group) => admin.subfunds.create({ code, name: `ชนิด ${code}`, group, has_collectible: false });
  sub('ก/20', 'บกศ.'); sub('ศูนย์กีฬา', 'รายได้');
  const fin = e.u('finance');
  fin.packages.create({ total: 150000, label: 'P', lines: ['ก/20=100000', 'ศูนย์กีฬา=50000'], channels: [] });
  const sav = (g) => e.u('admin').bank_accounts.list().find((a) => a.type === 'ออมทรัพย์' && a.fund_group === g);
  const r = (o) => fin.receipts.issue({ book_no: '3', date: '2026-11-10', payer: 'ผู้ชำระสมมติ', bks_cash: 100000, inc_cash: 50000, ...o });
  return { ...e, fin, inc: e.app.asUser(E('inc')), r, sav };
}

test('โต๊ะรับเงิน: จำเล่ม/เลขถัดไป/วันที่ทำงานไว้ในฐานข้อมูลจนกว่าจะสรุป', () => {
  const e = envD();
  let w = e.fin.receipts.workState();
  assert.equal(w.book, ''); assert.equal(w.next, '1'); assert.equal(w.size, 500);
  e.r({ receipt_no: '1' }); e.r({ receipt_no: '2' });
  w = e.inc.receipts.workState(); // เครื่อง/คนอื่นเห็นสถานะเดียวกัน
  assert.deepEqual([w.book, w.next, w.date, w.day.count, w.day.total], ['3', '3', '2026-11-10', 2, 300000]);
});

test('เล่มละ 500 ใบ (นับจำนวนใบในเล่ม ไม่ใช่เลขที่ เพราะเล่มจริงเริ่มเลขใดก็ได้): ใบที่ 501 ออกไม่ได้ ต้องขึ้นเล่มใหม่', () => {
  const e = envD();
  e.app.asUser(E('admin')); // ลดเพดานด้วยค่าตั้ง
  e.as('admin').settings.update('receipt_book_size', 2, 'ทดสอบ');
  e.r({ receipt_no: '1' }); e.r({ receipt_no: '2' });
  assert.equal(e.fin.receipts.workState().full, true);
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '3' })), ['book_no']);
  assert.ok(e.r({ book_no: '4', receipt_no: '1' }));
});

test('สรุปประจำวัน: ล็อกวันนั้น ออก/ยกเลิกเพิ่มไม่ได้ · ยอดเงินสดแยกกลุ่มเงิน · ไม่มีใบให้สรุปไม่ได้', () => {
  const e = envD();
  assert.deepEqual(fieldsOf(() => e.fin.receipts.closeDay('2026-11-10')), ['date']);
  const a = e.r({ receipt_no: '1' }); e.r({ receipt_no: '2' });
  e.fin.receipts.cancel(a.id, 'พิมพ์ผิด');
  const d = e.inc.receipts.closeDay('2026-11-10');
  assert.deepEqual([d.status, d.count, d.cancelled, d.cash_total, d.total], ['สรุปแล้ว', 1, 1, 150000, 150000]);
  assert.deepEqual(fieldsOf(() => e.r({ receipt_no: '3' })), ['date']);
  assert.deepEqual(fieldsOf(() => e.fin.receipts.closeDay('2026-11-10')), ['date']);
  assert.throws(() => e.fin.receipts.cancel(e.fin.receipts.list()[1].id, 'x'), /สรุปประจำวันแล้ว/);
  assert.equal(e.fin.receipts.workState().date, '2026-11-10'); // ยังไม่มีใบที่ค้างสรุป → วันนี้ของระบบ
  assert.throws(() => e.u('plan').receipts.closeDay('2026-11-10'), PermissionError);
});

test('สรุป → กรอกเลขใบนำฝาก → จับคู่กลับกับวันที่สรุป · มีใบนำฝากแล้วเปิดวันใหม่ไม่ได้', () => {
  const e = envD();
  e.r({ receipt_no: '1' }); e.r({ receipt_no: '2' });
  e.fin.receipts.closeDay('2026-11-10');
  let [d] = e.fin.receipts.daySummaries();
  const bks = d.groups.find((g) => g.group === 'บกศ.');
  assert.equal(bks.cash, 200000); assert.equal(bks.slip_no, '');
  e.fin.deposits.create({ slip_no: 'DEP-001', account_id: e.sav('บกศ.').id, date: '2026-11-11', amount: bks.cash, receipt_ids: bks.receipt_ids });
  [d] = e.fin.receipts.daySummaries();
  assert.deepEqual([d.groups.find((g) => g.group === 'บกศ.').slip_no, d.groups.find((g) => g.group === 'รายได้').slip_no], ['DEP-001', '']);
  assert.deepEqual(fieldsOf(() => e.fin.receipts.reopenDay('2026-11-10', 'แก้ไข')), ['date']);
});

test('เปิดวันใหม่ (ยังไม่ฝาก): ต้องมีเหตุผล · แก้ได้แล้วสรุปใหม่ · แถวสรุปเดิมไม่ถูกลบ', () => {
  const e = envD();
  const a = e.r({ receipt_no: '1' }); e.fin.receipts.closeDay('2026-11-10');
  assert.throws(() => e.fin.receipts.reopenDay('2026-11-10', ''));
  e.fin.receipts.reopenDay('2026-11-10', 'ยกเลิกใบผิด');
  e.fin.receipts.cancel(a.id, 'ผิดใบ'); e.r({ receipt_no: '2' });
  const d2 = e.fin.receipts.closeDay('2026-11-10');
  assert.equal(d2.count, 1);
  assert.equal(e.app.store.list('receipt_days').length, 2);
});

test('เงินแยกประเภท: รายละเอียดย่อยแยกตามชนิดเงิน มียอดสะสม ไม่นับใบยกเลิก', () => {
  const e = envD();
  const a = e.r({ receipt_no: '1' }); e.r({ receipt_no: '2' }); e.r({ receipt_no: '3' });
  e.fin.receipts.cancel(a.id, 'ผิด');
  const { funds } = e.fin.receipts.byFund('2026-11');
  const k = funds.find((f) => f.subfund_code === 'ก/20');
  assert.deepEqual([k.total, k.lines.length, k.lines[1].balance, k.group], [200000, 2, 200000, 'บกศ.']);
  assert.equal(funds.find((f) => f.subfund_code === 'ศูนย์กีฬา').total, 100000);
});

test('บันทึกใบเสร็จโดยไม่ต้องมีผู้ชำระเงิน · workState ส่งใบล่าสุดของเล่มไว้โชว์ (ไม่เกิน 4 ใบ ไม่นับยกเลิก)', () => {
  const e = envD();
  const a = e.fin.receipts.issue({ book_no: '3', receipt_no: '1', date: '2026-11-10', bks_cash: 100000, inc_cash: 50000 });
  assert.equal(a.payer, '');
  for (let i = 2; i <= 6; i++) e.fin.receipts.issue({ book_no: '3', receipt_no: String(i), date: '2026-11-10', bks_cash: 100000, inc_cash: 50000 });
  e.fin.receipts.cancel(e.fin.receipts.list()[5].id, 'ผิด');
  const w = e.fin.receipts.workState();
  assert.deepEqual(w.recent.map((x) => x.no), ['2', '3', '4', '5']);
  assert.deepEqual([w.recent[0].cash, w.recent[0].bks, w.recent[0].inc], [150000, 100000, 50000]);
});
