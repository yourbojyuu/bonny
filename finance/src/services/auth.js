// ล็อกอินด้วยอีเมลโรงเรียน + รหัสผ่านกลาง (ตามที่โรงเรียนกำหนด · ดู HANDOFF หัวข้อ 14)
// - รหัสไม่อยู่ในโค้ด: เก็บเป็น sha256(salt + รหัส) ใน Script Properties
// - session = token สุ่ม อายุ 6 ชั่วโมง · รหัสผิด 5 ครั้งใน 15 นาที → พักอีเมลนั้น 15 นาที
// - ทุกการล็อกอินลง login_log พร้อมบัญชี Google ที่เปิดอยู่ (ถ้ารู้) เพื่อตรวจย้อนหลังว่าใครเข้าแทนใคร
import { ValidationError, PermissionError } from '../core/errors.js';

export const SESSION_TTL_SEC = 6 * 3600;
const FAIL_LIMIT = 5;
const FAIL_WINDOW_SEC = 15 * 60;
const SYSTEM = { email: 'system:login' };

export function hashPassword(sha256, salt, password) {
  return sha256(`${salt}:${password}`);
}

/** ตรวจรหัสโดยเทียบ hash · ยังไม่ตั้งรหัส = ไม่มีใครเข้าได้ */
export function makePasswordVerifier({ salt, hash, sha256 }) {
  return (password) => {
    if (!salt || !hash || typeof password !== 'string' || !password) return false;
    const h = hashPassword(sha256, salt, password);
    let diff = h.length ^ hash.length;
    for (let i = 0; i < Math.min(h.length, hash.length); i++) diff |= h.charCodeAt(i) ^ hash.charCodeAt(i);
    return diff === 0;
  };
}

/** session ในหน่วยความจำ (test/dev) · บน Apps Script ใช้ CacheService แทน (interface เดียวกัน) */
export function createMemorySessions(clock) {
  const m = new Map();
  const now = () => clock.now().getTime();
  return {
    get(k) { const v = m.get(k); if (!v) return null; if (v.exp <= now()) { m.delete(k); return null; } return v.value; },
    put(k, value, ttlSec) { m.set(k, { value, exp: now() + ttlSec * 1000 }); },
    remove(k) { m.delete(k); },
  };
}

export function createAuth({ app, sessions, verifyPassword, clock, newToken }) {
  const settings = () => app.asSystemSettings();
  const normEmail = (raw) => {
    let e = String(raw || '').trim().toLowerCase();
    const domain = settings().allowed_email_domain;
    if (e && !e.includes('@')) e = `${e}@${domain}`;
    return e;
  };
  const log = (email, googleEmail, result) => app.store.insert(SYSTEM, 'login_log', {
    at: clock.now().toISOString(), email, google_email: String(googleEmail || '').toLowerCase(), result,
  });

  return {
    /** คืน { token, email } หรือโยน error */
    login({ email, password, googleEmail }) {
      const e = normEmail(email);
      const domain = settings().allowed_email_domain;
      if (!e.endsWith(`@${domain}`) || e.length <= domain.length + 1) {
        throw new ValidationError([{ field: 'email', message: `ใช้อีเมล @${domain} เท่านั้น` }]);
      }
      const failKey = `fail:${e}`;
      const fails = Number(sessions.get(failKey) || 0);
      if (fails >= FAIL_LIMIT) {
        log(e, googleEmail, 'ถูกพัก');
        throw new PermissionError('ใส่รหัสผิดหลายครั้ง พักการเข้าระบบ 15 นาที');
      }
      if (!verifyPassword(password)) {
        sessions.put(failKey, String(fails + 1), FAIL_WINDOW_SEC);
        log(e, googleEmail, 'รหัสผิด');
        throw new ValidationError([{ field: 'password', message: 'รหัสผ่านไม่ถูกต้อง' }]);
      }
      try {
        app.asUser(e); // ตรวจว่าเข้าได้จริง (ปิดใช้งาน / ระบบยังไม่ตั้ง)
      } catch (err) {
        log(e, googleEmail, `ปฏิเสธ: ${err.message}`);
        throw err;
      }
      sessions.remove(failKey);
      const token = newToken();
      sessions.put(`s:${token}`, e, SESSION_TTL_SEC);
      log(e, googleEmail, 'สำเร็จ');
      return { token, email: e };
    },
    /** token → อีเมล · ไม่พบ/หมดอายุ = null */
    emailOf(token) {
      return token ? sessions.get(`s:${token}`) : null;
    },
    logout(token) {
      if (token) sessions.remove(`s:${token}`);
    },
  };
}
