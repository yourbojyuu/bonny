# ระบบการเงิน · โค้ด Apps Script

## รัน test (ต้องผ่านทุกข้อก่อน push)

```bash
cd finance && npm install && npm test
```

## ลองหน้าเว็บบนเครื่อง (ข้อมูลสมมติ ไม่แตะ Google)

```bash
node scripts/dev-server.mjs
```

เปิด `http://localhost:8787` แล้วล็อกอินด้วยชื่อ `admin` `finance` `head` `reviewer1` `plan` `auditor` หรือชื่ออื่นใดก็ได้ (= ครูทั่วไป) · รหัสทดลอง `dev-pass` (เปลี่ยนได้ด้วยตัวแปร `DEV_PASSWORD`)

## ขึ้น Google Apps Script (ครั้งแรก)

1. `npm run build` → ได้ `dist/` (Code.js · index.html · appsscript.json)
2. ติดตั้ง clasp และ login ด้วยบัญชี `@kwc.ac.th` ที่จะเป็นเจ้าของระบบ: `npm i -g @google/clasp` แล้ว `clasp login`
3. `clasp create --type standalone --title "ระบบการเงิน" --rootDir dist` (หรือคัดลอก `.clasp.json.example` เป็น `.clasp.json` แล้วใส่ scriptId)
4. `clasp push`
5. ใน editor ของ Apps Script เลือกฟังก์ชัน `setupSheets` แล้วกด Run → อนุญาตสิทธิ์ → ได้ spreadsheet ใหม่ที่ทุกชีตถูก protect ให้แก้ได้เฉพาะเจ้าของ
6. Project Settings → Script Properties ใส่ `ADMIN_NAME` `ADMIN_EMAIL` `ADMIN_APPOINTMENT_REF` แล้วรัน `bootstrapFirstAdmin` (ทำได้ครั้งเดียว)
7. ตั้งรหัสผ่านกลาง: ใส่ Script Property `LOGIN_PASSWORD_NEW` = รหัสที่โรงเรียนกำหนด แล้วรัน `setLoginPassword` (ระบบเก็บเป็น hash และลบตัวรหัสออกให้) · เปลี่ยนรหัสภายหลังทำวิธีเดียวกัน
8. Deploy → New deployment → Web app · Execute as: **Me** · Who has access: **Anyone within kwc.ac.th**

แก้โค้ดครั้งต่อไป: `npm test && npm run build && clasp push` แล้ว Deploy → Manage deployments → แก้ version
