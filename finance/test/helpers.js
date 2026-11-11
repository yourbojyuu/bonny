// ตัวช่วยสำหรับ test · ข้อมูลทั้งหมดเป็นข้อมูลสมมติ
import { createMemoryRepo } from '../src/data/memoryRepo.js';
import { createApp } from '../src/app.js';

export function fixedClock(iso) {
  let t = new Date(iso);
  return {
    now: () => new Date(t.getTime()),
    set: (next) => { t = new Date(next); },
  };
}

export const EMAILS = {
  admin: 'admin.test@kwc.ac.th',
  finance: 'finance.test@kwc.ac.th',
  finance2: 'finance2.test@kwc.ac.th',
  head: 'head.test@kwc.ac.th', // หัวหน้าการเงิน (ผู้ตรวจชั้น 1) + การเงิน
  reviewer1: 'reviewer1.test@kwc.ac.th',
  plan: 'plan.test@kwc.ac.th',
  teacher: 'teacher.test@kwc.ac.th',
  auditor: 'auditor.test@kwc.ac.th',
};

/** สร้างระบบเปล่า + ผู้ใช้สมมติชุดมาตรฐาน */
export function setup({ now = '2026-11-10T03:00:00Z', extraTables, extraFlows } = {}) {
  const clock = fixedClock(now);
  const repo = createMemoryRepo();
  const app = createApp({ repo, clock, extraTables, extraFlows });
  app.bootstrap({ name: 'ผู้ดูแล สมมติ', email: EMAILS.admin, appointment_ref: 'คำสั่งสมมติ 1/2570' });
  const admin = app.asUser(EMAILS.admin);
  const mk = (key, roles) =>
    admin.users.create({ name: `ผู้ใช้ ${key}`, email: EMAILS[key], roles, appointment_ref: `คำสั่งสมมติ ${key}` });
  mk('finance', ['finance']);
  mk('finance2', ['finance']);
  mk('head', ['finance', 'reviewer1']);
  mk('reviewer1', ['reviewer1']);
  mk('plan', ['plan']);
  mk('teacher', ['requester']);
  mk('auditor', ['auditor']);
  return { app, repo, clock, as: (k) => app.asUser(EMAILS[k] || k) };
}

/** ตั้งบัญชีธนาคาร + ประเภทเงินสมมติ สำหรับ test ที่ต้องใช้ */
export function seedBankAndFund(env) {
  const admin = env.as('admin');
  const sav = admin.bank_accounts.create({ account_no: '000-0-00001-1', bank: 'ธนาคารสมมติ', branch: 'สาขาสมมติ', type: 'ออมทรัพย์', fund_group: 'บกศ.' });
  const cur = admin.bank_accounts.create({ account_no: '000-0-00002-2', bank: 'ธนาคารสมมติ', branch: 'สาขาสมมติ', type: 'กระแสรายวัน', fund_group: 'บกศ.', linked_account_id: sav.id });
  const fund = admin.funds.create({ fund_code: 'บกศ. ง/1', name: 'ค่าจ้างครูสมมติ', fund_group: 'บกศ.', bank_account_id: cur.id });
  return { sav, cur, fund };
}

export function fieldsOf(fn) {
  try { fn(); } catch (e) { if (e.errors) return e.errors.map((x) => x.field).sort(); throw e; }
  throw new Error('คาดว่าจะ error แต่ผ่าน');
}
