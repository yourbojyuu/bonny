// จุดเข้า Apps Script · ใช้ได้เฉพาะใน Google (SpreadsheetApp, Session, ...) ไม่มี test บน Node
// web app ตั้งให้ execute as owner + เข้าได้เฉพาะในโดเมน (appsscript.json)
// ผู้ใช้จึงแก้ชีตตรงไม่ได้ (ชีตถูก protect ให้เจ้าของคนเดียว) ต้องเขียนผ่านระบบเท่านั้น
/* global SpreadsheetApp, LockService, Utilities, Session, HtmlService, PropertiesService */
import { createApp } from '../app.js';
import { handle } from '../api.js';
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

function makeApp() {
  return createApp({ repo: makeRepo(openSpreadsheet()), clock: { now: () => new Date() } });
}

export function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('ระบบการเงิน · โรงเรียนกาวิละวิทยาลัย')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** หน้าเว็บเรียกผ่าน google.script.run.api(action, payload) · อีเมลมาจาก Google ไม่รับจากหน้าเว็บ */
export function api(action, payload) {
  const email = Session.getActiveUser().getEmail();
  return JSON.parse(JSON.stringify(handle(makeApp(), email, action, payload || {})));
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
