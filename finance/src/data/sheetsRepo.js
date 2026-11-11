// storage บน Google Sheets · 1 ตาราง = 1 ชีต · แถว 1 = ชื่อคอลัมน์
// ทุกช่องตั้งรูปแบบเป็นข้อความ (@) และเขียนเป็นข้อความเสมอ กัน Sheets แปลงเลข 0 นำหน้า/วันที่/ทศนิยมเอง
// ห้ามมีสูตรในชีต · ไม่มีคำสั่งลบ
import { headersOf } from '../core/schema.js';

export function createSheetsRepo({ spreadsheet, lock, tables, newUuid, flush = () => {} }) {
  const def = (t) => { const d = tables[t]; if (!d) throw new Error(`ไม่รู้จักตาราง ${t}`); return d; };
  const typeOf = (d, key) => (d.columns.find((c) => c.key === key) || { type: 'string' }).type;

  function sheetOf(t) {
    const sh = spreadsheet.getSheetByName(t);
    if (!sh) throw new Error(`ไม่พบชีต ${t} (รัน setupSheets ก่อน)`);
    const headers = headersOf(def(t));
    const actual = sh.getRange(1, 1, 1, headers.length).getValues()[0].map(String);
    if (sh.getLastColumn() !== headers.length || actual.join('\u0001') !== headers.join('\u0001')) {
      throw new Error(`หัวคอลัมน์ของชีต ${t} ถูกแก้จากภายนอก ระบบหยุดเขียนเพื่อกันข้อมูลเสีย แจ้งผู้ดูแลระบบ`);
    }
    return { sh, headers };
  }

  function toCell(type, v) {
    if (v === null || v === undefined) return '';
    if (type === 'list') return JSON.stringify(v);
    if (type === 'bool') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }

  function fromCell(type, v) {
    const s = v === null || v === undefined ? '' : String(v);
    switch (type) {
      case 'list': return s ? JSON.parse(s) : [];
      case 'bool': return s.toUpperCase() === 'TRUE';
      case 'int':
      case 'money': return s === '' ? null : Number(s);
      default: return s;
    }
  }

  function readAll(t) {
    const d = def(t);
    const { sh, headers } = sheetOf(t);
    const n = sh.getLastRow() - 1;
    if (n <= 0) return [];
    return sh.getRange(2, 1, n, headers.length).getValues().map((row) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = fromCell(typeOf(d, h), row[i]); });
      return o;
    });
  }

  function rowOf(t, rec) {
    const d = def(t);
    return headersOf(d).map((h) => toCell(typeOf(d, h), rec[h]));
  }

  let depth = 0;
  return {
    newId: (prefix) => `${prefix}${newUuid().replace(/-/g, '').slice(0, 12)}`,
    list: (t) => readAll(t),
    get: (t, id) => readAll(t).find((r) => r.id === id) || null,
    insert(t, rec) {
      const { sh } = sheetOf(t);
      sh.appendRow(rowOf(t, rec));
    },
    update(t, id, patch) {
      const { sh, headers } = sheetOf(t);
      const rows = readAll(t);
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw new Error(`ไม่พบรายการ ${id} ในตาราง ${t}`);
      sh.getRange(i + 2, 1, 1, headers.length).setValues([rowOf(t, { ...rows[i], ...patch })]);
    },
    /** LockService: รอสูงสุด 30 วินาที · ซ้อนกันในการทำงานเดียวกันได้ (ปล่อย lock ชั้นนอกสุดเท่านั้น) */
    withLock(fn) {
      if (depth > 0) { depth++; try { return fn(); } finally { depth--; } }
      lock.waitLock(30000);
      depth = 1;
      try { const r = fn(); flush(); return r; } finally { depth = 0; lock.releaseLock(); }
    },
    /** สร้างชีตที่ยังไม่มี + หัวคอลัมน์ + รูปแบบข้อความ · ชีตที่มีอยู่แล้วตรวจหัวคอลัมน์ */
    ensureSheets() {
      for (const t of Object.keys(tables).filter((x) => !tables[x].virtual)) {
        let sh = spreadsheet.getSheetByName(t);
        const headers = headersOf(def(t));
        if (!sh) {
          sh = spreadsheet.insertSheet(t);
          sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
          sh.appendRow(headers);
          sh.setFrozenRows(1);
        }
        sheetOf(t);
      }
    },
  };
}
