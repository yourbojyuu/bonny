#!/usr/bin/env bash
# รันเทสต์ทั้งหมด: หลังบ้าน (ในหน่วยความจำ + ผ่าน makeSheetIO บนชีทจำลอง) · ตัวนำเข้า · หน้าเว็บในเบราว์เซอร์
set -e
cd "$(dirname "$0")"
echo "== หลังบ้าน =="; node test.js | tail -2
echo "== หลังบ้านผ่านชีทจำลอง (makeSheetIO) =="; SHEETIO=1 node test.js | tail -2
echo "== ตัวนำเข้า =="; node test_import.js | tail -1
echo "== หน้าเว็บ (ต้องมี playwright) =="; node test_ui.js | tail -3
