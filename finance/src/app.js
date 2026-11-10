// ประกอบระบบ: store + services ผูกกับผู้ใช้ที่เข้าระบบ (ctx) · หน้าเว็บและ test เรียกผ่านทางเดียวกันนี้
import { TABLES } from './core/schema.js';
import { loadSettings } from './core/settings.js';
import { requirePermission } from './core/roles.js';
import { createStore } from './data/store.js';
import * as users from './services/users.js';
import * as settingsSvc from './services/settings.js';
import * as payees from './services/payees.js';
import { masterService, MASTER_TABLES } from './services/masters.js';

const SYSTEM_USER = { id: 'system', email: 'system', roles: [] };

export function createApp({ repo, clock, extraTables = {} }) {
  const tables = { ...TABLES, ...extraTables };
  let store;
  const getSettings = () => loadSettings(store);
  store = createStore(repo, { clock, tables, getSettings });

  function makeCtx(user) {
    return {
      store, user, clock,
      get settings() { return getSettings(); },
      today: () => store.today(),
    };
  }

  function bind(ctx) {
    const b = (fn) => (...args) => fn(ctx, ...args);
    const api = {
      ctx,
      users: { create: b(users.createUser), update: b(users.updateUser), list: b(users.listUsers) },
      settings: { update: b(settingsSvc.updateSetting), list: b(settingsSvc.listSettings), pending: b(settingsSvc.pendingSettings) },
      payees: {
        create: b(payees.createPayee), update: b(payees.updatePayee),
        list: () => store.list('payees'), get: (id) => store.get('payees', id),
        requestAccountChange: b(payees.requestAccountChange),
        approveAccountChange: b(payees.approveAccountChange),
        rejectAccountChange: b(payees.rejectAccountChange),
        listAccountChanges: b(payees.listAccountChanges),
      },
      audit: { list: () => { requirePermission(ctx, 'audit.read'); return store.list('audit_log'); } },
    };
    for (const t of MASTER_TABLES) {
      const s = masterService(t);
      api[t] = { create: b(s.create), update: b(s.update), list: b(s.list), get: b(s.get) };
    }
    return api;
  }

  return {
    store,
    tables,
    /** ตั้งระบบครั้งแรก: ใส่ค่าตั้งเริ่มต้น + ผู้ดูแลระบบคนแรก */
    bootstrap(input) {
      const ctx = makeCtx({ ...SYSTEM_USER, email: 'system:bootstrap' });
      if (store.list('users').length) users.bootstrapAdmin(ctx, input); // โยน error "มีผู้ใช้แล้ว"
      settingsSvc.seedSettings(ctx);
      return users.bootstrapAdmin(ctx, input);
    },
    /** ทุกคำขอเริ่มที่นี่: อีเมลที่ Google ยืนยัน → ผู้ใช้ในระบบ */
    asUser(email) {
      return bind(makeCtx(users.resolveUser(store, email)));
    },
  };
}
