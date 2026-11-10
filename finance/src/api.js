// จุดเดียวที่หน้าเว็บเรียก (ผ่าน google.script.run) · แปลงยอดเงินจากบาทเป็นสตางค์ · คืน error ชี้ช่อง
import { ValidationError, PermissionError, collector } from './core/errors.js';
import { toSatang } from './core/money.js';
import { can, ROLES } from './core/roles.js';
import { SETTING_SPECS } from './core/settings.js';

// ใครอ่าน/เขียนตารางไหนได้ (ผ่านหน้าเว็บ)
export const TABLE_ACCESS = {
  users: { read: 'users.read', write: 'users.manage' },
  settings: { read: 'any', write: 'settings.update' },
  bank_accounts: { read: 'any', write: 'bank_accounts.manage' },
  funds: { read: 'any', write: 'funds.manage' },
  subfunds: { read: 'any', write: 'subfunds.manage' },
  fund_allowed_expense: { read: 'any', write: 'fund_allowed_expense.manage' },
  payees: { read: 'any', write: 'payees.manage' },
  payee_account_changes: { read: 'any', write: 'payees.account.request' },
  plan_projects: { read: 'any', write: 'plan_projects.manage' },
  cheque_books: { read: 'any', write: 'cheque_books.manage' },
  audit_log: { read: 'audit.read', write: null },
};

const ok = (data) => ({ ok: true, data });

function fromWire(def, rec) {
  const out = { ...rec };
  const c = collector();
  for (const col of def.columns) {
    const v = out[col.key];
    if (v === undefined || v === null || v === '') continue;
    try {
      if (col.type === 'money') out[col.key] = toSatang(v);
      if (col.type === 'int' && typeof v === 'string') { if (!/^-?\d+$/.test(v.trim())) throw new Error('ต้องเป็นจำนวนเต็ม'); out[col.key] = Number(v); }
      if (col.type === 'bool' && typeof v === 'string') out[col.key] = v === 'true';
    } catch (e) { c.add(col.key, e.message); }
  }
  c.throwIfAny();
  return out;
}

function publicSchema(app) {
  return Object.fromEntries(Object.keys(TABLE_ACCESS).map((t) => [t, app.tables[t]]));
}

export function handle(app, email, action, payload = {}) {
  try {
    const u = app.asUser(email);
    const ctx = u.ctx;
    const table = payload.table;
    const access = TABLE_ACCESS[table];
    const needRead = () => { if (!access || !can(ctx.user, access.read, ctx.settings)) throw new PermissionError('ไม่มีสิทธิ์ดูตารางนี้'); };
    switch (action) {
      case 'me':
        return ok({
          user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, roles: ctx.user.roles },
          roles: ROLES,
          today: ctx.today(),
          settings: ctx.settings,
          schema: publicSchema(app),
          tables: Object.entries(TABLE_ACCESS)
            .filter(([, a]) => can(ctx.user, a.read, ctx.settings))
            .map(([key, a]) => ({ key, label: app.tables[key].label, canWrite: !!a.write && can(ctx.user, a.write, ctx.settings) })),
        });
      case 'list':
        needRead();
        if (table === 'users') return ok(u.users.list());
        if (table === 'audit_log') return ok(u.audit.list().slice(-500).reverse());
        if (table === 'settings') return ok(u.settings.list());
        if (table === 'payee_account_changes') return ok(u.payees.listAccountChanges());
        return ok(u[table].list());
      case 'create':
        needRead();
        if (!u[table] || !u[table].create) throw new PermissionError('เพิ่มรายการในตารางนี้ไม่ได้');
        return ok(u[table].create(fromWire(app.tables[table], payload.record || {})));
      case 'update':
        needRead();
        if (!u[table] || !u[table].update) throw new PermissionError('แก้ตารางนี้ไม่ได้');
        return ok(u[table].update(payload.id, fromWire(app.tables[table], payload.record || {}), payload.reason));
      case 'settings.update': {
        const spec = SETTING_SPECS[payload.key];
        let v = payload.value;
        if (spec && typeof v === 'string') { try { v = JSON.parse(v); } catch { throw new ValidationError([{ field: 'value', message: 'รูปแบบค่าไม่ถูกต้อง (JSON)' }]); } }
        return ok(u.settings.update(payload.key, v, payload.reason));
      }
      case 'payees.requestAccountChange':
        return ok(u.payees.requestAccountChange(payload.payee_id, payload));
      case 'payees.approveAccountChange':
        return ok(u.payees.approveAccountChange(payload.id));
      case 'payees.rejectAccountChange':
        return ok(u.payees.rejectAccountChange(payload.id, payload.reason));
      default:
        return { ok: false, error: `ไม่รู้จักคำสั่ง ${action}` };
    }
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, errors: e.errors, error: e.message };
    return { ok: false, error: e.message };
  }
}
