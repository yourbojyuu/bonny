// ข้อมูลหลัก: บัญชีธนาคาร · ประเภทเงิน · ชนิดเงินย่อย · สมุดเช็ค · โครงการตามแผน · ค่าใช้จ่ายที่ประเภทเงินอนุญาต
import { requirePermission } from '../core/roles.js';
import { fiscalYearOf } from '../core/thaidate.js';
import { digitsOnly } from '../core/validate.js';
import { validateWith, requireReason, getOrFail, rejectFields, norm } from './common.js';
import { projectUsage } from './plan.js';

const isDigits = (s) => /^\d+$/.test(s);
// เทียบเลขเช็คแบบข้อความ (เติม 0 ให้ยาวเท่ากัน) ไม่ใช้ Number เพื่อไม่ให้เลข 0 นำหน้าหาย
const cmpNo = (a, b) => { const n = Math.max(a.length, b.length); const x = a.padStart(n, '0'), y = b.padStart(n, '0'); return x < y ? -1 : x > y ? 1 : 0; };

const RULES = {
  bank_accounts(ctx, out, c, selfId) {
    const no = digitsOnly(out.account_no);
    if (out.account_no && !isDigits(no)) c.add('account_no', 'เลขที่บัญชีต้องเป็นตัวเลข');
    else if (no && ctx.store.find('bank_accounts', (a) => a.account_no === no && a.id !== selfId).length) c.add('account_no', 'เลขที่บัญชีนี้มีแล้ว');
    out.account_no = no;
    if (out.linked_account_id) {
      const sav = ctx.store.get('bank_accounts', out.linked_account_id);
      if (!sav) c.add('linked_account_id', 'ไม่พบบัญชีคู่');
      else if (out.type !== 'กระแสรายวัน') c.add('linked_account_id', 'จับคู่ได้เฉพาะบัญชีกระแสรายวัน');
      else if (sav.type !== 'ออมทรัพย์') c.add('linked_account_id', 'บัญชีคู่ต้องเป็นออมทรัพย์');
      else if (sav.fund_group !== out.fund_group) c.add('linked_account_id', 'บัญชีคู่ต้องเป็นกลุ่มเงินเดียวกัน');
    }
  },
  funds(ctx, out, c, selfId) {
    out.fund_code = norm(out.fund_code);
    if (out.fund_code && ctx.store.find('funds', (f) => norm(f.fund_code) === out.fund_code && f.id !== selfId).length) c.add('fund_code', 'รหัสเงินนี้มีแล้ว');
    if (out.bank_account_id) {
      const a = ctx.store.get('bank_accounts', out.bank_account_id);
      if (!a) c.add('bank_account_id', 'ไม่พบบัญชีธนาคาร');
      else if (a.fund_group !== out.fund_group) c.add('bank_account_id', `บัญชีนี้เป็นของกลุ่มเงิน ${a.fund_group}`);
    }
  },
  subfunds(ctx, out, c, selfId) {
    out.code = norm(out.code);
    if (out.code && ctx.store.find('subfunds', (s) => norm(s.code) === out.code && s.id !== selfId).length) c.add('code', 'รหัสนี้มีแล้ว');
  },
  fund_allowed_expense(ctx, out, c) {
    if (out.fund_code && !findFund(ctx, out.fund_code)) c.add('fund_code', 'ไม่พบรหัสเงินนี้');
  },
  plan_projects(ctx, out, c) {
    const domain = `@${ctx.settings.allowed_email_domain}`;
    out.owner_emails = [...new Set(out.owner_emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const bad = out.owner_emails.filter((e) => !e.endsWith(domain) || e.length <= domain.length);
    if (bad.length) c.add('owner_emails', `ผู้รับผิดชอบต้องเป็นอีเมล ${domain}: ${bad.join(', ')}`);
    if (out.fund_code && !findFund(ctx, out.fund_code)) c.add('fund_code', 'ไม่พบรหัสเงินนี้');
    if (Number.isInteger(out.budget) && out.budget <= 0) c.add('budget', 'วงเงินต้องมากกว่า 0');
  },
  cheque_books(ctx, out, c, selfId) {
    if (out.bank_account_id) {
      const a = ctx.store.get('bank_accounts', out.bank_account_id);
      if (!a) c.add('bank_account_id', 'ไม่พบบัญชีธนาคาร');
      else if (a.type !== 'กระแสรายวัน') c.add('bank_account_id', 'สมุดเช็คต้องผูกกับบัญชีกระแสรายวัน');
    }
    if (out.first_no && !isDigits(out.first_no)) c.add('first_no', 'เลขเช็คต้องเป็นตัวเลข');
    if (out.last_no && !isDigits(out.last_no)) c.add('last_no', 'เลขเช็คต้องเป็นตัวเลข');
    if (c.has('first_no') || c.has('last_no') || !out.first_no || !out.last_no) return;
    if (out.first_no.length !== out.last_no.length) return c.add('last_no', 'เลขแรกกับเลขสุดท้ายต้องมีจำนวนหลักเท่ากัน');
    if (cmpNo(out.first_no, out.last_no) > 0) return c.add('last_no', 'เลขสุดท้ายต้องไม่น้อยกว่าเลขแรก');
    const clash = ctx.store.find('cheque_books', (b) => b.bank_account_id === out.bank_account_id && b.id !== selfId
      && cmpNo(b.first_no, out.last_no) <= 0 && cmpNo(out.first_no, b.last_no) <= 0)[0];
    if (clash) c.add('first_no', `ช่วงเลขทับสมุดเดิม ${clash.first_no}–${clash.last_no}`);
  },
};

const PERM = {
  bank_accounts: 'bank_accounts.manage', funds: 'funds.manage', subfunds: 'subfunds.manage',
  fund_allowed_expense: 'fund_allowed_expense.manage', plan_projects: 'plan_projects.manage', cheque_books: 'cheque_books.manage',
};

// ค่าที่คำนวณเพิ่มตอนแสดงผล (ไม่เก็บซ้ำในชีต)
const VIEWS = {
  cheque_books(ctx, b) {
    const a = ctx.store.get('bank_accounts', b.bank_account_id);
    return { ...b, fund_group: a ? a.fund_group : '', account_no: a ? a.account_no : '' };
  },
  plan_projects(ctx, p) {
    return { ...p, ...projectUsage(ctx, p), is_mine: (p.owner_emails || []).includes(ctx.user.email) };
  },
};

function findFund(ctx, code) {
  return ctx.store.find('funds', (f) => norm(f.fund_code) === norm(code))[0];
}

function prepare(ctx, table, rec, selfId) {
  if (table === 'plan_projects' && !selfId) rec.fiscal_year = fiscalYearOf(ctx.today(), ctx.settings.fiscal_year_start_month);
  return validateWith(ctx, table, rec, (out, c) => RULES[table](ctx, out, c, selfId));
}

// ใครอ่านตารางไหนได้ · โครงการตามแผนทุกคนดูได้ (ครูดูเพื่อรู้ว่าโครงการไหนเป็นของตน)
const READ = { plan_projects: 'any' };
export const readPermissionOf = (table) => READ[table] || 'masters.read';

export function masterService(table) {
  const view = (ctx, r) => (VIEWS[table] ? VIEWS[table](ctx, r) : r);
  return {
    create(ctx, input) {
      requirePermission(ctx, PERM[table]);
      rejectFields(input, ['id', 'fiscal_year'], 'ระบบกำหนดให้');
      return view(ctx, ctx.store.insert(ctx.user, table, prepare(ctx, table, { ...input }, null)));
    },
    update(ctx, id, patch, reason) {
      requirePermission(ctx, PERM[table]);
      const why = requireReason(reason);
      rejectFields(patch, ['id', 'fiscal_year'], 'ระบบกำหนดให้');
      const { created_by, created_at, updated_at, ...plain } = getOrFail(ctx, table, id);
      return view(ctx, ctx.store.update(ctx.user, table, id, prepare(ctx, table, { ...plain, ...patch }, id), { reason: why }));
    },
    list: (ctx) => { requirePermission(ctx, readPermissionOf(table)); return ctx.store.list(table).map((r) => view(ctx, r)); },
    get: (ctx, id) => { requirePermission(ctx, readPermissionOf(table)); return view(ctx, getOrFail(ctx, table, id)); },
  };
}

export const MASTER_TABLES = Object.keys(PERM);
