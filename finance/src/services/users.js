import { PermissionError, fail } from '../core/errors.js';
import { ROLES, roleConflicts, requirePermission } from '../core/roles.js';
import { validateWith, requireReason, getOrFail, rejectFields } from './common.js';

function check(ctx, rec, selfId) {
  return validateWith(ctx, 'users', rec, (out, c) => {
    out.email = out.email.toLowerCase();
    const domain = ctx.settings.allowed_email_domain;
    if (out.email && !out.email.endsWith(`@${domain}`)) c.add('email', `ต้องเป็นอีเมล @${domain}`);
    else if (out.email && ctx.store.find('users', (u) => u.email.toLowerCase() === out.email && u.id !== selfId).length) c.add('email', 'อีเมลนี้มีผู้ใช้แล้ว');
    const unknown = out.roles.filter((r) => !ROLES[r]);
    if (unknown.length) c.add('roles', `ไม่รู้จักบทบาท: ${unknown.join(', ')}`);
    else if (!c.has('roles')) {
      const bad = roleConflicts(out.roles);
      if (bad.length) c.add('roles', `บทบาทที่ถือพร้อมกันไม่ได้: ${bad.map(([a, b]) => `${ROLES[a]} + ${ROLES[b]}`).join(' · ')}`);
    }
  });
}

export function createUser(ctx, input) {
  requirePermission(ctx, 'users.manage');
  rejectFields(input, ['id'], 'รหัสผู้ใช้ระบบออกให้');
  return ctx.store.insert(ctx.user, 'users', check(ctx, input, null));
}

export function updateUser(ctx, id, patch, reason) {
  requirePermission(ctx, 'users.manage');
  const why = requireReason(reason);
  const cur = getOrFail(ctx, 'users', id, 'ผู้ใช้');
  const { created_by, created_at, updated_at, ...plain } = cur;
  const next = check(ctx, { ...plain, ...patch }, id);
  return ctx.store.update(ctx.user, 'users', id, next, { reason: why });
}

export function listUsers(ctx) {
  requirePermission(ctx, 'users.read');
  return ctx.store.list('users');
}

/**
 * หาผู้ใช้จากอีเมลที่ล็อกอินแล้ว
 * - มีชื่อในตารางผู้ใช้ → ใช้บทบาทตามที่ตั้ง (ปิดใช้งาน = เข้าไม่ได้ ไม่ตกไปเป็นครู)
 * - ไม่มีชื่อ แต่เป็นอีเมลโรงเรียน → "ครูผู้ขอ" (ไม่บันทึกลงตารางผู้ใช้)
 */
export function resolveUser(store, email, settings) {
  const e = String(email || '').trim().toLowerCase();
  const all = store.list('users');
  if (!all.length) throw new PermissionError('ระบบยังไม่ได้ตั้งผู้ดูแลระบบ');
  const u = e && all.find((x) => x.email.toLowerCase() === e);
  if (u) {
    if (!u.active) throw new PermissionError('บัญชีนี้ถูกปิดใช้งาน ติดต่อผู้ดูแลระบบ');
    return u;
  }
  const domain = `@${settings.allowed_email_domain}`;
  if (!e.endsWith(domain) || e.length <= domain.length) throw new PermissionError(`เข้าได้เฉพาะอีเมล ${domain}`);
  return { id: `teacher:${e}`, name: e.slice(0, -domain.length), email: e, roles: ['requester'], appointment_ref: '', active: true, virtual: true };
}

/** ตั้งผู้ดูแลระบบคนแรก ทำได้ครั้งเดียวตอนยังไม่มีผู้ใช้ */
export function bootstrapAdmin(ctx, input) {
  if (ctx.store.list('users').length) fail('email', 'มีผู้ใช้แล้ว ตั้งผู้ดูแลคนแรกซ้ำไม่ได้');
  return ctx.store.insert(ctx.user, 'users', check(ctx, { ...input, roles: ['admin'] }, null), { reason: 'ตั้งผู้ดูแลระบบคนแรก' });
}
