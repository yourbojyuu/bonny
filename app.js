/* ระบบการเงินโรงเรียน — app.js (แกนหลัก: เข้าสู่ระบบ เมนู ภาพรวม ตั้งค่า และเครื่องมือร่วม)
   JS แบบ ES5 · ค่า API_URL / CLIENT_ID อยู่บนสุดของ index.html */

var S = { led: null, token: '', me: null, schema: null, st: null, docs: null, tab: 'overview', date: '', bal: null, opt: {} };
var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
var MONTHS_L = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ================= เครื่องมือร่วม ================= */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function money(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function moneyCell(n) { return '<span class="money' + (Number(n) === 0 ? ' zero' : '') + '">' + money(n) + '</span>'; }
function thaiDate(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return iso || '';
  return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + String(Number(p[0]) + 543).slice(-2);
}
function thaiDateLong(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return iso || '';
  return Number(p[2]) + ' ' + MONTHS_L[Number(p[1]) - 1] + ' ' + (Number(p[0]) + 543);
}
function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function defaultDate() {
  var t = todayISO();
  if (!S.st) return t;
  return t < S.st.fyStart ? S.st.fyStart : t > S.st.fyEnd ? S.st.fyEnd : t;
}
function cleanNum(v) {
  var n = Number(String(v === null || v === undefined ? '' : v).replace(/,|บาท|\s/g, ''));
  return isFinite(n) ? n : 0;
}
function r2(n) { return Math.round(n * 100) / 100; }
function sumSat(arr, f) { var s = 0; for (var i = 0; i < arr.length; i++) s += Math.round(f(arr[i]) * 100); return s / 100; }
function typeById(id) {
  var t = (S.st && S.st.types) || [];
  for (var i = 0; i < t.length; i++) if (t[i][0] === id) return t[i];
  return null;
}
function typeName(id) { var t = typeById(id); return t ? t[1] : id; }
function typeGroup(id) { var t = typeById(id); return t ? t[2] : 'อื่น ๆ'; }
function storeName(id) {
  var s = (S.st && S.st.stores) || [];
  for (var i = 0; i < s.length; i++) if (s[i][0] === id) return s[i][1];
  return id || '—';
}
function role() { return S.me ? S.me.role : ''; }
var can = {
  khb: function () { return ['admin', 'การเงิน', 'พัสดุ'].indexOf(role()) >= 0; },
  ask: function () { return ['admin', 'การเงิน', 'พัสดุ', 'ครู'].indexOf(role()) >= 0; },
  fin: function () { return ['admin', 'การเงิน'].indexOf(role()) >= 0; },
  approve: function () { return ['admin', 'ผู้บริหาร'].indexOf(role()) >= 0; },
  admin: function () { return role() === 'admin'; }
};
/** สามโหมดตามบทบาท: ครู (ส่งคำขอ/ติดตาม) · การเงิน (ทำงานเต็ม) · ผู้บริหาร (อนุมัติ/ดูรายงาน) — admin สลับดูได้ */
var MODES = { teacher: 'โหมดครู', fin: 'โหมดการเงิน', exec: 'โหมดผู้บริหาร' };
var TEACHER_MODE = false; // โหมดครูพับเก็บไว้ก่อน (เริ่มใช้ภายในฝ่าย: การเงิน + ผู้บริหาร) เปลี่ยนเป็น true เมื่อพร้อมให้ครูใช้
function modeList() { return TEACHER_MODE ? ['fin', 'exec', 'teacher'] : ['fin', 'exec']; }
function mode() {
  var r = role();
  if (r === 'ครู') return 'teacher';
  if (r === 'ผู้บริหาร') return 'exec';
  if (r === 'admin' && S.modeAs && modeList().indexOf(S.modeAs) >= 0) return S.modeAs;
  return 'fin';
}
function homeTab() { return { teacher: 'request', exec: 'approve', fin: 'overview' }[mode()]; }
function myKhbs() { var me = S.me ? String(S.me.email).toLowerCase() : ''; return ((S.docs && S.docs.khbs) || []).filter(function (h) { return h.owner === me; }); }
function personName(email) { return (S.docs && S.docs.names && S.docs.names[email]) || String(email || '').split('@')[0] || '—'; }
var SI = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  income: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  expense: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  approve: '<path d="M9 12l2 2 4-4"/><path d="M12 3l2.4 1.8 3-.1.9 2.9 2.4 1.8-1 2.8 1 2.8-2.4 1.8-.9 2.9-3-.1L12 21l-2.4-1.8-3 .1-.9-2.9L3.3 14.6l1-2.8-1-2.8 2.4-1.8.9-2.9 3 .1z"/>',
  request: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  chev: '<path d="m6 17 5-5-5-5M13 17l5-5-5-5"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'
};
function si(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SI[n] + '</svg>'; }
var ICON = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
};

var toastTimer = null;
function toast(text, kind) {
  var m = $('toast');
  m.className = (kind || '') + ' on';
  m.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { m.className = kind || ''; }, kind === 'err' ? 7000 : 3200);
}

/* ================= เรียก API ================= */
function api(action, payload) {
  if (!/^(get|me$|ping|khbDoc|khjDoc)/.test(action)) S.led = null;
  if (!API_URL || API_URL.indexOf('ใส่') === 0) return Promise.reject(new Error('ยังไม่ได้ใส่ API_URL ใน index.html'));
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, idToken: S.token, payload: payload || {} })
  }).then(function (r) {
    if (!r.ok) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (HTTP ' + r.status + ')');
    return r.json();
  }).then(function (res) {
    if (!res.ok) { var e = new Error(res.error || 'เกิดข้อผิดพลาด'); e.code = res.code; throw e; }
    return res.data;
  });
}
function handleError(e) {
  if (e && e.code === 'AUTH') { signOut(e.message); return; }
  toast(e && e.message ? e.message : String(e), 'err');
}
/** ปุ่มกำลังทำงาน: ปิดปุ่มกันกดซ้ำ แล้วคืนสภาพ */
function busy(btn, p) {
  if (!btn) return p;
  var old = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'กำลังบันทึก…';
  return p.then(function (x) { btn.disabled = false; btn.innerHTML = old; return x; },
    function (e) { btn.disabled = false; btn.innerHTML = old; throw e; });
}

/* ================= เข้าสู่ระบบ ================= */
function initGsi() {
  if (!window.google || !google.accounts) return;
  if (!CLIENT_ID || CLIENT_ID.indexOf('ใส่') === 0) { $('loginMsg').textContent = 'ยังไม่ได้ใส่ CLIENT_ID ใน index.html'; return; }
  google.accounts.id.initialize({ client_id: CLIENT_ID, callback: function (resp) { startApp(resp.credential); } });
  google.accounts.id.renderButton($('gbtn'), { theme: 'filled_blue', size: 'large', locale: 'th', shape: 'pill' });
}
function signOut(message) {
  S.token = ''; S.me = null;
  try { sessionStorage.removeItem('tok'); } catch (e) {}
  $('app').hidden = true; $('login').hidden = false; document.body.classList.remove('authed');
  $('loginMsg').textContent = message || '';
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
}
function startApp(token) {
  S.token = token;
  $('loginMsg').textContent = 'กำลังตรวจสิทธิ์…';
  api('me').then(function (me) {
    if (me.role === 'ครู' && !TEACHER_MODE) throw new Error('ระบบเปิดให้ใช้ภายในฝ่ายการเงินและผู้บริหารก่อน — โหมดครูยังไม่เปิด');
    S.me = me;
    try { S.modeAs = me.role === 'admin' ? (localStorage.getItem('fin-mode') || '') : ''; } catch (e) { S.modeAs = ''; }
    return Promise.all([api('getSchema'), api('getSettings'), api('getDocs'), me.role === 'ครู' ? null : api('getReceipts')]);
  }).then(function (r) {
    S.schema = r[0]; S.st = r[1]; S.docs = r[2]; S.rcv = r[3] || { rows: [] };
    try { sessionStorage.setItem('tok', token); } catch (e) {}
    $('login').hidden = true; $('app').hidden = false; document.body.classList.add('authed');
    renderWho();
    $('fyLabel').textContent = 'ปีงบประมาณ ' + S.st.fy;
    S.date = defaultDate();
    renderTabs();
    go(homeTab(), null, true);
  }).catch(function (e) { signOut(e && e.message ? e.message : String(e)); });
}
/** โหลดเอกสารใหม่ (หลังบันทึก) */
function reloadDocs() {
  S.led = null;
  if (window.Flow) Flow.resetBal();
  return api('getDocs').then(function (d) { S.docs = d; renderTabs(); return d; });
}
function reloadReceipts() {
  S.led = null;
  return api('getReceipts').then(function (d) { S.rcv = d; return d; });
}
function reloadSettings() {
  return api('getSettings').then(function (d) { S.st = d; return d; });
}

/** ชื่อผู้ใช้ + ตัวสลับโหมด (admin สลับดูหน้าของครู/ผู้บริหารได้) */
function renderWho() {
  var w = $('who');
  w.textContent = S.me.name + ' · ' + MODES[mode()];
  var old = $('modeSw'); if (old) old.parentNode.removeChild(old);
  var ml = modeList();
  $('topdock').classList.remove('hasSw');
  if (!can.admin() || ml.length !== 2) return;
  $('topdock').classList.add('hasSw');
  var on = mode() === ml[1], sw = document.createElement('div'); sw.id = 'modeSw'; sw.className = 'modesw2';
  sw.innerHTML = '<span class="ml' + (on ? '' : ' on') + '" data-m="' + ml[0] + '">' + esc(MODES[ml[0]].replace('โหมด', '')) + '</span>' +
    '<button type="button" class="tgl" role="switch" aria-checked="' + on + '" aria-label="สลับโหมด ' + esc(MODES[ml[0]].replace('โหมด', '')) + ' / ' + esc(MODES[ml[1]].replace('โหมด', '')) + '"><i></i></button>' +
    '<span class="ml' + (on ? ' on' : '') + '" data-m="' + ml[1] + '">' + esc(MODES[ml[1]].replace('โหมด', '')) + '</span>';
  $('topdock').appendChild(sw);
  sw.onclick = function (e) {
    var l = e.target.closest('[data-m]'), t = e.target.closest('.tgl');
    var m = l ? l.getAttribute('data-m') : t ? (on ? ml[0] : ml[1]) : null; if (!m || m === mode()) return;
    S.modeAs = m === 'fin' ? '' : m;
    try { localStorage.setItem('fin-mode', S.modeAs); } catch (er) {}
    sw.querySelector('.tgl').setAttribute('aria-checked', String(m === ml[1]));
    Array.prototype.forEach.call(sw.querySelectorAll('.ml'), function (x) { x.classList.toggle('on', x.getAttribute('data-m') === m); });
    setTimeout(function () { renderWho(); renderTabs(); go(homeTab(), null); }, 260); // ให้เห็นปุ่มสไลด์ก่อนเปลี่ยนหน้า
  };
}

/* ================= เมนูและการเปลี่ยนหน้า ================= */
var TAB_SETS = {
  fin: [{ id: 'overview', label: 'ภาพรวม' }, { id: 'income', label: 'รายรับ' }, { id: 'expense', label: 'รายจ่าย' }, { id: 'settings', label: 'ตั้งค่า', admin: true }],
  teacher: [{ id: 'request', label: 'คำขอเบิกของฉัน' }],
  exec: [{ id: 'approve', label: 'อนุมัติ' }, { id: 'overview', label: 'ภาพรวม' }, { id: 'expense', label: 'รายจ่าย' }, { id: 'income', label: 'รายรับ' }]
};
var TABS = TAB_SETS.fin;
function tabsNow() { TABS = TAB_SETS[mode()]; return TABS; }
function tabOk(id) { return tabsNow().some(function (t) { return t.id === id && (!t.admin || can.admin()); }); }
/** ตัวเลขบนเมนู = งานที่รอเราทำ */
function pendingCount(tab) {
  var n = 0, ks = (S.docs && S.docs.khbs) || [];
  if (tab === 'approve') ks.forEach(function (h) { if (h.status !== 'ยกเลิก' && h.flow === 'รออนุมัติ') n++; });
  else if (tab === 'request') myKhbs().forEach(function (h) { if (h.status !== 'ยกเลิก' && h.flow === 'ส่งกลับแก้ไข') n++; });
  else if (tab === 'expense' && mode() === 'fin') ks.forEach(function (h) {
    if (h.status === 'ยกเลิก') return;
    if (h.flow === 'อนุมัติแล้ว') n++;
    else if (h.flow === 'รับเรื่องแล้ว') n += h.counts['รอจ่าย'] || 0;
  });
  return n;
}
function renderTabs() {
  tabsNow();
  var h = '<span class="pill" aria-hidden="true"></span>';
  TABS.forEach(function (t) {
    if (t.admin && !can.admin()) return;
    var n = pendingCount(t.id);
    h += '<button class="tab" role="tab" type="button" data-tab="' + t.id + '" aria-selected="' + (S.tab === t.id) + '">' + esc(t.label) +
      (n ? '<span class="n" title="รายการที่ยังไม่จ่าย">' + n + '</span>' : '') + '</button>';
  });
  $('tabs').innerHTML = h;
  movePill();
  renderSide();
}
var SIDE_ICON = { overview: 'home', income: 'income', expense: 'expense', settings: 'settings', request: 'request', approve: 'approve' };
function sideOpen() { try { return localStorage.getItem('fin-side') !== '0'; } catch (e) { return true; } }
/** แถบนำทางกระจกเหลว: อยู่บนสุดของหน้า (ข้างตัวสลับโหมด) และค้างอยู่เมื่อเลื่อน */
var NAV = null;
function placeNav() { var d = $('topdock'); if (NAV && d && NAV.parentNode !== d) d.insertBefore(NAV, d.firstChild); }
function renderSide() {
  var old = $('side'); if (old) old.parentNode.removeChild(old);
  var bn = NAV;
  if (!bn) { bn = NAV = document.createElement('nav'); bn.id = 'bnav'; bn.className = 'bnav'; bn.setAttribute('aria-label', 'เมนูหลัก'); $('topdock').appendChild(bn);
    new MutationObserver(function () { placeNav(); moveDock(); }).observe($('view'), { childList: true }); }
  var md = mode(), canAdd = md === 'teacher' ? can.ask() : md === 'fin' && (can.khb() || can.fin());
  tabsNow();
  bn.classList.toggle('one', TABS.length === 1);
  bn.innerHTML = '<span class="bpill" aria-hidden="true"></span>' + TABS.map(function (t) {
    if (t.admin && !can.admin()) return '';
    var n = pendingCount(t.id);
    return '<button type="button" class="bn" data-bn="' + t.id + '" data-tab="' + t.id + '" aria-current="' + (S.tab === t.id ? 'page' : 'false') + '">' + si(SIDE_ICON[t.id]) + '<span>' + esc(t.label) + '</span>' + (n ? '<em>' + n + '</em>' : '') + '</button>';
  }).join('') + (canAdd ? '<span class="bsep"></span><button type="button" class="bn add" id="bAdd" aria-haspopup="menu" aria-expanded="false" aria-label="เพิ่มรายการใหม่">' + si('plus') + '<span>เพิ่ม</span></button>' : '');
  Array.prototype.forEach.call(bn.querySelectorAll('[data-bn]'), function (b) { b.onclick = function () { closeAdd(); go(b.getAttribute('data-bn'), null); }; });
  if (canAdd) $('bAdd').onclick = function (e) { e.stopPropagation(); toggleAdd(); };
  document.body.classList.add('has-dock');
  placeNav();
  requestAnimationFrame(moveDock);
}
function closeAdd() { var m = $('addMenu'); if (m) m.classList.remove('on'); var b = $('bAdd'); if (b) b.setAttribute('aria-expanded', 'false'); }
function toggleAdd() {
  var m = $('addMenu');
  if (mode() === 'teacher') { closeAdd(); go('request', { draft: 1 }); return; }
  if (!m) {
    m = document.createElement('div'); m.id = 'addMenu'; m.className = 'addmenu'; m.setAttribute('role', 'menu');
    m.innerHTML = (can.khb() ? '<button type="button" role="menuitem" data-a="khb"><i>' + si('expense') + '</i><span><b>ขบ. ใหม่</b><small>ขอเบิกเงิน · วางจาก Excel ได้</small></span></button>' : '') +
      (can.fin() ? '<button type="button" role="menuitem" data-a="rcv"><i>' + si('income') + '</i><span><b>บันทึกใบเสร็จ</b><small>รายรับ · ต่อเนื่องเลขที่ +1</small></span></button>' : '') +
      (can.fin() ? '<button type="button" role="menuitem" data-a="khj"><i>' + si('settings') + '</i><span><b>รับเรื่อง / ทำ ขจ.</b><small>ขบ. ที่ผู้บริหารอนุมัติแล้ว</small></span></button>' : '');
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return; closeAdd(); var k = b.getAttribute('data-a');
      if (k === 'khb') go('expense', { seg: 'khb', draft: 1 }); else if (k === 'rcv') go('income', { seg: 'enter' }); else go('expense', { seg: 'khj' });
    });
    document.addEventListener('pointerdown', function (e) { if (!e.target.closest('#addMenu') && !e.target.closest('#bAdd')) closeAdd(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAdd(); });
    window.addEventListener('scroll', closeAdd, { passive: true });
  }
  var on = !m.classList.contains('on');
  if (on) { var r = $('bAdd').getBoundingClientRect(), w = Math.min(330, window.innerWidth - 28); m.style.top = (r.bottom + 10) + 'px'; m.style.left = Math.max(14, Math.min(window.innerWidth - w - 14, r.right - w)) + 'px'; }
  m.classList.toggle('on', on); $('bAdd').setAttribute('aria-expanded', String(on));
}
/** แถบสีเลื่อนไปอยู่หลังแท็บที่เลือก */
function moveDock() {
  var bn = $('bnav'); if (!bn) return;
  var a = bn.querySelector('.bn[aria-current="page"]'), p = bn.querySelector('.bpill');
  if (!a || !p) return;
  p.style.width = a.offsetWidth + 'px'; p.style.transform = 'translateX(' + a.offsetLeft + 'px)';
}
function movePill() {
  var nav = $('tabs'), a = nav.querySelector('.tab[aria-selected="true"]'), pill = nav.querySelector('.pill');
  if (!a || !pill) return;
  pill.style.width = a.offsetWidth + 'px';
  pill.style.transform = 'translateX(' + (a.offsetLeft - 5) + 'px)';
  pill.style.left = '5px';
}
/** เปลี่ยนหน้าแบบลื่น (View Transition ถ้ารองรับ) */
function go(tab, opt, instant) {
  var vt = !instant && !!document.startViewTransition && !REDUCE;
  if (vt) { // ทิศทาง: ไปแท็บถัดไป = ซูมเข้าหาเรา · ย้อนกลับ = ซูมออก
    var ids = tabsNow().map(function (t) { return t.id; });
    document.documentElement.setAttribute('data-vt', ids.indexOf(tab) >= ids.indexOf(S.tab) ? 'fwd' : 'back');
  }
  var run = function () {
    if (vt) jumpTop(); // หน้าใหม่เริ่มบนสุดทันที ให้ hero/แถบเมนูจับคู่ย่อขยายจากตำแหน่งเดิมไปตำแหน่งใหม่
    if (window.GFUnmount) Array.prototype.forEach.call(document.querySelectorAll('.gfhost'), GFUnmount);
    if (window.Docs) Docs.leave();
    if (window.Receipts) Receipts.leave();
    S.tab = tab; S.opt = opt || {};
    document.body.setAttribute('data-tab', tab);
    Array.prototype.forEach.call($('tabs').querySelectorAll('.tab'), function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab));
    });
    movePill();
    if (window.Bento) Bento.unmount();
    Array.prototype.forEach.call(document.querySelectorAll('#side [data-sg]'), function (b) { b.setAttribute('aria-current', b.getAttribute('data-sg') === tab ? 'page' : 'false'); });
    Array.prototype.forEach.call(document.querySelectorAll('#bnav [data-bn]'), function (b) { b.setAttribute('aria-current', b.getAttribute('data-bn') === tab ? 'page' : 'false'); });
    moveDock();
    var v = $('view');
    v.className = '';
    if (tab === 'overview') renderOverview();
    else if (tab === 'income') Receipts.render(v, S.opt);
    else if (tab === 'expense') Docs.render(v, S.opt);
    else if (tab === 'request') Flow.teacher(v, S.opt);
    else if (tab === 'approve') Flow.exec(v, S.opt);
    else renderSettings();
    if (!document.startViewTransition || REDUCE) { void v.offsetWidth; v.className = 'view-in'; }
    observeReveal(); watchHero();
  };
  if (vt) {
    try {
      document.startViewTransition(run);
    } catch (e) { run(); }
  } else run();
  if (!instant && !vt) window.scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' });
}
/** หยุดภาพเคลื่อนไหวของ hero เมื่อพ้นจอ (ประหยัดเครื่อง) */
var heroIO = null;
function watchHero() {
  if (!window.IntersectionObserver) return;
  if (!heroIO) heroIO = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle('off', !e.isIntersecting); }); });
  heroIO.disconnect();
  var h = document.querySelector('#view > .hero'); if (h) heroIO.observe(h);
}
function jumpTop() {
  var h = document.documentElement, old = h.style.scrollBehavior;
  h.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); h.style.scrollBehavior = old;
}

/* ================= พื้นหลังเรขาคณิต + การเลื่อน ================= */
function buildBg() {
  var defs = '<svg width="0" height="0" style="position:absolute"><defs>' +
    '<linearGradient id="bgGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>' +
    '<linearGradient id="bgRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".5" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity=".8"/></linearGradient>' +
    '</defs></svg>';
  function L(id, body) { return '<svg data-for="' + id + '" viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice">' + body + '</svg>'; }
  // วางรูปทรงชิดขอบซ้าย-ขวา ปล่อยกลางจอโล่งให้เนื้อหา
  var overview = L('overview',
    '<g class="f1"><circle class="t" cx="1340" cy="520" r="260"/><circle class="l" cx="1340" cy="520" r="200"/><circle class="l" cx="1340" cy="520" r="140" stroke-dasharray="3 10"/></g>' +
    '<g class="f2"><rect class="g" x="1180" y="760" width="190" height="190" rx="52" transform="rotate(16 1275 855)"/><circle class="g" cx="80" cy="640" r="96"/></g>' +
    '<g class="f1"><circle class="t2" cx="60" cy="900" r="120"/><path class="l" d="M-20 470 C 120 430 180 540 300 500"/></g>');
  var expense = L('expense',
    '<g class="f2"><path class="t" d="M1210 380 L1440 380 L1440 1000 L1010 1000 Z"/><path class="g" d="M1290 420 L1370 420 L1210 980 L1130 980 Z"/></g>' +
    '<g class="f1"><circle class="g" cx="1350" cy="300" r="70"/><circle class="t2" cx="1270" cy="880" r="54"/><path class="l" d="M1000 560 C 1120 600 1180 520 1300 580 S 1420 700 1460 660"/></g>' +
    '<g class="f2"><rect class="g" x="-40" y="600" width="170" height="230" rx="30" transform="rotate(-10 45 715)"/><rect class="t" x="10" y="640" width="170" height="230" rx="30" transform="rotate(6 95 755)"/></g>');
  var income = L('income',
    '<g class="f2"><rect class="g" x="1180" y="620" width="70" height="260" rx="26"/><rect class="g" x="1270" y="540" width="70" height="340" rx="26"/><rect class="t" x="1360" y="450" width="70" height="430" rx="26"/></g>' +
    '<g class="f1"><circle class="g" cx="70" cy="700" r="92"/><circle class="t2" cx="150" cy="880" r="56"/><path class="l" d="M1010 760 C 1110 700 1180 660 1300 560 S 1400 470 1450 440"/></g>' +
    '<g class="f2"><circle class="l" cx="1250" cy="330" r="120" stroke-dasharray="3 10"/><circle class="t2" cx="1360" cy="250" r="48"/></g>');
  var settings = L('settings',
    '<g class="f1"><circle class="l" cx="1320" cy="640" r="180" stroke-dasharray="2 12"/><circle class="g" cx="1320" cy="640" r="74"/></g>' +
    '<g class="f2"><rect class="t" x="1190" y="320" width="160" height="160" rx="40"/><rect class="g" x="40" y="720" width="150" height="150" rx="40" transform="rotate(12 115 795)"/></g>');
  $('bg').innerHTML = '<div class="aur"><i></i><i></i><i></i></div><div class="liq"><i></i><i></i><i></i><i></i><i></i></div><div class="dots"></div>' + defs + overview + income + expense + settings;
}
var revealIO = null;
function observeReveal() {
  var els = document.querySelectorAll('.reveal:not(.in)');
  if (REDUCE || !('IntersectionObserver' in window)) { Array.prototype.forEach.call(els, function (e) { e.classList.add('in'); }); return; }
  if (!revealIO) {
    revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); revealIO.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  }
  Array.prototype.forEach.call(els, function (e) { revealIO.observe(e); });
}
(function () {
  var hr = 0, hel = null, hx = 0, hy = 0;
  document.addEventListener('pointermove', function (e) {
    if (REDUCE || e.pointerType === 'touch') return;
    var h = e.target.closest ? e.target.closest('.hero') : null;
    if (!h) { if (hel) { hel.style.setProperty('--mx', 0); hel.style.setProperty('--my', 0); hel = null; } return; }
    var r = h.getBoundingClientRect(); hel = h; hx = ((e.clientX - r.left) / r.width) * 2 - 1; hy = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (!hr) hr = requestAnimationFrame(function () { hr = 0; if (hel) { hel.style.setProperty('--mx', hx.toFixed(3)); hel.style.setProperty('--my', hy.toFixed(3)); } });
  }, { passive: true });
})();
(function () {
  var raf = 0, cur = 0;
  /** ค่าเลื่อนที่ไหลตามอย่างนุ่ม ๆ (ใช้กับพื้นหลัง/hero) ไม่กระตุกตามล้อเมาส์ */
  function tick() {
    raf = 0;
    var h = document.documentElement, max = h.scrollHeight - h.clientHeight, y = window.scrollY || 0;
    $('prog').style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
    if (REDUCE) return;
    cur += (y - cur) * 0.085;
    if (Math.abs(y - cur) < 0.15) cur = y; else raf = requestAnimationFrame(tick);
    document.body.style.setProperty('--sy', cur.toFixed(2));
  }
  window.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(tick); }, { passive: true });
  window.addEventListener('resize', function () { movePill(); moveDock(); });
  var scT = 0; window.addEventListener('scroll', function () { if (scT) return; scT = requestAnimationFrame(function () { scT = 0; document.body.classList.toggle('scrolled', window.scrollY > 12); }); }, { passive: true });
})();

/* ================= โมดัล ================= */
var modalStack = [];
function openModal(o) {
  var m = document.createElement('div');
  m.className = 'modal';
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
  m.innerHTML = '<div class="sheet" style="' + (o.width ? 'width:min(' + o.width + 'px,100%)' : '') + '">' +
    '<header><h3>' + o.title + '</h3>' + (o.headExtra || '') + '<button class="x" type="button" data-close aria-label="ปิด">×</button></header>' +
    '<div class="body">' + (o.body || '') + '</div>' + (o.footer ? '<footer>' + o.footer + '</footer>' : '') + '</div>';
  document.body.appendChild(m);
  var prevFocus = document.activeElement;
  var api_ = {
    el: m,
    close: function () {
      m.classList.remove('on');
      modalStack.splice(modalStack.indexOf(api_), 1);
      setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, REDUCE ? 0 : 320);
      if (!modalStack.length) document.body.style.overflow = '';
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      if (o.onClose) o.onClose();
    }
  };
  modalStack.push(api_);
  document.body.style.overflow = 'hidden';
  m.addEventListener('click', function (e) { if (e.target === m || (e.target.closest && e.target.closest('[data-close]'))) api_.close(); });
  requestAnimationFrame(function () { m.classList.add('on'); var f = m.querySelector('[autofocus],input,select,button.btn'); if (f) f.focus(); });
  return api_;
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
});
/** ตัวอย่างไฟล์ Excel ก่อนดาวน์โหลด (หน้าตาและฟอนต์เดียวกับไฟล์: TH SarabunPSK) */
function previewSheet(title, cols, rows, sub, file) {
  var MAXR = 300, tot = cols.map(function (c, i) { return c.sum ? rows.reduce(function (s, r) { return s + (Number(r[i]) || 0); }, 0) : null; });
  var h = '<table><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    rows.slice(0, MAXR).map(function (r) { return '<tr>' + r.map(function (v, i) { var c = cols[i]; return '<td class="' + (c.type === 'money' ? 'r' : c.type === 'center' ? 'c' : 'l') + '">' + (c.type === 'money' ? (Number(v) ? Grid.fmtN(Number(v)) : '') : esc(v)) + '</td>'; }).join('') + '</tr>'; }).join('') +
    '<tr class="tot">' + cols.map(function (c, i) { return i === 0 ? '<td>รวม ' + rows.length + ' รายการ</td>' : '<td class="r">' + (tot[i] !== null ? Grid.fmtN(tot[i]) : '') + '</td>'; }).join('') + '</tr></tbody></table>';
  var m = openModal({
    title: 'ตัวอย่างไฟล์ Excel', width: 1240,
    body: '<div class="paperwrap"><div class="paper land"><h1>' + esc(title) + '</h1><p class="xsub">' + esc(sub || '') + '</p>' + h + '</div></div>' +
      (rows.length > MAXR ? '<p class="xpnote">ตัวอย่างแสดง ' + MAXR + ' แถวแรก จากทั้งหมด ' + rows.length + ' แถว — ไฟล์ที่ดาวน์โหลดมีครบทุกแถว</p>' : '') +
      '<p class="xpnote">ไฟล์จริงใช้ฟอนต์ TH SarabunPSK ตามแบบราชการ (ตัวอย่างนี้แสดงด้วยฟอนต์ใกล้เคียงถ้าเครื่องยังไม่มี TH SarabunPSK)</p>',
    footer: '<button class="btn ghost" type="button" data-close>ปิด</button><button class="btn" type="button" id="xpGo">ดาวน์โหลด Excel</button>'
  });
  m.el.querySelector('#xpGo').onclick = function () {
    if (!window.XlsxExport || !window.ExcelJS) { toast('ดาวน์โหลดใช้ได้ในเว็บจริง (หน้าตัวอย่างนี้ปิดการดาวน์โหลด)', 'err'); return; }
    busy(this, XlsxExport.sheet(title, cols, rows, sub, file)).then(function (n) { toast('ดาวน์โหลด ' + n + ' แล้ว', 'good'); m.close(); }).catch(handleError);
  };
}
/** ถามเหตุผล (ใช้แทน prompt) */
function askReason(title, okText, cb) {
  var m = openModal({
    title: esc(title), width: 520,
    body: '<label class="f">เหตุผล (บันทึกไว้ในเอกสาร)<textarea id="askR" rows="3" autofocus></textarea></label>',
    footer: '<span class="sp"></span><button class="btn ghost" data-close type="button">ไม่ใช่ตอนนี้</button><button class="btn danger" id="askOk" type="button">' + esc(okText) + '</button>'
  });
  m.el.querySelector('#askOk').onclick = function () {
    var v = m.el.querySelector('#askR').value.trim();
    if (!v) { toast('กรุณาระบุเหตุผล', 'err'); return; }
    cb(v, m, this);
  };
}
/** แสดงวันที่ไทยข้างช่องเลือกวันที่ */
function thaiDateHint(inp) {
  var s = inp.nextElementSibling;
  if (!s || !s.classList.contains('th-date')) { s = document.createElement('span'); s.className = 'th-date'; inp.parentNode.insertBefore(s, inp.nextSibling); }
  s.textContent = inp.value ? thaiDateLong(inp.value) : '';
}
document.addEventListener('change', function (e) { if (e.target && e.target.type === 'date' && !e.target.closest('.hero')) thaiDateHint(e.target); }, true);

/** ตัวเลขนับขึ้น */
function countUp(el, to) {
  var from = Number(el.getAttribute('data-v') || 0);
  el.setAttribute('data-v', String(to));
  if (REDUCE || from === to) { el.textContent = money(to); return; }
  var t0 = null;
  function step(ts) {
    if (t0 === null) t0 = ts;
    var p = Math.min(1, (ts - t0) / 700), e = 1 - Math.pow(1 - p, 3);
    el.textContent = money(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step); else el.textContent = money(to);
  }
  requestAnimationFrame(step);
}

/* ================= ภาพรวม ================= */
/** รูปทรงเรขาคณิตกระจกใส: c วงกลม · ring/dash วงแหวน · thick วงหนา · arc เส้นโค้ง · sq สี่เหลี่ยมมน · tri สามเหลี่ยม · semi ครึ่งวง · quart เสี้ยววง · hex หกเหลี่ยม · pill แคปซูล · dia เพชร */
function gshape(t, x, y, r, rot, fill, cls, delay) {
  var p;
  if (t === 'c') p = '<circle r="' + r + '" fill="' + fill + '"/>';
  else if (t === 'ring') p = '<circle r="' + r + '" fill="none" class="ln"/>';
  else if (t === 'dash') p = '<circle r="' + r + '" fill="none" class="ln dash"/>';
  else if (t === 'thick') p = '<circle r="' + r + '" fill="none" style="stroke:' + fill + ';stroke-width:' + (r * 0.26).toFixed(1) + 'px"/>';
  else if (t === 'arc') p = '<path d="M' + (-r) + ' 0 A' + r + ' ' + r + ' 0 1 1 0 ' + r + '" fill="none" class="ln arc"/>';
  else if (t === 'sq') p = '<rect x="' + (-r) + '" y="' + (-r) + '" width="' + (2 * r) + '" height="' + (2 * r) + '" rx="' + (r * 0.34) + '" fill="' + fill + '"/>';
  else if (t === 'doc') p = '<rect x="' + (-r * 0.78) + '" y="' + (-r) + '" width="' + (r * 1.56) + '" height="' + (2 * r) + '" rx="' + (r * 0.2) + '" fill="' + fill + '"/>';
  else if (t === 'tri') p = '<path d="M0 ' + (-r) + ' L' + (r * 0.95) + ' ' + (r * 0.7) + ' L' + (-r * 0.95) + ' ' + (r * 0.7) + 'Z" fill="' + fill + '" stroke-linejoin="round" style="stroke-width:' + (r * 0.16) + 'px"/>';
  else if (t === 'semi') p = '<path d="M' + (-r) + ' 0 A' + r + ' ' + r + ' 0 0 1 ' + r + ' 0Z" fill="' + fill + '"/>';
  else if (t === 'quart') p = '<path d="M' + (-r) + ' ' + r + ' L' + (-r) + ' ' + (-r) + ' A' + (2 * r) + ' ' + (2 * r) + ' 0 0 1 ' + r + ' ' + r + 'Z" fill="' + fill + '"/>';
  else if (t === 'hex') { var q = '', k; for (k = 0; k < 6; k++) q += (k ? ' ' : '') + (r * Math.cos(Math.PI / 3 * k)).toFixed(1) + ',' + (r * Math.sin(Math.PI / 3 * k)).toFixed(1); p = '<polygon points="' + q + '" fill="' + fill + '" stroke-linejoin="round" style="stroke-width:' + (r * 0.08) + 'px"/>'; }
  else if (t === 'pill') p = '<rect x="' + (-r * 0.42) + '" y="' + (-r) + '" width="' + (r * 0.84) + '" height="' + (2 * r) + '" rx="' + (r * 0.42) + '" fill="' + fill + '"/>';
  else if (t === 'dia') p = '<rect x="' + (-r * 0.7) + '" y="' + (-r * 0.7) + '" width="' + (r * 1.4) + '" height="' + (r * 1.4) + '" rx="' + (r * 0.22) + '" transform="rotate(45)" fill="' + fill + '"/>';
  else p = '<circle r="' + r + '" fill="' + fill + '"/>';
  return '<g transform="translate(' + x + ' ' + y + ') rotate(' + (rot || 0) + ')"><g class="gs ' + (cls || '') + '"' + (delay ? ' style="animation-delay:' + delay + 's"' : '') + '>' + p + '</g></g>';
}
/** ก้อนของเหลวแก้วใส: เส้นขอบเปลี่ยนรูปช้า ๆ วนไปมา (วงกลม → สี่เหลี่ยมมน → ใบไม้ → เพชรมน) ใช้ SMIL ให้ morph ทุกเบราว์เซอร์ */
var BLOB_SHAPES = [[.552, .552, .552, .552, 0, 0], [.9, .9, .9, .9, 0, 0], [.7, .4, .8, .5, .12, -.1], [.22, .3, .25, .3, 0, 0], [.5, .8, .4, .7, -.1, .1]];
function blobPath(sh, r) {
  var a = sh[0], b = sh[1], c = sh[2], d = sh[3], dx = sh[4], dy = sh[5];
  function n(v) { return (v * r).toFixed(1); }
  return 'M' + n(dx) + ' ' + n(-1 + dy) + ' C' + n(a) + ' ' + n(-1 + dy) + ' ' + n(1 + dx) + ' ' + n(-a) + ' ' + n(1 + dx) + ' ' + n(0) +
    ' C' + n(1 + dx) + ' ' + n(b) + ' ' + n(b) + ' ' + n(1 - dy) + ' ' + n(dx) + ' ' + n(1 - dy) +
    ' C' + n(-c) + ' ' + n(1 - dy) + ' ' + n(-1 + dx) + ' ' + n(c) + ' ' + n(-1 + dx) + ' ' + n(0) +
    ' C' + n(-1 + dx) + ' ' + n(-d) + ' ' + n(-d) + ' ' + n(-1 + dy) + ' ' + n(dx) + ' ' + n(-1 + dy) + 'Z';
}
function gblob(x, y, r, fill, cls, dur, offset) {
  var order = [], k, n = BLOB_SHAPES.length;
  for (k = 0; k < n; k++) order.push(BLOB_SHAPES[(k + (offset || 0)) % n]);
  order.push(order[0]);
  var vals = order.map(function (sh) { return blobPath(sh, r); }), kt = order.map(function (_, i) { return (i / (order.length - 1)).toFixed(3); }).join(';');
  var spl = order.slice(1).map(function () { return '.45 .05 .55 .95'; }).join(';');
  return '<g transform="translate(' + x + ' ' + y + ')"><g class="gs ' + (cls || '') + ' lqd"><path d="' + vals[0] + '" fill="' + fill + '">' +
    (REDUCE ? '' : '<animate attributeName="d" dur="' + dur + 's" repeatCount="indefinite" calcMode="spline" keyTimes="' + kt + '" keySplines="' + spl + '" values="' + vals.join(';') + '"/>') + '</path></g></g>';
}
/** ตารางจุดบาง ๆ เป็นพื้นผิว (ไม่ขยับ) */
function gdots(kind, x, y, w, h) { return '<rect class="gdots" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="url(#hd-' + kind + ')"/>'; }
/** ฉากตกแต่ง hero: แก้วใสที่มีของเหลวไหลช้า ๆ ภายใน + เรขาคณิตแบบจัดองค์ประกอบ
    ทุกแท็บใช้สูตรเดียวกัน (รูปหลักใหญ่ 1 · รูปสีเน้นซ้อน 1 · เส้นวง 1 · รูปเล็ก 2 · ตารางจุด) แต่รูปทรงและเรื่องต่างกัน ไม่รก ไม่โล่งเกิน */
function heroDeco(kind) {
  var G = '<defs><linearGradient id="hg-' + kind + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity=".07"/></linearGradient>' +
    '<linearGradient id="ha-' + kind + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--h3)" stop-opacity=".9"/><stop offset="1" style="stop-color:var(--h2)" stop-opacity=".4"/></linearGradient>' +
    '<linearGradient id="hb-' + kind + '" x1="1" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--h4)" stop-opacity=".65"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>' +
    '<pattern id="hd-' + kind + '" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="#fff"/></pattern></defs>';
  var f = 'url(#hg-' + kind + ')', a = 'url(#ha-' + kind + ')', b = 'url(#hb-' + kind + ')', S = gshape, s = '';
  if (kind === 'income') {            // เงินเข้า: แท่งไล่ระดับขึ้น + เสี้ยววงสีเน้น
    s += gdots(kind, 296, 180, 84, 70) +
      '<g class="gs g1"><rect x="392" y="182" width="40" height="92" rx="20" fill="' + f + '"/><rect x="446" y="132" width="40" height="142" rx="20" fill="' + f + '"/><rect x="500" y="76" width="40" height="198" rx="20" fill="' + b + '"/></g>' +
      S('quart', 556, 70, 46, 0, a, 'g2', -2) + S('ring', 352, 96, 34, 0, 0, 'g3') + S('c', 594, 210, 10, 0, f, 'g1', -3) + S('arc', 466, 160, 150, 200, 0, 'sp');
  } else if (kind === 'expense') {    // เงินออก: เอกสารเอียงซ้อนสามเหลี่ยมสีเน้น
    s += gdots(kind, 300, 40, 84, 70) +
      gblob(468, 152, 72, f, 'g1', 48, 2) + S('tri', 536, 96, 46, 12, a, 'g2', -2) + S('dash', 468, 152, 112, 0, 0, 'sp') +
      S('dia', 330, 236, 20, 0, b, 'g3', -1) + S('semi', 576, 254, 22, 180, f, 'g1', -3);
  } else if (kind === 'settings') {   // ปรับแต่ง: วงซ้อนแบบเวนน์ + หกเหลี่ยม
    s += gdots(kind, 296, 196, 84, 70) +
      gblob(444, 146, 68, f, 'g1', 52, 1) + gblob(508, 168, 56, a, 'g2', 40, 3) + gblob(478, 96, 26, b, 'g3', 30, 4) +
      S('ring', 470, 146, 112, 0, 0, 'sp') + S('hex', 326, 90, 26, 0, f, 'g2', -2);
  } else if (kind === 'request') {    // คำขอ: กระดาษลอยตามเส้นทางจุดไปหาวงกลม (ส่งออกไป)
    s += gdots(kind, 520, 200, 84, 70) +
      '<path class="ln trail" d="M296 262 C340 250 360 200 404 186" fill="none"/>' +
      S('doc', 466, 146, 76, -10, f, 'g1') + gblob(552, 74, 38, a, 'g2', 32, 2) + S('ring', 552, 74, 56, 0, 0, 'g2', -2) +
      S('tri', 340, 104, 20, -16, b, 'g3', -1) + S('pill', 586, 210, 16, 30, f, 'g1', -3);
  } else if (kind === 'approve') {    // อนุมัติ: วงแหวนหนาแบบตราประทับ + เพชรสีเน้น
    s += gdots(kind, 298, 46, 84, 70) +
      S('thick', 468, 150, 76, 0, f, 'g1') + gblob(468, 150, 46, a, 'g2', 36, 0) + S('arc', 468, 150, 112, 120, 0, 'sp') +
      S('dia', 566, 76, 24, 0, b, 'g3', -1) + S('sq', 340, 236, 18, 20, f, 'g1', -3);
  } else {                            // ภาพรวม: ดวงกลมใหญ่ + ดวงสีเน้น + วงโคจร
    s += gdots(kind, 296, 188, 84, 70) +
      gblob(466, 146, 84, f, 'g1', 46, 0) + gblob(530, 100, 40, a, 'g2', 34, 2) + S('dash', 466, 146, 118, 0, 0, 'sp') +
      '<g class="orbit"><circle class="dotw" cx="466" cy="28" r="5"/></g>' +
      S('sq', 336, 74, 20, 18, b, 'g3', -1) + S('semi', 568, 262, 22, 180, f, 'g1', -3);
  }
  var wv = function (ph, amp) { var d = 'M0 ' + (200 + ph); for (var x = 0; x < 2400; x += 600) d += 'C' + (x + 150) + ' ' + (200 + ph - amp) + ',' + (x + 450) + ' ' + (200 + ph + amp) + ',' + (x + 600) + ' ' + (200 + ph); return d + 'L2400 320L0 320Z'; };
  var lq = function (cls, id, ph, amp) { return '<svg class="wave ' + cls + '" viewBox="0 0 2400 300" preserveAspectRatio="none"><path d="' + wv(ph, amp) + '" fill="url(#' + id + '-' + kind + ')"/></svg>'; };
  return '<div class="deco k-' + kind + '" aria-hidden="true"><i class="orb o1"></i><i class="orb o2"></i><i class="orb o3"></i>' +
    '<svg width="0" height="0" style="position:absolute"><defs>' +
    '<linearGradient id="lq1-' + kind + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--h3)" stop-opacity=".55"/><stop offset="1" style="stop-color:var(--h1)" stop-opacity=".08"/></linearGradient>' +
    '<linearGradient id="lq2-' + kind + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--h2)" stop-opacity=".5"/><stop offset="1" style="stop-color:var(--h4)" stop-opacity=".06"/></linearGradient>' +
    '<linearGradient id="lq3-' + kind + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity=".02"/></linearGradient></defs></svg>' +
    lq('w1', 'lq2', 20, 70) + lq('w2', 'lq1', 60, 56) + lq('w3', 'lq3', 100, 44) +
    '<svg class="scene" viewBox="200 -20 420 340" preserveAspectRatio="xMaxYMid meet">' + G + '<g class="par">' + s + '</g></svg></div>';
}
function pendingAmount() {
  var w = 0, k = 0;
  ((S.docs && S.docs.khbs) || []).forEach(function (h) {
    h.lines.forEach(function (l) {
      if (l.state === 'รอจ่าย') w += Math.round(l.net * 100);
      else if (l.state === 'อยู่ใน ขจ.') k += Math.round(l.net * 100);
    });
  });
  return { wait: w / 100, inKhj: k / 100 };
}
/* ---------- ฉบับร่าง (เก็บในเบราว์เซอร์ของผู้ใช้ ไม่หายถ้าปิดหน้ากลางทาง) ---------- */
var Draft = {
  k: function (kind) { return 'fin-draft:' + (S.me ? S.me.email : '') + ':' + kind; },
  get: function (kind) { try { var v = localStorage.getItem(Draft.k(kind)); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set: function (kind, data) { try { localStorage.setItem(Draft.k(kind), JSON.stringify({ at: Date.now(), data: data })); } catch (e) {} },
  del: function (kind) { try { localStorage.removeItem(Draft.k(kind)); } catch (e) {} }
};
function clockText(ms) {
  var d = new Date(ms);
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

/** แถบงานค้างบาง ๆ (กดแล้วไปทำต่อ) */
function workChips() {
  var d = S.docs, chips = [], wn = 0, jn = 0, dr = 0, ap = 0, rc = 0, ex = mode() === 'exec';
  var dk = Draft.get('khb'), dc = Draft.get('rcv');
  if (dk && dk.data && can.khb() && (dk.data.lines || []).some(function (l) { return l.payee || l.gross; })) dr++;
  if (dc && dc.data && can.fin() && (dc.data.lines || []).some(function (l) { return l.amount; })) dr++;
  (d.khbs || []).forEach(function (h) {
    if (h.status === 'ยกเลิก') return;
    if (h.flow === 'รออนุมัติ') ap++; else if (h.flow === 'อนุมัติแล้ว') rc++;
    else if (h.flow === 'รับเรื่องแล้ว') h.lines.forEach(function (l) { if (l.state === 'รอจ่าย') wn++; });
  });
  (d.khjs || []).forEach(function (j) { if (j.status !== 'ยกเลิก' && j.paid < j.count) jn++; });
  if (ex) { if (ap) chips.push({ c: 'appr', t: 'รอท่านอนุมัติ ' + ap + ' ฉบับ', go: ['approve', null] }); return chips; }
  if (dr) chips.push({ c: 'draft', t: 'ฉบับร่างค้าง ' + dr, go: dk && can.khb() ? ['expense', { seg: 'khb', draft: 1 }] : ['income', { seg: 'enter' }] });
  if (rc) chips.push({ c: 'cloud', t: 'อนุมัติแล้ว รอรับเรื่อง ' + rc + ' ฉบับ', go: ['expense', { seg: 'khj' }] });
  if (wn) chips.push({ c: 'wait', t: 'รอทำ ขจ. ' + wn + ' รายการ', go: ['expense', { seg: 'khj' }] });
  if (jn) chips.push({ c: 'pay', t: 'ขจ. รอจ่ายเงิน ' + jn + ' ใบ', go: ['expense', { seg: 'khj' }] });
  if (ap) chips.push({ c: 'appr', t: 'อยู่ที่ผู้บริหาร ' + ap + ' ฉบับ', go: ['expense', { seg: 'grid' }] });
  return chips;
}
function renderInbox() {
  var box = $('inbox'); if (!box) return;
  var chips = workChips();
  box.innerHTML = chips.length ? '<span class="wl">งานค้าง</span>' + chips.map(function (x, i) { return '<button type="button" class="wchip ' + x.c + '" data-i="' + i + '"><i></i>' + esc(x.t) + '</button>'; }).join('') :
    '<span class="wl ok">ไม่มีงานค้าง</span>';
  Array.prototype.forEach.call(box.querySelectorAll('[data-i]'), function (b) { b.onclick = function () { var x = chips[Number(b.getAttribute('data-i'))]; go(x.go[0], x.go[1]); }; });
}
function renderOverview() {
  var pa = pendingAmount();
  $('view').innerHTML =
    '<section class="hero">' + heroDeco('overview') +
    '<div class="lbl">ยอดคงเหลือทุกประเภทเงิน ทุกที่เก็บ ณ <input type="date" id="dt" value="' + esc(S.date) + '" min="' + esc(S.st.fyStart) + '" max="' + esc(S.st.fyEnd) + '" aria-label="เลือกวันที่"> <span id="dtTh"></span></div>' +
    '<div class="big money" id="kpi" data-v="0">—</div><div class="sub">คำนวณจาก Ledger ที่เดียว (ยอดยกมา + รับ − จ่าย)</div>' +
    '<div class="tiles">' +
    '<button class="tile" type="button" data-go="income"><div class="k">รับตั้งแต่ต้นปีงบ</div><div class="v money" id="kRecv">—</div><div class="s">ถึงวันที่เลือก · ไปหน้ารายรับ →</div></button>' +
    '<button class="tile" type="button" data-go="expense"><div class="k">จ่ายแล้วตั้งแต่ต้นปีงบ</div><div class="v money" id="kPaid">—</div><div class="s">ถึงวันที่เลือก · ไปหน้ารายจ่าย →</div></button>' +
    '<button class="tile" type="button" data-go="pending"><div class="k">ขอเบิกแล้ว ยังไม่ได้จ่าย</div><div class="v money">' + money(pa.wait + pa.inKhj) + '</div><div class="s">รอ ขจ. ' + money(pa.wait) + ' · รอจ่าย ' + money(pa.inKhj) + '</div></button>' +
    '</div></section>' +
    '<div class="wstrip" id="inbox"></div>' +
    '<section id="rep" aria-label="รายงานสรุป"></section>';
  var dt = $('dt');
  dt.onchange = function () { if (this.value) { S.date = this.value; fetchBalances(); } };
  Array.prototype.forEach.call($('view').querySelectorAll('[data-go]'), function (b) {
    b.onclick = function () {
      var g = b.getAttribute('data-go');
      if (g === 'pending') go('expense', { seg: 'khj' }); else go(g, null);
    };
  });
  renderInbox();
  fetchBalances();
  Report.mount($('rep'));
}
function fetchBalances() {
  $('dtTh').textContent = thaiDateLong(S.date);
  api('getBalances', { date: S.date }).then(function (d) {
    S.bal = d;
    if (S.tab !== 'overview' || !$('kpi')) return;
    countUp($('kpi'), d.grand);
    $('kRecv').textContent = money(d.receivedIn || 0);
    $('kPaid').textContent = money(d.paidOut || 0);
    Report.refreshBal();
  }).catch(function (e) {
    if (e && e.code === 'AUTH') { handleError(e); return; }
    if ($('ov')) $('ov').innerHTML = '<div class="err-box"><b>แสดงยอดไม่ได้</b><br>' + esc(e.message) + '</div>';
  });
}
function groupsOf(d) {
  var order = [], map = {};
  d.types.forEach(function (t, i) { if (!map[t.group]) { map[t.group] = []; order.push(t.group); } map[t.group].push(i); });
  return { order: order, map: map };
}
function renderBalanceTable(d) {
  var g = groupsOf(d), i, j, k, h = '';
  h += '<div class="tablewrap bal"><table><thead><tr><th>ประเภทเงิน</th>';
  for (j = 0; j < d.stores.length; j++) h += '<th class="money">' + esc(d.stores[j].name) + '</th>';
  h += '<th class="money">รวม</th></tr></thead><tbody>';
  for (k = 0; k < g.order.length; k++) {
    h += '<tr class="grp-row"><td colspan="' + (d.stores.length + 2) + '">' + esc(g.order[k]) + '</td></tr>';
    g.map[g.order[k]].forEach(function (r) {
      h += '<tr><td>' + esc(d.types[r].name) + '</td>';
      for (var jj = 0; jj < d.stores.length; jj++) h += '<td class="money">' + moneyCell(d.cells[r][jj]) + '</td>';
      h += '<td class="money"><b class="money">' + money(d.rowTotals[r]) + '</b></td></tr>';
    });
  }
  h += '<tr class="sum-row"><td>รวมทุกประเภท</td>';
  for (j = 0; j < d.stores.length; j++) h += '<td class="money">' + money(d.colTotals[j]) + '</td>';
  h += '<td class="money">' + money(d.grand) + '</td></tr></tbody></table></div>';
  h += '<div class="cards">';
  for (k = 0; k < g.order.length; k++) {
    h += '<div class="tc-g">' + esc(g.order[k]) + '</div>';
    g.map[g.order[k]].forEach(function (q) {
      var lines = '';
      for (var jj = 0; jj < d.stores.length; jj++) {
        if (d.cells[q][jj] !== 0) lines += '<div class="tc-l"><span>' + esc(d.stores[jj].name) + '</span><span class="money">' + money(d.cells[q][jj]) + '</span></div>';
      }
      h += '<div class="tc"><div class="tc-h"><span>' + esc(d.types[q].name) + '</span><span class="money">' + money(d.rowTotals[q]) + '</span></div>' +
        (lines || '<div class="tc-l"><span>ไม่มียอด</span></div>') + '</div>';
    });
  }
  h += '<div class="tc-g">รวมตามที่เก็บ</div><div class="tc">';
  for (j = 0; j < d.stores.length; j++) h += '<div class="tc-l"><span>' + esc(d.stores[j].name) + '</span><span class="money">' + money(d.colTotals[j]) + '</span></div>';
  h += '<div class="tc-h" style="margin-top:6px"><span>รวมทุกประเภท</span><span class="money">' + money(d.grand) + '</span></div></div></div></section>';
  $('ov').innerHTML = h;
  observeReveal();
}

/* ================= ตั้งค่า (admin) ================= */
function opts(list, sel, blank) {
  var h = blank ? '<option value="">(ไม่ระบุ)</option>' : '';
  list.forEach(function (x) { h += '<option value="' + esc(x[0]) + '"' + (x[0] === sel ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; });
  return h;
}
function plainOpts(list, sel) {
  return list.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
}
function typeRow(r) {
  var L = S.schema.schema['ประเภทเงิน'];
  return '<div class="erow" data-row="type">' +
    '<label class="f">' + esc(L[0]) + '<input data-k="0" value="' + esc(r[0]) + '"></label>' +
    '<label class="f">' + esc(L[1]) + '<input data-k="1" value="' + esc(r[1]) + '"></label>' +
    '<label class="f">' + esc(L[2]) + '<input data-k="2" list="groups" value="' + esc(r[2]) + '"></label>' +
    '<label class="f">' + esc(L[3]) + '<select data-k="3">' + opts(S.st.stores, r[3], true) + '</select></label>' +
    '<label class="chk"><input type="checkbox" data-k="4"' + (r[4] === 'ใช่' ? ' checked' : '') + '> ' + esc(L[4]) + '</label>' +
    '<div><button class="btn danger sm" type="button" data-act="delrow">ลบแถว</button></div></div>';
}
function storeRow(r) {
  var L = S.schema.schema['ที่เก็บเงิน'];
  return '<div class="erow" data-row="store">' +
    '<label class="f">' + esc(L[0]) + '<input data-k="0" value="' + esc(r[0]) + '"></label>' +
    '<label class="f">' + esc(L[1]) + '<input data-k="1" value="' + esc(r[1]) + '"></label>' +
    '<label class="f">' + esc(L[2]) + '<select data-k="2">' + plainOpts(S.st.kinds, r[2]) + '</select></label>' +
    '<div><button class="btn danger sm" type="button" data-act="delrow">ลบแถว</button></div></div>';
}
function aliasRow(r) {
  return '<div class="erow" data-row="alias"><label class="f">ชื่อย่อ<input data-k="0" value="' + esc(r[0]) + '"></label>' +
    '<label class="f">ประเภทเงิน<select data-k="1">' + opts(S.st.types, r[1], false) + '</select></label>' +
    '<div><button class="btn danger sm" type="button" data-act="delrow">ลบแถว</button></div></div>';
}
function openRow(r) {
  var L = S.schema.schema['ยอดยกมา'];
  return '<div class="erow" data-row="open">' +
    '<label class="f">' + esc(L[1]) + '<select data-k="0">' + opts(S.st.types, r[0], false) + '</select></label>' +
    '<label class="f">' + esc(L[2]) + '<select data-k="1">' + opts(S.st.stores, r[1], false) + '</select></label>' +
    '<label class="f">' + esc(L[3]) + ' (บาท)<input class="money" data-k="2" inputmode="decimal" value="' + esc(r[2]) + '"></label>' +
    '<div><button class="btn danger sm" type="button" data-act="delrow">ลบแถว</button></div></div>';
}
var DOC_FIELDS = [
  ['ส่วนราชการ', 'ส่วนราชการ (หัวเอกสาร)'], ['เรียน', 'เรียน'], ['ผู้เสนอ', 'ผู้เสนอ (ด้วย …)'],
  ['ขบ_ลงนาม1_ชื่อ', 'ขบ. ผู้ลงนาม 1 ชื่อ'], ['ขบ_ลงนาม1_ตำแหน่ง', 'ตำแหน่ง'], ['ขบ_ลงนาม2_ชื่อ', 'ขบ. ผู้ลงนาม 2 ชื่อ'], ['ขบ_ลงนาม2_ตำแหน่ง', 'ตำแหน่ง'],
  ['ขบ_ลงนาม3_ชื่อ', 'ขบ. ผู้ลงนาม 3 ชื่อ'], ['ขบ_ลงนาม3_ตำแหน่ง', 'ตำแหน่ง'], ['ขบ_ลงนาม4_ชื่อ', 'ขบ. ผู้ลงนาม 4 ชื่อ'], ['ขบ_ลงนาม4_ตำแหน่ง', 'ตำแหน่ง'],
  ['ขจ_ลงนาม1_ชื่อ', 'ขจ. ผู้ลงนาม 1 ชื่อ'], ['ขจ_ลงนาม1_ตำแหน่ง', 'ตำแหน่ง'], ['ขจ_ลงนาม2_ชื่อ', 'ขจ. ผู้ลงนาม 2 ชื่อ'], ['ขจ_ลงนาม2_ตำแหน่ง', 'ตำแหน่ง'],
  ['ขจ_ลงนาม3_ชื่อ', 'ขจ. ผู้ลงนาม 3 ชื่อ'], ['ขจ_ลงนาม3_ตำแหน่ง', 'ตำแหน่ง'], ['ขจ_ลงนาม4_ชื่อ', 'ขจ. ผู้ลงนาม 4 ชื่อ'], ['ขจ_ลงนาม4_ตำแหน่ง', 'ตำแหน่ง'],
  ['ผอ_ชื่อ', 'ผู้อำนวยการ ชื่อ'], ['ผอ_ตำแหน่ง', 'ตำแหน่ง']
];
/** การ์ดตั้งค่าพับได้: เปิดทีละหัวข้อที่ต้องใช้ จำสถานะไว้ */
function collapsify(root) {
  var state = {}; try { state = JSON.parse(localStorage.getItem('fin-col') || '{}'); } catch (e) {}
  Array.prototype.forEach.call(root.querySelectorAll('section.card'), function (sec, i) {
    var h2 = sec.querySelector(':scope > h2'); if (!h2) return;
    var key = 'c' + i, open = state.hasOwnProperty(key) ? state[key] : i === 0;
    var wrap = document.createElement('div'), body = document.createElement('div');
    wrap.className = 'cwrap'; body.className = 'cbody';
    while (h2.nextSibling) body.appendChild(h2.nextSibling);
    wrap.appendChild(body); sec.appendChild(wrap);
    h2.setAttribute('role', 'button'); h2.setAttribute('tabindex', '0'); h2.classList.add('chd');
    function set(o) { sec.classList.toggle('col', !o); h2.setAttribute('aria-expanded', String(o)); }
    set(open);
    function toggle() { var o = sec.classList.contains('col'); set(o); state[key] = o; try { localStorage.setItem('fin-col', JSON.stringify(state)); } catch (e) {} }
    h2.onclick = toggle; h2.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  });
}
function renderSettings() {
  var st = S.st, h = '', groups = {}, gl = '';
  st.types.forEach(function (t) { groups[t[2]] = true; });
  Object.keys(groups).forEach(function (g) { gl += '<option value="' + esc(g) + '">'; });
  h += '<section class="hero">' + heroDeco('settings') + '<div class="lbl">ตั้งค่าระบบ</div><div class="big" style="font-family:var(--font);font-size:clamp(26px,4vw,38px)">ประเภทเงิน · ที่เก็บ · ยอดยกมา · เอกสาร</div>' +
    '<div class="sub">แก้ได้เฉพาะ admin · รหัสที่ถูกใช้ในเอกสารแล้วลบไม่ได้ ให้ปิดใช้งานแทน</div></section>';
  h += '<section class="card glass reveal"><h2>ผู้ลงนามและหัวเอกสาร ขบ. / ขจ.</h2><p class="hint">ใช้พิมพ์บนเอกสาร ไม่มีชื่อจริงในโค้ด กรอกครั้งเดียว</p><div class="erow" id="docSet">';
  DOC_FIELDS.forEach(function (f) {
    h += '<label class="f">' + esc(f[1]) + '<input data-key="' + esc(f[0]) + '" value="' + esc(st.docSettings[f[0]] || '') + '"></label>';
  });
  h += '</div><div class="actions"><button class="btn" type="button" data-act="savedoc">บันทึกหัวเอกสาร</button></div></section>';
  h += '<section class="card glass reveal"><h2>ผู้รับเงินและภาษีหัก ณ ที่จ่าย</h2><p class="hint">ทะเบียนมี <b>' + st.payees.length + '</b> ราย · ภ.ง.ด.53 หัก 1% ทุกยอด · ภ.ง.ด.3 หัก 1% เมื่อตั้งแต่ 10,000 บาท · ผู้รับที่จด VAT ใช้ยอด ÷ 1.07 เป็นฐาน · ผู้รับใหม่ที่เคยกรอกใน ขบ. ระบบจำไว้ให้เอง</p>' +
    '<div class="actions"><button class="btn" type="button" data-act="payees">เปิดทะเบียนผู้รับเงิน (วางจาก Excel / ค้นหา / แก้)</button></div></section>';
  h += '<section class="card glass reveal"><h2>ชื่อย่อประเภทเงิน</h2><p class="hint">ชื่อที่ใช้ในไฟล์เดิม (เช่น อน.รห. · บกศ. จ/2) ระบบใช้จับคู่ตอนวางจาก Excel</p><div id="aliasRows">';
  (st.aliases || []).forEach(function (r) { h += aliasRow(r); });
  h += '</div><div class="actions"><button class="btn ghost" type="button" data-act="addalias">' + ICON.plus + ' เพิ่มชื่อย่อ</button><button class="btn" type="button" data-act="savealiases">บันทึกชื่อย่อ</button></div></section>';
  h += '<section class="card glass reveal"><h2>ที่เก็บเงิน</h2><div id="storeRows">';
  st.stores.forEach(function (r) { h += storeRow(r); });
  h += '</div><div class="actions"><button class="btn ghost" type="button" data-act="addstore">' + ICON.plus + ' เพิ่มที่เก็บเงิน</button><button class="btn" type="button" data-act="savestores">บันทึกที่เก็บเงิน</button></div></section>';
  h += '<section class="card glass reveal"><h2>ประเภทเงิน</h2><datalist id="groups">' + gl + '</datalist><div id="typeRows">';
  st.types.forEach(function (r) { h += typeRow(r); });
  h += '</div><div class="actions"><button class="btn ghost" type="button" data-act="addtype">' + ICON.plus + ' เพิ่มประเภทเงิน</button><button class="btn" type="button" data-act="savetypes">บันทึกประเภทเงิน</button></div></section>';
  var op = st.opening.length ? st.opening : st.types.filter(function (t) { return t[4] === 'ใช่'; })
    .map(function (t) { return [t[0], t[3] || (st.stores[0] ? st.stores[0][0] : ''), '']; });
  h += '<section class="card glass reveal"><h2>ยอดยกมา ปีงบ ' + esc(st.fy) + ' (ณ ' + esc(thaiDateLong(st.fyStart)) + ')</h2>' +
    '<p class="hint">เลือกที่เก็บให้ตรงกับที่เงินอยู่จริง แถวที่ไม่กรอกจำนวนจะถูกข้าม</p><div id="openRows">';
  op.forEach(function (r) { h += openRow(r); });
  h += '</div><p class="hint" style="margin-top:8px">รวม: <b class="money" id="openSum">0.00</b> บาท</p>' +
    '<div class="actions"><button class="btn ghost" type="button" data-act="addopen">' + ICON.plus + ' เพิ่มแถว</button><button class="btn" type="button" data-act="saveopen">บันทึกยอดยกมา</button>' +
    '<button class="btn soft" type="button" data-act="rebuild">สร้าง Ledger ใหม่จากเอกสาร</button></div></section>';
  $('view').innerHTML = h;
  collapsify($('view'));
  updateOpenSum();
  var v = $('view');
  v.onclick = onSettingsClick;
  v.oninput = function (e) { if (e.target.closest('[data-row="open"]')) updateOpenSum(); };
}
function readRows(boxId) {
  return Array.prototype.map.call($(boxId).children, function (box) {
    var row = [];
    Array.prototype.forEach.call(box.querySelectorAll('[data-k]'), function (f) {
      row[Number(f.getAttribute('data-k'))] = f.type === 'checkbox' ? (f.checked ? 'ใช่' : 'ไม่') : f.value;
    });
    return row;
  });
}
function updateOpenSum() {
  var el = $('openSum'); if (!el) return;
  el.textContent = money(sumSat(readRows('openRows'), function (r) { return cleanNum(r[2]); }));
}
function refreshSettings(okText) {
  return api('getSettings').then(function (st) { S.st = st; toast(okText, 'good'); renderSettings(); });
}
function onSettingsClick(ev) {
  var t = ev.target.closest('[data-act]'); if (!t) return;
  var act = t.getAttribute('data-act'), tmp = document.createElement('div');
  if (act === 'delrow') { var row = t.closest('.erow'); row.parentNode.removeChild(row); updateOpenSum(); return; }
  if (act === 'addstore') { tmp.innerHTML = storeRow(['', '', S.st.kinds[0]]); $('storeRows').appendChild(tmp.firstChild); return; }
  if (act === 'addtype') { tmp.innerHTML = typeRow(['', '', '', '', 'ใช่']); $('typeRows').appendChild(tmp.firstChild); return; }
  if (act === 'addalias') { tmp.innerHTML = aliasRow(['', S.st.types[0][0]]); $('aliasRows').appendChild(tmp.firstChild); return; }
  if (act === 'payees') { openPayees(); return; }
  if (act === 'addopen') { tmp.innerHTML = openRow([S.st.types[0][0], S.st.stores[0][0], '']); $('openRows').appendChild(tmp.firstChild); return; }
  var p;
  if (act === 'savestores') p = api('saveStores', { rows: readRows('storeRows') }).then(function () { return refreshSettings('บันทึกที่เก็บเงินแล้ว'); });
  else if (act === 'savealiases') p = api('saveAliases', { rows: readRows('aliasRows') }).then(function () { return refreshSettings('บันทึกชื่อย่อแล้ว'); });
  else if (act === 'savetypes') p = api('saveTypes', { rows: readRows('typeRows') }).then(function () { return refreshSettings('บันทึกประเภทเงินแล้ว'); });
  else if (act === 'saveopen') {
    var rows = readRows('openRows').filter(function (r) { return String(r[2]).replace(/\s/g, '') !== ''; });
    p = api('saveOpening', { rows: rows }).then(function () { return refreshSettings('บันทึกยอดยกมาและสร้าง Ledger ใหม่แล้ว'); });
  } else if (act === 'savedoc') {
    var vals = {};
    Array.prototype.forEach.call($('docSet').querySelectorAll('[data-key]'), function (i) { vals[i.getAttribute('data-key')] = i.value; });
    p = api('saveDocSettings', { values: vals }).then(function () { return refreshSettings('บันทึกหัวเอกสารแล้ว'); });
  } else if (act === 'rebuild') p = api('rebuildLedger').then(function (r) { toast('สร้าง Ledger ใหม่แล้ว ' + r.rows + ' แถว', 'good'); });
  if (p) busy(t, p).catch(handleError);
}


/* ================= ทะเบียนผู้รับเงิน (วางจาก Excel / ค้นหา / แก้) ================= */
function openPayees(onDone) {
  var pasteCtx = function () { return { types: S.st.types, aliases: S.st.aliases || [] }; };
  var m = openModal({
    title: 'ทะเบียนผู้รับเงิน · ภาษีหัก ณ ที่จ่าย', width: 980,
    body: '<p class="hint">ภ.ง.ด.53 หัก 1% ทุกยอด · ภ.ง.ด.3 หัก 1% เมื่อตั้งแต่ 10,000 บาท · "VAT ใช่" ใช้ยอด ÷ 1.07 เป็นฐานภาษี ใช้คำนวณภาษีใน ขบ. ให้อัตโนมัติ</p>' +
      '<div class="card glass" style="padding:14px"><b>วางรายชื่อจากไฟล์เดิม</b><p class="hint" style="margin:4px 0 8px">คัดลอกจากชีทรายชื่อ (ชื่อ · ภาษี · วิธีจ่าย · ชื่อย่อประเภทเงิน ช่องไหนอยู่ตรงไหนก็ได้) แล้ววาง Ctrl+V ที่นี่ แถวที่ชื่อซ้ำจะอัปเดต แถวใหม่จะเพิ่ม</p>' +
      '<textarea id="pPaste" rows="3" placeholder="วางที่นี่…"></textarea><div class="actions"><span class="hint" id="pInfo" style="margin:8px 0 0"></span><span style="flex:1"></span><button class="btn" type="button" id="pAdd" disabled>เพิ่ม/อัปเดตเข้าทะเบียน</button></div></div>' +
      '<div class="toolbar" style="margin-top:14px"><input class="grow" type="search" id="pQ" placeholder="ค้นหาชื่อผู้รับ (แสดงสูงสุด 30 ราย)" aria-label="ค้นหา"><span class="hint" id="pCount" style="margin:0"></span></div><div id="pList"></div>',
    footer: '<span class="sp"></span><button class="btn ghost" type="button" data-close>ปิด</button><button class="btn" type="button" id="pSave" disabled>บันทึกที่แก้ไข</button>',
    onClose: function () { if (onDone) onDone(); }
  });
  var el = m.el, parsed = [], dirty = {};
  function drawList() {
    var q = Paste.nk(el.querySelector('#pQ').value), list = S.st.payees.filter(function (p) { return !q || Paste.nk(p[0]).indexOf(q) >= 0; });
    el.querySelector('#pCount').textContent = 'พบ ' + list.length + ' จากทั้งหมด ' + S.st.payees.length + ' ราย';
    el.querySelector('#pList').innerHTML = list.length ? '<div class="tablewrap"><table><thead><tr><th>ชื่อ</th><th>ภาษี</th><th>VAT</th><th>วิธีจ่าย</th><th>ประเภทเงินหลัก</th></tr></thead><tbody>' +
      list.slice(0, 30).map(function (p, i) {
        return '<tr data-name="' + esc(p[0]) + '"><td>' + esc(p[0]) + '</td>' +
          '<td><select data-c="1">' + plainOpts(S.schema.taxTypes, p[1]) + '</select></td>' +
          '<td><select data-c="2">' + plainOpts(['ไม่', 'ใช่'], p[2]) + '</select></td>' +
          '<td><select data-c="3"><option value="">—</option>' + plainOpts(S.schema.payMethods, p[3]) + '</select></td>' +
          '<td><select data-c="4">' + opts(S.st.types, p[4], true) + '</select></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty"><b>ยังไม่มีผู้รับในทะเบียน</b>วางรายชื่อจากไฟล์เดิมด้านบน หรือกรอก ขบ. ระบบจะจำผู้รับให้เอง</div>';
  }
  drawList();
  el.querySelector('#pQ').oninput = drawList;
  el.querySelector('#pList').addEventListener('change', function (e) {
    var tr = e.target.closest('tr[data-name]'); if (!tr) return;
    var name = tr.getAttribute('data-name'), row = S.st.payees.filter(function (p) { return p[0] === name; })[0].slice();
    row[Number(e.target.getAttribute('data-c'))] = e.target.value;
    dirty[name] = row; el.querySelector('#pSave').disabled = false;
  });
  function parsePaste() {
    var rows = Paste.parseTSV(el.querySelector('#pPaste').value);
    parsed = Paste.payeeRows(rows, pasteCtx());
    var c = { '': 0 }; parsed.forEach(function (r) { c[r[1]] = (c[r[1]] || 0) + 1; });
    el.querySelector('#pInfo').innerHTML = parsed.length ? 'อ่านได้ <b>' + parsed.length + '</b> ราย · ภ.ง.ด.53: ' + (c['ภ.ง.ด.53'] || 0) + ' · ภ.ง.ด.3: ' + (c['ภ.ง.ด.3'] || 0) + ' · ไม่มีภาษี: ' + (c['ไม่มีภาษี'] || 0) : '';
    el.querySelector('#pAdd').disabled = !parsed.length;
  }
  el.querySelector('#pPaste').addEventListener('paste', function () { setTimeout(parsePaste, 30); });
  el.querySelector('#pPaste').addEventListener('input', parsePaste);
  el.querySelector('#pAdd').onclick = function () {
    busy(this, api('savePayees', { rows: parsed })).then(function (r) {
      toast('บันทึกทะเบียนผู้รับแล้ว (รวม ' + r.saved + ' ราย)', 'good');
      el.querySelector('#pPaste').value = ''; parsed = []; el.querySelector('#pInfo').textContent = ''; el.querySelector('#pAdd').disabled = true;
      return reloadSettings().then(drawList);
    }).catch(handleError);
  };
  el.querySelector('#pSave').onclick = function () {
    var rows = Object.keys(dirty).map(function (k) { return dirty[k]; });
    busy(this, api('savePayees', { rows: rows })).then(function () {
      dirty = {}; toast('บันทึกที่แก้แล้ว', 'good'); this.disabled = true; return reloadSettings().then(drawList);
    }.bind(this)).catch(handleError);
  };
}

/* ================= เริ่มต้น ================= */
document.addEventListener('DOMContentLoaded', function () {
  buildBg();
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (b && b.getAttribute('data-tab') !== S.tab) go(b.getAttribute('data-tab'));
  });
  $('btnOut').addEventListener('click', function () { signOut(''); });
  var saved = '';
  try { saved = sessionStorage.getItem('tok') || ''; } catch (e) {}
  if (saved) startApp(saved);
});
