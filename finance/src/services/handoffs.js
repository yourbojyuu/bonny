// ส่ง-รับงาน: ทุกการส่งต่อสร้างแถว handoff · ผู้รับต้องกด "รับ" · ผู้รับ ≠ ผู้ส่ง · นับวันค้างจากเวลาส่ง
// ฟังก์ชันในไฟล์นี้ไม่ล็อกเอง (ผู้เรียกภายนอกครอบ withLock ชั้นเดียว)
import { fail, PermissionError } from '../core/errors.js';
import { daysBetween, todayInBangkok } from '../core/thaidate.js';
import { getOrFail } from './common.js';

export const hasRole = (user, role) => user.roles.includes(role);

export function sendHandoff(ctx, { doc_type, doc_id, step_key, from_role = '', to_role, note = '' }) {
  return ctx.store.insert(ctx.user, 'handoffs', { doc_type, doc_id, step_key, from_role, to_role, sent_by: ctx.user.email, sent_at: ctx.store.now(), note });
}

/** กดรับ: ต้องถือบทบาทปลายทาง · ไม่ใช่ผู้ส่ง · ไม่อยู่ในรายชื่อต้องห้าม (เช่น ผู้ทำเอกสาร) · รับได้ครั้งเดียว */
export function receiveHandoff(ctx, id, { scan_ref = '', forbidEmails = [], reason = '', allowSender = false } = {}) {
  const h = getOrFail(ctx, 'handoffs', id, 'งานส่ง-รับ');
  if (h.received_at) fail('id', 'งานนี้มีผู้รับแล้ว');
  if (!hasRole(ctx.user, h.to_role)) throw new PermissionError('ไม่มีสิทธิ์รับงานนี้ (บทบาทไม่ตรงกับผู้รับ)');
  const me = ctx.user.email.toLowerCase();
  if (!allowSender && h.sent_by.toLowerCase() === me) throw new PermissionError('ผู้รับต้องไม่ใช่ผู้ส่ง');
  if (forbidEmails.map((e) => String(e).toLowerCase()).includes(me)) throw new PermissionError('ผู้รับต้องไม่ใช่ผู้ทำเอกสารนี้');
  return ctx.store.update(ctx.user, 'handoffs', id, { received_by: ctx.user.email, received_at: ctx.store.now(), scan_ref }, { reason: reason || 'กดรับงาน' });
}

export const waitDays = (ctx, h) => Math.max(0, daysBetween(todayInBangkok(new Date(h.sent_at)), ctx.today()));

export function pendingHandoffs(ctx) {
  return ctx.store.list('handoffs').filter((h) => !h.received_at);
}

/** งานที่ส่งแล้วยังไม่มีคนรับ นานเกิน sla_days ของขั้นนั้น (ยังไม่ตั้ง = ไม่ขึ้นธง) */
export function overdueHandoffs(ctx) {
  const sla = ctx.settings.sla_days || {};
  return pendingHandoffs(ctx)
    .map((h) => ({ ...h, days: waitDays(ctx, h), limit: sla[h.step_key] }))
    .filter((h) => h.limit !== undefined && h.days > h.limit);
}
