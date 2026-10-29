/* combo.js — ช่องเลือกแบบ "พิมพ์ค้นหา + เลื่อนเลือก" ใช้ทั้งระบบโดยไม่ต้องแก้โค้ดหน้าอื่น
 *  1) <input list="…">  (datalist)  -> เมนูค้นหาของระบบเอง แทนเมนูของเบราว์เซอร์ (พิมพ์ได้อิสระ หรือเลือกจากรายการ)
 *  2) <select> ที่มี 6 ตัวเลือกขึ้นไป -> ปุ่มเลือก + ช่องค้นหา (มือถือขึ้นเป็นแผ่นด้านล่าง)
 *     ไม่ต้องการ: ใส่ data-native บน <select>
 *  เลือกแล้วส่ง event input/change เหมือนเดิม โค้ดฝั่งอื่นอ่าน .value ได้ตามปกติ
 *  คีย์ลัด: ↑↓ เลื่อน · Enter เลือก · Esc ปิด (ช่องที่ต้องตรงรายการ: พิมพ์แล้ว Enter เลือกตัวแรกให้) */
var Combo = (function () {
  'use strict';
  var MAXSHOW = 80, MIN_OPTS = 6;
  var FREE = /^(qPayees|payees|gl-payee|groups)$/; // รายการที่พิมพ์ชื่อใหม่ได้ (ผู้รับ / ชื่อกลุ่ม)
  var pop = null, back = null, cur = null;

  function norm(s) { return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/\s+/g, ''); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function isNarrow() { return window.matchMedia && window.matchMedia('(max-width: 640px)').matches; }
  function vp() { var v = window.visualViewport; return v ? { top: v.offsetTop, h: v.height } : { top: 0, h: window.innerHeight }; }

  /* ---------- รายการตัวเลือก ---------- */
  function inputItems(inp) {
    var dl = document.getElementById(inp.getAttribute('data-cb') || ''); if (!dl) return [];
    return Array.prototype.map.call(dl.options, function (o) { return { v: o.value, t: o.label || o.value }; });
  }
  function selectItems(sel) {
    var out = [], g = '';
    Array.prototype.forEach.call(sel.children, function (n) {
      if (n.tagName === 'OPTGROUP') { Array.prototype.forEach.call(n.children, function (o) { out.push({ v: o.value, t: o.text, g: n.label, dis: o.disabled }); }); }
      else if (n.tagName === 'OPTION') out.push({ v: n.value, t: n.text, g: g, dis: n.disabled });
    });
    return out;
  }
  /** กรองตามคำค้น: ขึ้นต้นด้วยคำค้นก่อน แล้วค่อยที่มีคำค้นอยู่ข้างใน */
  function filter(items, q) {
    q = norm(q); if (!q) return items.slice();
    var a = [], b = [];
    items.forEach(function (it) { var t = norm(it.t) + '|' + norm(it.v), i = t.indexOf(q); if (i === 0) a.push(it); else if (i > 0) b.push(it); });
    return a.concat(b);
  }
  function mark(text, q) {
    var t = String(text), n = norm(q); if (!n) return esc(t);
    var low = t.toLowerCase(), i = low.indexOf(String(q).trim().toLowerCase());
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + String(q).trim().length)) + '</mark>' + esc(t.slice(i + String(q).trim().length));
  }

  /* ---------- เมนูลอย ---------- */
  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div'); pop.className = 'cb-pop'; pop.hidden = true; pop.setAttribute('role', 'listbox');
    pop.addEventListener('mousedown', function (e) { if (!e.target.closest('.cb-q')) e.preventDefault(); }); // ไม่ให้ช่องกรอกเสียโฟกัส
    pop.addEventListener('click', function (e) {
      var it = e.target.closest('[data-i]'); if (it && cur) pick(Number(it.getAttribute('data-i')));
    });
    pop.addEventListener('mousemove', function (e) { var it = e.target.closest('[data-i]'); if (it && cur && cur.idx !== Number(it.getAttribute('data-i'))) setActive(Number(it.getAttribute('data-i')), true); });
    document.body.appendChild(pop);
    back = document.createElement('div'); back.className = 'cb-back'; back.hidden = true;
    back.addEventListener('click', function () { close(true); });
    document.body.appendChild(back);
    return pop;
  }
  function open(c) {
    ensurePop(); close(false); cur = c; c.idx = -1; c.q = c.q || '';
    c.sheet = c.kind === 'select' && isNarrow();
    pop.className = 'cb-pop' + (c.sheet ? ' sheet' : ''); pop.hidden = false; back.hidden = !c.sheet;
    if (c.kind === 'select') {
      pop.innerHTML = '<div class="cb-top"><input class="cb-q" type="text" autocomplete="off" placeholder="พิมพ์ค้นหา…" aria-label="ค้นหา"></div><div class="cb-list"></div>';
      var q = pop.querySelector('.cb-q'); q.value = c.q;
      q.addEventListener('input', function () { c.q = q.value; render(true); });
    } else pop.innerHTML = '<div class="cb-list"></div>';
    c.el.setAttribute('aria-expanded', 'true');
    render(false);
    place();
    if (c.kind === 'select') { var qq = pop.querySelector('.cb-q'); qq.focus(); if (c.q) qq.setSelectionRange(c.q.length, c.q.length); }
  }
  function close(refocus) {
    if (!cur) return;
    var c = cur; cur = null;
    if (pop) { pop.hidden = true; pop.innerHTML = ''; }
    if (back) back.hidden = true;
    c.el.setAttribute('aria-expanded', 'false');
    if (refocus && c.kind === 'select' && document.contains(c.el)) c.el.focus();
  }
  function render(typed) {
    var c = cur; if (!c) return;
    var all = c.kind === 'select' ? selectItems(c.sel) : inputItems(c.el), q = c.q;
    var exact = q && all.some(function (it) { return norm(it.t) === norm(q) || norm(it.v) === norm(q); });
    var res = filter(all, q), more = Math.max(0, res.length - MAXSHOW); res = res.slice(0, MAXSHOW);
    c.items = res; c.exact = !!exact;
    var list = pop.querySelector('.cb-list'), h = '', lastG = null, curV = c.kind === 'select' ? c.sel.value : null;
    res.forEach(function (it, i) {
      if (!q && it.g && it.g !== lastG) { h += '<div class="cb-g">' + esc(it.g) + '</div>'; lastG = it.g; }
      var sel = c.kind === 'select' && String(it.v) === String(curV);
      h += '<div class="cb-it' + (it.v === '' ? ' cb-none' : '') + (it.dis ? ' dis' : '') + '" role="option" data-i="' + i + '" aria-selected="' + sel + '" id="cbi' + i + '">' +
        '<span class="cb-t">' + (it.v === '' && c.kind === 'select' ? esc(it.t || '— ไม่เลือก —') : mark(it.t, q)) + '</span>' +
        (c.kind === 'input' && it.t !== it.v ? '<span class="cb-s">' + esc(it.v) + '</span>' : '') + (sel ? '<span class="cb-ck" aria-hidden="true">✓</span>' : '') + '</div>';
    });
    if (!res.length) h = '<div class="cb-empty">' + (c.free ? 'ไม่มีในรายการ — พิมพ์ชื่อใหม่แล้วกด Enter เพื่อใช้ชื่อนี้' : 'ไม่พบ “' + esc(q) + '”') + '</div>';
    list.innerHTML = h;
    var foot = pop.querySelector('.cb-foot'); if (foot) foot.remove();
    var note = more ? 'แสดง ' + MAXSHOW + ' จาก ' + (MAXSHOW + more) + ' · พิมพ์เพื่อค้นหาให้แคบลง' : (c.free && q && !exact && res.length ? 'กด Enter เพื่อใช้ “' + esc(q) + '” (ชื่อใหม่)' : '');
    if (note) pop.insertAdjacentHTML('beforeend', '<div class="cb-foot">' + note + '</div>');
    // ตำแหน่งที่ไฮไลต์: ช่องที่ต้องตรงรายการ -> ตัวแรกที่ตรง · ช่องเลือกเดิม -> ตัวที่เลือกอยู่ · ช่องพิมพ์อิสระ -> ไม่ไฮไลต์จนกว่าจะกดลูกศร
    var idx = -1;
    if (c.kind === 'select') { if (q) idx = res.length ? 0 : -1; else { res.forEach(function (it, i) { if (String(it.v) === String(curV) && idx < 0) idx = i; }); } }
    else if (!q) { res.forEach(function (it, i) { if (it.v === c.el.value && idx < 0) idx = i; }); }
    else if (!c.free && !exact && res.length) idx = 0;
    setActive(idx, false);
    if (typed) place();
  }
  function setActive(i, noScroll) {
    var c = cur; if (!c) return; c.idx = i;
    Array.prototype.forEach.call(pop.querySelectorAll('.cb-it'), function (n) { n.classList.toggle('on', Number(n.getAttribute('data-i')) === i); });
    var n = pop.querySelector('.cb-it.on');
    if (c.kind === 'input') { if (n) c.el.setAttribute('aria-activedescendant', n.id); else c.el.removeAttribute('aria-activedescendant'); }
    if (n && !noScroll) { var l = pop.querySelector('.cb-list'), t = n.offsetTop, b = t + n.offsetHeight; if (t < l.scrollTop + 4) l.scrollTop = Math.max(0, t - 40); else if (b > l.scrollTop + l.clientHeight - 4) l.scrollTop = b - l.clientHeight + 8; }
  }
  function place() {
    var c = cur; if (!c || !pop) return;
    if (c.sheet) { pop.style.cssText = ''; return; }
    var r = c.el.getBoundingClientRect(), v = vp(), W = document.documentElement.clientWidth, GAP = 6;
    var below = v.top + v.h - r.bottom - GAP - 8, above = r.top - v.top - GAP - 8, up = below < 220 && above > below;
    var space = Math.max(140, up ? above : below), w = Math.min(Math.max(r.width, 260), W - 16);
    var left = Math.min(Math.max(8, r.left), W - w - 8);
    pop.style.left = left + 'px'; pop.style.width = w + 'px'; pop.style.maxHeight = Math.min(340, space) + 'px';
    pop.style.top = up ? 'auto' : (r.bottom + GAP) + 'px'; pop.style.bottom = up ? (window.innerHeight - r.top + GAP) + 'px' : 'auto';
    var l = pop.querySelector('.cb-list'); if (l) l.style.maxHeight = (Math.min(340, space) - (pop.querySelector('.cb-top') ? 58 : 0) - (pop.querySelector('.cb-foot') ? 30 : 0)) + 'px';
  }
  function pick(i) {
    var c = cur; if (!c) return; var it = c.items[i]; if (!it || it.dis) return;
    if (c.kind === 'select') {
      var changed = c.sel.value !== it.v; c.sel.value = it.v; sync(c.sel);
      if (changed) { c.sel.dispatchEvent(new Event('input', { bubbles: true })); c.sel.dispatchEvent(new Event('change', { bubbles: true })); }
      close(true);
    } else {
      var el = c.el, ch = el.value !== it.v; el.value = it.v; close(false);
      if (ch) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  }

  /* ---------- ช่องพิมพ์ที่มี datalist ---------- */
  function openInput(el) {
    if (el.readOnly || el.disabled) return;
    if (!el.getAttribute('data-cb') && el.getAttribute('list')) { el.setAttribute('data-cb', el.getAttribute('list')); el.removeAttribute('list'); el.setAttribute('autocomplete', 'off'); el.setAttribute('role', 'combobox'); el.setAttribute('aria-autocomplete', 'list'); }
    var id = el.getAttribute('data-cb'); if (!id || !document.getElementById(id)) return;
    if (cur && cur.el === el) return;
    open({ kind: 'input', el: el, q: '', free: FREE.test(id) }); // เปิดมาเห็นทุกตัวเลือก แล้วค่อยกรองเมื่อพิมพ์
  }
  var lastUser = 0; // ผู้ใช้แตะ/กดคีย์ล่าสุดเมื่อไร — โฟกัสอัตโนมัติจากโปรแกรม (autofocus) จะไม่เด้งเมนูขึ้นมาบังหน้าจอ
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, function () { lastUser = Date.now(); }, true); });
  document.addEventListener('focusin', function (e) { var t = e.target; if (t && t.tagName === 'INPUT' && (t.getAttribute('list') || t.getAttribute('data-cb')) && Date.now() - lastUser < 600) openInput(t); });
  document.addEventListener('mousedown', function (e) {
    var t = e.target;
    if (t && t.tagName === 'INPUT' && (t.getAttribute('list') || t.getAttribute('data-cb')) && !(cur && cur.el === t)) { setTimeout(function () { openInput(t); }, 0); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (cur && cur.kind === 'input' && t === cur.el) { cur.q = t.value; render(true); }
    else if (!cur && t && t.tagName === 'INPUT' && e.isTrusted && (t.getAttribute('list') || t.getAttribute('data-cb'))) { openInput(t); if (cur && cur.el === t) { cur.q = t.value; render(true); } }
  });
  document.addEventListener('focusout', function (e) { if (cur && cur.kind === 'input' && e.target === cur.el) setTimeout(function () { if (cur && cur.kind === 'input' && document.activeElement !== cur.el) close(false); }, 120); });
  document.addEventListener('pointerdown', function (e) {
    if (!cur) return; if (pop.contains(e.target) || e.target === cur.el || (cur.kind === 'select' && cur.el.contains(e.target))) return; close(false);
  }, true);
  window.addEventListener('resize', function () { if (cur) place(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { if (cur) place(); });
  window.addEventListener('scroll', function () { if (cur && !cur.sheet) { var r = cur.el.getBoundingClientRect(); if (r.bottom < 0 || r.top > window.innerHeight) close(false); else place(); } }, true);

  /* ---------- คีย์บอร์ด (ดักก่อนตารางกรอก เพื่อไม่ให้ Enter/ลูกศรไปเลื่อนช่อง) ---------- */
  document.addEventListener('keydown', function (e) {
    if (!cur) {
      var b = e.target && e.target.classList && e.target.classList.contains('cb-btn') ? e.target : null;
      if (b && !b.disabled) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect(b); }
        else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleSelect(b, e.key); }
      }
      return;
    }
    var c = cur, inSearch = e.target && e.target.classList && e.target.classList.contains('cb-q'), mine = inSearch || e.target === c.el;
    if (!mine) return;
    var n = c.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); if (n) setActive(c.idx < 0 ? 0 : Math.min(n - 1, c.idx + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); if (n) setActive(c.idx <= 0 ? 0 : c.idx - 1); }
    else if (e.key === 'Home' && inSearch === false && c.kind === 'select') { /* ปล่อยให้ช่องค้นหาจัดการ */ }
    else if (e.key === 'Enter') {
      if (c.idx >= 0 && c.items[c.idx]) { e.preventDefault(); e.stopImmediatePropagation(); pick(c.idx); }
      else if (c.kind === 'select') { e.preventDefault(); e.stopImmediatePropagation(); }
      else close(false); // พิมพ์อิสระ: ใช้ข้อความที่พิมพ์ แล้วให้ตารางทำงานต่อ (Enter = ไปช่องถัดไป)
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(true); }
    else if (e.key === 'Tab') { close(false); }
  }, true);

  /* ---------- <select> -> ปุ่มเลือกพร้อมค้นหา ---------- */
  var chev = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  function eligible(sel) {
    if (sel.multiple || sel.hasAttribute('data-native') || sel.getAttribute('data-cb-done')) return false;
    if (sel.closest('.cb-pop')) return false;
    return sel.options.length >= MIN_OPTS;
  }
  function enhance(sel) {
    if (!eligible(sel)) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'cb-btn'; b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '<span class="cb-v"></span>' + chev; b._sel = sel;
    sel.setAttribute('data-cb-done', '1'); sel.classList.add('cb-hid'); sel.setAttribute('tabindex', '-1'); sel.setAttribute('aria-hidden', 'true');
    sel.parentNode.insertBefore(b, sel.nextSibling); sel._btn = b;
    var lab = sel.getAttribute('aria-label'); if (lab) b.setAttribute('aria-label', lab);
    b.addEventListener('click', function () { toggleSelect(b); });
    sync(sel);
  }
  function toggleSelect(b, q) {
    if (b.disabled) return;
    if (cur && cur.el === b) { close(true); return; }
    open({ kind: 'select', el: b, sel: b._sel, q: q || '' });
  }
  function sync(sel) {
    var b = sel._btn; if (!b) return;
    var o = sel.options[sel.selectedIndex], t = o ? o.text : '', empty = !o || o.value === '';
    var v = b.querySelector('.cb-v'); v.textContent = empty ? (t && t.trim() && !/^[—-]+$/.test(t.trim()) ? t : 'เลือก…') : t; b.classList.toggle('cb-ph', empty);
    b.disabled = sel.disabled; b.classList.toggle('bad', sel.classList.contains('bad'));
    if (sel.hasAttribute('data-f')) b.setAttribute('data-f-btn', sel.getAttribute('data-f'));
  }
  // โค้ดอื่นตั้ง select.value ตรง ๆ ได้ — ให้ป้ายบนปุ่มตามทัน
  (function () {
    var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (!d || !d.set) return;
    Object.defineProperty(HTMLSelectElement.prototype, 'value', { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { d.set.call(this, v); if (this._btn) sync(this); } });
    var d2 = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    if (d2 && d2.set) Object.defineProperty(HTMLSelectElement.prototype, 'selectedIndex', { configurable: true, enumerable: d2.enumerable, get: d2.get, set: function (v) { d2.set.call(this, v); if (this._btn) sync(this); } });
  })();
  document.addEventListener('change', function (e) { if (e.target && e.target._btn) sync(e.target); }, true);
  // กดชื่อช่อง (label) แล้วเปิดเมนู
  document.addEventListener('click', function (e) {
    var lab = e.target.closest ? e.target.closest('label') : null; if (!lab || e.target.closest('.cb-btn')) return;
    var s = lab.querySelector('select.cb-hid'); if (s && s._btn && !s._btn.disabled && !lab.querySelector('input,textarea')) { e.preventDefault(); s._btn.focus(); toggleSelect(s._btn); }
  });

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.tagName === 'SELECT') enhance(root);
    var l = root.querySelectorAll ? root.querySelectorAll('select') : [];
    for (var i = 0; i < l.length; i++) enhance(l[i]);
  }
  var queued = [], rq = 0;
  function flush() {
    rq = 0; var q = queued; queued = [];
    q.forEach(function (n) { if (n.nodeType === 1 && document.contains(n)) scan(n); });
    Array.prototype.forEach.call(document.querySelectorAll('select.cb-hid'), function (s) { if (s._btn && !document.contains(s._btn)) { s._btn = null; s.classList.remove('cb-hid'); s.removeAttribute('data-cb-done'); } });
    if (cur && !document.contains(cur.el)) close(false);
  }
  function start() {
    scan(document.body);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'childList') { m.addedNodes.forEach(function (n) { queued.push(n); }); if (m.target && m.target.tagName === 'SELECT') queued.push(m.target.parentNode); }
        else if (m.target && m.target._btn) sync(m.target);
      });
      if (!rq) rq = requestAnimationFrame(flush);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  return { scan: scan, sync: sync, filter: filter, close: close };
})();
