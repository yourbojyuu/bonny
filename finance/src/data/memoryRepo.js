// storage ในหน่วยความจำ สำหรับ test · ไม่มีคำสั่งลบ
export function createMemoryRepo() {
  const tables = new Map();
  const rows = (t) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t); };
  let n = 0;
  let locked = false;
  return {
    newId: (prefix) => `${prefix}${++n}`,
    list: (t) => rows(t).map((r) => structuredClone(r)),
    get: (t, id) => { const r = rows(t).find((x) => x.id === id); return r ? structuredClone(r) : null; },
    insert: (t, rec) => { rows(t).push(structuredClone(rec)); },
    update: (t, id, patch) => {
      const r = rows(t).find((x) => x.id === id);
      if (!r) throw new Error(`ไม่พบรายการ ${id} ในตาราง ${t}`);
      Object.assign(r, structuredClone(patch));
    },
    withLock: (fn) => {
      if (locked) throw new Error('lock busy: มีผู้ใช้อื่นกำลังออกเลข/บันทึก ลองใหม่อีกครั้ง');
      locked = true;
      try { return fn(); } finally { locked = false; }
    },
  };
}
