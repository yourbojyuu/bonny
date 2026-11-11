// ค่าตั้งค่าทั้งหมด · pending = ค่าที่ [รอยืนยัน] หรือยังรอคำตอบจากโรงเรียน (หัวข้อ 12/14 ใน HANDOFF)
// ค่าเงินเก็บเป็นสตางค์

const isStr = (v) => typeof v === 'string';
const isStrList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => isStr(x) && x.trim() !== '');
const isInt = (v) => Number.isInteger(v);

export const SETTING_SPECS = {
  allowed_email_domain: { label: 'โดเมนอีเมลที่เข้าระบบได้', default: 'kwc.ac.th', check: (v) => isStr(v) && /^[a-z0-9.-]+$/.test(v) },
  school_name: { label: 'ชื่อโรงเรียนในหัวเอกสาร', default: 'โรงเรียนกาวิละวิทยาลัย', check: (v) => isStr(v) && v.trim() !== '' },
  director_name: { label: 'ชื่อผู้อำนวยการในช่องลงนาม (เว้นว่างได้)', default: '', check: isStr },
  fiscal_year_start_month: { label: 'เดือนแรกของปีงบ', default: 10, check: (v) => isInt(v) && v >= 1 && v <= 12 },

  doc_prefix_approval: { label: 'ตัวนำเลขรหัสอนุมัติ', default: 'อม.', pending: 'HANDOFF 14.4 [รอยืนยัน]', check: isStr },
  doc_prefix_khb: { label: 'ตัวนำเลข ขบ.', default: 'ขบ.', check: isStr },
  doc_prefix_khj: { label: 'ตัวนำเลข ขจ.', default: 'ขจ.', check: isStr },
  doc_prefix_loan: { label: 'ตัวนำเลขสัญญาเงินยืม', default: '', check: isStr },

  fund_groups: { label: 'กลุ่มเงิน', default: ['อุดหนุน', 'บกศ.', 'รายได้'], check: isStrList },
  bank_account_types: { label: 'ประเภทบัญชีธนาคาร', default: ['ออมทรัพย์', 'กระแสรายวัน'], check: isStrList },
  pay_methods: { label: 'วิธีจ่าย', default: ['KTB', 'เช็ค', 'ออนไลน์'], check: isStrList },
  tax_forms: { label: 'ประเภทภาษี', default: ['ภ.ง.ด.3', 'ภ.ง.ด.53', 'ไม่มีภาษี'], check: isStrList },

  // เกณฑ์ภาษีเก็บเป็น "ยอดรวม VAT" แล้วคำนวณเทียบแบบจำนวนเต็ม (base × (100+vat) ≥ gross × 100) ไม่ปัดเป็น 467
  pnd3_gross_threshold: { label: 'เกณฑ์ ภ.ง.ด.3 (ยอดรวม VAT, สตางค์)', default: 1000000, check: (v) => isInt(v) && v >= 0 },
  pnd53_gross_threshold: { label: 'เกณฑ์ ภ.ง.ด.53 (ยอดรวม VAT, สตางค์)', default: 50000, check: (v) => isInt(v) && v >= 0 },
  vat_rate_pct: { label: 'อัตรา VAT (%)', default: 7, check: (v) => isInt(v) && v >= 0 && v < 100 },
  wht_rate_pct: { label: 'อัตราภาษีหัก ณ ที่จ่าย (%)', default: 1, check: (v) => isInt(v) && v >= 0 && v < 100 },

  cash_holding_limit: { label: 'วงเงินเก็บรักษาเงินสดต่อวัน (สตางค์)', default: null, pending: 'HANDOFF 12.12', check: (v) => v === null || (isInt(v) && v >= 0) },
  sla_days: { label: 'จำนวนวันค้างก่อนขึ้นธง แยกตามขั้น', default: {}, pending: 'HANDOFF 12.7', check: (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((d) => isInt(d) && d >= 0) },

  ktb_approver_user_ids: { label: 'ผู้มีสิทธิ์อนุมัติใน KTB (รหัสผู้ใช้)', default: [], check: (v) => Array.isArray(v) && v.every(isStr) },
  payee_account_approver_roles: { label: 'บทบาทที่อนุมัติการแก้เลขบัญชีผู้รับเงินได้', default: ['reviewer1'], pending: 'ขั้น 1 [รอยืนยัน]', check: isStrList },
  payee_account_flag_days: { label: 'ขึ้นธงเมื่อบัญชีผู้รับเงินถูกแก้ภายใน (วัน)', default: 30, check: (v) => isInt(v) && v >= 0 },

  loan_due_days: { label: 'เงินยืมต้องส่งใช้ภายใน (วัน)', default: 30, pending: 'HANDOFF 12.11 [รอยืนยัน]', check: (v) => isInt(v) && v > 0 },
  close_code_mode: { label: 'ปิดรหัสอนุมัติ (manual = การเงินกดปิดเอง · auto = ปิดเมื่อจ่ายครบทุกแถวของรหัส)', default: 'manual', pending: 'HANDOFF 12.6 [รอยืนยัน]', check: (v) => v === 'manual' || v === 'auto' },
  statement_codes: { label: 'รหัสรายการใน statement (deposit · ktb · interest · cheque · overdraft)', default: { deposit: ['PBSDT'], ktb: ['BPSWT'], interest: ['IIPS'], cheque: ['CWTPC', 'CWTRC', 'CBCA'], overdraft: ['OTID'] }, pending: 'HANDOFF 12.16 [รอตัวอย่าง statement แต่ละบัญชี]', check: (v) => v && typeof v === 'object' && ['deposit', 'ktb', 'interest', 'cheque', 'overdraft'].every((k) => Array.isArray(v[k])) },
  adjustment_approver_roles: { label: 'บทบาทที่อนุมัติรายการปรับปรุง (≠ ผู้ทำ)', default: ['reviewer1', 'reviewer2', 'reviewer3'], pending: 'ขั้น 6 [รอยืนยัน]', check: isStrList },
  deposit_match_days: { label: 'ใบนำฝากกับ statement วันที่ห่างกันได้ (วัน)', default: 3, check: (v) => isInt(v) && v >= 0 },
  cheque_stale_days: { label: 'เช็คค้างขึ้นเงิน เตือนที่/ธงแดงที่ (วัน)', default: [150, 180], check: (v) => Array.isArray(v) && v.length === 2 && v.every(isInt) && v[0] < v[1] },
  review_restart: { label: 'ส่งคืนแล้วแก้ ให้เริ่มตรวจที่ (first = ชั้น 1 ใหม่ · returned = ชั้นที่ส่งคืน)', default: 'first', pending: 'HANDOFF 12.5 [รอยืนยัน]', check: (v) => v === 'first' || v === 'returned' },
  require_scan: { label: 'ต้องแนบภาพหน้าที่ ผอ. ลงนามทุกครั้ง', default: true, pending: 'HANDOFF 12.8 [รอยืนยัน]', check: (v) => typeof v === 'boolean' },
  timeline_roles: { label: 'บทบาทที่เห็นไทม์ไลน์ภาพรวมของทุกเอกสาร', default: ['finance', 'income', 'khj_maker', 'procurement', 'reviewer1', 'reviewer2', 'reviewer3', 'plan', 'director', 'auditor'], check: isStrList },
  receipt_book_size: { label: 'จำนวนใบเสร็จต่อเล่ม', default: 500, check: (v) => isInt(v) && v >= 1 && v <= 100000 },
  fund_allowed_expense_mode: { label: 'กฎค่าใช้จ่ายตามประเภทเงิน', default: 'flag', check: (v) => v === 'flag' || v === 'block' },
};

/** อ่าน settings จาก store รวมกับค่าเริ่มต้น */
export function loadSettings(store) {
  const out = {};
  for (const [k, spec] of Object.entries(SETTING_SPECS)) out[k] = JSON.parse(JSON.stringify(spec.default)); // Apps Script ไม่มี structuredClone
  for (const row of store.list('settings')) {
    if (SETTING_SPECS[row.id]) out[row.id] = JSON.parse(row.value);
  }
  return out;
}
