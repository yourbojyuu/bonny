// ย้ายข้อมูลจากไฟล์เดิม (หัวข้อ 8): ตรวจก่อน (dry-run) → รายงาน → ยืนยันแล้วจึงนำเข้า · ค่าว่างไม่เดา (ให้ผู้ใช้ระบุ) · ไม่ลบ ไม่ทับข้อมูลเดิม
// ยังไม่ได้ทดสอบกับไฟล์จริงของโรงเรียน (ทดสอบด้วย CSV สมมติตามโครงที่ระบุใน HANDOFF)
import { PermissionError, ValidationError } from '../core/errors.js';
import { parseCsv, toNumberOrNull } from '../core/csv.js';
import { toSatang } from '../core/money.js';
import { addDays, isValidDate } from '../core/thaidate.js';
import { requirePermission } from '../core/roles.js';
import { reserveDocNumber } from '../core/numbering.js';
import { hasRole } from './handoffs.js';
import { createPayee } from './payees.js';
import { createPackage } from './receipts.js';
import { opening } from './ledger.js';
import { norm } from './common.js';

const needFinance = (ctx) => { if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินย้ายข้อมูล'); };
const msg = (e) => (e instanceof ValidationError ? e.message : e.message);
const digits = (s) => String(s ?? '').replace(/\D/g, '');

function normMethod(raw, allowed) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return '';
  if (['check', 'cheque', 'เช็ค', 'เช็ก'].includes(t)) return allowed.includes('เช็ค') ? 'เช็ค' : '';
  const hit = allowed.find((a) => a.toLowerCase() === t);
  return hit || '';
}
function normTax(raw, allowed) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (t.includes('53')) return allowed.includes('ภ.ง.ด.53') ? 'ภ.ง.ด.53' : '';
  if (/ภ\.?ง\.?ด\.?\s*3/.test(t)) return allowed.includes('ภ.ง.ด.3') ? 'ภ.ง.ด.3' : '';
  if (t.includes('ไม่มี')) return allowed.includes('ไม่มีภาษี') ? 'ไม่มีภาษี' : '';
  return '';
}

/** ชีต "รายชื่อ": คอลัมน์ D = ชื่อ · E = วิธีจ่าย · F = ภาษี · วิธีจ่าย/ภาษีที่ว่างหรือไม่รู้จัก = ต้องให้ผู้ใช้ระบุ (overrides[เลขแถว]) */
export function migratePayees(ctx, { text, commit = false, overrides = {} } = {}) {
  needFinance(ctx);
  const rows = parseCsv(text);
  const s = ctx.settings;
  const known = new Set(ctx.store.list('payees').map((p) => norm(p.name)));
  const seen = new Set();
  const out = { committed: false, ready: [], needs_confirmation: [], duplicates: [], errors: [], imported: 0 };
  rows.forEach((r, i) => {
    if (i === 0) return; // หัวตาราง
    const row = i + 1, name = norm(r[3]);
    if (!name) return;
    if (known.has(name) || seen.has(name)) { out.duplicates.push({ row, name }); return; }
    const ov = overrides[row] || overrides[String(row)] || {};
    let method = normMethod(ov.pay_method ?? r[4], s.pay_methods), tax = normTax(ov.tax_form ?? r[5], s.tax_forms);
    if (ov.pay_method && !s.pay_methods.includes(ov.pay_method)) { out.errors.push({ row, name, message: `วิธีจ่ายต้องเป็น ${s.pay_methods.join(' / ')}` }); return; }
    if (ov.tax_form && !s.tax_forms.includes(ov.tax_form)) { out.errors.push({ row, name, message: `ประเภทภาษีต้องเป็น ${s.tax_forms.join(' / ')}` }); return; }
    if (ov.pay_method) method = ov.pay_method; if (ov.tax_form) tax = ov.tax_form;
    const missing = [!method && 'pay_method', !tax && 'tax_form'].filter(Boolean);
    seen.add(name);
    if (missing.length) out.needs_confirmation.push({ row, name, missing, raw_method: r[4] || '', raw_tax: r[5] || '' });
    else out.ready.push({ row, name, pay_method: method, tax_form: tax });
  });
  if (commit) {
    for (const p of out.ready) {
      try { createPayee(ctx, { name: p.name, pay_method: p.pay_method, tax_form: p.tax_form, type: '' }); out.imported++; } catch (e) { out.errors.push({ row: p.row, name: p.name, message: msg(e) }); }
    }
    out.committed = true;
  }
  return out;
}

/** แพ็กเกจ: คอลัมน์ 1 = ยอดรวม (บาท) · คอลัมน์ 2 = ชื่อ · หัวคอลัมน์ที่เหลือ = รหัสชนิดเงินย่อย (ยอดเป็นบาท) */
export function migratePackages(ctx, { text, commit = false } = {}) {
  needFinance(ctx);
  const rows = parseCsv(text);
  const out = { committed: false, ready: [], errors: [], imported: 0 };
  if (!rows.length) return out;
  const codes = rows[0].slice(2);
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const total = toNumberOrNull(r[0]);
    const label = norm(r[1]) || `แพ็กเกจ ${r[0]}`;
    if (total === null) { out.errors.push({ row, message: 'ยอดรวมไม่ใช่ตัวเลข' }); return; }
    const lines = [];
    let bad = '';
    codes.forEach((code, j) => {
      const raw = String(r[j + 2] ?? '').trim();
      if (!raw) return;
      const n = toNumberOrNull(raw);
      if (n === null || n <= 0) bad = `ยอดของ ${code} ไม่ใช่ตัวเลข: "${raw}"`; else lines.push(`${code}=${toSatang(String(n))}`);
    });
    if (bad) { out.errors.push({ row, message: bad }); return; }
    const missing = lines.map((l) => l.split('=')[0]).filter((c) => !ctx.store.find('subfunds', (x) => x.code === c).length);
    if (missing.length) { out.errors.push({ row, message: `ไม่พบชนิดเงินย่อยในระบบ: ${missing.join(', ')}` }); return; }
    if (lines.reduce((s2, l) => s2 + Number(l.split('=')[1]), 0) !== toSatang(String(total))) { out.errors.push({ row, message: 'ผลรวมที่แยกไม่เท่ายอดรวม' }); return; }
    out.ready.push({ row, total: toSatang(String(total)), label, lines });
  });
  if (commit) { for (const p of out.ready) { try { createPackage(ctx, { total: p.total, label: p.label, lines: p.lines, channels: [] }); out.imported++; } catch (e) { out.errors.push({ row: p.row, message: msg(e) }); } } out.committed = true; }
  return out;
}

/** ยอดยกมาต่อบัญชี: account_no · ยอด · ยอดตาม statement วันนั้น · วันที่ · ต้องตรงกับ statement ทุกแถว มิฉะนั้นไม่นำเข้าเลย */
export function migrateOpening(ctx, { text, commit = false } = {}) {
  needFinance(ctx);
  const rows = parseCsv(text);
  const out = { committed: false, ready: [], errors: [], imported: 0 };
  const dup = new Set(ctx.store.list('ledger').filter((e) => e.source_type === 'opening').map((e) => e.location));
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const acct = ctx.store.find('bank_accounts', (a) => digits(a.account_no) === digits(r[0]) && digits(r[0]))[0];
    const amt = toNumberOrNull(r[1]), stm = toNumberOrNull(r[2]), date = String(r[3] || '').trim();
    if (!acct) out.errors.push({ row, message: `ไม่พบบัญชี ${r[0]}` });
    else if (dup.has(acct.id)) out.errors.push({ row, message: 'บัญชีนี้ตั้งยอดยกมาแล้ว' });
    else if (amt === null || stm === null) out.errors.push({ row, message: 'ยอดหรือยอดตาม statement ไม่ใช่ตัวเลข' });
    else if (toSatang(String(amt)) !== toSatang(String(stm))) out.errors.push({ row, message: 'ยอดยกมาไม่ตรงกับ statement วันนั้น ต้องตรงก่อนเปิดใช้' });
    else if (!isValidDate(date)) out.errors.push({ row, message: 'วันที่ต้องเป็น YYYY-MM-DD' });
    else { out.ready.push({ row, account_id: acct.id, account_no: acct.account_no, amount: toSatang(String(amt)), date }); dup.add(acct.id); }
  });
  if (commit && !out.errors.length) { for (const o of out.ready) { opening(ctx, { account_id: o.account_id, amount: o.amount, date: o.date }); out.imported++; } out.committed = true; }
  return out;
}

/** เงินยืม: ผู้ยืม(อีเมล) · ยอด · วันที่ยืม · ครบกำหนด · ส่งใช้ · วันส่งใช้ · สถานะเดิม (ทิ้ง คำนวณใหม่จากวันที่) */
export function migrateLoans(ctx, { text, commit = false } = {}) {
  needFinance(ctx);
  const rows = parseCsv(text);
  const out = { committed: false, ready: [], needs_confirmation: [], errors: [], imported: 0 };
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const borrower = String(r[0] || '').trim().toLowerCase(), amt = toNumberOrNull(r[1]), date = String(r[2] || '').trim(), due = String(r[3] || '').trim();
    const settled = toNumberOrNull(r[4]), sdate = String(r[5] || '').trim(), old = String(r[6] || '');
    if (!borrower.endsWith(`@${ctx.settings.allowed_email_domain}`)) { out.errors.push({ row, message: `ผู้ยืมต้องเป็นอีเมล @${ctx.settings.allowed_email_domain}` }); return; }
    if (amt === null || amt <= 0 || !isValidDate(date) || (due && !isValidDate(due))) { out.errors.push({ row, message: 'ยอดหรือวันที่ไม่ถูกต้อง' }); return; }
    if (due && due < date) { out.errors.push({ row, message: 'วันครบกำหนดก่อนวันที่ยืม' }); return; }
    const hasSettle = settled !== null && settled > 0;
    if ((old.includes('ส่งใช้แล้ว') && !hasSettle) || (hasSettle && !isValidDate(sdate))) { out.needs_confirmation.push({ row, borrower, message: 'สถานะเดิมเป็นส่งใช้แล้วแต่ไม่มียอดหรือวันที่ส่งใช้ ให้ผู้ใช้ตรวจแล้วแก้ไฟล์' }); return; }
    out.ready.push({ row, borrower, amount: toSatang(String(amt)), date, due_date: due || addDays(date, ctx.settings.loan_due_days), legacy_settled: hasSettle ? toSatang(String(settled)) : 0, legacy_settled_date: hasSettle ? sdate : '' });
  });
  if (commit) {
    for (const l of out.ready) {
      ctx.store.withLock(() => {
        const { docNo } = reserveDocNumber(ctx, { prefixSetting: 'doc_prefix_loan', table: 'loans', field: 'loan_no' }, l.date);
        ctx.store.insert(ctx.user, 'loans', { loan_no: docNo, approval_code: 'ย้ายข้อมูล', borrower: l.borrower, amount: l.amount, fund_code: '', date: l.date, due_date: l.due_date, legacy_settled: l.legacy_settled, legacy_settled_date: l.legacy_settled_date }, { reason: 'ย้ายข้อมูลเงินยืมจากไฟล์เดิม' });
      });
      out.imported++;
    }
    out.committed = true;
  }
  return out;
}

const findCol = (head, ...parts) => head.findIndex((h) => parts.every((p) => String(h).includes(p)));
/** รายงานตรวจก่อนย้ายข้อมูลจากหน้ารายการเดิมและทะเบียน ขบ. (ไม่เขียนข้อมูล · ให้ผู้ใช้ตรวจก่อน ไม่เดา) */
export function migrateAudit(ctx, { lines_text = '', khb_text = '' } = {}) {
  requirePermission(ctx, 'masters.read');
  const L = parseCsv(lines_text);
  const out = { duplicates: [], khb_formats: { number: 0, slash: 0, blank: 0, tax: 0, dash: 0 }, khb_mismatch: [], register_missing_khj: [] };
  if (L.length > 1) {
    const head = L[0];
    const kc = findCol(head, 'ขบ'), ac = findCol(head, 'ขอเบิก');
    const groups = new Map();
    const totals = new Map();
    L.slice(1).forEach((r, i) => {
      const row = i + 2, key = r.join('\u0001');
      groups.set(key, [...(groups.get(key) || []), row]);
      if (kc >= 0) {
        const v = String(r[kc] ?? '').trim();
        if (v === '') out.khb_formats.blank++; else if (v === '-') out.khb_formats.dash++; else if (v.includes('ภาษี')) out.khb_formats.tax++; else if (v.includes('/')) out.khb_formats.slash++; else if (/^\d+$/.test(v)) { out.khb_formats.number++; const a = toNumberOrNull(r[ac]); if (a !== null) totals.set(v, (totals.get(v) || 0) + toSatang(String(a))); }
      }
    });
    out.duplicates = [...groups.values()].filter((g) => g.length > 1).map((rows) => ({ rows }));
    const R = parseCsv(khb_text);
    if (R.length > 1) {
      const rh = R[0], rk = findCol(rh, 'ขบ'), rt = findCol(rh, 'ยอด'), rj = findCol(rh, 'ขจ');
      for (const r of R.slice(1)) {
        const k = String(r[rk] || '').trim(), tot = toNumberOrNull(r[rt]);
        if (!k) continue;
        if (tot !== null && (totals.get(k) || 0) !== toSatang(String(tot))) out.khb_mismatch.push({ khb: k, lines_total: totals.get(k) || 0, register_total: toSatang(String(tot)) });
        if (rj >= 0 && !String(r[rj] || '').trim()) out.register_missing_khj.push({ khb: k });
      }
    }
  }
  return out;
}
