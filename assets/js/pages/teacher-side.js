// 관리 메뉴: 메뉴 목록(#hub)을 그대로 읽어 만든다(2026-11-22 묶음 4개)
// 넓은 화면(961px 이상)은 위 칸 4개(#topnav) + 묶음 안 왼쪽 목록(#subnav), 좁은 화면은 ☰로 여는 서랍(#side)
import { IS_MAIN } from '../config.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const WIDE = matchMedia('(min-width: 961px)');
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';

const store = {
  get: () => { try { return localStorage.getItem('adminSide'); } catch { return null; } },
  set: (v) => { try { localStorage.setItem('adminSide', v); } catch { /* 저장 안 돼도 화면은 그대로 */ } },
};

function link(a, cls) {
  const out = document.createElement('a');
  out.className = 'side-link';
  out.href = a.getAttribute('href');
  if (a.target) { out.target = a.target; out.rel = a.rel; }
  const ic = a.querySelector('.hub-ic svg');
  out.innerHTML = `<i class="side-ic ${cls}" aria-hidden="true">${ic ? ic.outerHTML : ''}</i><span></span>`;
  out.querySelector('span').textContent = a.querySelector('b').textContent;
  const badge = a.querySelector('.hub-badge');
  if (badge) out.insertAdjacentHTML('beforeend', `<em class="side-badge hidden" data-for="${badge.id}"></em>`);
  // 다른 화면으로 가는 항목(검사·발표·모둠 편성·학생 화면)은 작은 화살표
  if (!out.getAttribute('href').startsWith('#')) out.insertAdjacentHTML('beforeend', `<i class="side-ext" aria-hidden="true">${ARROW}</i>`);
  return out;
}

// 묶음(수업·학생·점수·설정): #hub의 hub-group 하나 = 위 칸 하나. 묶음 안 화면은 왼쪽 목록(#subnav)
const groups = () => [...document.querySelectorAll('#hub .hub-group')];
const itemsOf = (g) => [...g.querySelectorAll('.hub-item:not([data-hide-menu])')];
export function groupOf(key) {
  if (!key) return null;
  return groups().find((g) => g.querySelector(`.hub-item[href="#${CSS.escape(key)}"]`)) || null;
}
const CHEV = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5"/></svg>';

// 위 메뉴: 왼쪽 '관리', 가운데 묶음 4칸(누르면 그 묶음 첫 화면), 오른쪽 검사·[선생님] 메뉴·[수업 시작]
function initTop() {
  const top = $('topnav');
  const app = window.webkit?.messageHandlers?.scienceApp; // 맥 앱 '과학 관리'에서 열었을 때만 [배포]
  top.innerHTML = `<a class="tn-brand" href="#">관리</a><nav class="tn-nav" aria-label="관리 메뉴"></nav>
    <div class="tn-right"><a class="tn-ghost" href="check.html">검사 ${ARROW}</a>
      <div class="tn-acct">
        <button class="tn-ghost" type="button" id="tn-acct-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="tn-acct-menu">선생님 ${CHEV}</button>
        <div class="tn-acct-menu" id="tn-acct-menu" role="menu" hidden>
          <a role="menuitem" href="../index.html" target="_blank" rel="noopener">학생 화면 열기 ${ARROW}</a>
          ${IS_MAIN ? '' : `<a role="menuitem" href="guide.html" target="_blank" rel="noopener">안내 ${ARROW}</a>`}
          ${app ? '<button role="menuitem" type="button" id="tn-deploy">배포</button>' : ''}
          <hr>
          <button role="menuitem" type="button" data-logout>로그아웃</button>
        </div>
      </div>
      <a class="tn-pill" href="#lessons">수업 시작 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a></div>`;
  const nav = top.querySelector('.tn-nav');
  groups().forEach((g) => {
    const first = itemsOf(g)[0];
    if (!first) return;
    const a = document.createElement('a');
    a.className = 'tn-tab';
    a.href = first.getAttribute('href');
    a.dataset.group = g.dataset.group;
    a.innerHTML = '<span></span><em class="tn-badge hidden"></em>';
    a.firstChild.textContent = g.querySelector('.hub-label').textContent;
    nav.append(a);
  });
  $('tn-deploy')?.addEventListener('click', () => app.postMessage({ cmd: 'deploy' }));
  const btn = $('tn-acct-btn');
  const menu = $('tn-acct-menu');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', () => { menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
  menu.addEventListener('click', (e) => { if (e.target.closest('[role="menuitem"]')) close(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.tn-acct')) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
}

// 왼쪽 목록: 지금 묶음의 화면들 (화면이 하나뿐인 묶음·수업 시작에서는 숨김)
function renderSub(key) {
  const sub = $('subnav');
  const g = groupOf(key);
  const items = g ? itemsOf(g) : [];
  const show = items.length > 1;
  document.body.classList.toggle('has-sub', show);
  if (!show) { sub.innerHTML = ''; return; }
  sub.innerHTML = '';
  items.forEach((it) => {
    const a = document.createElement('a');
    a.className = 'sn-link';
    a.href = it.getAttribute('href');
    a.innerHTML = '<span></span>';
    a.firstChild.textContent = it.querySelector('b').textContent;
    const badge = it.querySelector('.hub-badge');
    if (badge) a.insertAdjacentHTML('beforeend', `<em class="side-badge hidden" data-for="${badge.id}"></em>`);
    if (!a.getAttribute('href').startsWith('#')) a.insertAdjacentHTML('beforeend', `<i class="side-ext" aria-hidden="true">${ARROW}</i>`);
    if (a.getAttribute('href') === `#${key}`) a.setAttribute('aria-current', 'page');
    sub.append(a);
  });
  syncSideBadges();
}

export function initSide() {
  initTop();
  const side = $('side');
  side.innerHTML = `
    <div class="side-top"><a class="side-home" href="#">관리</a>
      <button type="button" class="side-x" id="side-close" aria-label="사이드바 접기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15M15.5 10l-2 2 2 2"/></svg></button>
    </div>
    <nav class="side-nav" aria-label="관리 메뉴"></nav>
    ${IS_MAIN ? '' : '<a class="side-link side-out" href="guide.html" target="_blank" rel="noopener"><i class="side-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg></i><span>안내</span></a>'}
    <button class="side-link side-out" type="button" data-logout><i class="side-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h10"/></svg></i><span>로그아웃</span></button>`;
  const nav = side.querySelector('.side-nav');
  side.querySelector('.side-home').addEventListener('click', () => root.classList.remove('side-drawer'));
  document.querySelectorAll('#hub .hub-group').forEach((g) => {
    const cls = [...g.classList].find((c) => c.startsWith('g-')) || '';
    const sec = document.createElement('div');
    sec.className = `side-group ${cls}`;
    sec.innerHTML = '<h2 class="side-label"></h2>';
    sec.firstChild.textContent = g.querySelector('.hub-label').textContent;
    g.querySelectorAll('.hub-item:not([data-hide-menu])').forEach((a) => sec.append(link(a, cls)));
    nav.append(sec);
  });

  const closeDrawer = () => root.classList.remove('side-drawer');
  $('side-open').addEventListener('click', () => {
    if (WIDE.matches) { root.classList.remove('side-closed'); store.set('open'); }
    else root.classList.add('side-drawer');
  });
  $('side-close').addEventListener('click', () => {
    if (WIDE.matches) { root.classList.add('side-closed'); store.set('closed'); }
    else closeDrawer();
  });
  $('side-scrim').addEventListener('click', closeDrawer);
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) closeDrawer(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('side-drawer')) closeDrawer(); });
  WIDE.addEventListener('change', closeDrawer);
  if (store.get() === 'closed') root.classList.add('side-closed');
  syncSideBadges();
}

// 지금 연 항목 표시 (key: 주소의 # 뒤, 첫 화면은 '')
export function markSide(key) {
  document.querySelectorAll('#side .side-link[href]').forEach((a) => {
    const h = a.getAttribute('href');
    if (h.startsWith('#') && h.slice(1) === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const g = groupOf(key);
  document.querySelectorAll('#topnav .tn-tab').forEach((t) => {
    if (g && t.dataset.group === g.dataset.group) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  renderSub(key);
}

// 기다리는 신청 수(닉네임·구매)를 위 칸·왼쪽 목록·서랍에 숫자로
export function syncSideBadges() {
  document.querySelectorAll('#side .side-badge, #subnav .side-badge').forEach((b) => {
    const src = $(b.dataset.for);
    b.textContent = src?.textContent || '';
    b.classList.toggle('hidden', !src || src.classList.contains('hidden'));
  });
  document.querySelectorAll('#topnav .tn-tab').forEach((t) => {
    const g = groups().find((x) => x.dataset.group === t.dataset.group);
    const n = [...(g?.querySelectorAll('.hub-badge:not(.hidden)') ?? [])].reduce((sum, b) => sum + (Number(b.textContent) || 0), 0);
    const em = t.querySelector('.tn-badge');
    em.textContent = n || '';
    em.classList.toggle('hidden', !n);
    t.setAttribute('aria-label', n ? `${t.firstChild.textContent} (기다리는 신청 ${n}개)` : t.firstChild.textContent);
  });
}
