import { env3, project, approved, payee, line, reviewAll, E } from './step3_helpers.js';

export function env4() {
  const e = env3();
  const admin = e.as('admin');
  admin.users.create({ name: 'ผู้บริหาร สมมติ', email: E('dir'), roles: ['director'], appointment_ref: 'คำสั่งสมมติ dir' });
  const dir = e.app.store.find('users', (u) => u.email === E('dir'))[0];
  admin.settings.update('ktb_approver_user_ids', [dir.id], 'ทดสอบ');
  // สมุดเช็คของบัญชีกระแสรายวันแต่ละกลุ่ม (เลขสมมติ)
  const accts = admin.bank_accounts.list().filter((a) => a.type === 'กระแสรายวัน');
  const books = {};
  for (const a of accts) {
    const start = { 'บกศ.': 100, 'อุดหนุน': 200, 'รายได้': 300 }[a.fund_group];
    books[a.fund_group] = e.u('finance').cheque_books.create({ bank_account_id: a.id, first_no: String(start * 1000 + 1).padStart(8, '0'), last_no: String(start * 1000 + 50).padStart(8, '0') });
  }
  return { ...e, books, dir };
}

/** ผู้รับเงินพร้อมเลขบัญชี (ผ่านคำขอที่มีผู้อนุมัติ) */
export function bankedPayee(e, o = {}) {
  const p = payee(e, { pay_method: 'KTB', ...o });
  const r = e.u('finance').payees.requestAccountChange(p.id, { bank: 'ธนาคารสมมติ', account_no: '0000000123', reason: 'สมมติ' });
  e.u('reviewer1').payees.approveAccountChange(r.id);
  return e.u('finance').payees.get(p.id);
}

/**
 * สร้างแถว → ขบ. → ผอ. เซ็น → จัด ขจ. → ผอ. เซ็น ขจ. ครบ · specs = [{ fund, payee, bases:[...], ... }]
 * คืน { khjs, lines }
 */
export function signedKhj(e, specs, { signKhj = true } = {}) {
  const lines = [];
  for (const sp of specs) {
    const proj = e.u('plan').plan_projects.create({ name: `โครงการ ${sp.fund}`, fund_code: sp.fund, budget: 90000000 });
    const { code } = approved(e, { proj, amount: sp.approve || 5000000 });
    for (const b of sp.bases) lines.push(line(e, code, sp.payee, { base_amount: b, kind: sp.kind || 'เบิก' }));
  }
  const k = e.u('finance').khb.create({ line_ids: lines.map((l) => l.id) });
  reviewAll(e, 'khb', k.id, 'khj');
  const khjs = e.u('khj').khj.generate(k.id);
  if (signKhj) for (const j of khjs) reviewAll(e, 'khj', j.id, 'finance');
  return { khjs, lines, khb: k };
}
