// บทบาท สิทธิ์ และคู่บทบาทที่ถือพร้อมกันไม่ได้
// คู่บทบาทที่ขัดกันอยู่ในโค้ด ไม่อยู่ใน settings เพื่อไม่ให้ผู้ดูแลระบบปลดการควบคุมเองได้
import { PermissionError } from './errors.js';

export const ROLES = {
  requester: 'ครูผู้ขอ',
  plan: 'งานแผน',
  finance: 'การเงิน',
  khj_maker: 'ผู้ทำ ขจ.',
  reviewer1: 'ผู้ตรวจชั้น 1 หัวหน้าการเงิน',
  reviewer2: 'ผู้ตรวจชั้น 2 หัวหน้ากลุ่มบริหารงานแผนและงบประมาณ',
  reviewer3: 'ผู้ตรวจชั้น 3 รอง ผอ. กลุ่มบริหารงบประมาณ',
  director: 'ผอ.',
  procurement: 'พัสดุ',
  cash_committee: 'กรรมการเก็บรักษาเงิน',
  unit_head: 'หัวหน้าหน่วยงานย่อย',
  auditor: 'ผู้ตรวจสอบ',
  admin: 'ผู้ดูแลระบบ',
};

// บทบาทที่ทำรายการเงิน (สร้าง/ตรวจ/อนุมัติเอกสารเงิน)
const MONEY_ROLES = ['plan', 'finance', 'khj_maker', 'reviewer1', 'reviewer2', 'reviewer3', 'procurement', 'cash_committee'];

// [บทบาท, บทบาทที่ห้ามถือร่วม]
export const ROLE_CONFLICTS = [
  ['admin', [...MONEY_ROLES, 'director', 'auditor']], // ผู้ดูแลระบบทำรายการเงินไม่ได้
  ['auditor', Object.keys(ROLES).filter((r) => r !== 'auditor')], // ผู้ตรวจสอบอ่านอย่างเดียว
  ['cash_committee', ['finance', 'khj_maker']], // กรรมการห้ามออกใบเสร็จ/จ่ายเงิน
  ['director', MONEY_ROLES], // ผอ. ห้ามทำรายการแทนเจ้าหน้าที่
];

/** คืนรายการคู่ที่ขัดกัน เช่น [['admin','finance']] */
export function roleConflicts(roles) {
  const out = [];
  for (const [r, banned] of ROLE_CONFLICTS) {
    if (!roles.includes(r)) continue;
    for (const b of banned) if (roles.includes(b) && !out.some(([x, y]) => (x === b && y === r))) out.push([r, b]);
  }
  return out;
}

// การกระทำ → บทบาทที่ทำได้ · ค่าเป็น string = ดึงรายการบทบาทจาก settings
// ครูทั่วไป (ไม่มีชื่อในตารางผู้ใช้) ได้บทบาท requester อย่างเดียว · ข้อมูลหลักอ่านได้เฉพาะบุคลากรที่ได้รับแต่งตั้ง
export const STAFF_ROLES = Object.keys(ROLES).filter((r) => r !== 'requester');

export const PERMISSIONS = {
  'masters.read': STAFF_ROLES,
  'users.read': ['admin', 'auditor'],
  'users.manage': ['admin'],
  'settings.update': ['admin'],
  'bank_accounts.manage': ['admin'],
  'funds.manage': ['admin'],
  'subfunds.manage': ['admin'],
  'fund_allowed_expense.manage': ['admin'],
  'cheque_books.manage': ['finance'],
  'payees.manage': ['finance'],
  'packages.manage': ['finance'],
  'payees.account.request': ['finance'],
  'payees.account.approve': 'payee_account_approver_roles',
  'plan_projects.manage': ['plan'],
  'audit.read': ['admin', 'auditor'],
  'flags.read': ['admin', 'auditor', 'director', 'plan', 'finance', 'reviewer1', 'reviewer2', 'reviewer3'],
};

export function allowedRoles(action, settings) {
  const p = PERMISSIONS[action];
  if (p === undefined) throw new Error(`ไม่รู้จักสิทธิ์ ${action}`);
  return typeof p === 'string' ? settings[p] || [] : p;
}

export function can(user, action, settings) {
  if (action === 'any') return true;
  const allowed = allowedRoles(action, settings);
  return user.roles.some((r) => allowed.includes(r));
}

export function requirePermission(ctx, action) {
  if (!can(ctx.user, action, ctx.settings)) {
    const names = allowedRoles(action, ctx.settings).map((r) => ROLES[r] || r).join(' / ');
    throw new PermissionError(`ไม่มีสิทธิ์ทำรายการนี้ (ต้องเป็น ${names || '—'})`);
  }
}
