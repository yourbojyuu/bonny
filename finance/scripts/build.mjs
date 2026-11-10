// รวมโค้ดเป็นไฟล์เดียวสำหรับ Apps Script (ไม่รองรับ import) → dist/Code.js + index.html + appsscript.json
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const ENTRY_FUNCS = ['doGet', 'api', 'setupSheets', 'bootstrapFirstAdmin'];
mkdirSync('dist', { recursive: true });
const r = await build({
  entryPoints: ['src/gas/main.js'],
  bundle: true,
  format: 'iife',
  globalName: 'Finance',
  target: 'es2019',
  write: false,
  charset: 'utf8',
});
// Apps Script ต้องเห็นฟังก์ชันระดับบนสุดจึงจะเรียกได้ (google.script.run / เมนู Run)
const shims = ENTRY_FUNCS.map((f) => `function ${f}() { return Finance.${f}.apply(null, arguments); }`).join('\n');
writeFileSync('dist/Code.js', `${r.outputFiles[0].text}\n${shims}\n`);
copyFileSync('src/ui/index.html', 'dist/index.html');
copyFileSync('appsscript.json', 'dist/appsscript.json');
console.log('build → dist/ (Code.js', readFileSync('dist/Code.js').length, 'bytes)');
