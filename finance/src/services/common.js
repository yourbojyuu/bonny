import { collector, fail } from '../core/errors.js';
import { checkRecord } from '../core/validate.js';

export function requireReason(reason) {
  if (!reason || !String(reason).trim()) fail('reason', 'ต้องระบุเหตุผล');
  return String(reason).trim();
}

/** ตรวจชนิดตาม schema แล้วให้ service ตรวจกฎเพิ่ม (extra) ก่อนโยน error ทีเดียว */
export function validateWith(ctx, table, rec, extra) {
  const c = collector();
  const out = checkRecord(ctx.store.tables[table], rec, ctx.settings, c);
  if (extra) extra(out, c);
  c.throwIfAny();
  return out;
}

/** ห้ามผู้ใช้ส่งช่อง readonly/ระบบ */
export function rejectFields(rec, keys, message) {
  const c = collector();
  for (const k of keys) if (rec[k] !== undefined && rec[k] !== '' && rec[k] !== null) c.add(k, message);
  c.throwIfAny();
}

export function getOrFail(ctx, table, id, label) {
  const r = ctx.store.get(table, id);
  if (!r) fail('id', `ไม่พบ${label || 'รายการ'} ${id}`);
  return r;
}

export const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
