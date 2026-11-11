import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env3, E } from './step3_helpers.js';
import { parseCsv } from '../src/core/csv.js';
import { PermissionError } from '../src/core/errors.js';

function env8() {
  const e = env3();
  const admin = e.as('admin');
  for (const [code, g] of [['ก/20', 'บกศ.'], ['ข/3', 'บกศ.'], ['SMS', 'รายได้']]) admin.subfunds.create({ code, name: code, group: g, has_collectible: false });
  const accts = admin.bank_accounts.list();
  return { ...e, fin: e.u('finance'), sav: accts.find((a) => a.type === 'ออมทรัพย์' && a.fund_group === 'บกศ.') };
}

test('CSV: ตัดตัวคั่นหลายแบบ (, หรือ Tab) · เครื่องหมายคำพูด · BOM · บรรทัดว่าง', () => {
  assert.deepEqual(parseCsv('﻿a,"b,c",d\n\n1,2,3\n'), [['a', 'b,c', 'd'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('"x ""q"" y",z'), [['x "q" y', 'z']]);
});

// รูปแบบตามชีต "รายชื่อ": คอลัมน์ D = ชื่อ · E = วิธีจ่าย · F = ภาษี
const payeeCsv = [
  'A,B,C,ชื่อ,วิธีจ่าย,ภาษี',
  ',,,ร้านสมมติ หนึ่ง,KTB,ภ.ง.ด.53',
  ',,,ร้านสมมติ สอง,check,ภ.ง.ด.3',
  ',,,ร้านสมมติ สาม,,ภ.ง.ด.53', // วิธีจ่ายว่าง ห้าม default เป็นเช็ค
  ',,,ร้านสมมติ สี่,เช็ค,', // ภาษีว่าง
  ',,,ร้านสมมติ หนึ่ง,KTB,ภ.ง.ด.53', // ซ้ำในไฟล์
  ',,,,,',
].join('\n');

test('ย้ายผู้รับเงิน: ตรวจก่อน (dry-run) ไม่เขียนข้อมูล · ค่าว่างห้ามเดา (ต้องยืนยัน) · "check" = เช็ค · ซ้ำถูกข้าม', () => {
  const e = env8();
  const r = e.fin.migrate.payees({ text: payeeCsv });
  assert.equal(r.committed, false);
  assert.deepEqual([r.ready.length, r.needs_confirmation.length, r.duplicates.length], [2, 2, 1]);
  assert.deepEqual(r.ready.map((x) => [x.name, x.pay_method, x.tax_form]), [['ร้านสมมติ หนึ่ง', 'KTB', 'ภ.ง.ด.53'], ['ร้านสมมติ สอง', 'เช็ค', 'ภ.ง.ด.3']]);
  assert.deepEqual(r.needs_confirmation.map((x) => [x.row, x.missing]), [[4, ['pay_method']], [5, ['tax_form']]]);
  assert.equal(e.fin.payees.list().length, 0);
});

test('ย้ายผู้รับเงิน: นำเข้าเฉพาะแถวที่ครบ · แถวที่ต้องยืนยันนำเข้าได้เมื่อผู้ใช้ระบุค่า (ตรวจกับรายการตั้งค่า)', () => {
  const e = env8();
  const done = e.fin.migrate.payees({ text: payeeCsv, commit: true });
  assert.deepEqual([done.committed, done.imported], [true, 2]);
  assert.equal(e.fin.payees.list().length, 2);
  assert.deepEqual(e.fin.migrate.payees({ text: payeeCsv, commit: true }).duplicates.length, 3); // รันซ้ำ: ทุกแถวที่ครบกลายเป็นซ้ำ
  const bad = e.fin.migrate.payees({ text: payeeCsv, commit: true, overrides: { 4: { pay_method: 'พร้อมเพย์' } } });
  assert.equal(bad.errors.length, 1); assert.equal(bad.errors[0].row, 4);
  const ok = e.fin.migrate.payees({ text: payeeCsv, commit: true, overrides: { 4: { pay_method: 'ออนไลน์' }, 5: { tax_form: 'ไม่มีภาษี' } } });
  assert.equal(ok.imported, 2);
  assert.equal(e.fin.payees.list().find((p) => p.name === 'ร้านสมมติ สาม').pay_method, 'ออนไลน์');
});

// แพ็กเกจ: คอลัมน์แรก = ยอดรวม (บาท) · คอลัมน์สอง = ชื่อ · หัวคอลัมน์ที่เหลือ = รหัสชนิดเงินย่อย
const pkgCsv = ['ยอดรวม,ชื่อ,ก/20,ข/3,SMS', '2325,แพ็กเกจ A,1000,1325,', '2325,แพ็กเกจ B,2325,,', '500,ยอดผิด,100,100,', '300,ชนิดไม่มี,ZZ,,'].join('\n');
test('ย้ายแพ็กเกจ: ยอดรวมซ้ำได้ · Σ ไม่เท่ายอดรวม/ชนิดที่ไม่มีในระบบ = แถวผิด (ไม่นำเข้า)', () => {
  const e = env8();
  const r = e.fin.migrate.packages({ text: pkgCsv });
  assert.deepEqual([r.ready.length, r.errors.map((x) => x.row)], [2, [4, 5]]);
  const d = e.fin.migrate.packages({ text: pkgCsv, commit: true });
  assert.equal(d.imported, 2);
  assert.deepEqual(e.fin.packages.list().map((p) => [p.total, p.lines]), [[232500, ['ก/20=100000', 'ข/3=132500']], [232500, ['ก/20=232500']]]);
});

// ยอดยกมา: account_no, ยอด, ยอดตาม statement วันนั้น, วันที่
test('ยอดยกมา: ต้องตรงกับ statement วันนั้นก่อนเปิดใช้ (ไม่ตรงบันทึกไม่ได้ทั้งชุด) · บัญชีเดียวตั้งซ้ำไม่ได้', () => {
  const e = env8();
  const acct = e.sav.account_no;
  const bad = e.fin.migrate.opening({ text: `account_no,ยอด,statement,วันที่\n${acct},"5,000.00","4,999.00",2026-11-01`, commit: true });
  assert.deepEqual([bad.imported, bad.errors.length], [0, 1]);
  assert.equal(e.fin.ledger.list().length, 0);
  const ok = e.fin.migrate.opening({ text: `account_no,ยอด,statement,วันที่\n${acct},"5,000.00","5,000.00",2026-11-01`, commit: true });
  assert.equal(ok.imported, 1);
  assert.equal(e.fin.ledger.list().find((x) => x.source_type === 'opening').debit, 500000);
  const again = e.fin.migrate.opening({ text: `account_no,ยอด,statement,วันที่\n${acct},"1.00","1.00",2026-11-02`, commit: true });
  assert.deepEqual([again.imported, again.errors.length], [0, 1]);
  assert.equal(e.fin.migrate.opening({ text: 'account_no,ยอด,statement,วันที่\n9999,1,1,2026-11-01' }).errors.length, 1); // ไม่พบบัญชี
});

// เงินยืม: ผู้ยืม (อีเมล), ยอด, วันที่ยืม, ครบกำหนด, ส่งใช้แล้ว (บาท), วันที่ส่งใช้, สถานะเดิม
const loanCsv = ['ผู้ยืม,ยอด,วันที่ยืม,ครบกำหนด,ส่งใช้,วันส่งใช้,สถานะเดิม',
  'teacher@kwc.ac.th,"8,000.00",2026-09-01,2026-10-01,,,ส่งใช้แล้ว', // พิมพ์มือว่าส่งใช้แล้วแต่ไม่มีวันที่/ยอด
  'teacher2@kwc.ac.th,"5,000.00",2026-10-20,,,,ยังไม่ส่ง',
  'teacher@kwc.ac.th,"3,000.00",2026-08-01,2026-09-01,"3,000.00",2026-08-20,ส่งใช้แล้ว'].join('\n');
test('ย้ายเงินยืม: ทิ้งสถานะที่พิมพ์มือแล้วคำนวณใหม่จากวันที่ · ส่งใช้ไม่มีวันที่ = ต้องยืนยัน · ครบกำหนดว่าง = ตามค่าตั้ง', () => {
  const e = env8();
  const r = e.fin.migrate.loans({ text: loanCsv });
  assert.deepEqual([r.ready.length, r.needs_confirmation.map((x) => x.row)], [2, [2]]); // แถว 2: ยืมมาแล้วสถานะเดิมบอกส่งใช้แล้วแต่ไม่มียอด/วันที่ส่งใช้
  e.fin.migrate.loans({ text: loanCsv, commit: true });
  e.clock.set('2026-12-01T03:00:00Z');
  const rows = e.fin.loans.list();
  assert.equal(rows.length, 2);
  const l2 = rows.find((x) => x.borrower === 'teacher2@kwc.ac.th');
  assert.deepEqual([l2.due_date, l2.status], ['2026-11-19', 'เกินกำหนด']); // 2026-10-20 + 30 วัน
  assert.equal(rows.find((x) => x.amount === 300000).status, 'ส่งใช้แล้ว');
  assert.deepEqual(rows.map((x) => x.loan_no).sort(), ['1/2569', '1/2570']); // เลขสัญญาต่อปีงบ ตามวันที่ยืม
});

// รายการ (หน้ารายการเดิม): หัวคอลัมน์มีคำว่า ขบ และ ขอเบิก · ทะเบียน ขบ.: ขบ และ ยอดรวม
const lines = ['วันที่,ชื่อ,ชนิด,ขบ.,ขอเบิก', '2026-01-02,ร้าน ก,เบิก,895,"1,000.00"', '2026-01-02,ร้าน ก,เบิก,895,"1,000.00"', '2026-01-03,ร้าน ข,เบิก,896,"500.00"', '2026-01-04,ร้าน ค,เบิก,xx/yy,"70.00"', '2026-01-05,ร้าน ง,ภาษี,ภาษี,"10.00"', '2026-01-06,ร้าน จ,เบิก,,"20.00"', '2026-01-07,ร้าน ฉ,เบิก,-,"5.00"', '2026-01-08,ร้าน ช,เบิก,897,"100.00"'].join('\n');
const reg = ['ขบ.,ยอดรวม,ขจ.', '895,"2,000.00",12', '896,"600.00",', '897,"100.00",13'].join('\n');
test('รายงานตรวจก่อนย้ายข้อมูล: แถวเหมือนกันทุกช่อง · รูปแบบเลข ขบ. ปนกัน · ยอดตามเลข ขบ. ไม่ตรงทะเบียน · ทะเบียน ขบ. ไม่มีเลข ขจ.', () => {
  const e = env8();
  const r = e.fin.migrate.audit({ lines_text: lines, khb_text: reg });
  assert.deepEqual(r.duplicates.map((g) => g.rows), [[2, 3]]); // แถว 2 กับ 3 เหมือนกันทุกช่อง (นับเลขแถวรวมหัว)
  assert.deepEqual(r.khb_formats, { number: 4, slash: 1, blank: 1, tax: 1, dash: 1 });
  assert.deepEqual(r.khb_mismatch.map((x) => [x.khb, x.lines_total, x.register_total]), [['896', 50000, 60000]]); // 895 และ 897 ตรง
  assert.deepEqual(r.register_missing_khj.map((x) => x.khb), ['896']);
});

test('เครื่องมือย้ายข้อมูลใช้ได้เฉพาะการเงิน (ผู้ดูแลระบบทำรายการเงินไม่ได้)', () => {
  const e = env8();
  assert.throws(() => e.as('admin').migrate.payees({ text: payeeCsv }), PermissionError);
  assert.throws(() => e.u('plan').migrate.opening({ text: 'x' }), PermissionError);
  assert.ok(e.as('auditor').migrate.audit({ lines_text: lines, khb_text: reg }));
});
