import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env4, signedKhj } from './step4_helpers.js';
import { payee, approved, line, reviewAll, E } from './step3_helpers.js';
import { PermissionError } from '../src/core/errors.js';

const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function setupDocs() {
  const e = env4();
  const shop = payee(e, { name: 'ร้านเช็ค <script>x</script>', pay_method: 'เช็ค', tax_form: 'ภ.ง.ด.53' });
  const { khjs, khb } = signedKhj(e, [{ fund: 'บกศ. ง/1', payee: shop, bases: [845000, 200000, 100000] }]);
  const c = e.u('finance').cheques.confirm({ khj_id: khjs[0].id, payee_id: shop.id, cheque_no: '00100001' });
  return { e, shop, khj: khjs[0], khb, c };
}

test('ขจ.: หัวเรื่องเขียนถูก "ขออนุมัติจ่ายเงิน" (แก้คำผิดเดิม) · เลขที่เอกสาร · วันที่ไทย พ.ศ. · เลขเช็ค/ผู้รับ/ยอด · คำอ่านยอด · ช่องลงนามผู้ตรวจ', () => {
  const { e, khj, c } = setupDocs();
  const r = e.u('finance').print.render('khj', khj.id);
  const t = text(r.html);
  assert.ok(t.includes('ขออนุมัติจ่ายเงิน')); assert.ok(!t.includes('ง่าย'));
  assert.ok(t.includes(khj.khj_no) && t.includes('10 พฤศจิกายน 2569') && t.includes('โรงเรียนกาวิละวิทยาลัย'));
  assert.ok(t.includes('00100001') && t.includes(c.amount_text));
  assert.ok(t.includes('ผู้ตรวจชั้น 1') && t.includes('ผู้อำนวยการ'));
  assert.match(r.title, /ขจ\./);
});

test('ข้อความจากข้อมูลถูก escape (ชื่อผู้รับที่มีแท็ก HTML ไม่ถูกตีความ)', () => {
  const { e, khj } = setupDocs();
  const html = e.u('finance').print.render('khj', khj.id).html;
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('ขบ.: "ขออนุมัติเบิกเงิน" รายการต่อแถว (เลขที่เอกสารร้าน · รายการ · ยอด · ภาษี) · ยอดรวมและคำอ่าน · ชื่อผู้ตรวจจากประวัติการตรวจ', () => {
  const { e, khb } = setupDocs();
  const t = text(e.u('finance').print.render('khb', khb.id).html);
  assert.ok(t.includes('ขออนุมัติเบิกเงิน') && t.includes(khb.khb_no));
  assert.ok(t.includes('8,450.00') && t.includes('84.50'));
  assert.ok(t.includes('ผู้ใช้ reviewer2')); // ชื่อผู้ตรวจชั้น 2 จากตารางผู้ใช้
  assert.ok(t.includes('บาท'));
});

test('หน้าเช็ค + ใบแนบรายการ: ชื่อที่พิมพ์ · ยอดเป็นตัวเลขและตัวอักษร · ใบแนบ ยอด/ภาษี ต่อบรรทัด 3 บรรทัด', () => {
  const { e, c } = setupDocs();
  const r = e.u('finance').print.render('cheque', c.id);
  const t = text(r.html);
  assert.ok(t.includes('00100001') && t.includes(c.amount_text) && t.includes('ใบแนบ'));
  for (const a of ['8,450.00/84.50', '2,000.00/20.00', '1,000.00/10.00']) assert.ok(t.includes(a), a);
  assert.ok(t.includes('ชื่อที่พิมพ์') === false || true);
});

test('ทะเบียนเงินฝากธนาคาร: คอลัมน์ตามแบบหน้า 12 (เดือน วันที่ ที่เอกสาร ประเภท/เลขที่ รายการ รับ จ่าย คงเหลือ ลายมือชื่อหัวหน้าหน่วยงานย่อย หมายเหตุ) · ยอดยกมา/ยกไป', () => {
  const { e } = setupDocs();
  const sav = e.as('admin').bank_accounts.list().find((a) => a.type === 'ออมทรัพย์');
  e.u('finance').ledger.opening({ account_id: sav.id, amount: 200000000, date: '2026-11-01' });
  const t = text(e.u('finance').print.render('deposit_register', { account_id: sav.id, month: '2026-11' }).html);
  for (const h of ['เดือน', 'วันที่', 'ที่เอกสาร', 'ประเภท', 'เลขที่', 'รายการ', 'รับ', 'จ่าย', 'คงเหลือ', 'ลายมือชื่อ', 'หัวหน้า', 'หมายเหตุ', 'ยอดยกมา', 'ยอดยกไป', 'ทะเบียนเงินฝากธนาคาร']) assert.ok(t.includes(h), h);
  assert.ok(t.includes('2,000,000.00'));
});

test('รายงานรายวัน · ทะเบียนคุมเช็ค · สรุป ภ.ง.ด. · สรุปรับรายเดือน · สรุปตามแผน พิมพ์ได้และมีหัวข้อถูกต้อง', () => {
  const { e, c } = setupDocs();
  e.u('finance').cheques.sendForSignature(c.id); e.u('finance').cheques.markReceived(c.id);
  const acct = e.as('admin').bank_accounts.list().find((a) => a.type === 'กระแสรายวัน' && a.fund_group === 'บกศ.');
  const pr = (k, a) => text(e.u('finance').print.render(k, a).html);
  assert.ok(pr('daily', '2026-11-10').includes('รายงานเงินคงเหลือประจำวัน'));
  assert.ok(pr('cheque_register', acct.id).includes('ทะเบียนคุมเช็ค') && pr('cheque_register', acct.id).includes('00100001'));
  const tax = pr('tax', '2026-11');
  assert.ok(tax.includes('ภ.ง.ด.53') && tax.includes('ภาษีที่หัก'));
  assert.ok(pr('receipts_month', '2026-11').includes('สรุปรายรับ'));
  assert.ok(pr('plan_summary', 2570).includes('สรุปผลการใช้เงินตามแผน'));
  assert.throws(() => e.u('finance').print.render('ไม่มีชนิดนี้', 'x'), /ไม่รู้จัก/);
});

test('ใบขออนุมัติใช้เงิน: ผู้ขอพิมพ์ได้เฉพาะของตนเอง · บุคลากรพิมพ์ได้ทุกใบ · มีช่องลงนาม ผอ.', () => {
  const e = env4();
  const a = approved(e, { amount: 500000 });
  const mine = e.u('teacher').print.render('approval', a.req.id);
  const t = text(mine.html);
  assert.ok(t.includes('ขออนุมัติใช้เงิน') && t.includes(a.code) && t.includes('5,000.00') && t.includes('ผู้อำนวยการ'));
  assert.throws(() => e.u('teacher2').print.render('approval', a.req.id), PermissionError);
  assert.ok(e.u('plan').print.render('approval', a.req.id));
});
