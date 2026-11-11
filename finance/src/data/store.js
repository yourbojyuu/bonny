// ชั้นเขียนข้อมูล: ตรวจชนิดตาม schema · เติม created_by/created_at/updated_at · บันทึก audit_log ทุกครั้ง
// ไม่มีคำสั่งลบ (หลัก "ไม่ลบ แค่ยกเลิก")
import { collector } from '../core/errors.js';
import { checkRecord } from '../core/validate.js';
import { todayInBangkok } from '../core/thaidate.js';

export function createStore(repo, { clock, tables, getSettings }) {
  const nowIso = () => clock.now().toISOString();
  const def = (t) => { const d = tables[t]; if (!d) throw new Error(`ไม่รู้จักตาราง ${t}`); return d; };

  function audit(user, action, table, recordId, before, after, reason) {
    repo.insert('audit_log', {
      id: repo.newId('L'), at: nowIso(), user: user.email, action, table, record_id: recordId,
      before: before ? JSON.stringify(before) : '', after: after ? JSON.stringify(after) : '', reason: reason || '',
    });
  }

  function validated(d, rec) {
    const c = collector();
    const out = checkRecord(d, rec, getSettings(), c);
    c.throwIfAny();
    return out;
  }

  const store = {
    tables,
    list: (t) => { def(t); return repo.list(t); },
    get: (t, id) => { def(t); return repo.get(t, id); },
    find: (t, pred) => store.list(t).filter(pred),
    now: nowIso,
    today: () => todayInBangkok(clock.now()),
    withLock: (fn) => repo.withLock(fn),

    insert(user, t, rec, { reason } = {}) {
      const d = def(t);
      if (d.appendOnly && t === 'audit_log') throw new Error('audit_log เขียนโดยระบบเท่านั้น');
      const full = { ...rec };
      if (!full.id) full.id = repo.newId(d.idPrefix);
      const out = validated(d, full);
      if (repo.get(t, out.id)) throw new Error(`รหัส ${out.id} ซ้ำในตาราง ${t}`);
      const now = nowIso();
      const saved = { ...out, created_by: user.email, created_at: now, updated_at: now };
      repo.insert(t, saved);
      if (!d.noAudit) audit(user, 'insert', t, saved.id, null, saved, reason);
      return saved;
    },

    update(user, t, id, patch, { reason } = {}) {
      const d = def(t);
      if (d.appendOnly) throw new Error(`${t} เป็น append-only แก้ไม่ได้`);
      if (patch.id === '') { patch = { ...patch }; delete patch.id; }
      const before = repo.get(t, id);
      if (!before) throw new Error(`ไม่พบรายการ ${id} ในตาราง ${t}`);
      for (const k of ['id', 'created_by', 'created_at', 'updated_at']) {
        if (k in patch && patch[k] !== before[k]) throw new Error(`ช่อง ${k} แก้ไม่ได้`);
      }
      const { created_by, created_at, updated_at, ...plain } = before;
      const { created_by: _a, created_at: _b, updated_at: _c, ...p2 } = patch;
      const out = validated(d, { ...plain, ...p2, id });
      const after = { ...out, created_by, created_at, updated_at: nowIso() };
      repo.update(t, id, after);
      audit(user, 'update', t, id, before, after, reason);
      return after;
    },
  };
  return store;
}
