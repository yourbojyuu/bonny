import { setup, EMAILS, seedBankAndFund } from './helpers.js';

export const E = (k) => `${k}.test@kwc.ac.th`;
export const SCAN = { scan_ref: 'scan-x.jpg' };

/** ระบบ + ผู้ใช้ครบทุกบทบาทที่ฝั่งจ่ายใช้ + ประเภทเงิน 3 กลุ่ม (ข้อมูลสมมติ) */
export function env3() {
  const e = setup();
  const admin = e.as('admin');
  for (const [k, roles] of [['reviewer2', ['reviewer2']], ['reviewer3', ['reviewer3']], ['khj', ['khj_maker']], ['proc', ['procurement']], ['teacher2', ['requester']]]) {
    admin.users.create({ name: `ผู้ใช้ ${k}`, email: E(k), roles, appointment_ref: `คำสั่งสมมติ ${k}` });
  }
  const { fund } = seedBankAndFund(e); // บกศ. ง/1 (กลุ่ม บกศ.)
  const mkFund = (group, code, acct) => {
    const sav = admin.bank_accounts.create({ account_no: acct + '1', bank: 'ธนาคารสมมติ', branch: 'สาขาสมมติ', type: 'ออมทรัพย์', fund_group: group });
    const cur = admin.bank_accounts.create({ account_no: acct + '2', bank: 'ธนาคารสมมติ', branch: 'สาขาสมมติ', type: 'กระแสรายวัน', fund_group: group, linked_account_id: sav.id });
    return admin.funds.create({ fund_code: code, name: `ทุน ${code}`, fund_group: group, bank_account_id: cur.id });
  };
  mkFund('อุดหนุน', 'อน.รห.', '1000');
  mkFund('รายได้', 'รด.สมมติ', '2000');
  const u = (k) => (k === 'khj' || k === 'reviewer2' || k === 'reviewer3' || k === 'proc' || k === 'teacher2') ? e.app.asUser(E(k)) : e.as(k);
  return { ...e, u, fund };
}

export function project(e, { fund_code = 'บกศ. ง/1', budget = 10000000, name = 'โครงการสมมติ', owners = [] } = {}) {
  return e.u('plan').plan_projects.create({ name, fund_code, budget, owner_emails: owners });
}

/** ขออนุมัติจนได้รหัส (ผ่านงานแผน + ผอ. เซ็น) คืน {req, code} */
export function approved(e, { proj, amount = 1000000, requester = 'teacher', items = 'ซื้อวัสดุสมมติ' } = {}) {
  const p = proj || project(e);
  let r = e.u(requester).approvals.submit({ project_id: p.id, items, amount });
  e.u('plan').approvals.receive(r.id);
  e.u('plan').approvals.propose(r.id);
  r = e.u('plan').approvals.recordDecision(r.id, { approved: true, ...SCAN });
  return { req: r, code: r.approval_code, proj: p };
}

export function payee(e, o = {}) {
  return e.u('finance').payees.create({ name: 'ร้านสมมติ ก', tax_form: 'ภ.ง.ด.53', pay_method: 'เช็ค', ...o });
}

export function line(e, code, p, o = {}) {
  return e.u('finance').payments.createLine({ approval_code: code, date: '2026-11-10', kind: 'เบิก', payee_id: p.id, vendor_doc_no: `INV-${Math.random().toString(36).slice(2, 8)}`, description: 'รายการสมมติ', base_amount: 100000, ...o });
}

/** ตรวจ 3 ชั้น + ผอ. เซ็นจนจบ (ผู้ส่งตรวจคือผู้ทำ) */
export function reviewAll(e, type, id, receiver) {
  e.u(type === 'khb' ? 'finance' : 'khj').workflow.submit(type, id);
  for (const w of ['reviewer1', 'reviewer2', 'reviewer3']) { e.u(w).workflow.receive(type, id); e.u(w).workflow.pass(type, id); }
  return e.u(receiver).workflow.receiveSigned(type, id, SCAN);
}
