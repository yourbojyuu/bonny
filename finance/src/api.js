// จุดเดียวที่หน้าเว็บเรียก (ผ่าน google.script.run) · แปลงยอดเงินจากบาทเป็นสตางค์ · คืน error ชี้ช่อง
import { ValidationError, PermissionError, collector } from './core/errors.js';
import { toSatang } from './core/money.js';
import { can, ROLES } from './core/roles.js';
import { SETTING_SPECS } from './core/settings.js';

// ใครอ่าน/เขียนตารางไหนได้ (ผ่านหน้าเว็บ)
// ลำดับนี้ = ลำดับเมนูในหน้าเว็บ
export const TABLE_ACCESS = {
  plan_projects: { read: 'any', write: 'plan_projects.manage' },
  approval_requests: { read: 'any', write: null },
  payment_lines: { read: 'masters.read', write: null },
  khb: { read: 'masters.read', write: null },
  khj: { read: 'masters.read', write: null },
  loans: { read: 'masters.read', write: null },
  procurements: { read: 'masters.read', write: null },
  cheques: { read: 'masters.read', write: null },
  ktb_batches: { read: 'masters.read', write: null },
  ledger: { read: 'masters.read', write: null },
  migrate: { read: 'payees.manage', write: null },
  daily_close: { read: 'masters.read', write: null },
  executive: { read: 'masters.read', write: null },
  year_end: { read: 'masters.read', write: null },
  bank_register: { read: 'masters.read', write: null },
  deposit_slips: { read: 'masters.read', write: null },
  bank_statement_lines: { read: 'masters.read', write: null },
  adjustments: { read: 'masters.read', write: null },
  receipts: { read: 'masters.read', write: null },
  packages: { read: 'masters.read', write: null },
  collectibles: { read: 'masters.read', write: null },
  payees: { read: 'masters.read', write: 'payees.manage' },
  payee_account_changes: { read: 'masters.read', write: 'payees.account.request' },
  bank_accounts: { read: 'masters.read', write: 'bank_accounts.manage' },
  cheque_books: { read: 'masters.read', write: 'cheque_books.manage' },
  funds: { read: 'masters.read', write: 'funds.manage' },
  subfunds: { read: 'masters.read', write: 'subfunds.manage' },
  fund_allowed_expense: { read: 'masters.read', write: 'fund_allowed_expense.manage' },
  users: { read: 'users.read', write: 'users.manage' },
  settings: { read: 'masters.read', write: 'settings.update' },
  audit_log: { read: 'audit.read', write: null },
  handoffs: { read: 'audit.read', write: null },
  review_steps: { read: 'audit.read', write: null },
  login_log: { read: 'audit.read', write: null },
};

const ok = (data) => ({ ok: true, data });

// การกระทำที่หน้าเว็บเรียกได้ (ชื่อบริการ → วิธี) · ทุกวิธีตรวจสิทธิ์เองในบริการ
const CALLS = {
  approvals: ['submit', 'resubmit', 'receive', 'returnToRequester', 'propose', 'recordDecision', 'financeReceive', 'classify', 'closeCode'],
  cheques: ['propose', 'confirm', 'voidCheque', 'register', 'sendForSignature', 'markReceived'],
  ktb: ['createBatch', 'fileContent', 'markUploaded', 'recordApproval', 'recordTxn', 'approvers'],
  ledger: ['balance', 'taxSummary', 'opening'],
  deposits: ['create', 'undeposited'],
  statements: ['import'],
  adjustments: ['create', 'approve'],
  bank: ['reconcile', 'register', 'signMonth'],
  daily: ['open', 'receiveCount', 'recordCount', 'explainDiff', 'sign', 'sendToDirector', 'receiveBack', 'close', 'report'],
  reports: ['executive', 'planSummary', 'yearEnd'],
  print: ['render'],
  migrate: ['payees', 'packages', 'opening', 'loans', 'audit'],
  receipts: ['issue', 'preview', 'cancel', 'nextNo', 'splits', 'monthlySummary'],
  packages: ['create'],
  collectibles: ['set'],
  subfunds: ['seedDefaults'],
  loans: ['create'],
  procurement: ['purchase', 'inspect', 'sendBundle', 'receiveBundle'],
  payments: ['createLine', 'updateLine', 'reverseLine'],
  khb: ['create'],
  khj: ['generate'],
  workflow: ['submit', 'receive', 'pass', 'returnDoc', 'receiveSigned', 'directorReturn'],
};
const MONEY_KEYS = ['amount', 'base_amount', 'bks_cash', 'inc_cash', 'bks_transfer', 'inc_transfer', 'other', 'amount_due', 'total', 'counted_cash'];
// แพ็กเกจ: หน้าเว็บส่งบรรทัด "รหัส=บาท" → "รหัส=สตางค์"
const pairsToSatang = (list) => (Array.isArray(list) ? list : []).map((x) => { const i = String(x).lastIndexOf('='); return `${String(x).slice(0, i).trim()}=${toSatang(String(x).slice(i + 1).trim())}`; });
// หน้าเว็บส่งยอดเงินเป็นบาท (ข้อความ) → แปลงเป็นสตางค์ก่อนเข้าบริการ
function moneyArgs(args) {
  return args.map((a) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return a;
    const out = { ...a };
    const c = collector();
    for (const k of MONEY_KEYS) {
      if (out[k] === undefined || out[k] === '' || out[k] === null) { if (out[k] === '') delete out[k]; continue; }
      try { out[k] = toSatang(out[k]); } catch (e) { c.add(k, e.message); }
    }
    for (const k of ['lines', 'channels']) if (Array.isArray(out[k])) { try { out[k] = pairsToSatang(out[k]); } catch (e) { c.add(k, 'รูปแบบต้องเป็น รหัส=บาท'); } }
    if (out.split && Array.isArray(out.split.splits)) {
      out.split = { ...out.split, splits: out.split.splits.map((x) => { try { return { ...x, amount: toSatang(x.amount) }; } catch (e) { c.add('splits', e.message); return x; } }) };
    }
    c.throwIfAny();
    return out;
  });
}

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

export function handle(app, email, action, payload = {}, deps = {}) {
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
          settings: can(ctx.user, 'masters.read', ctx.settings) ? ctx.settings : {},
          schema: publicSchema(app),
          tables: Object.entries(TABLE_ACCESS)
            .filter(([, a]) => can(ctx.user, a.read, ctx.settings))
            .map(([key, a]) => ({ key, label: app.tables[key].label, canWrite: !!a.write && can(ctx.user, a.write, ctx.settings) })),
        });
      case 'inbox':
        return ok(u.workflow.inbox());
      case 'call': {
        const { svc, method } = payload;
        if (!(CALLS[svc] || []).includes(method)) return { ok: false, error: 'ไม่รู้จักคำสั่งนี้' };
        return ok(u[svc][method](...moneyArgs(Array.isArray(payload.args) ? payload.args : [])));
      }
      case 'upload': {
        if (!payload.data || String(payload.data).length > 5_600_000) return { ok: false, errors: [{ field: 'scan_ref', message: 'ไฟล์ใหญ่เกิน 4 MB' }], error: 'ไฟล์ใหญ่เกิน 4 MB' };
        const name = String(payload.name || 'scan').replace(/[^\w.\-ก-๙]+/g, '_').slice(0, 80);
        const ref = deps.saveFile ? deps.saveFile({ name, mime: String(payload.mime || ''), data: payload.data, by: ctx.user.email }) : `ไฟล์:${name}`;
        return ok({ ref });
      }
      case 'flags':
        return ok({ overdue: u.workflow.overdue() });
      case 'list':
        needRead();
        if (table === 'users') return ok(u.users.list());
        if (table === 'audit_log') return ok(u.audit.list().slice(-500).reverse());
        if (table === 'handoffs' || table === 'review_steps') return ok(app.store.list(table).slice(-500).reverse());
        if (table === 'login_log') return ok(u.audit.logins().slice(-500).reverse());
        if (table === 'settings') return ok(u.settings.list());
        if (table === 'payee_account_changes') return ok(u.payees.listAccountChanges());
        if (table === 'approval_requests') return ok(u.approvals.list());
        if (table === 'payment_lines') return ok(u.payments.listLines().slice().reverse());
        if (table === 'khb') return ok(u.khb.list());
        if (table === 'khj') return ok(u.khj.list());
        if (table === 'loans') return ok(u.loans.list());
        if (table === 'procurements') return ok(u.procurement.list());
        if (table === 'cheques') return ok(u.cheques.list().slice().reverse());
        if (table === 'ktb_batches') return ok(u.ktb.list());
        if (table === 'ledger') return ok(u.ledger.list().slice().reverse());
        if (table === 'receipts') return ok(u.receipts.list().slice().reverse());
        if (table === 'bank_register') return ok(u.bank_accounts.list());
        if (table === 'daily_close') return ok(u.daily.list());
        if (table === 'executive' || table === 'year_end' || table === 'migrate') return ok([]);
        if (table === 'deposit_slips') return ok(app.store.list('deposit_slips').slice().reverse());
        if (table === 'bank_statement_lines') return ok(app.store.list('bank_statement_lines').slice(-1000).reverse());
        if (table === 'adjustments') return ok(u.adjustments.list().slice().reverse());
        if (table === 'packages') return ok(u.packages.list());
        if (table === 'collectibles') return ok(u.collectibles.list());
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

/**
 * จุดเข้าเดียวจากหน้าเว็บ: { token, action, payload } · action 'login' ไม่ต้องมี token
 * googleEmail = บัญชี Google ที่เปิดอยู่ (ถ้า Apps Script รู้) ใช้บันทึกใน login_log เท่านั้น
 */
export function handleRequest({ app, auth, saveFile }, req = {}, googleEmail = '') {
  const { token, action, payload = {} } = req;
  try {
    if (action === 'login') {
      const r = auth.login({ email: payload.email, password: payload.password, googleEmail });
      return ok({ token: r.token, email: r.email });
    }
    if (action === 'logout') { auth.logout(token); return ok(true); }
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, errors: e.errors, error: e.message };
    return { ok: false, error: e.message };
  }
  const email = auth.emailOf(token);
  if (!email) return { ok: false, code: 'AUTH', error: 'กรุณาเข้าสู่ระบบ (หมดเวลาหรือยังไม่ได้ล็อกอิน)' };
  return handle(app, email, action, payload, { saveFile });
}
