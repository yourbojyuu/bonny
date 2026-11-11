// อ่าน CSV/TSV (ส่งออกจาก Google Sheets/Excel): ตัดตัวคั่น , หรือ Tab ตามบรรทัดแรก · เครื่องหมายคำพูด · BOM · ข้ามบรรทัดว่าง
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const lines = src.split(/\r?\n/);
  const first = lines.find((l) => l.trim()) || '';
  const delim = first.split('\t').length > first.split(',').length ? '\t' : ',';
  const rows = [];
  let cur = [], field = '', q = false;
  const endField = () => { cur.push(field.trim()); field = ''; };
  const endRow = () => { endField(); if (cur.some((x) => x !== '')) rows.push(cur); cur = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) endField();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || cur.length) endRow();
  return rows;
}
export const toNumberOrNull = (s) => { const t = String(s ?? '').replace(/[,\s]/g, ''); return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
