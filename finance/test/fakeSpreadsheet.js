// Google Sheets จำลองเฉพาะ API ที่ sheetsRepo ใช้ · ทุกค่าเก็บตามที่ใส่ (repo ส่งเป็นข้อความ)
export function createFakeSpreadsheet() {
  const sheets = new Map();
  function makeSheet(name) {
    const rows = []; // array of arrays
    const sheet = {
      getName: () => name,
      getLastRow: () => rows.length,
      getMaxRows: () => Math.max(1000, rows.length),
      getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
      appendRow: (vals) => { rows.push(vals.slice()); return sheet; },
      setFrozenRows: () => sheet,
      protect: () => ({ setDescription: () => ({}), removeEditors: () => ({}), getEditors: () => [], setWarningOnly: () => ({}), setDomainEdit: () => ({}) }),
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
        setValues: (vals) => {
          vals.forEach((rowVals, i) => {
            const row = rows[r - 1 + i] || (rows[r - 1 + i] = []);
            rowVals.forEach((v, j) => { row[c - 1 + j] = v; });
          });
        },
        setValue: (v) => { const row = rows[r - 1] || (rows[r - 1] = []); row[c - 1] = v; },
        setNumberFormat: () => ({}),
      }),
    };
    return sheet;
  }
  return {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
  };
}
