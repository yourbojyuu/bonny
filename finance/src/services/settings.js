import { fail } from '../core/errors.js';
import { requirePermission } from '../core/roles.js';
import { SETTING_SPECS } from '../core/settings.js';
import { requireReason } from './common.js';

export function updateSetting(ctx, key, value, reason) {
  requirePermission(ctx, 'settings.update');
  const spec = SETTING_SPECS[key];
  if (!spec) fail('key', `ไม่รู้จักค่าตั้ง ${key}`);
  const why = requireReason(reason);
  if (!spec.check(value)) fail('value', `ค่าไม่ถูกต้องสำหรับ "${spec.label}"`);
  const row = { value: JSON.stringify(value) };
  return ctx.store.get('settings', key)
    ? ctx.store.update(ctx.user, 'settings', key, row, { reason: why })
    : ctx.store.insert(ctx.user, 'settings', { id: key, ...row }, { reason: why });
}

export function listSettings(ctx) {
  requirePermission(ctx, 'masters.read');
  const s = ctx.settings;
  return Object.entries(SETTING_SPECS).map(([key, spec]) => ({ key, label: spec.label, value: s[key], pending: spec.pending || '' }));
}

export function pendingSettings(ctx) {
  return listSettings(ctx).filter((x) => x.pending);
}

/** ใส่ค่าเริ่มต้นทุกตัวลงชีต settings (ตอนตั้งระบบ) ให้เห็นและแก้ได้ */
export function seedSettings(ctx) {
  for (const [key, spec] of Object.entries(SETTING_SPECS)) {
    if (!ctx.store.get('settings', key)) ctx.store.insert(ctx.user, 'settings', { id: key, value: JSON.stringify(spec.default) }, { reason: 'ค่าเริ่มต้น' });
  }
}
