import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env4, signedKhj } from './step4_helpers.js';
import { payee } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { bahtText } from '../src/core/bahttext.js';
import { PermissionError } from '../src/core/errors.js';

const photo = { void_photo: 'void-1.jpg' };
function chequeEnv(specs) {
  const e = env4();
  const shop = payee(e, { name: 'ร้านเช็ค', tax_form: 'ภ.ง.ด.53', pay_method: 'เช็ค' });
  const r = signedKhj(e, specs(shop));
  const khj = r.khjs.find((j) => j.pay_method === 'เช็ค');
  return { e, shop, khj, ...r };
}

test('เช็คสร้างได้จาก ขจ. ที่ ผอ. เซ็นแล้วเท่านั้น', () => {
  const e = env4();
  const shop = payee(e, { name: 'ร้านเช็ค', pay_method: 'เช็ค', tax_form: 'ไม่มีภาษี' });
  const { khjs } = signedKhj(e, [{ fund: 'บกศ. ง/1', payee: shop, bases: [100000] }], { signKhj: false });
  assert.deepEqual(fieldsOf(() => e.u('finance').cheques.confirm({ khj_id: khjs[0].id, payee_id: shop.id, cheque_no: '00100001' })), ['khj_id']);
  assert.deepEqual(fieldsOf(() => e.u('finance').cheques.confirm({ khj_id: 'ไม่มี', payee_id: shop.id, cheque_no: '00100001' })), ['khj_id']);
});

test('ข้อเสนอเลขเช็ค: ผู้รับเดียว 3 แถวใน ขจ. เดียว → เช็ค 1 ใบ ใบแนบ 3 บรรทัด (ยอด/ภาษี) · คำอ่านจาก ขจ.', () => {
  const { e, shop, khj } = chequeEnv((s) => [{ fund: 'บกศ. ง/1', payee: s, bases: [845000, 200000, 100000] }]);
  const prop = e.u('finance').cheques.propose(khj.id);
  assert.equal(prop.length, 1);
  assert.equal(prop[0].next_no, '00100001');
  assert.equal(prop[0].line_count, 3);
  const c = e.u('finance').cheques.confirm({ khj_id: khj.id, payee_id: shop.id, cheque_no: '00100001' });
  assert.deepEqual(c.attachment, ['8,450.00/84.50', '2,000.00/20.00', '1,000.00/10.00']);
  assert.equal(c.amount, 845000 - 8450 + 200000 - 2000 + 100000 - 1000);
  assert.equal(c.amount_text, bahtText(c.amount));
  assert.equal(c.status, 'ออกแล้ว');
  assert.equal(c.print_name, 'ร้านเช็ค');
  assert.equal(e.u('finance').payments.listLines().filter((l) => l.cheque_no === '00100001').length, 3);
  assert.equal(e.u('finance').cheques.propose(khj.id).length, 0); // ออกครบแล้ว
});

test('สมุดเช็คตรงกลุ่มเงินของ ขจ. · เลขที่พิมพ์ต้องตรงกับที่ระบบเสนอ (block)', () => {
  const { e, shop, khj } = chequeEnv((s) => [{ fund: 'อน.รห.', payee: s, bases: [100000] }]);
  assert.equal(e.u('finance').cheques.propose(khj.id)[0].next_no, '00200001'); // สมุดของบัญชีอุดหนุน
  assert.deepEqual(fieldsOf(() => e.u('finance').cheques.confirm({ khj_id: khj.id, payee_id: shop.id, cheque_no: '00100001' })), ['cheque_no']); // เลขสมุดกลุ่มอื่น
  assert.deepEqual(fieldsOf(() => e.u('finance').cheques.confirm({ khj_id: khj.id, payee_id: shop.id, cheque_no: '00200005' })), ['cheque_no']); // ข้ามเลข
  assert.ok(e.u('finance').cheques.confirm({ khj_id: khj.id, payee_id: shop.id, cheque_no: '00200001' }));
});

test('เช็คพิมพ์พลาด → บันทึก "เช็คเสีย" (ต้องมีเหตุผลและรูป) → เลขถัดไปถูกใช้ · ทะเบียนคุมเช็คไม่มีเลขขาด', () => {
  const { e, shop, khj } = chequeEnv((s) => [{ fund: 'บกศ. ง/1', payee: s, bases: [100000] }]);
  const ch = e.u('finance').cheques;
  assert.deepEqual(fieldsOf(() => ch.voidCheque({ khj_id: khj.id, cheque_no: '00100001', reason: 'กระดาษติด' })), ['void_photo']);
  assert.deepEqual(fieldsOf(() => ch.voidCheque({ khj_id: khj.id, cheque_no: '00100001', ...photo, reason: '' })), ['reason']);
  assert.deepEqual(fieldsOf(() => ch.voidCheque({ khj_id: khj.id, cheque_no: '00100002', ...photo, reason: 'x' })), ['cheque_no']); // เสียต้องเริ่มที่เลขถัดไปของสมุด
  const v = ch.voidCheque({ khj_id: khj.id, cheque_no: '00100001', reason: 'กระดาษติด', ...photo });
  assert.deepEqual([v.status, v.amount], ['เสีย', 0]);
  assert.equal(ch.propose(khj.id)[0].next_no, '00100002');
  assert.deepEqual(fieldsOf(() => ch.confirm({ khj_id: khj.id, payee_id: shop.id, cheque_no: '00100001' })), ['cheque_no']); // ใช้เลขเสียซ้ำไม่ได้
  ch.confirm({ khj_id: khj.id, payee_id: shop.id, cheque_no: '00100002' });
  const reg = ch.register(e.books['บกศ.'].bank_account_id);
  assert.deepEqual(reg.rows.map((r) => [r.cheque_no, r.status]), [['00100001', 'เสีย'], ['00100002', 'ออกแล้ว']]);
  assert.equal(reg.rows[0].amount, 0);
  assert.deepEqual(reg.gaps, []); // ใช้แล้ว/เสียครบ ไม่มีเลขขาด
});

test('ทะเบียนคุมเช็ค: ทุกใบมีวันที่จ่าย ผู้รับ ยอด อ้าง ขจ. · ยอดไม่ตรง ขจ. ส่งลงนามไม่ได้', () => {
  const { e, shop, khj } = chequeEnv((s) => [{ fund: 'บกศ. ง/1', payee: s, bases: [100000] }]);
  const c = e.u('finance').cheques.confirm({ khj_id: khj.id, payee_id: shop.id, cheque_no: '00100001' });
  const row = e.u('finance').cheques.register(e.books['บกศ.'].bank_account_id).rows[0];
  assert.deepEqual([row.date, row.payee, row.khj_no], ['2026-11-10', 'ร้านเช็ค', khj.khj_no]);
  e.app.store.update({ email: 'x' }, 'cheques', c.id, { amount: c.amount + 1 }); // จำลองข้อมูลเพี้ยน
  assert.deepEqual(fieldsOf(() => e.u('finance').cheques.sendForSignature(c.id)), ['amount']);
});

test('สถานะเช็ค ออกแล้ว → ลงนามแล้ว → ผู้รับรับแล้ว · จ่ายแล้ว (ledger/ตัดยอด) เมื่อผู้รับลงชื่อรับเช็ค', () => {
  const { e, shop, khj, lines } = chequeEnv((s) => [{ fund: 'บกศ. ง/1', payee: s, bases: [100000, 200000] }]);
  const c = e.u('finance').cheques.confirm({ khj_id: khj.id, payee_id: shop.id, cheque_no: '00100001' });
  assert.throws(() => e.u('finance').cheques.markReceived(c.id), /ลงนามก่อน/);
  assert.equal(e.u('finance').cheques.sendForSignature(c.id).status, 'ลงนามแล้ว');
  assert.equal(e.u('finance').payments.listLines().every((l) => l.status !== 'จ่ายแล้ว'), true); // ยังไม่จ่าย
  const rec = e.u('finance').cheques.markReceived(c.id);
  assert.equal(rec.status, 'ผู้รับรับแล้ว');
  const ls = e.u('finance').payments.listLines().filter((l) => l.cheque_no === '00100001');
  assert.deepEqual([ls.length, ls.every((l) => l.status === 'จ่ายแล้ว'), ls[0].paid_date], [2, true, '2026-11-10']);
  const led = e.u('finance').ledger.list().filter((x) => x.source_type === 'payment_line');
  assert.equal(led.length, 2);
  assert.equal(led.reduce((s, x) => s + x.credit, 0), ls.reduce((s, l) => s + l.pay_amount, 0));
  assert.throws(() => e.u('finance').cheques.markReceived(c.id), /รับแล้ว|ผู้รับรับแล้ว/);
  assert.ok(lines.length === 2);
});

test('เฉพาะการเงินจัดการเช็ค', () => {
  const { e, shop, khj } = chequeEnv((s) => [{ fund: 'บกศ. ง/1', payee: s, bases: [100000] }]);
  assert.throws(() => e.u('plan').cheques.confirm({ khj_id: khj.id, payee_id: shop.id, cheque_no: '00100001' }), PermissionError);
  assert.throws(() => e.u('khj').cheques.propose(khj.id), PermissionError);
});
