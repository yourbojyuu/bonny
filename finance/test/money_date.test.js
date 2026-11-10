import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSatang, formatSatang } from '../src/core/money.js';
import { fiscalYearOf, formatThaiDate, formatThaiDateShort, todayInBangkok, toBE, daysBetween } from '../src/core/thaidate.js';

test('เงิน: แปลงบาทเป็นสตางค์จำนวนเต็ม ไม่มีเศษทศนิยมลอย', () => {
  assert.equal(toSatang('1,234.50'), 123450);
  assert.equal(toSatang(467.29), 46729);
  assert.equal(toSatang('467.10'), 46710);
  assert.equal(toSatang(0.1 + 0.2), 30);
  assert.equal(toSatang('-5'), -500);
});

test('เงิน: ปฏิเสธทศนิยมเกิน 2 ตำแหน่งและข้อความที่ไม่ใช่ตัวเลข', () => {
  assert.throws(() => toSatang('1.234'));
  assert.throws(() => toSatang('abc'));
  assert.throws(() => toSatang(''));
  assert.throws(() => toSatang(null));
});

test('เงิน: แสดงผลแบบมีจุลภาคและ 2 ตำแหน่ง', () => {
  assert.equal(formatSatang(123450), '1,234.50');
  assert.equal(formatSatang(0), '0.00');
  assert.equal(formatSatang(-5), '-0.05');
  assert.equal(formatSatang(100000000), '1,000,000.00');
});

test('ปีงบ ต.ค.–ก.ย. เป็น พ.ศ.', () => {
  assert.equal(fiscalYearOf('2026-09-30'), 2569);
  assert.equal(fiscalYearOf('2026-10-01'), 2570);
  assert.equal(fiscalYearOf('2026-11-10'), 2570);
  assert.equal(fiscalYearOf('2026-11-10', 1), 2569); // ถ้าตั้งเริ่มเดือน 1
  assert.equal(toBE(2026), 2569);
});

test('วันที่ไทยคำนวณในโค้ด ไม่พึ่ง locale', () => {
  assert.equal(formatThaiDate('2026-11-10'), '10 พฤศจิกายน 2569');
  assert.equal(formatThaiDateShort('2026-10-01'), '1 ต.ค. 2569');
  assert.throws(() => formatThaiDate('2026-02-30'));
});

test('วันนี้ตามเวลาไทย (UTC+7)', () => {
  assert.equal(todayInBangkok(new Date('2026-11-09T16:59:59Z')), '2026-11-09');
  assert.equal(todayInBangkok(new Date('2026-11-09T17:00:00Z')), '2026-11-10');
  assert.equal(daysBetween('2026-11-10', '2026-12-10'), 30);
});
