// เงินคงเหลือประจำวัน (ผังหน้า 9): รายงาน ยกมา + รับ − จ่าย = คงเหลือ แยกประเภทเงิน → กรรมการตรวจนับเงินสด → ลงนาม → ผอ. ตรวจการจ่าย (กระดาษ) → การเงินกดรับคืน + ภาพ → ปิดวัน (ล็อก)
import { fail, PermissionError } from '../core/errors.js';
import { isValidDate } from '../core/thaidate.js';
import { requirePermission } from '../core/roles.js';
import { hasRole, sendHandoff, receiveHandoff, pendingHandoffs } from './handoffs.js';
import { groupOfEntry, isInternalEntry } from './ledger.js';

const sum = (xs) => xs.reduce((s, x) => s + x, 0);

/** วันล่าสุดที่ปิดวันแล้ว (วันที่ ≤ นี้ลง Ledger เพิ่มไม่ได้) */
export function lockedThrough(ctx) {
  const ds = ctx.store.list('daily_close').filter((d) => d.locked).map((d) => d.date);
  return ds.length ? ds.sort().pop() : '';
}
export function assertOpenDay(ctx, date, field = 'date') {
  const lt = lockedThrough(ctx);
  if (lt && date && date <= lt) fail(field, `วันที่ ${date} ถูกล็อกแล้ว (ปิดวันถึง ${lt}) บันทึกย้อนหลังไม่ได้`);
}

export function report(ctx, date) {
  requirePermission(ctx, 'masters.read');
  if (!isValidDate(date)) fail('date', 'วันที่ไม่ถูกต้อง');
  const es = ctx.store.list('ledger');
  const groups = new Map();
  const g = (k) => { if (!groups.has(k)) groups.set(k, { group: k, carried: 0, in: 0, out: 0 }); return groups.get(k); };
  for (const e of es) {
    if (e.date > date) continue;
    const k = groupOfEntry(ctx, e);
    if (!k) continue;
    const row = g(k);
    if (e.date < date) row.carried += e.debit - e.credit;
    else if (!isInternalEntry(e) && e.source_type !== 'opening') { row.in += e.debit; row.out += e.credit; } else row.carried += e.debit - e.credit;
  }
  const rows = [...groups.values()].map((r) => ({ ...r, balance: r.carried + r.in - r.out })).filter((r) => r.carried || r.in || r.out);
  const sysCash = sum(es.filter((e) => e.location === 'cash' && e.date <= date).map((e) => e.debit - e.credit));
  const pay = new Set(es.filter((e) => e.date === date && e.source_type === 'payment_line' && e.credit > 0).map((e) => e.source_id));
  return {
    date, groups: rows, total: { carried: sum(rows.map((r) => r.carried)), in: sum(rows.map((r) => r.in)), out: sum(rows.map((r) => r.out)), balance: sum(rows.map((r) => r.balance)) },
    system_cash: sysCash, payments_count: pay.size, receipts_count: ctx.store.list('receipts').filter((r) => r.date === date && r.status !== 'ยกเลิก').length,
  };
}

const rowOf = (ctx, date) => ctx.store.find('daily_close', (d) => d.date === date)[0] || null;
function view(d) {
  const status = d.locked ? 'ปิดวันแล้ว' : d.received_back_at ? 'ผอ. ลงนามแล้ว รอปิดวัน' : d.director_sent_at ? 'ส่ง ผอ. แล้ว รอลงนาม' : d.signed_at ? 'กรรมการลงนามแล้ว' : d.counted_by ? 'นับเงินแล้ว รอลงนาม' : d.count_received_by ? 'กรรมการรับแล้ว รอนับเงิน' : 'ส่งแล้ว · รอกรรมการรับ';
  return { ...d, status };
}
const need = (ctx, date) => { const d = rowOf(ctx, date); if (!d) fail('date', 'ยังไม่ได้เปิดวันนี้'); return d; };
const upd = (ctx, d, patch, reason) => ctx.store.update(ctx.user, 'daily_close', d.id, patch, { reason });
const handoffOf = (ctx, d, step) => pendingHandoffs(ctx).filter((h) => h.doc_type === 'daily' && h.doc_id === d.id && h.step_key === step).pop();
const role = (ctx, r, msg) => { if (!hasRole(ctx.user, r)) throw new PermissionError(msg); };

export function open(ctx, date) {
  role(ctx, 'finance', 'เฉพาะการเงินเปิดวัน');
  return ctx.store.withLock(() => {
    if (!isValidDate(date)) fail('date', 'วันที่ไม่ถูกต้อง');
    if (date > ctx.today()) fail('date', 'เปิดวันล่วงหน้าไม่ได้');
    const ex = rowOf(ctx, date);
    if (ex) fail('date', ex.locked ? 'วันนี้ปิดวันแล้ว' : 'เปิดวันนี้แล้ว');
    const d = ctx.store.insert(ctx.user, 'daily_close', { date, signers: [], locked: false });
    sendHandoff(ctx, { doc_type: 'daily', doc_id: d.id, step_key: 'daily_count', from_role: 'finance', to_role: 'cash_committee' });
    return view(d);
  });
}
export function receiveCount(ctx, date) {
  return ctx.store.withLock(() => {
    const d = need(ctx, date);
    if (d.count_received_by) fail('date', 'กรรมการรับแล้ว');
    receiveHandoff(ctx, handoffOf(ctx, d, 'daily_count').id, { reason: 'กรรมการกดรับรายงานประจำวัน' });
    return view(upd(ctx, d, { count_received_by: ctx.user.email }, 'กรรมการกดรับ'));
  });
}
export function recordCount(ctx, date, { counted_cash } = {}) {
  role(ctx, 'cash_committee', 'เฉพาะกรรมการเก็บรักษาเงินบันทึกผลตรวจนับ');
  return ctx.store.withLock(() => {
    const d = need(ctx, date);
    if (!d.count_received_by) fail('date', 'ยังไม่ได้กดรับรายงาน จึงบันทึกผลนับไม่ได้');
    if (d.signed_at) fail('date', 'ลงนามแล้ว แก้ผลนับไม่ได้');
    if (!Number.isInteger(counted_cash) || counted_cash < 0) fail('counted_cash', 'ยอดเงินสดที่นับได้ไม่ถูกต้อง');
    const sys = report(ctx, date).system_cash;
    return view(upd(ctx, d, { system_cash: sys, counted_cash, diff: counted_cash - sys, counted_by: ctx.user.email, diff_note: '' }, 'บันทึกผลตรวจนับเงินสด'));
  });
}
export function explainDiff(ctx, date, note) {
  role(ctx, 'finance', 'เฉพาะการเงินบันทึกส่วนต่าง');
  return ctx.store.withLock(() => {
    const d = need(ctx, date);
    if (!d.counted_by || d.diff === 0) fail('date', 'ไม่มีส่วนต่างที่ต้องอธิบาย');
    if (!String(note || '').trim()) fail('note', 'ต้องระบุคำอธิบายส่วนต่าง');
    return view(upd(ctx, d, { diff_note: String(note).trim() }, 'บันทึกส่วนต่างพร้อมคำอธิบาย (ธงแดง)'));
  });
}
export function sign(ctx, date) {
  role(ctx, 'cash_committee', 'เฉพาะกรรมการเก็บรักษาเงินลงนามรายงาน');
  return ctx.store.withLock(() => {
    const d = need(ctx, date);
    if (!d.counted_by) fail('counted_cash', 'ต้องบันทึกผลตรวจนับก่อนลงนาม');
    if (d.diff !== 0 && !d.diff_note) fail('diff_note', 'นับไม่ตรง ต้องให้การเงินบันทึกส่วนต่างพร้อมคำอธิบายก่อนลงนาม');
    const lim = ctx.settings.cash_holding_limit;
    if (lim !== null && d.counted_cash > lim) fail('counted_cash', 'เงินสดเกินวงเงินเก็บรักษา ต้องนำฝากธนาคารก่อนลงนาม');
    return view(upd(ctx, d, { signers: [...new Set([...(d.signers || []), ctx.user.email])], signed_at: d.signed_at || ctx.store.now() }, 'กรรมการลงนามรายงานประจำวัน'));
  });
}
export function sendToDirector(ctx, date) {
  role(ctx, 'finance', 'เฉพาะการเงินส่ง ผอ. ตรวจการจ่าย');
  return ctx.store.withLock(() => {
    const d = need(ctx, date);
    if (!d.signed_at) fail('date', 'กรรมการยังไม่ได้ลงนามรายงานประจำวัน');
    if (d.director_sent_at) fail('date', 'ส่ง ผอ. แล้ว');
    sendHandoff(ctx, { doc_type: 'daily', doc_id: d.id, step_key: 'daily_sign', from_role: 'finance', to_role: 'finance', note: 'รอ ผอ. ตรวจการจ่ายและลงนาม' });
    return view(upd(ctx, d, { director_sent_at: ctx.store.now() }, 'ส่ง ผอ. ตรวจการจ่าย'));
  });
}
export function receiveBack(ctx, date, { scan_ref = '' } = {}) {
  role(ctx, 'finance', 'เฉพาะการเงินกดรับคืนเอกสารที่ ผอ. ลงนาม');
  return ctx.store.withLock(() => {
    const d = need(ctx, date);
    if (!d.director_sent_at) fail('date', 'ยังไม่ได้ส่ง ผอ.');
    if (d.received_back_at) fail('date', 'รับคืนแล้ว');
    if (ctx.settings.require_scan && !String(scan_ref).trim()) fail('scan_ref', 'ต้องแนบภาพหน้าที่ ผอ. ลงนาม');
    receiveHandoff(ctx, handoffOf(ctx, d, 'daily_sign').id, { scan_ref, allowSender: true, reason: 'การเงินกดรับคืน (ผอ. ลงนามแล้ว)' });
    return view(upd(ctx, d, { director_scan: scan_ref, received_back_at: ctx.store.now() }, 'กดรับคืนพร้อมภาพหน้า ผอ. ลงนาม'));
  });
}
/** ปิดวัน (ล็อก): ต้องผ่านการลงนามกรรมการ · วันที่มีการจ่ายต้องมีเอกสาร ผอ. ที่รับคืนแล้ว */
export function close(ctx, date) {
  role(ctx, 'finance', 'เฉพาะการเงินปิดวัน');
  return ctx.store.withLock(() => {
    const d = need(ctx, date);
    if (d.locked) fail('date', 'ปิดวันแล้ว');
    if (!d.signed_at) fail('date', 'กรรมการยังไม่ได้ลงนามรายงานประจำวัน');
    const rep = report(ctx, date);
    if (rep.payments_count > 0 && !d.received_back_at) fail('director_scan', 'วันที่มีการจ่ายต้องมีเอกสาร ผอ. ลงนามและรับคืนแล้ว จึงปิดวันได้');
    return view(upd(ctx, d, { locked: true, closed_at: ctx.store.now(), closed_by: ctx.user.email, snapshot: JSON.stringify(rep) }, 'ปิดวัน (ล็อก)'));
  });
}
export const listDays = (ctx) => { requirePermission(ctx, 'masters.read'); return ctx.store.list('daily_close').map(view).sort((a, b) => (a.date < b.date ? 1 : -1)); };
export const getDay = (ctx, date) => { requirePermission(ctx, 'masters.read'); const d = rowOf(ctx, date); return d ? view(d) : null; };
