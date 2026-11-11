// จุดเข้า Apps Script · ใช้ได้เฉพาะใน Google (SpreadsheetApp, Session, ...) ไม่มี test บน Node
// web app ตั้งให้ execute as owner + เข้าได้เฉพาะในโดเมน (appsscript.json) + ล็อกอินด้วยรหัสผ่านกลางอีกชั้น
// ผู้ใช้จึงแก้ชีตตรงไม่ได้ (ชีตถูก protect ให้เจ้าของคนเดียว) ต้องเขียนผ่านระบบเท่านั้น
/* global SpreadsheetApp, LockService, Utilities, Session, HtmlService, PropertiesService, CacheService, DriveApp */
import { createApp } from '../app.js';
import { handleRequest } from '../api.js';
import { createAuth, makePasswordVerifier, hashPassword } from '../services/auth.js';
import { TABLES } from '../core/schema.js';
import { createSheetsRepo } from '../data/sheetsRepo.js';

const props = () => PropertiesService.getScriptProperties();

function openSpreadsheet() {
  const id = props().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ยังไม่ได้ตั้งระบบ: รัน setupSheets ใน editor ก่อน');
  return SpreadsheetApp.openById(id);
}

function makeRepo(ss) {
  return createSheetsRepo({
    spreadsheet: ss,
    lock: LockService.getScriptLock(),
    tables: TABLES,
    newUuid: () => Utilities.getUuid(),
    flush: () => SpreadsheetApp.flush(),
  });
}

const CLOCK = { now: () => new Date() };

function makeApp() {
  return createApp({ repo: makeRepo(openSpreadsheet()), clock: CLOCK });
}

function sha256(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

// session เก็บใน CacheService (อายุสูงสุด 6 ชม. ตรงกับ SESSION_TTL_SEC)
const cacheSessions = () => {
  const c = CacheService.getScriptCache();
  return { get: (k) => c.get(k), put: (k, v, ttl) => c.put(k, String(v), ttl), remove: (k) => c.remove(k) };
};

function makeAuth(app) {
  return createAuth({
    app,
    sessions: cacheSessions(),
    clock: CLOCK,
    verifyPassword: makePasswordVerifier({
      salt: props().getProperty('LOGIN_PASSWORD_SALT'),
      hash: props().getProperty('LOGIN_PASSWORD_HASH'),
      sha256,
    }),
    newToken: () => Utilities.getUuid() + Utilities.getUuid(),
  });
}

// เก็บภาพหน้าลงนามใน Drive ของเจ้าของระบบ (โฟลเดอร์ใน Script Property SCAN_FOLDER_ID ถ้าไม่ตั้งจะเก็บที่รากของ Drive) · ยังไม่ได้ทดสอบบน Google จริง
function saveFile({ name, mime, data, by }) {
  const blob = Utilities.newBlob(Utilities.base64Decode(data), mime || 'application/octet-stream', `${Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss')}-${name}`);
  const folderId = props().getProperty('SCAN_FOLDER_ID');
  const file = (folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder()).createFile(blob);
  file.setDescription(`อัปโหลดโดย ${by}`);
  return file.getUrl();
}

export function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('ระบบการเงิน · โรงเรียนกาวิละวิทยาลัย')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * หน้าเว็บเรียกผ่าน google.script.run.api({ token, action, payload })
 * ตัวตนมาจาก token ที่ได้ตอนล็อกอิน · บัญชี Google ที่เปิดอยู่ (ถ้ารู้) ใช้บันทึกใน login_log เท่านั้น
 */
export function api(req) {
  const app = makeApp();
  let google = '';
  try { google = Session.getActiveUser().getEmail(); } catch (e) { google = ''; }
  return JSON.parse(JSON.stringify(handleRequest({ app, auth: makeAuth(app), saveFile }, req || {}, google)));
}

/**
 * ตั้ง/เปลี่ยนรหัสผ่านกลาง: ใส่ Script Property LOGIN_PASSWORD_NEW แล้วรันฟังก์ชันนี้จาก editor
 * ระบบเก็บเป็น hash + salt แล้วลบรหัสตัวจริงออกจาก Script Properties ทันที
 */
export function setLoginPassword() {
  const p = props();
  const pw = p.getProperty('LOGIN_PASSWORD_NEW');
  if (!pw) throw new Error('ใส่ Script Property LOGIN_PASSWORD_NEW ก่อน');
  const salt = Utilities.getUuid();
  p.setProperties({ LOGIN_PASSWORD_SALT: salt, LOGIN_PASSWORD_HASH: hashPassword(sha256, salt, pw) });
  p.deleteProperty('LOGIN_PASSWORD_NEW');
  return 'ตั้งรหัสผ่านแล้ว (เก็บเป็น hash)';
}

/**
 * รันครั้งแรกจาก editor โดยเจ้าของสคริปต์:
 * สร้าง spreadsheet (ถ้ายังไม่มี) → สร้างชีต/หัวคอลัมน์ → protect ทุกชีตให้แก้ได้เฉพาะเจ้าของ
 */
export function setupSheets() {
  let id = props().getProperty('SPREADSHEET_ID');
  if (!id) {
    id = SpreadsheetApp.create('ฐานข้อมูลระบบการเงิน (ห้ามแก้ตรง)').getId();
    props().setProperty('SPREADSHEET_ID', id);
  }
  const ss = SpreadsheetApp.openById(id);
  makeRepo(ss).ensureSheets();
  const me = Session.getEffectiveUser();
  for (const sh of ss.getSheets()) {
    if (!TABLES[sh.getName()]) continue;
    const p = sh.protect().setDescription('เขียนผ่านระบบการเงินเท่านั้น');
    p.addEditor(me);
    p.removeEditors(p.getEditors().filter((u) => u.getEmail() !== me.getEmail()));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  }
  return `ตั้งชีตเรียบร้อย: ${ss.getUrl()}`;
}

/**
 * ตั้งผู้ดูแลระบบคนแรก: ใส่ Script Properties ADMIN_NAME, ADMIN_EMAIL, ADMIN_APPOINTMENT_REF แล้วรันจาก editor
 * ทำได้ครั้งเดียว (มีผู้ใช้แล้วจะถูกปฏิเสธ)
 */
export function bootstrapFirstAdmin() {
  const p = props();
  const u = makeApp().bootstrap({
    name: p.getProperty('ADMIN_NAME'),
    email: p.getProperty('ADMIN_EMAIL'),
    appointment_ref: p.getProperty('ADMIN_APPOINTMENT_REF'),
  });
  return `ตั้งผู้ดูแลระบบ ${u.email} แล้ว`;
}
