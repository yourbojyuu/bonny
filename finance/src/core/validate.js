// ตรวจชนิดข้อมูลตาม schema · ไม่รู้จักช่อง = error · สะสม error ทุกช่องลง collector
import { isValidDate } from './thaidate.js';

/**
 * คืน record ที่ normalize แล้ว (trim ข้อความ, เติมค่าเริ่มต้น) · error ใส่ลง c
 * @param {object} c collector จาก errors.js
 */
export function checkRecord(def, rec, settings, c) {
  const out = {};
  for (const key of Object.keys(rec)) {
    if (!def.columns.some((col) => col.key === key)) c.add(key, 'ไม่มีช่องนี้ในตาราง');
  }
  for (const col of def.columns) {
    let v = rec[col.key];
    if (v === undefined || v === null) v = col.default !== undefined ? col.default : emptyOf(col.type);
    switch (col.type) {
      case 'id':
      case 'string':
      case 'date':
      case 'enum':
        if (typeof v === 'number') v = String(v);
        if (typeof v !== 'string') { c.add(col.key, 'ต้องเป็นข้อความ'); break; }
        v = v.trim();
        if (col.required && v === '') { c.add(col.key, `ต้องกรอก${col.label || ''}`); break; }
        if (col.type === 'date' && v !== '' && !isValidDate(v)) c.add(col.key, 'วันที่ไม่ถูกต้อง');
        if (col.type === 'enum' && (v !== '' || col.required)) {
          const opts = col.optionsSetting ? settings[col.optionsSetting] : col.options;
          if (!opts.includes(v)) c.add(col.key, `ต้องเลือกจากรายการ: ${opts.filter(Boolean).join(' / ')}`);
        }
        break;
      case 'int':
      case 'money':
        if (v === '' || v === undefined) { if (col.required) c.add(col.key, `ต้องกรอก${col.label || ''}`); v = null; break; }
        if (!Number.isInteger(v)) c.add(col.key, col.type === 'money' ? 'ยอดเงินไม่ถูกต้อง (ทศนิยมได้ไม่เกิน 2 ตำแหน่ง)' : 'ต้องเป็นจำนวนเต็ม');
        break;
      case 'bool':
        if (typeof v !== 'boolean') c.add(col.key, 'ต้องเป็นใช่/ไม่ใช่');
        break;
      case 'list':
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) { c.add(col.key, 'ต้องเป็นรายการ'); break; }
        if (col.required && v.length === 0) c.add(col.key, `ต้องเลือก${col.label || ''}อย่างน้อย 1 รายการ`);
        break;
      default:
        throw new Error(`ชนิดคอลัมน์ไม่รู้จัก ${col.type}`);
    }
    out[col.key] = v;
  }
  return out;
}

function emptyOf(type) {
  if (type === 'list') return [];
  if (type === 'int' || type === 'money') return '';
  return '';
}

export const digitsOnly = (s) => String(s ?? '').replace(/[\s-]/g, '');
