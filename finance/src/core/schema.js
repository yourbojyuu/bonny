// นิยามตารางทั้งหมดไว้ที่เดียว · 1 ตาราง = 1 ชีต · แถวแรกเป็นชื่อคอลัมน์
// ชนิด: id · string · int · money (สตางค์ จำนวนเต็ม) · bool · date (YYYY-MM-DD) · list (array ข้อความ) · enum
// list ที่ itemType: 'email' = รายการอีเมล (ไม่ใช่บทบาท)
// enum ที่ optionsSetting = รายการมาจาก settings (แก้ได้โดยไม่ต้องแก้โค้ด)
// readonly = ผู้ใช้กรอกเองไม่ได้ ระบบเติมให้

export const COMMON_COLUMNS = ['created_by', 'created_at', 'updated_at'];

const id = { key: 'id', label: 'รหัส', type: 'id' };
const active = { key: 'active', label: 'ใช้งาน', type: 'bool', default: true };

export const TABLES = {
  users: {
    label: 'ผู้ใช้', idPrefix: 'U',
    columns: [
      id,
      { key: 'name', label: 'ชื่อ-สกุล', type: 'string', required: true },
      { key: 'email', label: 'อีเมล @kwc.ac.th', type: 'string', required: true },
      { key: 'roles', label: 'บทบาท', type: 'list', required: true },
      { key: 'appointment_ref', label: 'เลขคำสั่งแต่งตั้ง', type: 'string', required: true },
      active,
    ],
  },
  settings: {
    label: 'ตั้งค่า', idPrefix: '',
    columns: [
      { key: 'id', label: 'คีย์', type: 'id' },
      { key: 'value', label: 'ค่า (JSON)', type: 'string', required: true },
    ],
  },
  bank_accounts: {
    label: 'บัญชีธนาคาร', idPrefix: 'BA',
    columns: [
      id,
      { key: 'account_no', label: 'เลขที่บัญชี', type: 'string', required: true },
      { key: 'bank', label: 'ธนาคาร', type: 'string', required: true },
      { key: 'branch', label: 'สาขา', type: 'string', required: true },
      { key: 'type', label: 'ประเภทบัญชี', type: 'enum', optionsSetting: 'bank_account_types', required: true },
      { key: 'fund_group', label: 'กลุ่มเงิน', type: 'enum', optionsSetting: 'fund_groups', required: true },
      { key: 'linked_account_id', label: 'บัญชีออมทรัพย์คู่ (OTID)', type: 'string', ref: 'bank_accounts' },
      active,
    ],
  },
  funds: {
    label: 'ประเภทเงิน (ฝั่งจ่าย)', idPrefix: 'F',
    columns: [
      id,
      { key: 'fund_code', label: 'รหัสเงิน', type: 'string', required: true },
      { key: 'name', label: 'ชื่อ', type: 'string', required: true },
      { key: 'fund_group', label: 'กลุ่มเงิน', type: 'enum', optionsSetting: 'fund_groups', required: true },
      { key: 'bank_account_id', label: 'บัญชีธนาคาร', type: 'string', required: true, ref: 'bank_accounts' },
      active,
    ],
  },
  subfunds: {
    label: 'ชนิดเงินย่อย (ฝั่งรับ)', idPrefix: 'SF',
    columns: [
      id,
      { key: 'code', label: 'รหัส', type: 'string', required: true },
      { key: 'name', label: 'ชื่อ', type: 'string', required: true },
      { key: 'group', label: 'กลุ่มเงิน', type: 'enum', optionsSetting: 'fund_groups', required: true },
      { key: 'has_collectible', label: 'ตั้งยอดที่ต้องเก็บ', type: 'bool', default: false },
      active,
    ],
  },
  fund_allowed_expense: {
    label: 'ค่าใช้จ่ายที่ประเภทเงินอนุญาต', idPrefix: 'FX',
    columns: [
      id,
      { key: 'fund_code', label: 'รหัสเงิน', type: 'string', required: true, ref: 'funds', refKey: 'fund_code' },
      { key: 'expense_category', label: 'หมวดค่าใช้จ่าย', type: 'string', required: true },
      active,
    ],
  },
  payees: {
    label: 'ผู้รับเงิน', idPrefix: 'P',
    columns: [
      id,
      { key: 'name', label: 'ชื่อ', type: 'string', required: true },
      { key: 'short_name', label: 'ชื่อย่อ', type: 'string' },
      { key: 'cheque_print_name', label: 'ชื่อที่พิมพ์บนเช็ค', type: 'string' },
      { key: 'type', label: 'ประเภทผู้รับ', type: 'string' },
      { key: 'tax_form', label: 'ประเภทภาษี', type: 'enum', optionsSetting: 'tax_forms', required: true },
      { key: 'pay_method', label: 'วิธีจ่าย', type: 'enum', optionsSetting: 'pay_methods', required: true },
      { key: 'bank', label: 'ธนาคาร', type: 'string', readonly: true },
      { key: 'account_no', label: 'เลขที่บัญชี', type: 'string', readonly: true },
      { key: 'account_changed_at', label: 'แก้บัญชีล่าสุด', type: 'date', readonly: true },
      { key: 'account_change_approved_by', label: 'ผู้อนุมัติแก้บัญชี', type: 'string', readonly: true },
      active,
    ],
  },
  payee_account_changes: {
    label: 'คำขอเปลี่ยนบัญชีผู้รับเงิน', idPrefix: 'PAC',
    columns: [
      id,
      { key: 'payee_id', label: 'ผู้รับเงิน', type: 'string', required: true, ref: 'payees' },
      { key: 'old_bank', label: 'ธนาคารเดิม', type: 'string' },
      { key: 'old_account_no', label: 'บัญชีเดิม', type: 'string' },
      { key: 'new_bank', label: 'ธนาคารใหม่', type: 'string', required: true },
      { key: 'new_account_no', label: 'บัญชีใหม่', type: 'string', required: true },
      { key: 'reason', label: 'เหตุผล/หลักฐาน', type: 'string', required: true },
      { key: 'requested_by', label: 'ผู้ยื่น', type: 'string', required: true },
      { key: 'decision', label: 'ผลพิจารณา', type: 'enum', options: ['', 'approve', 'reject'] },
      { key: 'decided_by', label: 'ผู้พิจารณา', type: 'string' },
      { key: 'decided_at', label: 'วันที่พิจารณา', type: 'string' },
      { key: 'decision_reason', label: 'เหตุผลไม่อนุมัติ', type: 'string' },
    ],
  },
  plan_projects: {
    label: 'โครงการตามแผน', idPrefix: 'PJ',
    columns: [
      id,
      { key: 'fiscal_year', label: 'ปีงบ', type: 'int', readonly: true },
      { key: 'name', label: 'ชื่อโครงการ/กิจกรรม', type: 'string', required: true },
      { key: 'fund_code', label: 'รหัสเงิน', type: 'string', required: true, ref: 'funds', refKey: 'fund_code' },
      { key: 'budget', label: 'วงเงิน', type: 'money', required: true },
      { key: 'owner_emails', label: 'ผู้รับผิดชอบ (อีเมลโรงเรียน)', type: 'list', itemType: 'email' },
      active,
    ],
  },
  cheque_books: {
    label: 'สมุดเช็ค', idPrefix: 'CB',
    columns: [
      id,
      { key: 'bank_account_id', label: 'บัญชีกระแสรายวัน', type: 'string', required: true, ref: 'bank_accounts' },
      { key: 'first_no', label: 'เลขเช็คแรก', type: 'string', required: true },
      { key: 'last_no', label: 'เลขเช็คสุดท้าย', type: 'string', required: true },
      { key: 'note', label: 'หมายเหตุ', type: 'string' },
    ],
  },
  handoffs: {
    label: 'งานส่ง-รับ', idPrefix: 'H',
    columns: [
      id,
      { key: 'doc_type', label: 'ชนิดเอกสาร', type: 'string', required: true },
      { key: 'doc_id', label: 'เอกสาร', type: 'string', required: true },
      { key: 'step_key', label: 'ขั้น', type: 'string', required: true },
      { key: 'from_role', label: 'จากบทบาท', type: 'string' },
      { key: 'to_role', label: 'ถึงบทบาท', type: 'string', required: true },
      { key: 'sent_by', label: 'ผู้ส่ง', type: 'string', required: true },
      { key: 'sent_at', label: 'ส่งเมื่อ', type: 'string', required: true },
      { key: 'received_by', label: 'ผู้รับ', type: 'string', readonly: true },
      { key: 'received_at', label: 'รับเมื่อ', type: 'string', readonly: true },
      { key: 'scan_ref', label: 'ภาพหน้าลงนาม', type: 'string' },
      { key: 'note', label: 'หมายเหตุ', type: 'string' },
    ],
  },
  review_steps: {
    label: 'ประวัติการตรวจ', idPrefix: 'RS', appendOnly: true,
    columns: [
      id,
      { key: 'doc_type', label: 'ชนิดเอกสาร', type: 'string', required: true },
      { key: 'doc_id', label: 'เอกสาร', type: 'string', required: true },
      { key: 'round', label: 'รอบ', type: 'int', required: true },
      { key: 'step', label: 'ชั้น', type: 'enum', options: ['1', '2', '3', 'director'], required: true },
      { key: 'user', label: 'ผู้ทำ', type: 'string', required: true },
      { key: 'action', label: 'ผล', type: 'enum', options: ['pass', 'return', 'sign'], required: true },
      { key: 'reason', label: 'เหตุผล', type: 'string' },
      { key: 'scan_ref', label: 'ภาพหน้าลงนาม', type: 'string' },
      { key: 'at', label: 'เวลา', type: 'string', required: true },
    ],
  },
  doc_flow: {
    label: 'สถานะการตรวจเอกสาร', idPrefix: 'DF',
    columns: [
      id,
      { key: 'doc_type', label: 'ชนิดเอกสาร', type: 'string', required: true },
      { key: 'doc_id', label: 'เอกสาร', type: 'string', required: true },
      { key: 'maker', label: 'ผู้ทำ', type: 'string', required: true },
      { key: 'round', label: 'รอบ', type: 'int', required: true },
      { key: 'stage', label: 'ขั้น', type: 'enum', options: ['returned', 'r1', 'r2', 'r3', 'sign', 'done'], required: true },
      { key: 'phase', label: 'ระยะ', type: 'enum', options: ['', 'wait', 'review'] },
      { key: 'reviewer', label: 'ผู้ตรวจปัจจุบัน', type: 'string' },
      { key: 'return_stage', label: 'ชั้นที่ส่งคืน', type: 'string' },
      { key: 'return_reason', label: 'เหตุผลส่งคืน', type: 'string' },
      { key: 'finished_at', label: 'เสร็จเมื่อ', type: 'string' },
    ],
  },
  login_log: {
    label: 'บันทึกการเข้าระบบ', idPrefix: 'LG', noCommon: true, appendOnly: true, noAudit: true,
    columns: [
      id,
      { key: 'at', label: 'เวลา', type: 'string' },
      { key: 'email', label: 'อีเมลที่ใช้เข้า', type: 'string' },
      { key: 'google_email', label: 'บัญชี Google ที่เปิดอยู่', type: 'string' },
      { key: 'result', label: 'ผล', type: 'string' },
    ],
  },
  audit_log: {
    label: 'ประวัติการแก้ไข', idPrefix: 'L', noCommon: true, appendOnly: true,
    columns: [
      id,
      { key: 'at', label: 'เวลา', type: 'string' },
      { key: 'user', label: 'ผู้ทำ', type: 'string' },
      { key: 'action', label: 'การกระทำ', type: 'string' },
      { key: 'table', label: 'ตาราง', type: 'string' },
      { key: 'record_id', label: 'รายการ', type: 'string' },
      { key: 'before', label: 'ก่อน (JSON)', type: 'string' },
      { key: 'after', label: 'หลัง (JSON)', type: 'string' },
      { key: 'reason', label: 'เหตุผล', type: 'string' },
    ],
  },
};

export function headersOf(def) {
  return def.columns.map((c) => c.key).concat(def.noCommon ? [] : COMMON_COLUMNS);
}

export function columnOf(def, key) {
  return def.columns.find((c) => c.key === key);
}
