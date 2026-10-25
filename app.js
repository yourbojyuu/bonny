/* ระบบการเงินโรงเรียน — app.js (แกนหลัก: เข้าสู่ระบบ เมนู ภาพรวม ตั้งค่า และเครื่องมือร่วม)
   JS แบบ ES5 · ค่า API_URL / CLIENT_ID อยู่บนสุดของ index.html */

var S = { token: '', me: null, schema: null, st: null, docs: null, tab: 'overview', date: '', bal: null, opt: {} };
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
  fin: function () { return ['admin', 'การเงิน'].indexOf(role()) >= 0; },
  admin: function () { return role() === 'admin'; }
};
var SI = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  income: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  expense: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
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
  $('app').hidden = true; $('login').hidden = false;
  $('loginMsg').textContent = message || '';
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
}
function startApp(token) {
  S.token = token;
  $('loginMsg').textContent = 'กำลังตรวจสิทธิ์…';
  api('me').then(function (me) {
    S.me = me;
    return Promise.all([api('getSchema'), api('getSettings'), api('getDocs'), api('getReceipts')]);
  }).then(function (r) {
    S.schema = r[0]; S.st = r[1]; S.docs = r[2]; S.rcv = r[3];
    try { sessionStorage.setItem('tok', token); } catch (e) {}
    $('login').hidden = true; $('app').hidden = false;
    $('who').textContent = S.me.name + ' · ' + S.me.role;
    $('fyLabel').textContent = 'ปีงบประมาณ ' + S.st.fy;
    S.date = defaultDate();
    renderTabs();
    go(S.tab || 'overview', null, true);
  }).catch(function (e) { signOut(e && e.message ? e.message : String(e)); });
}
/** โหลดเอกสารใหม่ (หลังบันทึก) */
function reloadDocs() {
  return api('getDocs').then(function (d) { S.docs = d; renderTabs(); return d; });
}
function reloadReceipts() {
  return api('getReceipts').then(function (d) { S.rcv = d; return d; });
}
function reloadSettings() {
  return api('getSettings').then(function (d) { S.st = d; return d; });
}

/* ================= เมนูและการเปลี่ยนหน้า ================= */
var TABS = [
  { id: 'overview', label: 'ภาพรวม' },
  { id: 'income', label: 'รายรับ' },
  { id: 'expense', label: 'รายจ่าย' },
  { id: 'settings', label: 'ตั้งค่า', admin: true }
];
function pendingCount() {
  var n = 0;
  ((S.docs && S.docs.khbs) || []).forEach(function (h) { n += (h.counts['รอจ่าย'] || 0) + (h.counts['อยู่ใน ขจ.'] || 0); });
  return n;
}
function renderTabs() {
  var h = '<span class="pill" aria-hidden="true"></span>';
  TABS.forEach(function (t) {
    if (t.admin && !can.admin()) return;
    var n = t.id === 'expense' ? pendingCount() : 0;
    h += '<button class="tab" role="tab" type="button" data-tab="' + t.id + '" aria-selected="' + (S.tab === t.id) + '">' + esc(t.label) +
      (n ? '<span class="n" title="รายการที่ยังไม่จ่าย">' + n + '</span>' : '') + '</button>';
  });
  $('tabs').innerHTML = h;
  movePill();
  renderSide();
}
var SIDE_ICON = { overview: 'home', income: 'income', expense: 'expense', settings: 'settings' };
function sideOpen() { try { return localStorage.getItem('fin-side') !== '0'; } catch (e) { return true; } }
function renderSide() {
  var nav = $('side'); if (!nav) return;
  var open = sideOpen(), h = '';
  nav.className = 'side' + (open ? '' : ' mini');
  h += '<div class="stitle"><span class="logo"><img src="logo.png" alt="ตราโรงเรียน"></span><span class="stx"><b>การเงินโรงเรียน</b><small>ปีงบประมาณ ' + esc(S.st ? S.st.fy : '') + '</small></span></div><div class="sopts">';
  TABS.forEach(function (t) {
    if (t.admin && !can.admin()) return;
    var n = t.id === 'expense' ? pendingCount() : 0;
    h += '<button type="button" class="sopt" data-sg="' + t.id + '" data-tab="' + t.id + '" title="' + esc(t.label) + '" aria-current="' + (S.tab === t.id ? 'page' : 'false') + '"><span class="sic">' + si(SIDE_ICON[t.id]) + '</span><span class="slb">' + esc(t.label) + '</span>' + (n ? '<span class="sn">' + n + '</span>' : '') + '</button>';
  });
  h += '</div>';
  if (can.khb() || can.fin()) {
    h += '<div class="ssec">ทางลัด</div><div class="sopts">' +
      (can.khb() ? '<button type="button" class="sopt q" data-sq="khb" title="ขบ. ใหม่"><span class="sic">' + si('plus') + '</span><span class="slb">ขบ. ใหม่</span></button>' : '') +
      (can.fin() ? '<button type="button" class="sopt q" data-sq="rcv" title="บันทึกใบเสร็จ"><span class="sic">' + si('plus') + '</span><span class="slb">บันทึกใบเสร็จ</span></button>' : '') + '</div>';
  }
  h += '<div class="sfoot"><button type="button" class="sopt" id="sOut" title="ออกจากระบบ"><span class="sic">' + si('out') + '</span><span class="slb">ออกจากระบบ</span></button>' +
    '<button type="button" class="sopt" id="sTog" title="' + (open ? 'ย่อเมนู' : 'ขยายเมนู') + '" aria-expanded="' + open + '"><span class="sic chv">' + si('chev') + '</span><span class="slb">ซ่อนเมนู</span></button></div>';
  nav.innerHTML = h;
  Array.prototype.forEach.call(nav.querySelectorAll('[data-sg]'), function (b) { b.onclick = function () { go(b.getAttribute('data-sg'), null); }; });
  Array.prototype.forEach.call(nav.querySelectorAll('[data-sq]'), function (b) { b.onclick = function () { if (b.getAttribute('data-sq') === 'khb') go('expense', { seg: 'khb', draft: 1 }); else go('income', { seg: 'enter' }); }; });
  $('sTog').onclick = function () { try { localStorage.setItem('fin-side', sideOpen() ? '0' : '1'); } catch (e) {} renderSide(); document.body.classList.toggle('side-mini', !sideOpen()); };
  $('sOut').onclick = function () { signOut(''); };
  document.body.classList.toggle('side-mini', !open);
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
  var run = function () {
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
    var v = $('view');
    v.className = '';
    if (tab === 'overview') renderOverview();
    else if (tab === 'income') Receipts.render(v, S.opt);
    else if (tab === 'expense') Docs.render(v, S.opt);
    else renderSettings();
    if (!document.startViewTransition || REDUCE) { void v.offsetWidth; v.className = 'view-in'; }
    observeReveal();
  };
  if (!instant && document.startViewTransition && !REDUCE) {
    try { document.startViewTransition(run); } catch (e) { run(); }
  } else run();
  if (!instant) window.scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' });
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
  $('bg').innerHTML = '<div class="aur"><i></i><i></i><i></i></div><div class="dots"></div>' + defs + overview + income + expense + settings;
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
  window.addEventListener('resize', movePill);
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
function heroDeco(kind) {
  var b = kind === 'income'
    ? '<rect class="hg" x="270" y="150" width="62" height="170" rx="22"/><rect class="hg" x="350" y="90" width="62" height="230" rx="22"/><rect class="hg" x="430" y="20" width="62" height="300" rx="22"/><path class="hl" d="M240 230 C 320 210 370 150 430 100 S 500 30 540 10"/><circle class="hl" cx="300" cy="60" r="44"/>'
    : kind === 'expense'
    ? '<path class="hg" d="M300 -20h70L250 300h-70z"/><path class="hg" d="M400 -20h40L320 300h-40z"/><circle class="hl" cx="420" cy="220" r="90"/><circle class="hg" cx="470" cy="70" r="38"/>'
    : '<circle class="hl" cx="380" cy="140" r="150"/><circle class="hl" cx="380" cy="140" r="104" stroke-dasharray="3 9"/><circle class="hg" cx="430" cy="70" r="64"/><rect class="hg" x="250" y="170" width="110" height="110" rx="30" transform="rotate(16 305 225)"/>';
  return '<div class="deco" aria-hidden="true"><i class="orb o1"></i><i class="orb o2"></i><i class="orb o3"></i><svg viewBox="0 0 520 300">' + b + '</svg></div>';
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

/** งานที่ต้องทำต่อ: เรียงตามความเร่งด่วน กดแล้วไปทำต่อได้ทันที */
function inboxItems() {
  var items = [], d = S.docs, rc = S.rcv ? S.rcv.rows : [];
  var dk = Draft.get('khb'), dr = Draft.get('rcv');
  if (dk && dk.data && dk.data.lines && can.khb()) {
    var n = dk.data.lines.filter(function (l) { return l.payee || l.gross; }).length;
    if (n) items.push({ cls: 'draft', t: 'ฉบับร่าง ขบ. ค้างอยู่ ' + n + ' รายการ', s: 'บันทึกไว้เมื่อ ' + clockText(dk.at) + ' · ยังไม่ได้กดบันทึก', b: 'ทำต่อ', go: ['expense', { seg: 'khb', draft: 1 }] });
  }
  if (dr && dr.data && can.fin() && (dr.data.lines || []).some(function (l) { return l.amount; })) {
    items.push({ cls: 'draft', t: 'ฉบับร่างใบเสร็จ เล่ม ' + (dr.data.book || '-') + ' เลขที่ ' + (dr.data.no || '-'), s: 'บันทึกไว้เมื่อ ' + clockText(dr.at), b: 'ทำต่อ', go: ['income', { seg: 'enter' }] });
  }
  var pa = pendingAmount(), wn = 0, jn = 0;
  (d.khbs || []).forEach(function (h) { h.lines.forEach(function (l) { if (l.state === 'รอจ่าย') wn++; }); });
  if (wn) items.push({ cls: 'wait', t: 'ขบ. รอทำ ขจ. ' + wn + ' รายการ', s: 'รวม ' + money(pa.wait) + ' บาท · ติ๊กเลือกแล้วสร้าง ขจ. ได้เลย', b: can.fin() ? 'สร้าง ขจ.' : 'ดู', go: ['expense', { seg: 'pending' }] });
  (d.khjs || []).forEach(function (j) {
    if (j.status === 'ยกเลิก' || j.paid >= j.count) return;
    jn++;
    if (jn <= 3) items.push({ cls: 'pay', t: 'ขจ.' + j.no + ' รอบันทึกการจ่าย ' + (j.count - j.paid) + '/' + j.count + ' รายการ', s: thaiDate(j.date) + ' · ' + money(j.total) + ' บาท · ใส่เลขเช็ค/KTB และวันที่จ่าย', b: can.fin() ? 'บันทึกการจ่าย' : 'ดู', khj: j.no });
  });
  if (jn > 3) items.push({ cls: 'pay', t: 'ขจ. ที่ยังจ่ายไม่ครบ อีก ' + (jn - 3) + ' ใบ', s: '', b: 'ดูทั้งหมด', go: ['expense', { seg: 'khj' }] });
  var last = '';
  rc.forEach(function (r) { if (!r[8] && r[3] > last) last = r[3]; });
  var today = defaultDate();
  if (!rc.length) items.push({ cls: 'rcv', t: 'ยังไม่มีใบเสร็จในปีงบนี้', s: 'เริ่มบันทึกหรือวางจาก Excel ได้ที่หน้า รายรับ', b: 'ไปหน้ารายรับ', go: ['income', { seg: 'enter' }] });
  else if (last < today && daysBetween(last, today) >= 1) {
    var dd = daysBetween(last, today);
    items.push({ cls: 'rcv', t: 'ใบเสร็จล่าสุดที่บันทึก ' + thaiDate(last) + ' (ผ่านมา ' + dd + ' วัน)', s: 'ถ้ามีใบเสร็จใหม่ วางจาก Excel ได้ทีเดียวทั้งก้อน', b: 'บันทึกรายรับ', go: ['income', { seg: 'enter' }] });
  }
  return items;
}
/** ลิ้นชักงาน: แฟ้มแก้ว 4 แฟ้ม กดแฟ้มเดียวเห็นงานในนั้นทั้งหมด กดงานเพื่อไปทำต่อ */
function drawerFolders() {
  var d = S.docs, rc = S.rcv ? S.rcv.rows : [], out = [];
  var dk = Draft.get('khb'), dr = Draft.get('rcv'), drafts = [];
  if (dk && dk.data && can.khb()) {
    var n = (dk.data.lines || []).filter(function (l) { return l.payee || l.gross; }).length;
    if (n) drafts.push({ name: 'ฉบับร่าง ขบ.', meta: n + ' รายการ', go: ['expense', { seg: 'khb', draft: 1 }] });
  }
  if (dr && dr.data && can.fin() && (dr.data.lines || []).some(function (l) { return l.amount; })) drafts.push({ name: 'ฉบับร่างใบเสร็จ ' + (dr.data.book || '-') + '/' + (dr.data.no || '-'), meta: clockText(dr.at), go: ['income', { seg: 'enter' }] });
  out.push({ key: 'draft', label: 'ฉบับร่าง', art: 'aurora', seed: 3, meta: drafts.length ? drafts.length + ' ฉบับ · ทำต่อได้เลย' : 'ไม่มีฉบับร่าง', files: drafts });

  var wait = [], waitSum = 0, pay = [];
  (d.khbs || []).forEach(function (h) {
    if (h.status === 'ยกเลิก') return;
    h.lines.forEach(function (l) { if (l.state === 'รอจ่าย') { wait.push({ name: l.payee || typeName(l.type), meta: money(l.net), go: ['expense', { seg: 'pending' }] }); waitSum += Math.round(l.net * 100); } });
  });
  out.push({ key: 'wait', label: 'ขบ. รอทำ ขจ.', art: 'ember', seed: 11, meta: wait.length ? wait.length + ' รายการ · ' + money(waitSum / 100) : 'ไม่มีรายการรอ', files: wait });
  (d.khjs || []).forEach(function (j) {
    if (j.status === 'ยกเลิก' || j.paid >= j.count) return;
    pay.push({ name: 'ขจ.' + j.no + ' · ' + thaiDate(j.date), meta: 'เหลือ ' + (j.count - j.paid) + '/' + j.count, khj: j.no });
  });
  out.push({ key: 'pay', label: 'รอจ่ายเงิน', art: 'glacier', seed: 5, meta: pay.length ? pay.length + ' ใบ ขจ.' : 'จ่ายครบแล้ว', files: pay });

  var live = rc.filter(function (r) { return !r[8]; }).sort(function (x, y) { return x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0; });
  var last = live.length ? live[live.length - 1][3] : '', ago = last ? daysBetween(last, defaultDate()) : 0;
  out.push({ key: 'rcv', label: 'รายรับล่าสุด', art: 'verdant', seed: 7,
    meta: !live.length ? 'ยังไม่มีใบเสร็จ' : ago > 0 ? 'ล่าสุด ' + thaiDate(last) + ' · ' + ago + ' วันก่อน' : 'บันทึกวันนี้แล้ว',
    files: live.slice(-6).map(function (r) { return { name: 'ใบเสร็จ ' + r[0] + '/' + r[1], meta: money(r[7]), go: ['income', { seg: 'list' }] }; }) });
  return out;
}
function renderInbox() {
  var box = $('inbox'); if (!box) return;
  if (window.GFUnmount) Array.prototype.forEach.call(document.querySelectorAll('.gfhost'), GFUnmount);
  var fs = drawerFolders(), total = 0;
  fs.forEach(function (f) { if (f.key !== 'rcv') total += f.files.length; });
  var h = '<h2>งานที่ต้องทำต่อ' + (total ? ' <span class="cnt">' + total + '</span>' : '') + '</h2>' +
    '<div class="quick">' +
    (can.khb() ? '<button class="btn sm" type="button" data-q="khb">' + ICON.plus + ' ขบ. ใหม่</button>' : '') +
    (can.fin() ? '<button class="btn sm soft" type="button" data-q="rcv">' + ICON.plus + ' บันทึกใบเสร็จ</button>' : '') +
    (can.fin() ? '<button class="btn sm ghost" type="button" data-q="pending">ทำ ขจ. จากรายการรอ</button>' : '') + '</div>';
  if (!window.GFMount) {
    h += '<div class="rows">' + fs.map(function (f) {
      return f.files.length ? '<div class="todo ' + f.key + '"><span class="dot"></span><span class="tx"><b>' + esc(f.label) + '</b><br><span class="tag">' + esc(f.meta) + '</span></span></div>' : '';
    }).join('') + '</div>';
    box.innerHTML = h; wireQuick(box); return;
  }
  h += '<div class="drawer" id="drawer">' + fs.map(function (f, i) { return '<div class="gfhost" data-f="' + i + '"></div>'; }).join('') + '</div>';
  box.innerHTML = h; wireQuick(box);
  var dw = $('drawer'), cols = dw.clientWidth < 560 ? 2 : 4, gap = cols === 2 ? 10 : 20;
  var wd = Math.max(140, Math.min(300, Math.floor((dw.clientWidth - gap * (cols - 1)) / cols)));
  Array.prototype.forEach.call(dw.querySelectorAll('.gfhost'), function (el, i) {
    var f = fs[i];
    el.style.setProperty('--k', (wd / 340).toFixed(3));
    GFMount(el, {
      label: f.label, meta: f.meta, art: f.art, seed: f.seed, width: wd, action: 'none', appearDelay: i * 120, defaultOpen: false,
      files: f.files.map(function (x) { return { name: x.name, meta: x.meta }; }),
      onFileSelect: function (file, idx) {
        var x = f.files[idx]; if (!x) return;
        if (x.khj) go('expense', { seg: 'khj', openKhj: x.khj }); else go(x.go[0], x.go[1]);
      }
    });
  });
}
function wireQuick(box) {
  Array.prototype.forEach.call(box.querySelectorAll('[data-q]'), function (b) {
    b.onclick = function () {
      var q = b.getAttribute('data-q');
      if (q === 'khb') go('expense', { seg: 'khb', draft: 1 });
      else if (q === 'rcv') go('income', { seg: 'enter' });
      else go('expense', { seg: 'pending' });
    };
  });
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
    '<section class="card glass" id="inbox"></section>' +
    '<section id="bento" aria-label="สรุปกราฟ"></section>' +
    '<div id="ov"><div class="skel"></div></div>';
  var dt = $('dt');
  dt.onchange = function () { if (this.value) { S.date = this.value; fetchBalances(); } };
  Array.prototype.forEach.call($('view').querySelectorAll('[data-go]'), function (b) {
    b.onclick = function () {
      var g = b.getAttribute('data-go');
      if (g === 'pending') go('expense', { seg: 'pending' }); else go(g, null);
    };
  });
  renderInbox();
  fetchBalances();
}
function fetchBalances() {
  $('dtTh').textContent = thaiDateLong(S.date);
  api('getBalances', { date: S.date }).then(function (d) {
    S.bal = d;
    if (S.tab !== 'overview' || !$('ov')) return;
    countUp($('kpi'), d.grand);
    $('kRecv').textContent = money(d.receivedIn || 0);
    $('kPaid').textContent = money(d.paidOut || 0);
    renderBalanceTable(d);
    if (window.Bento) Bento.mount($('bento'));
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
  var g = groupsOf(d), i, j, k, h = '<section class="card glass reveal"><h2>คงเหลือแยกประเภทเงิน × ที่เก็บ</h2>';
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
