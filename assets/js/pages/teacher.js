// 관리 화면: 첫 화면은 항목 카드, 누르면 그 항목만(#lessons #boards #mats #progress #ai #roster #nick #buys #shopset #grant #coins #points #data #lock #omok #presets)
// 수업 시작(차시 창 → 반 → 수업 모드, 학습지 올리기), 반 게시판(반마다 섹션·자료), 보드 만들기(여러 반 한 번에)·오늘 보드 지정·보관, 명단·코드 발급, 닉네임 승인·반별 닉네임 고치기, 구매 승인, 상점 설정,
// 포인트 규칙·레벨 기준, CSV 내보내기·학기말 정리, 반별 잠금, 빠른 피드백 버튼
import { CLASSES, TEACHER_CLASSES, TEST_CLASS, GRADE, IS_MAIN, clsName } from '../config.js';
import { initUI, toast, esc } from '../ui.js';
import {
  listClasses, listBoards, createBoards, updateBoard, deleteBoard, setLessonSims, setTodayBoard, cleanupPostPhotos,
  listStudents, setRosterSize, updateStudent, issueCodes, resetCode, listSignup, setClassSignup,
  listPresets, addPreset, deletePreset, listNicknameRequests, decideNickname, listNicknames, setNickname, setClassLock,
  listPurchases, decidePurchase, listAvatarItems, updateAvatarItem, listShopItems, updateShopItem,
  getPointRules, savePointRules, getWorksheetRules, saveWorksheetRules, getWsFirstRules, saveWsFirstRules, getQuizRules, saveQuizRules, getQuizShowRules, saveQuizShowRules, getLevelThresholds, saveLevelThresholds, grantPoints, listGrants, getCoinStatus,
  listArchivedBoards, archiveBoards, exportPointEvents, exportPurchases,
  listLessons, saveLesson, deleteLesson, sendClassRefresh,
  listWorksheets, saveWorksheet, countWorksheetAnswers,
  getAwayStats,
} from '../db.js';
import { PARTS, SLOTS, SLOT_NAMES } from '../avatar-parts.js';
import { avatarSVG, normalize } from '../avatar.js';
import { teacherGate, errMsg } from '../gate.js';
import { parseWorksheet, renderPage, closeSims, simHref, TYPE_NAME } from '../worksheet.js';
import { refreshMats } from './teacher-mats.js';
import { refreshProgress, todayPlan } from './teacher-progress.js';
import { refreshAi } from './teacher-ai.js';
import { initSide, markSide, syncSideBadges } from './teacher-side.js';
import { startHero, stopHero, showToday } from './teacher-hero.js';

initUI();

const $ = (id) => document.getElementById(id);

let classes = [];
let boards = [];
let lessonMeta = [];   // 보드 화면 진도(쪽 수)·차시 제목
let students = [];
let presets = [];

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const boardLabel = (b) => [`${b.lesson_code}차시`, b.title, fmtDate(b.created_at)].filter(Boolean).join(' · ');

/* ---------- 시뮬레이션 링크 줄 ---------- */
// %EC%82... 처럼 바뀐 주소를 한글로 보여 준다 (저장할 때 다시 확인)
const readableUrl = (url) => { try { return decodeURI(url || '').normalize('NFC'); } catch { return url || ''; } };

function addSimRow(container, sim = { name: '', url: '' }) {
  const row = document.createElement('div');
  row.className = 'sim-row';
  row.innerHTML = `
    <input class="input sim-name" placeholder="이름" value="${esc(sim.name)}" aria-label="시뮬레이션 이름">
    <input class="input sim-url" placeholder="https://" value="${esc(readableUrl(sim.url))}" aria-label="시뮬레이션 주소">
    <button type="button" class="btn btn-line icon-btn sim-del" style="width:44px;height:44px;padding:0" aria-label="이 링크 지우기">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`;
  row.querySelector('.sim-del').addEventListener('click', () => row.remove());
  container.append(row);
}

// 같은 사이트(a11y526.github.io)의 주소가 열리는지 확인하고, 안 열리면 한글 파일 이름을 다른 방식으로 바꿔 본다.
// 맥에서 올린 파일은 한글이 자모로 나뉜 이름(NFD)으로 저장돼, 보통 입력한 주소(NFC)로는 404가 난다.
// 결과: { url, ok } (ok: true 열림, false 안 열림, null 다른 사이트라 확인 못 함)
async function checkSimUrl(url) {
  const u = new URL(url);
  if (u.origin !== location.origin) return { url, ok: null };
  const opens = async (x) => {
    try { return (await fetch(x, { method: 'HEAD', cache: 'no-store' })).ok; } catch { return false; }
  };
  if (await opens(url)) return { url, ok: true };
  let path;
  try { path = decodeURIComponent(u.pathname); } catch { return { url, ok: false }; }
  for (const form of ['NFD', 'NFC']) {
    const alt = new URL(url);
    alt.pathname = path.normalize(form);
    if (alt.href !== u.href && await opens(alt.href)) return { url: alt.href, ok: true };
  }
  return { url, ok: false };
}

// 반환: 링크 배열, 잘못된 주소가 있거나 저장을 그만두면 null
async function readSims(container) {
  const out = [];
  for (const row of container.querySelectorAll('.sim-row')) {
    const name = row.querySelector('.sim-name').value.trim();
    let url = row.querySelector('.sim-url').value.trim();
    if (!name && !url) continue;
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch {
      toast('시뮬레이션 주소를 확인해 주세요', 'error');
      row.querySelector('.sim-url').focus();
      return null;
    }
    const chk = await checkSimUrl(url);
    if (chk.ok === false && !confirm(`이 주소가 열리지 않아요(404). 그래도 저장할까요?\n${url}`)) {
      row.querySelector('.sim-url').focus();
      return null;
    }
    out.push({ name: name || new URL(url).hostname, url: chk.url });
  }
  return out;
}

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add-sim]');
  if (add) addSimRow(add.closest('.field').querySelector('[data-sims]'));
});

/* ---------- 오늘 보드 ---------- */
function renderToday() {
  $('today-list').innerHTML = `<table class="nd-table"><thead><tr><th>반</th><th>오늘 보드</th><th></th></tr></thead><tbody>${
    classes.map((c) => {
      const opts = boards.filter((b) => b.class_id === c.id)
        .map((b) => `<option value="${b.id}" ${b.id === c.today_board_id ? 'selected' : ''}>${esc(boardLabel(b))}</option>`)
        .join('');
      return `<tr>
        <td style="width:64px">${clsName(c.id)}반</td>
        <td><select class="nd-ghost${c.today_board_id ? '' : ' dim'}" data-today="${c.id}" aria-label="${clsName(c.id)}반 오늘 보드">
          <option value="" ${c.today_board_id ? '' : 'selected'}>없음</option>${opts}
        </select></td>
        <td><div class="nd-row-acts">
          <a class="nd-btn" href="../class.html?c=${c.id}" target="_blank" rel="noopener">반 페이지 ↗</a>
          <a class="nd-btn" href="groups.html?c=${c.id}">모둠</a>
          <a class="nd-btn" href="reveal.html?c=${c.id}">발표</a>
        </div></td>
      </tr>`;
    }).join('')}</tbody></table>`;
  updateHub();
}

$('today-list').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-today]');
  if (!sel) return;
  const classId = Number(sel.dataset.today);
  sel.disabled = true;
  try {
    await setTodayBoard(classId, sel.value || null);
    toast(`${clsName(classId)}반 오늘 보드를 바꿨어요`, 'ok');
    await refresh();
  } catch (err) {
    toast(errMsg(err), 'error');
    sel.disabled = false;
  }
});

/* ---------- 보드 목록 ---------- */
const isToday = (b) => classes.some((c) => c.today_board_id === b.id);

function renderBoards() {
  const todayIds = new Set(classes.map((c) => c.today_board_id).filter(Boolean));
  const groups = new Map();
  for (const b of boards) {
    const key = `${b.lesson_code}|${b.title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  if (!groups.size) {
    $('board-groups').innerHTML = '<div class="nd-empty">아직 만든 보드가 없어요</div>';
    return;
  }
  const pages = (b) => {
    const total = lessonMeta.find((l) => l.code === b.lesson_code)?.slide_count;
    if (!b.slide_max) return '<span class="muted">—</span>';
    return total ? `${Math.min(b.slide_max, total)}/${total}쪽` : `${b.slide_max}쪽까지`;
  };
  $('board-groups').innerHTML = `<table class="nd-table"><thead><tr><th>반</th><th>상태</th><th>오늘 보드</th><th>진도</th><th>만든 날</th><th></th></tr></thead><tbody>${
    [...groups.entries()].map(([key, list]) => {
      list.sort((a, b) => a.class_id - b.class_id);
      const allToday = list.every((b) => todayIds.has(b.id));
      const name = lessonMeta.find((l) => l.code === list[0].lesson_code)?.title;
      return `
        <tr class="nd-group">
          <td colspan="5">${esc(list[0].lesson_code)}${list[0].title ? ' · ' + esc(list[0].title) : name && name !== list[0].lesson_code ? ' ' + esc(name) : ''}
            <span class="muted" style="font-weight:400;margin-left:6px">${list.length}개</span></td>
          <td><div class="nd-row-acts"><details class="nd-menu"><summary aria-label="${esc(list[0].lesson_code)}차시 메뉴">⋯</summary><div class="nd-menu-list">
            <button type="button" class="nd-btn" data-group-today="${esc(key)}" ${allToday ? 'disabled' : ''}>${allToday ? '모두 오늘 보드예요' : '이 차시를 오늘 보드로'}</button>
            <button type="button" class="nd-btn" data-group-archive="${esc(key)}" ${allToday ? 'disabled' : ''}>보관 (오늘 보드는 빼고)</button>
          </div></details></div></td>
        </tr>
        ${list.map((b) => `
          <tr>
            <td style="width:64px">${clsName(b.class_id)}반</td>
            <td>${b.status === 'revealed' ? '<span class="nd-tag green">발표함</span>' : '<span class="nd-tag line">진행 중</span>'}</td>
            <td>${todayIds.has(b.id) ? '<span class="nd-tag gray">오늘</span>' : ''}</td>
            <td>${pages(b)}</td>
            <td class="muted">${fmtDate(b.created_at)}</td>
            <td><div class="nd-row-acts"><details class="nd-menu"><summary aria-label="${clsName(b.class_id)}반 보드 메뉴">⋯</summary><div class="nd-menu-list">
              <button type="button" class="nd-btn" data-edit="${b.id}">수정</button>
              <button type="button" class="nd-btn" data-away="${b.id}">딴 화면 기록</button>
              <button type="button" class="nd-btn danger" data-del="${b.id}">삭제</button>
            </div></details></div></td>
          </tr>`).join('')}`;
    }).join('')}</tbody></table>`;
}

$('board-groups').addEventListener('click', async (e) => {
  if (e.target.closest('.nd-menu-list button')) e.target.closest('details')?.removeAttribute('open');
  const groupBtn = e.target.closest('[data-group-today]');
  const archiveBtn = e.target.closest('[data-group-archive]');
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-del]');

  if (groupBtn) {
    const key = groupBtn.dataset.groupToday;
    const list = boards.filter((b) => `${b.lesson_code}|${b.title}` === key);
    groupBtn.disabled = true;
    try {
      // 같은 반에 같은 차시 보드가 여러 개면 가장 최근 것
      const latest = new Map();
      for (const b of list) if (!latest.has(b.class_id)) latest.set(b.class_id, b);
      for (const b of latest.values()) await setTodayBoard(b.class_id, b.id);
      toast(`${clsName([...latest.keys()].sort((a, b) => a - b).join(', '))}반 오늘 보드를 바꿨어요`, 'ok');
    } catch (err) { toast(errMsg(err), 'error'); }
    await refresh();
  }

  if (archiveBtn) {
    const key = archiveBtn.dataset.groupArchive;
    const ids = boards.filter((b) => `${b.lesson_code}|${b.title}` === key && !isToday(b)).map((b) => b.id);
    if (!ids.length) return;
    archiveBtn.disabled = true;
    try {
      await archiveBoards(ids);
      toast(`보드 ${ids.length}개를 보관했어요`, 'ok');
    } catch (err) { toast(errMsg(err), 'error'); }
    await refresh();
  }

  if (editBtn) openEdit(boards.find((b) => b.id === editBtn.dataset.edit));

  const awayBtn = e.target.closest('[data-away]');
  if (awayBtn) openAway(boards.find((b) => b.id === awayBtn.dataset.away));

  if (delBtn) {
    const b = boards.find((x) => x.id === delBtn.dataset.del);
    if (!b || !confirm(`${clsName(b.class_id)}반 ${b.lesson_code}차시 보드를 삭제할까요?`)) return;
    try {
      await deleteBoard(b.id);
      toast('삭제했어요', 'ok');
    } catch (err) { toast(errMsg(err), 'error'); }
    await refresh();
  }
});

/* ---------- 보드 만들기 ---------- */
function renderCreateForm() {
  $('class-picks').innerHTML = TEACHER_CLASSES.map((n) => `
    <label class="check"><input type="checkbox" data-include="${n}"${n === TEST_CLASS ? '' : ' checked'}> ${clsName(n)}반</label>`).join('');
  const sims = $('create').querySelector('[data-sims]');
  sims.innerHTML = '';
  addSimRow(sims);
}

// 시뮬레이션 링크는 차시마다 같다: 차시를 넣으면 그 차시 보드에 있던 링크를 채운다(링크 칸이 비어 있을 때만)
const lessonSims = (code) => boards.find((b) => b.lesson_code === code && b.sim_links?.length)?.sim_links ?? null;

$('create').lesson_code.addEventListener('change', (e) => {
  const sims = $('create').querySelector('[data-sims]');
  const filled = [...sims.querySelectorAll('.sim-row')].some((r) => r.querySelector('.sim-name').value.trim() || r.querySelector('.sim-url').value.trim());
  const found = lessonSims(e.target.value.trim());
  if (filled || !found) return;
  sims.innerHTML = '';
  found.forEach((s) => addSimRow(sims, s));
});

$('create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const lesson_code = f.lesson_code.value.trim();
  const title = f.elements.title.value.trim();
  const sim_links = await readSims(f.querySelector('[data-sims]'));
  if (!sim_links) return;

  const items = [];
  for (const n of TEACHER_CLASSES) {
    if (!f.querySelector(`[data-include="${n}"]`).checked) continue;
    items.push({ class_id: n });
  }
  if (!items.length) { toast('반을 하나 이상 골라 주세요', 'error'); return; }

  const btn = f.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    await createBoards({ lesson_code, title, sim_links, items, setToday: f.set_today.checked });
    if (sim_links.length) await setLessonSims(lesson_code, sim_links);
    toast(`${items.length}개 반에 보드를 만들었어요`, 'ok');
    $('create-dlg').close();
    f.reset();
    renderCreateForm();
    await refresh();
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

// 보기 탭 (차시별 · 오늘 보드), 마지막 탭 기억
let bdView = (() => { try { return localStorage.getItem('bdView') || 'list'; } catch { return 'list'; } })();
function renderBdView() {
  document.querySelectorAll('[data-bd-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.bdView === bdView)));
  $('board-groups').classList.toggle('hidden', bdView !== 'list');
  $('today-list').classList.toggle('hidden', bdView !== 'today');
}
document.querySelectorAll('[data-bd-view]').forEach((b) => b.addEventListener('click', () => {
  bdView = b.dataset.bdView;
  try { localStorage.setItem('bdView', bdView); } catch {}
  renderBdView();
}));
renderBdView();
$('bd-new').addEventListener('click', () => $('create-dlg').showModal());
$('create-cancel').addEventListener('click', () => $('create-dlg').close());
// 메뉴 밖을 누르면 닫기
document.addEventListener('click', (e) => {
  for (const m of document.querySelectorAll('[data-panel="boards"] .nd-menu[open]')) if (!m.contains(e.target)) m.removeAttribute('open');
});

/* ---------- 보드 수정 ---------- */
let editing = null;
const editForm = $('edit-form');

function openEdit(b) {
  if (!b) return;
  editing = b;
  $('edit-title').textContent = `${clsName(b.class_id)}반 보드 수정`;
  editForm.lesson_code.value = b.lesson_code;
  editForm.elements.title.value = b.title;
  const sims = editForm.querySelector('[data-sims]');
  sims.innerHTML = '';
  (b.sim_links?.length ? b.sim_links : [{ name: '', url: '' }]).forEach((s) => addSimRow(sims, s));
  $('edit').showModal();
}

$('edit-cancel').addEventListener('click', () => $('edit').close());

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editing) return;
  const sim_links = await readSims(editForm.querySelector('[data-sims]'));
  if (!sim_links) return;
  try {
    const lesson_code = editForm.lesson_code.value.trim();
    await updateBoard(editing.id, {
      lesson_code,
      title: editForm.elements.title.value.trim(),
      sim_links,
    });
    await setLessonSims(lesson_code, sim_links);
    toast(`저장했어요 (시뮬레이션 링크는 ${lesson_code}차시 모든 반에)`, 'ok');
    $('edit').close();
    await refresh();
  } catch (err) {
    toast(errMsg(err), 'error');
  }
});

/* ---------- 명단 ---------- */
let rosterClass = TEACHER_CLASSES[0];
try { const v = Number(localStorage.getItem('nickClass')); if (TEACHER_CLASSES.includes(v)) rosterClass = v; } catch {}

let codesShown = false; // 프로젝터에 비칠 수 있어 평소엔 가림
// 반 고르기 줄 (학생 명단·학생별 점수 공통 모양: 고른 반 = 검정)
function segTabs(cur, attr, counts) {
  return TEACHER_CLASSES.map((n) => `
    <button type="button" role="tab" class="seg${n === cur ? ' on' : ''}" aria-selected="${n === cur}" ${attr}="${n}">${clsName(n)}반${counts ? ` <small class="num">${counts.get(n)}</small>` : ''}</button>`).join('');
}

function renderRoster() {
  const counts = new Map(TEACHER_CLASSES.map((n) => [n, 0]));
  for (const s of students) if (s.active) counts.set(s.class_id, (counts.get(s.class_id) || 0) + 1);
  $('roster-tabs').innerHTML = segTabs(rosterClass, 'data-tab', counts);
  $('roster-cls').textContent = `${clsName(rosterClass)}반`;

  const list = students.filter((s) => s.class_id === rosterClass)
    .sort((a, b) => (b.active - a.active) || (a.number - b.number));
  const active = list.filter((s) => s.active);
  const missing = active.filter((s) => !s.has_code).length;
  $('roster-count').textContent = active.length ? `${active.length}명 · 코드 없음 ${missing}명` : '';
  $('issue-missing').disabled = !missing;
  $('issue-all').disabled = !active.length;
  $('codes-toggle').textContent = codesShown ? '코드 숨기기' : '코드 보기';
  $('codes-toggle').disabled = !active.some((s) => s.has_code);
  $('codes-sheet').disabled = !active.some((s) => s.code);

  const nickOf = new Map(nickAll.map((x) => [x.id, x]));
  $('roster-list').innerHTML = list.length ? list.map((s) => {
    const n = nickOf.get(s.id);
    const nick = n
      ? `<form class="nick-edit" data-nsid="${s.id}">
          <input class="input" name="nick" maxlength="8" value="${esc(n.nickname ?? '')}" placeholder="닉네임 미정" aria-label="${s.number}번 닉네임" autocomplete="off">
          ${n.nickname_status === 'pending' && n.nickname_request ? `<span class="req-tag">신청: ${esc(n.nickname_request)}</span>` : ''}
          <button type="submit" class="btn btn-primary btn-small" hidden>저장</button>
        </form>`
      : `<span class="muted">${s.active ? '…' : '명단에서 뺌'}</span>`;
    const code = !s.active ? ''
      : s.has_code ? `<span class="code-dots num${s.code || !codesShown ? '' : ' muted'}">${codesShown ? esc(s.code || '모름') : '••••••'}</span>`
      : '<span class="tag tag-warn">코드 없음</span>';
    const menu = s.active
      ? '<button type="button" data-reset>코드 다시 발급</button><button type="button" class="danger" data-off>명단에서 빼기</button>'
      : '<button type="button" data-on>되살리기</button>';
    return `<tr class="${s.active ? '' : 'off'}" data-sid="${s.id}">
      <td class="num b">${s.number}번</td>
      <td>${nick}</td>
      <td>${code}</td>
      <td class="r"><details class="more-menu row-menu"><summary class="btn btn-ghost icon-only" aria-label="${s.number}번 더 보기"><svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="14" cy="9" r="1.5"/></svg></summary><div class="more-list">${menu}</div></details></td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="muted">명단이 없어요</td></tr>';
  renderLocks();
  updateHub();
}

async function refreshStudents() {
  students = await listStudents();
  renderRoster();
  renderRosterSize();
  refreshSignup();
}

/* ---------- 학번으로 첫 가입 (다른 선생님 사이트만) ---------- */
let signupUntil = new Map(); // 반 → 열린 끝 시각(ms)

async function refreshSignup() {
  if (IS_MAIN) return;
  try {
    const rows = await listSignup();
    signupUntil = new Map(rows.map((r) => [r.id, r.signup_until ? Date.parse(r.signup_until) : 0]));
  } catch (err) {
    console.error(err);
  }
  renderSignup();
}

function renderSignup() {
  if (IS_MAIN) return;
  const n = rosterClass;
  const box = $('signup-box');
  box.classList.toggle('hidden', !CLASSES.includes(n));
  if (!CLASSES.includes(n)) return;
  const open = (signupUntil.get(n) || 0) > Date.now();
  const active = students.filter((s) => s.class_id === n && s.active);
  const done = active.filter((s) => s.has_code).length;
  $('signup-eg').textContent = `${GRADE}${String(n).padStart(2, '0')}01`;
  $('signup-state').textContent = !active.length ? '명단 먼저 (반별 마지막 번호)'
    : `${open ? '열림, 오늘 밤 12시까지' : '닫힘'} / 가입 ${done} / ${active.length}명`;
  const btn = $('signup-toggle');
  btn.textContent = open ? '가입 닫기' : '가입 열기';
  btn.className = `btn btn-small ${open ? 'btn-line' : 'btn-primary'}`;
  btn.disabled = !active.length;
}

if (!IS_MAIN) {
  // 가입이 열려 있고 이 칸이 보이는 동안 10초마다 가입 수를 다시 읽는다
  setInterval(() => {
    const panel = $('signup-box').closest('[data-panel]');
    if (document.hidden || panel.classList.contains('hidden') || $('signup-box').classList.contains('hidden')) return;
    if ((signupUntil.get(rosterClass) || 0) > Date.now()) refreshStudents().catch(() => {});
  }, 10000);
  $('signup-toggle').addEventListener('click', async (e) => {
    const n = rosterClass;
    const open = (signupUntil.get(n) || 0) > Date.now();
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await setClassSignup(n, !open);
      toast(`${clsName(n)}반 가입 ${open ? '닫힘' : '열림'}`, 'ok');
      await refreshStudents();
    } catch (err) {
      toast(errMsg(err), 'error');
      btn.disabled = false;
    }
  });
}

/* ---------- 반별 마지막 번호 ---------- */
function renderRosterSize() {
  $('roster-size-grid').innerHTML = CLASSES.map((n) => {
    const last = students.filter((s) => s.class_id === n && s.active).reduce((m, s) => Math.max(m, s.number), 0);
    return `
      <label class="roster-size-item">
        <span>${clsName(n)}반</span>
        <input class="input num" type="number" min="1" max="99" value="${last || ''}" data-last="${n}" aria-label="${clsName(n)}반 마지막 번호">
      </label>`;
  }).join('');
}

$('roster-size').addEventListener('submit', async (e) => {
  e.preventDefault();
  const changes = [];
  for (const input of $('roster-size-grid').querySelectorAll('[data-last]')) {
    const n = Number(input.dataset.last);
    const raw = input.value.trim();
    if (!raw) continue;
    const last = Number(raw);
    if (!Number.isInteger(last) || last < 1 || last > 99) {
      toast(`${clsName(n)}반 마지막 번호를 확인해 주세요`, 'error');
      input.focus();
      return;
    }
    const current = students.filter((s) => s.class_id === n && s.active).reduce((m, s) => Math.max(m, s.number), 0);
    if (last !== current) changes.push({ n, last, current });
  }
  if (!changes.length) { toast('바뀐 반이 없어요'); return; }
  const shrink = changes.filter((c) => c.last < c.current);
  if (shrink.length && !confirm(shrink.map((c) => `${clsName(c.n)}반 ${c.last + 1}~${c.current}번`).join(', ') + '을(를) 명단에서 뺄까요?')) return;

  const btn = e.currentTarget.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    for (const c of changes) await setRosterSize(c.n, c.last);
    toast(`${changes.map((c) => clsName(c.n) + '반').join(', ')} 명단을 저장했어요`, 'ok');
    rosterClass = changes[0].n;
    await refreshStudents();
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

$('roster-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;
  rosterClass = Number(tab.dataset.tab);
  try { localStorage.setItem('nickClass', String(rosterClass)); } catch {}
  renderRoster();
  renderSignup();
  refreshNickAll().catch((err) => toast(errMsg(err), 'error'));
});

$('roster-list').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-sid]');
  if (!row || !e.target.closest('[data-reset], [data-off], [data-on]')) return;
  e.target.closest('details')?.removeAttribute('open');
  const s = students.find((x) => x.id === row.dataset.sid);
  if (!s) return;
  const label = `${clsName(s.class_id)}반 ${s.number}번`;
  try {
    if (e.target.closest('[data-reset]')) {
      if (!confirm(`${label} 코드를 새로 만들까요? 지금 코드는 더 이상 쓸 수 없어요.`)) return;
      const code = await resetCode(s.id);
      showCodes([code], `${label} 새 코드`);
      await refreshStudents();
    } else if (e.target.closest('[data-off]')) {
      if (!confirm(`${label}을(를) 명단에서 뺄까요? 지금까지의 점수는 남아 있어요.`)) return;
      await updateStudent(s.id, { active: false });
      await refreshStudents();
    } else if (e.target.closest('[data-on]')) {
      await updateStudent(s.id, { active: true });
      await refreshStudents();
    }
  } catch (err) {
    toast(errMsg(err), 'error');
  }
});

/* ---------- 코드 발급 + A4 인쇄 ---------- */
async function issue(onlyMissing) {
  const n = rosterClass;
  if (!onlyMissing && !confirm(`${clsName(n)}반 학생 전체의 코드를 새로 만들까요? 지금 코드는 더 이상 쓸 수 없어요.`)) return;
  const btn = $(onlyMissing ? 'issue-missing' : 'issue-all');
  btn.disabled = true;
  try {
    const list = await issueCodes(n, onlyMissing);
    if (!list.length) toast('발급할 학생이 없어요', 'error');
    else showCodes(list, `${clsName(n)}반 코드 ${list.length}장`);
    await refreshStudents();
  } catch (err) {
    toast(errMsg(err), 'error');
    btn.disabled = false;
  }
}
$('codes-toggle').addEventListener('click', () => { codesShown = !codesShown; renderRoster(); });
// 반 코드표: 저장된 코드(학생이 정한 것·발급한 것)를 한 창에. 이 기능 전 코드는 '모름'이라 빠짐
$('codes-sheet').addEventListener('click', () => {
  const n = rosterClass;
  const active = students.filter((s) => s.class_id === n && s.active).sort((a, b) => a.number - b.number);
  const list = active.filter((s) => s.code).map((s) => ({ class_id: n, number: s.number, code: s.code }));
  if (!list.length) { toast('저장된 코드가 없어요', 'error'); return; }
  const unknown = active.filter((s) => s.has_code && !s.code).map((s) => s.number);
  const none = active.filter((s) => !s.has_code).map((s) => s.number);
  const note = [
    unknown.length ? `모름 ${unknown.join(', ')}번` : '',
    none.length ? `코드 없음 ${none.join(', ')}번` : '',
  ].filter(Boolean).join(' · ');
  showCodes(list, `${clsName(n)}반 코드 ${list.length}명`, note);
});
$('issue-missing').addEventListener('click', () => issue(true));
$('issue-all').addEventListener('click', () => issue(false));

function siteAddress() {
  const base = new URL('../', location.href);
  return (base.host + base.pathname).replace(/\/$/, '');
}

function showCodes(list, title, note = '') {
  $('codes-title').textContent = title;
  $('codes-note').textContent = note;
  $('codes-note').classList.toggle('hidden', !note);
  $('codes-preview').innerHTML = list.map((c) => `<span>${c.number}번 <b>${esc(c.code)}</b></span>`).join('');
  const site = esc(siteAddress());
  $('print-sheet').innerHTML = list.map((c) => `
    <div class="code-card">
      <div class="cc-top"><b>${GRADE}학년 ${clsName(c.class_id)}반 ${c.number}번</b></div>
      <div class="cc-code">${esc(c.code.slice(0, 3))} ${esc(c.code.slice(3))}</div>
      <div class="cc-bottom"><span class="cc-name">이름</span><span class="cc-url">${site}</span></div>
    </div>`).join('');
  $('codes-dlg').showModal();
}

$('codes-print').addEventListener('click', () => window.print());
$('codes-close').addEventListener('click', () => $('codes-dlg').close());

// 보드의 딴 화면 기록 (수업 모드가 열려 있던 동안 포털 화면을 벗어난 학생)
const awayDur = (sec) => sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
async function openAway(b) {
  if (!b) return;
  $('away-title').textContent = `${clsName(b.class_id)}반 ${b.lesson_code}차시 딴 화면 기록`;
  $('away-sum').textContent = '불러오는 중';
  $('away-rows').innerHTML = '';
  $('away-dlg').showModal();
  try {
    const st = await getAwayStats(b.id);
    const list = st?.list ?? [];
    $('away-sum').textContent = list.length ? `벗어난 학생 ${list.length}명 · 2초 넘게 벗어난 것만` : '기록이 없어요';
    $('away-rows').innerHTML = list.map((r) => `<li class="${r.away_now ? 'is-now' : ''}"><span class="rm-away-n">${r.number}번 · ${esc(r.nickname || '닉네임 미정')}</span><small class="num">${r.away_now ? '지금 벗어남 · ' : ''}${r.times}번 · ${awayDur(r.secs)}</small></li>`).join('');
  } catch (err) {
    $('away-sum').textContent = errMsg(err);
  }
}
$('away-close').addEventListener('click', () => $('away-dlg').close());
// Esc로 실수로 닫지 않게
$('codes-dlg').addEventListener('cancel', (e) => e.preventDefault());
// 닫으면 화면에서 평문 코드를 지운다
$('codes-dlg').addEventListener('close', () => {
  $('codes-preview').innerHTML = '';
  $('print-sheet').innerHTML = '';
});

/* ---------- 닉네임 승인 ---------- */
let nickReqs = [];

function renderNicks() {
  $('nick-count').textContent = nickReqs.length ? String(nickReqs.length) : '';
  $('nick-box').classList.toggle('hidden', !nickReqs.length);
  $('nick-list').innerHTML = nickReqs.map((s) => `
    <div class="req-row" data-nid="${s.id}">
      <b class="num">${clsName(s.class_id)}반 ${s.number}번</b>
      <span class="req-old">${s.nickname ? esc(s.nickname) : '닉네임 미정'}</span>
      <svg class="req-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 7h10M8 3l4 4-4 4"/></svg>
      <b class="req-new">${esc(s.nickname_request)}</b>
      <span class="req-btns">
        <button type="button" class="btn btn-ghost btn-small" data-reject>거절</button>
        <button type="button" class="btn btn-primary btn-small" data-approve>승인</button>
      </span>
    </div>`).join('');
  updateHub();
}

async function refreshNicks() {
  nickReqs = await listNicknameRequests();
  renderNicks();
}

$('nick-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-approve], [data-reject]');
  if (!btn) return;
  const row = btn.closest('[data-nid]');
  row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    await decideNickname(row.dataset.nid, btn.hasAttribute('data-approve'));
    nickReqs = nickReqs.filter((s) => s.id !== row.dataset.nid);
    renderNicks();
    refreshNickAll().catch(() => {});
  } catch (err) {
    toast(errMsg(err), 'error');
    await refreshNicks().catch(() => {});
  }
});

/* ---------- 닉네임 바로 고침: 학생 명단 표의 닉네임 칸 ---------- */
let nickAll = [];

async function refreshNickAll() {
  const cls = rosterClass;
  const rows = await listNicknames(cls);
  if (cls !== rosterClass) return;
  nickAll = rows.map((r) => ({ ...r, class_id: cls }));
  renderRoster();
}

$('roster-list').addEventListener('input', (e) => {
  const form = e.target.closest('form[data-nsid]');
  const s = nickAll.find((x) => x.id === form?.dataset.nsid);
  if (s) form.querySelector('button').hidden = e.target.value.trim() === (s.nickname ?? '');
});

$('roster-list').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const s = nickAll.find((x) => x.id === form.dataset.nsid);
  const input = form.querySelector('input');
  const btn = form.querySelector('button');
  const nick = input.value.trim();
  if (!s || btn.hidden) return;
  if (nick && (nick.length < 2 || nick.length > 8 || !/^[가-힣A-Za-z0-9]+$/.test(nick))) {
    toast('2~8자, 한글·영문·숫자만 돼요', 'error');
    return;
  }
  btn.disabled = input.disabled = true;
  try {
    const r = await setNickname(s.id, nick);
    if (!r?.ok) {
      toast(r?.error === 'TAKEN' ? '다른 학생이 쓰거나 신청 중인 닉네임이에요' : '2~8자, 한글·영문·숫자만 돼요', 'error');
      return;
    }
    s.nickname = r.nickname;
    if (s.nickname_status === 'pending') {
      nickReqs = nickReqs.filter((x) => x.id !== s.id);
      renderNicks();
    }
    s.nickname_status = r.nickname ? 'approved' : 'none';
    s.nickname_request = null;
    const num = students.find((x) => x.id === s.id)?.number ?? s.number;
    toast(`${num}번 ${r.nickname ? `'${r.nickname}'` : '닉네임 지움'}`, 'ok');
    renderRoster();
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    btn.disabled = input.disabled = false;
  }
});

/* ---------- 구매 승인 ---------- */
let buyReqs = [];
let buyDone = [];

const who = (p) => `${clsName(p.student?.class_id ?? '?')}반 ${p.student?.number ?? '?'}번`;
const buyWhat = (p) => esc(p.item?.name ?? p.item_id) +
  (p.item?.kind === 'pair' && p.partner_number ? ` · ${p.partner_number}번과 함께` : '');

function renderBuys() {
  $('buys-count').textContent = buyReqs.length ? String(buyReqs.length) : '';
  $('buys-list').innerHTML = buyReqs.length ? buyReqs.map((p) => `
    <div class="req-row" data-bid="${p.id}">
      <b class="num">${who(p)}</b>
      <b class="req-new">${buyWhat(p)}</b>
      <span class="req-old num">${p.cost}금화 · ${fmtDate(p.requested_at)}</span>
      <span class="req-btns">
        <button type="button" class="btn btn-ghost btn-small" data-reject>거절</button>
        <button type="button" class="btn btn-primary btn-small" data-approve>승인</button>
      </span>
    </div>`).join('') : '<p class="muted" style="margin:0">기다리는 신청이 없어요</p>';
  $('buys-done').innerHTML = buyDone.length ? buyDone.map((p) => {
    const ok = p.status === 'approved';
    const used = ok && p.item?.kind === 'pair' ? (p.used_board_id ? ' · 사용함' : ' · 아직 안 씀') : '';
    return `
    <div class="log-row">
      <span class="num muted">${fmtDate(p.decided_at || p.requested_at)}</span>
      <b class="num">${who(p)}</b>
      <span class="grow">${buyWhat(p)} <span class="muted num">${p.cost}금화</span></span>
      <span class="tag ${ok ? 'tag-done' : 'tag-warn'}">${ok ? '승인' : '거절 · 금화 돌려줌'}${used}</span>
    </div>`;
  }).join('') : '<p class="muted" style="margin:0">아직 처리한 신청이 없어요</p>';
  updateHub();
}

async function refreshBuys(withDone = false) {
  const [req, all] = await Promise.all([listPurchases('requested'), withDone ? listPurchases(null, 60) : null]);
  buyReqs = req;
  if (all) buyDone = all.filter((p) => p.status !== 'requested').slice(0, 30);
  renderBuys();
}

$('buys-refresh').addEventListener('click', () => refreshBuys(true).catch((err) => toast(errMsg(err), 'error')));

$('buys-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-approve], [data-reject]');
  if (!btn) return;
  const row = btn.closest('[data-bid]');
  row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    await decidePurchase(row.dataset.bid, btn.hasAttribute('data-approve'));
    await refreshBuys(true);
  } catch (err) {
    toast(errMsg(err), 'error');
    await refreshBuys(true).catch(() => {});
  }
});

/* ---------- 상점 설정: 보상과 꾸미기 아이템의 가격·판매 여부·등급·레벨 조건 ---------- */
let avItems = [];
let rewards = [];
let setSlot = 'hair';

const RARITY_OPTS = [['common', '일반'], ['rare', '희귀'], ['legend', '전설']];

function renderRewardsSet() {
  $('set-rewards').innerHTML = rewards.map((r) => `
    <div class="rw-row" data-rid="${esc(r.id)}">
      <input class="input" data-f="name" value="${esc(r.name)}" maxlength="20" aria-label="보상 이름">
      <label class="rw-cost"><input class="input num" type="number" min="0" max="9999" data-f="cost" value="${r.cost}" aria-label="${esc(r.name)} 가격"><span>금화</span></label>
      <label class="rw-on"><input type="checkbox" data-f="active"${r.active ? ' checked' : ''}> 판매</label>
    </div>`).join('') || '<p class="muted" style="margin:0">보상이 없어요</p>';
}

// 꾸미기: 칸별 카드(그림 · 이름 · 가격 · 등급), 누르면 오른쪽에서 가격·등급·레벨·판매를 고친다(바꾸면 바로 저장)
let setPick = null;
const RARITY_NAME = Object.fromEntries(RARITY_OPTS);
const thumb = (it, size) => (PARTS[it.slot]?.[it.id]
  ? avatarSVG(normalize({ [it.slot]: it.id }), size, { label: it.name })
  : '<span class="shop-noimg">그림 없음</span>');

function renderItemsSet() {
  const slots = SLOTS.filter((sl) => avItems.some((it) => it.slot === sl));
  if (!slots.includes(setSlot)) setSlot = slots[0];
  $('set-slot-tabs').innerHTML = slots.map((sl) => `
    <button type="button" role="tab" class="seg${sl === setSlot ? ' on' : ''}" aria-selected="${sl === setSlot}" data-sslot="${sl}">${SLOT_NAMES[sl]}</button>`).join('');
  const list = avItems.filter((it) => it.slot === setSlot);
  if (!list.some((it) => it.id === setPick)) setPick = list[0]?.id ?? null;
  $('set-items').innerHTML = list.map((it) => `
    <button type="button" class="shop-card${it.id === setPick ? ' on' : ''}${it.active ? '' : ' off'}" data-pick="${esc(it.id)}" aria-pressed="${it.id === setPick}">
      <span class="shop-thumb">${thumb(it, 96)}</span>
      <b>${esc(it.name)}</b>
      <span class="shop-meta"><span class="num">${it.price ? `${it.price} 은화` : '무료'}</span>${
        it.rarity !== 'common' ? `<span class="rar rar-${it.rarity}">${RARITY_NAME[it.rarity] ?? ''}</span>` : ''}${
        it.min_level > 1 ? `<span class="muted num">Lv.${it.min_level}</span>` : ''}${
        it.active ? '' : '<span class="tag tag-off">안 팖</span>'}</span>
    </button>`).join('');
  const it = list.find((x) => x.id === setPick);
  $('set-edit').innerHTML = it ? `
    <div class="shop-edit-h" data-aid="${esc(it.id)}"><span class="shop-thumb sm">${thumb(it, 56)}</span><div><b>${esc(it.name)}</b><small>${SLOT_NAMES[it.slot]}</small></div></div>
    <div class="shop-fields" data-aid="${esc(it.id)}">
      <label class="field"><span>가격 (은화, 0 = 기본 부품)</span><input class="input num" type="number" min="0" max="9999" data-f="price" value="${it.price}"></label>
      <div class="grid-2">
        <label class="field"><span>등급</span><select class="input" data-f="rarity">${RARITY_OPTS.map(([v, t]) => `<option value="${v}"${it.rarity === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span>레벨부터</span><input class="input num" type="number" min="1" max="99" data-f="min_level" value="${it.min_level}"></label>
      </div>
      <label class="rw-on big"><input type="checkbox" data-f="active"${it.active ? ' checked' : ''}> 판매</label>
    </div>` : '';
}

$('set-items').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  setPick = b.dataset.pick;
  renderItemsSet();
});
$('set-edit').addEventListener('submit', (e) => e.preventDefault());

async function refreshShopSet() {
  [avItems, rewards] = await Promise.all([listAvatarItems(), listShopItems()]);
  renderRewardsSet();
  renderItemsSet();
}

$('set-slot-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sslot]');
  if (!b) return;
  setSlot = b.dataset.sslot;
  renderItemsSet();
});

// 칸을 바꾸면 바로 저장
function fieldValue(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') {
    const n = Math.round(Number(el.value));
    const min = Number(el.min), max = Number(el.max);
    return Number.isFinite(n) && el.value !== '' ? Math.min(max, Math.max(min, n)) : null;
  }
  return el.value.trim();
}

async function saveField(el, list, idKey, update) {
  const row = el.closest(`[${idKey}]`);
  const item = list.find((x) => x.id === row.getAttribute(idKey));
  const f = el.dataset.f;
  const v = fieldValue(el);
  if (!item || v === null || v === '') { toast('값을 확인해 주세요', 'error'); return 'reset'; }
  if (item[f] === v) return;
  el.disabled = true;
  try {
    await update(item.id, { [f]: v });
    item[f] = v;
    toast('저장했어요', 'ok');
  } catch (err) {
    toast(errMsg(err), 'error');
    return 'reset';
  } finally {
    el.disabled = false;
  }
}

$('set-rewards').addEventListener('change', async (e) => {
  if (!e.target.dataset.f) return;
  if (await saveField(e.target, rewards, 'data-rid', updateShopItem) === 'reset') renderRewardsSet();
});
$('set-edit').addEventListener('change', async (e) => {
  if (!e.target.dataset.f) return;
  await saveField(e.target, avItems, 'data-aid', updateAvatarItem);
  renderItemsSet();
});

/* ---------- 점수 주기: 고른 학생에게 XP·금화 (음수면 빼기) ---------- */
let grantClass = TEACHER_CLASSES[0];
let grantPick = new Set(); // 고른 학생 id

const signed = (n, unit) => (n ? `${n > 0 ? '+' : '−'}${Math.abs(n)} ${unit}` : '');

function grantRoster() {
  return students.filter((s) => s.class_id === grantClass && s.active);
}

// 학생별 점수: 반 표(금화·은화·레벨)에서 체크로 고르고, 아래 줄에서 XP·금화를 준다
function renderGrant() {
  $('grant-tabs').innerHTML = segTabs(grantClass, 'data-gcls');
  const list = grantRoster();
  const coinOf = new Map(coinRows.filter((r) => r.class_id === grantClass).map((r) => [r.id, r]));
  $('grant-roll').innerHTML = list.length ? list.map((s) => {
    const c = coinOf.get(s.id);
    const on = grantPick.has(s.id);
    const cell = (v) => (c ? v : '');
    return `<tr class="${on ? 'pick' : ''}">
      <td class="ck"><input type="checkbox" data-gsid="${s.id}"${on ? ' checked' : ''} aria-label="${s.number}번 고르기"></td>
      <td class="num b">${s.number}번</td>
      <td>${c?.nickname ? `<b>${esc(c.nickname)}</b>` : '<span class="muted">닉네임 미정</span>'}</td>
      <td class="num muted">${cell(`Lv.${c?.level}`)}</td>
      <td class="num r b${c?.coins < 0 ? ' minus' : ''}">${cell(c?.coins)}</td>
      <td class="num r">${cell(c?.earned)}</td>
      <td class="num r">${cell(c?.spent)}</td>
      <td class="num r">${cell(c?.rewards)}${c?.pending ? ` <span class="wait">대기 ${c.pending}</span>` : ''}</td>
      <td class="num r muted">${cell(c?.silver ?? '')}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="muted">명단이 없어요</td></tr>';
  const all = $('grant-allck');
  all.checked = !!list.length && list.every((s) => grantPick.has(s.id));
  all.indeterminate = !all.checked && list.some((s) => grantPick.has(s.id));
  $('grant-count').textContent = `${grantPick.size}명`;
  $('grant-go').disabled = !grantPick.size;
  const rows = [...coinOf.values()];
  const sum = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
  $('coins-sum').textContent = rows.length
    ? `금화 = 받은 금화 − 뺀 금화 − 보상 신청(대기·승인) · ${clsName(grantClass)}반 합 ${sum('coins')} · 평균 ${Math.round(sum('coins') / rows.length)}${sum('pending') ? ` · 승인 기다리는 보상 ${sum('pending')}` : ''}`
    : '';
}

$('grant-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-gcls]');
  if (!b) return;
  grantClass = Number(b.dataset.gcls);
  grantPick = new Set();
  renderGrant();
  refreshCoins().catch((err) => toast(errMsg(err), 'error'));
});
$('grant-roll').addEventListener('change', (e) => {
  const b = e.target.closest('[data-gsid]');
  if (!b) return;
  if (b.checked) grantPick.add(b.dataset.gsid); else grantPick.delete(b.dataset.gsid);
  renderGrant();
});
$('grant-allck').addEventListener('change', (e) => {
  grantPick = e.target.checked ? new Set(grantRoster().map((s) => s.id)) : new Set();
  renderGrant();
});

$('grant-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const xp = Math.round(Number($('grant-xp').value) || 0);
  const coins = Math.round(Number($('grant-coins').value) || 0);
  const reason = $('grant-reason').value.trim();
  if (!grantPick.size) return toast('학생을 골라 주세요', 'error');
  if (!xp && !coins) return toast('XP나 금화를 넣어 주세요', 'error');
  const nums = grantRoster().filter((s) => grantPick.has(s.id)).map((s) => s.number);
  const what = [signed(xp, 'XP'), signed(coins, '금화')].filter(Boolean).join(', ');
  if (!confirm(`${clsName(grantClass)}반 ${nums.length}명(${nums.join(', ')}번)에게 ${what}\n사유: ${reason}`)) return;
  const btn = $('grant-go');
  btn.disabled = true;
  try {
    const res = await grantPoints([...grantPick], xp, coins, reason);
    toast(`${res.count}명에게 줬어요`, 'ok');
    grantPick = new Set();
    $('grant-xp').value = 0;
    $('grant-coins').value = 0;
    $('grant-reason').value = '';
    renderGrant();
    await Promise.all([refreshGrants(), refreshCoins()]);
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

async function refreshGrants() {
  const rows = await listGrants();
  $('grant-log').innerHTML = rows.length ? rows.map((g) => `
    <div class="log-row">
      <span class="num muted">${fmtDate(g.created_at)}</span>
      <b class="num">${clsName(g.student?.class_id ?? '?')}반 ${g.student?.number ?? '?'}번</b>
      <span class="grow">${esc(g.reason)}</span>
      <span class="num b">${[signed(g.xp, 'XP'), signed(g.coins, '금화')].filter(Boolean).join(' · ')}</span>
    </div>`).join('') : '<p class="muted" style="margin:0">아직 직접 준 점수가 없어요</p>';
}

/* ---------- 금화 현황: 학생별 점수 표의 금화·은화·레벨 칸 (get_coin_status) ---------- */
let coinRows = [];

async function refreshCoins() {
  const cls = grantClass;
  const rows = await getCoinStatus(cls);
  if (cls !== grantClass) return;
  coinRows = rows ?? [];
  renderGrant();
}

/* ---------- 포인트 규칙: 통과 기본·순위 보너스 (XP와 금화 따로) ---------- */
let pointRules = null;

function rulesFromForm() {
  const f = $('points-form').elements;
  const v = (k) => Math.min(1000, Math.max(0, Math.round(Number(f[k].value) || 0)));
  return {
    ...(pointRules ?? {}),
    pass_xp: v('pass_xp'),
    pass_coins: v('pass_coins'),
    rank_bonus: [v('bx0'), v('bx1'), v('bx2')],
    rank_bonus_coins: [v('bc0'), v('bc1'), v('bc2')],
  };
}

function renderPointsSum() {
  const r = rulesFromForm();
  $('points-sum').textContent = [0, 1, 2].map((i) =>
    `${i + 1}위 ${r.pass_xp + r.rank_bonus[i]} XP · ${r.pass_coins + r.rank_bonus_coins[i]}금화`).join('  /  ') +
    `  /  그 밖의 통과 ${r.pass_xp} XP · ${r.pass_coins}금화`;
}

/* 레벨 기준: Lv.1은 0 고정, 다음 레벨은 앞 레벨보다 커야 한다 */
const DEFAULT_LEVELS = [0, 30, 70, 120, 180, 250, 330, 420, 520, 630];
let savedLevels = DEFAULT_LEVELS;

function renderLevels(list) {
  $('level-grid').innerHTML = list.map((v, i) => `
    <label class="set-num"><span>Lv.${i + 1}</span><input class="input num" type="number" min="0" max="100000" step="1"
      data-lv="${i}" value="${v}" ${i === 0 ? 'disabled' : 'required'} aria-label="레벨 ${i + 1} 시작 XP"></label>`).join('');
  $('level-del').disabled = list.length <= 2;
}

const levelsFromForm = () => [...$('level-grid').querySelectorAll('[data-lv]')]
  .map((el, i) => (i === 0 ? 0 : Math.max(0, Math.round(Number(el.value) || 0))));

$('level-add').addEventListener('click', () => {
  const l = levelsFromForm();
  const gap = l.length >= 2 ? l[l.length - 1] - l[l.length - 2] + 10 : 30;
  renderLevels([...l, l[l.length - 1] + gap]);
});
$('level-del').addEventListener('click', () => {
  const l = levelsFromForm();
  if (l.length > 2) renderLevels(l.slice(0, -1));
});

let quizRules = {}; // settings.quiz_battle (xp·coins만 여기서 바꾼다)

async function refreshPoints() {
  const lv = await getLevelThresholds();
  savedLevels = Array.isArray(lv) && lv.length >= 2 ? lv.map(Number) : DEFAULT_LEVELS;
  renderLevels(savedLevels);
  const ws = (await getWorksheetRules()) ?? {};
  const wf = (await getWsFirstRules()) ?? {};
  quizRules = (await getQuizRules()) ?? {};
  const r = (await getPointRules()) ?? {};
  const bx = r.rank_bonus ?? [10, 6, 3];
  const bc = r.rank_bonus_coins ?? bx;
  pointRules = r;
  const f = $('points-form').elements;
  f.pass_xp.value = r.pass_xp ?? 10;
  f.pass_coins.value = r.pass_coins ?? 10;
  [0, 1, 2].forEach((i) => { f['bx' + i].value = bx[i] ?? 0; f['bc' + i].value = bc[i] ?? 0; });
  f.ws_xp.value = ws.xp ?? 10;
  f.ws_coins.value = ws.coins ?? 5;
  f.wf_xp.value = wf.xp ?? 1;
  f.wf_coins.value = wf.coins ?? 1;
  f.wf_draw.value = wf.draw ?? 50;
  f.qb_xp.value = quizRules.xp ?? 4;
  f.qb_coins.value = quizRules.coins ?? 4;
  const qs = (await getQuizShowRules()) ?? {};
  [0, 1, 2].forEach((i) => { f['qs_xp' + i].value = qs.xp?.[i] ?? [10, 6, 3][i]; f['qs_coins' + i].value = qs.coins?.[i] ?? [10, 6, 3][i]; });
  renderPointsSum();
  const hub = $('hub-points');
  if (hub) hub.textContent = `통과 ${f.pass_xp.value} XP · ${f.pass_coins.value}금화`;
}

$('points-form').addEventListener('input', renderPointsSum);
// 포인트 규칙 왼쪽 목록: 누르면 그 칸으로
$('points-form').querySelector('.pt-nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pt]');
  if (!b) return;
  $('points-form').querySelectorAll('[data-pt]').forEach((x) => x.classList.toggle('on', x === b));
  $(b.dataset.pt)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});
$('points-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.currentTarget.querySelector('[type="submit"]');
  const levels = levelsFromForm();
  const bad = levels.findIndex((v, i) => i > 0 && v <= levels[i - 1]);
  if (bad > 0) {
    toast(`Lv.${bad + 1}은 Lv.${bad}보다 커야 해요`, 'error');
    $('level-grid').querySelector(`[data-lv="${bad}"]`).focus();
    return;
  }
  // 기준을 올리면 지금 레벨이 내려가는 학생이 생길 수 있다 (레벨은 누적 XP로 그때그때 계산)
  const raised = levels.some((v, i) => i < savedLevels.length && v > savedLevels[i]) || levels.length < savedLevels.length;
  if (raised && !confirm('레벨 기준을 올리거나 줄이면 지금 레벨이 내려가는 학생이 생길 수 있어요. 저장할까요?')) return;
  btn.disabled = true;
  try {
    await savePointRules(rulesFromForm());
    const f = $('points-form').elements;
    const q = (k) => Math.min(1000, Math.max(0, Math.round(Number(f[k].value) || 0)));
    await saveWorksheetRules({ xp: q('ws_xp'), coins: q('ws_coins') });
    await saveWsFirstRules({ xp: q('wf_xp'), coins: q('wf_coins'), draw: Math.min(600, q('wf_draw')) });
    await saveQuizRules({ ...quizRules, xp: q('qb_xp'), coins: q('qb_coins') }); // 문제 시간은 그대로
    await saveQuizShowRules({ xp: [0, 1, 2].map((i) => q('qs_xp' + i)), coins: [0, 1, 2].map((i) => q('qs_coins' + i)) });
    if (levels.join() !== savedLevels.join()) await saveLevelThresholds(levels);
    await refreshPoints();
    toast('저장했어요', 'ok');
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

/* ---------- CSV 내보내기 ---------- */
// 시각은 한국 시간 'YYYY-MM-DD HH:MM'. 엑셀에서 한글이 깨지지 않게 맨 앞에 BOM
const KST = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const kst = (iso) => (iso ? KST.format(new Date(iso)) : '');
const cell = (v) => {
  if (typeof v === 'number') return String(v);
  let t = String(v ?? '');
  if (/^[=+\-@]/.test(t)) t = "'" + t; // 시트가 수식으로 읽지 않게
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

function downloadCSV(name, header, rows) {
  const text = '\uFEFF' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const todayKST = () => kst(new Date().toISOString()).slice(0, 10);
const studentCols = (st) => [st?.class_id ?? '', st?.number ?? '', st?.nickname ?? ''];

function eventKind(e) {
  if (e.board_id) return '순위 발표';
  if (e.worksheet_board_id || (e.reason || '').startsWith('학습지 ')) return '학습지';
  if (e.ws_first_id || (e.reason || '').startsWith('첫 답 ')) return '첫 답';
  if (e.qb_game_id || (e.reason || '').startsWith('퀴즈 배틀')) return '퀴즈 배틀';
  if (e.qs_game_id || (e.reason || '').startsWith('퀴즈 쇼')) return '퀴즈 쇼';
  if ((e.reason || '').startsWith('아이템:')) return '아이템 구매';
  if ((e.reason || '').startsWith('닉네임 ')) return '닉네임';
  if (e.reason === '은화 바꾸기') return '은화 바꾸기';
  return '직접 줌';
}

async function runExport(btn, job) {
  btn.disabled = true;
  try { await job(); } catch (err) { toast(errMsg(err), 'error'); } finally { btn.disabled = false; }
}

$('csv-points').addEventListener('click', (e) => runExport(e.currentTarget, async () => {
  const rows = await exportPointEvents();
  downloadCSV(`점수원장_${todayKST()}.csv`, ['시각', '반', '번호', '닉네임', 'XP', '금화', '은화', '종류', '사유'],
    rows.map((r) => [kst(r.created_at), ...studentCols(r.student), r.xp, r.coins, r.silver, eventKind(r), r.reason]));
  toast(`${rows.length}줄을 내보냈어요`, 'ok');
}));

const BUY_STATUS = { requested: '신청', approved: '승인', rejected: '거절' };
$('csv-buys').addEventListener('click', (e) => runExport(e.currentTarget, async () => {
  const rows = await exportPurchases();
  downloadCSV(`구매내역_${todayKST()}.csv`, ['신청 시각', '반', '번호', '닉네임', '품목', '금화', '상태', '함께할 친구 번호', '처리 시각'],
    rows.map((r) => [kst(r.requested_at), ...studentCols(r.student), r.item?.name ?? '', r.cost, BUY_STATUS[r.status] ?? r.status, r.partner_number ?? '', kst(r.decided_at)]));
  toast(`${rows.length}줄을 내보냈어요`, 'ok');
}));

/* ---------- 학기말 정리: 보드 보관 ---------- */
let archived = [];

function renderArchive() {
  const left = boards.filter((b) => !isToday(b)).length;
  $('archive-count').textContent = left ? `보관할 보드 ${left}개` : '보관할 보드가 없어요';
  $('archive-all').disabled = !left;
  $('archived-count').textContent = archived.length ? `${archived.length}개` : '';
  const groups = new Map();
  for (const b of archived) {
    const key = `${b.lesson_code}|${b.title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  $('archived-groups').innerHTML = groups.size ? [...groups.values()].map((list) => {
    list.sort((a, b) => a.class_id - b.class_id);
    return `
      <div class="board-group">
        <header>
          <b>${esc(list[0].lesson_code)}차시${list[0].title ? ' · ' + esc(list[0].title) : ''}</b>
          <span class="muted num" style="font-size:13px">${fmtDate(list[0].created_at)} · ${list.map((b) => b.class_id + '반').join(', ')}</span>
          <button type="button" class="btn btn-line btn-small" style="margin-left:auto" data-unarchive="${list.map((b) => b.id).join(',')}">되돌리기</button>
        </header>
      </div>`;
  }).join('') : '<p class="muted" style="margin:0">보관한 보드가 없어요</p>';
}

async function refreshArchive() {
  archived = await listArchivedBoards();
  renderArchive();
}

$('archive-all').addEventListener('click', async (e) => {
  const ids = boards.filter((b) => !isToday(b)).map((b) => b.id);
  if (!ids.length || !confirm(`오늘 보드를 뺀 보드 ${ids.length}개를 보관할까요?`)) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await archiveBoards(ids);
    toast(`보드 ${ids.length}개를 보관했어요`, 'ok');
  } catch (err) { toast(errMsg(err), 'error'); }
  await refresh();
  await refreshArchive().catch(() => {});
});

$('archived-groups').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-unarchive]');
  if (!btn) return;
  btn.disabled = true;
  try {
    await archiveBoards(btn.dataset.unarchive.split(','), false);
    toast('보드 목록으로 되돌렸어요', 'ok');
  } catch (err) { toast(errMsg(err), 'error'); }
  await refresh();
  await refreshArchive().catch(() => {});
});

/* ---------- 빠른 피드백 버튼 ---------- */
function renderPresets() {
  $('preset-list').innerHTML = presets.map((p) => `
    <span class="preset-item">
      ${esc(p.text)}
      <button type="button" class="preset-del" data-pdel="${p.id}" aria-label="${esc(p.text)} 지우기">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </span>`).join('');
  updateHub();
}

async function refreshPresets() {
  presets = await listPresets();
  renderPresets();
}

$('preset-list').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-pdel]');
  if (!del) return;
  try {
    await deletePreset(Number(del.dataset.pdel));
    await refreshPresets();
  } catch (err) { toast(errMsg(err), 'error'); }
});

$('preset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.currentTarget.elements.text;
  const text = input.value.trim();
  if (!text) return;
  try {
    await addPreset(text, presets.reduce((m, p) => Math.max(m, p.sort), 0) + 1);
    input.value = '';
    await refreshPresets();
  } catch (err) { toast(errMsg(err), 'error'); }
});

/* ---------- 수업 시작: 차시 창 (611, 612, …) ---------- */
// 창마다 수업자료 주소를 미리 저장해 두고, [수업 시작] → 반을 고르면 수업 모드(live.html)가 열린다.
// 보드에는 있는데 lessons 표에 없는 차시는 빈 주소의 창으로 보여 준다(saved: false, 저장하면 표에 들어감).
let lessons = [];
let sheets = new Map(); // 차시 → { title, page_count, field_count, updated_at }
let startOpen = null; // 반 버튼을 펼친 차시
let lessonsShown = false; // 처음 그릴 때만 등장 모션
const LIVE_CLASS = 'liveClass';
const byCode = (a, b) => String(a.code).localeCompare(String(b.code), 'ko', { numeric: true });

function lessonWindows() {
  const list = lessons.map((l) => ({ ...l, saved: true }));
  const known = new Set(list.map((l) => l.code));
  for (const b of boards) { // 최근 보드부터
    if (!b.lesson_code || known.has(b.lesson_code)) continue;
    known.add(b.lesson_code);
    list.push({ code: b.lesson_code, title: b.title || '', lesson_src: null, saved: false });
  }
  return list.sort(byCode);
}

// 이 반의 이 차시 보드 (여러 개면 가장 최근 것)
const lessonBoard = (classId, code) => boards.find((b) => b.class_id === classId && b.lesson_code === code) ?? null;

function renderLessons() {
  const wins = lessonWindows();
  const last = Number(localStorage.getItem(LIVE_CLASS)) || null;
  $('lesson-list').innerHTML = wins.length ? wins.map((l, i) => {
    const ready = !!l.lesson_src;
    const open = startOpen === l.code && ready;
    return `
      <article class="card glass${lessonsShown ? '' : ' rise'} lesson-win${open ? ' is-open' : ''}" style="--d:${Math.min(i, 8) * 0.04}s" data-code="${esc(l.code)}">
        <header class="lesson-win-top">
          <b class="lesson-code num">${esc(l.code)}</b>
          <input class="input lesson-title" value="${esc(l.title)}" maxlength="60" aria-label="${esc(l.code)}차시 제목">
          ${l.saved ? `<button type="button" class="preset-del" data-lesson-del aria-label="${esc(l.code)}차시 창 삭제">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>` : ''}
        </header>
        <div class="lesson-src-row">
          <input class="input lesson-src" value="${esc(readableUrl(l.lesson_src))}" placeholder="lessons/${esc(l.code)}.html" aria-label="${esc(l.code)}차시 수업자료 주소">
          <button type="button" class="btn btn-line btn-small" data-lesson-save>저장</button>
        </div>
        <div class="lesson-sheet">
          ${sheets.has(l.code)
            ? `<span class="tag tag-done num">학습지 ${sheets.get(l.code).page_count}쪽 · 칸 ${sheets.get(l.code).field_count}개 · ${fmtDate(sheets.get(l.code).updated_at)}</span>`
            : '<span class="tag tag-off">학습지 없음</span>'}
          <label class="btn btn-line btn-small ws-pick">${sheets.has(l.code) ? '다시 올리기' : '학습지 올리기'}
            <input type="file" class="ws-file" accept=".html,.htm,text/html" data-sheet-file></label>
        </div>
        <div class="lesson-chips">
          ${classes.map((c) => {
            const has = !!lessonBoard(c.id, l.code);
            return `<span class="tag lc-chip ${has ? 'tag-done' : 'tag-off'}" title="${clsName(c.id)}반 ${esc(l.code)}차시 보드 ${has ? '있음' : '없음'}">${clsName(c.id)}</span>`;
          }).join('')}
        </div>
        <div class="lesson-go">
          <button type="button" class="btn btn-primary" data-lesson-start ${ready ? '' : 'disabled'}>${open ? '닫기' : '수업 시작'}</button>
          ${ready ? '' : '<span class="muted lesson-need">수업자료 주소를 먼저 저장해 주세요</span>'}
        </div>
        ${open ? `<div class="lesson-classes" role="group" aria-label="반 고르기">
          ${classes.map((c, j) => `<button type="button" class="lesson-cls press pop${c.id === last ? ' is-last' : ''}" style="--d:${j * 0.03}s" data-live="${c.id}">${clsName(c.id)}반</button>`).join('')}
        </div>` : ''}
      </article>`;
  }).join('') : '<div class="empty"><strong>아직 차시가 없어요</strong></div>';
  if (wins.length && !$('lesson-list').closest('.hidden')) lessonsShown = true;
  updateHub();
}

// 이 포털 저장소의 lessons/ 폴더에 수업자료가 있는데 차시 창이 없으면 만든다(공유 자료실에서 받은 차시 포함).
// GitHub Pages 주소(아이디.github.io/저장소/)에서만 되고, 못 읽으면 조용히 넘어간다. 10분에 한 번만 확인
async function autoLessonWindows(known) {
  const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return false;
  const last = Number(sessionStorage.getItem('lessonScan')) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return false;
  sessionStorage.setItem('lessonScan', String(Date.now()));
  const owner = m[1];
  const repo = location.pathname.split('/')[1] && !/\.html?$/.test(location.pathname.split('/')[1]) && location.pathname.split('/')[1] !== 'teacher'
    ? location.pathname.split('/')[1] : `${owner}.github.io`;
  let files;
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/lessons`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return false;
    files = await r.json();
  } catch { return false; }
  if (!Array.isArray(files)) return false;
  let made = false;
  for (const f of files) {
    const c = /^([0-9]{3}[A-Za-z0-9]*)\.html$/.exec(f.name)?.[1];
    if (!c || known.has(c)) continue;
    const url = new URL(`../lessons/${f.name}`, location.href).href;
    try { // 사이트에 아직 안 올라온 파일이면 다음에
      const h = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!h.ok) continue;
      await saveLesson({ code: c, title: '', lesson_src: url, sort: parseInt(c, 10) || 0 });
      made = true;
    } catch { /* 다음에 다시 */ }
  }
  return made;
}

async function refreshLessons() {
  let [ls, ws] = await Promise.all([listLessons(), listWorksheets()]);
  if (await autoLessonWindows(new Set(ls.map((l) => l.code))).catch(() => false)) ls = await listLessons();
  lessons = ls;
  sheets = new Map(ws.map((w) => [w.lesson_code, w]));
  renderLessons();
}

/* ---------- 학습지 올리기: 파일 고르기 → 브라우저에서 읽어 미리보기 → 저장 ----------
   정답은 서버(worksheets.key)에만. 학생 쪽에는 정답을 뺀 화면용 html만 간다. GitHub에 올리지 않는다 */
let sheetDraft = null; // { code, file, parsed }
const BIG_BYTES = 1.5 * 1024 * 1024;

$('lesson-list').addEventListener('change', async (e) => {
  const input = e.target.closest('[data-sheet-file]');
  if (!input?.files?.[0]) return;
  const code = input.closest('[data-code]').dataset.code;
  const file = input.files[0];
  input.value = '';
  let parsed;
  try {
    parsed = parseWorksheet(await file.text());
  } catch (err) {
    toast(err.message || '파일을 읽지 못했어요', 'error');
    return;
  }
  sheetDraft = { code, file, parsed };
  showSheetPreview();
});

function showSheetPreview() {
  const { code, file, parsed } = sheetDraft;
  const bytes = new Blob([JSON.stringify(parsed.pages)]).size;
  const warns = parsed.report.reduce((n, r) => n + r.warn.length, 0);
  $('ws-dlg-h').textContent = `${code}차시 학습지 미리보기`;
  $('ws-dlg-meta').textContent = [file.name, `${parsed.pages.length}쪽`, `칸 ${parsed.fieldCount}개`, parsed.sims.length ? `시뮬레이션 ${parsed.report.reduce((n, r) => n + r.sims, 0)}개` : '',
    bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`, warns ? `확인할 것 ${warns}개` : ''].filter(Boolean).join(' · ') +
    (bytes > BIG_BYTES ? ' · 그림이 커서 학생 기기에서 느릴 수 있어요' : '');
  $('ws-report').innerHTML = parsed.report.map((r, i) => {
    const kinds = Object.entries(r.count).filter(([, n]) => n).map(([t, n]) => `${TYPE_NAME[t]} ${n}`).join(' · ') || '칸 없음';
    return `
      <li class="ws-rep${r.warn.length ? ' has-warn' : ''}">
        <button type="button" class="ws-rep-btn" data-view="${i}">
          <b class="num">${r.slide ?? '?'}쪽</b>
          <span class="ws-rep-t">${esc(r.title || '')}</span>
          <span class="ws-rep-k muted">${kinds}${r.open ? ` (정답 없는 고르기 ${r.open})` : ''}${r.count.plot ? ` (정답 점 ${r.plotPoints}개)` : ''}${r.sims ? ` · 시뮬레이션 ${r.sims}개` : ''}</span>
        </button>
        ${r.warn.map((w) => `<span class="ws-rep-w">${esc(w)}</span>`).join('')}
      </li>`;
  }).join('');
  $('ws-dlg-view').classList.add('hidden');
  $('ws-dlg-view').innerHTML = '';
  $('ws-dlg-save').disabled = false;
  $('ws-dlg').showModal();
}

// 쪽을 누르면 학생 화면처럼 보여 준다 (정답은 빠진 상태)
$('ws-report').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b || !sheetDraft) return;
  const view = $('ws-dlg-view');
  const i = Number(b.dataset.view);
  $('ws-report').querySelectorAll('.ws-rep').forEach((x, j) => x.classList.toggle('on', j === i));
  renderPage(view, sheetDraft.parsed.pages[i], {}, { locked: true });
  view.classList.remove('hidden');
  view.scrollIntoView({ block: 'nearest' });
});

$('ws-dlg-cancel').addEventListener('click', () => { $('ws-dlg').close(); sheetDraft = null; });
$('ws-dlg').addEventListener('close', () => closeSims($('ws-dlg-view')));

$('ws-dlg-save').addEventListener('click', async (e) => {
  if (!sheetDraft) return;
  const btn = e.currentTarget;
  const { code, parsed } = sheetDraft;
  btn.disabled = true;
  try {
    // 시뮬레이션 주소가 포털에서 열리는지(sims/ 파일을 GitHub에 올렸는지). 한글이 섞이면 NFC/NFD로 바꿔 본다
    const broken = [];
    for (const src of parsed.sims) {
      const chk = await checkSimUrl(simHref(src));
      if (chk.ok === false) broken.push(src);
    }
    if (broken.length && !confirm(`이 시뮬레이션 주소가 아직 열리지 않아요(404).\n${broken.join('\n')}\n\nsims/ 폴더에 파일을 GitHub에 올리면 열려요. 학습지는 지금 저장할까요?`)) {
      btn.disabled = false;
      return;
    }
    if (sheets.has(code)) {
      const n = await countWorksheetAnswers(code);
      if (n && !confirm(`이미 ${n}명이 이 학습지를 쓰기 시작했어요. 새 파일로 바꿀까요?\n칸이 바뀌면 쓰던 답이 맞지 않을 수 있어요. 이미 받은 XP는 그대로예요.`)) {
        btn.disabled = false;
        return;
      }
    }
    const lesson = lessonWindows().find((l) => l.code === code);
    await saveWorksheet({
      lesson_code: code,
      title: parsed.title || lesson?.title || '',
      pages: parsed.pages,
      key: parsed.key,
      page_count: parsed.pages.length,
      field_count: parsed.fieldCount,
    });
    $('ws-dlg').close();
    sheetDraft = null;
    toast(`${code}차시 학습지를 저장했어요`, 'ok');
    // 그 차시가 오늘 보드인 반은 바로 새 학습지로
    boards.filter((b) => b.lesson_code === code && classes.some((c) => c.today_board_id === b.id))
      .forEach((b) => sendClassRefresh(b.class_id));
    await refreshLessons();
  } catch (err) {
    toast(errMsg(err), 'error');
    btn.disabled = false;
  }
});

// 수업자료 주소: 'lessons/611.html'처럼 써도 포털 주소 기준으로 바꾼다
function lessonUrl(input) {
  let v = input.trim();
  if (!v) return null;
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(v)) v = 'https://' + v;
  try { return new URL(v, new URL('../', location.href)).href; } catch { return undefined; }
}

$('lesson-list').addEventListener('click', async (e) => {
  const win = e.target.closest('[data-code]');
  if (!win) return;
  const code = win.dataset.code;
  const l = lessonWindows().find((x) => x.code === code);

  if (e.target.closest('[data-lesson-save]')) {
    const btn = e.target.closest('[data-lesson-save]');
    const input = win.querySelector('.lesson-src');
    const url = lessonUrl(input.value);
    if (url === undefined) { toast('주소를 확인해 주세요', 'error'); input.focus(); return; }
    btn.disabled = true;
    try {
      let src = null;
      if (url) {
        const chk = await checkSimUrl(url);
        if (chk.ok === false && !confirm(`이 주소가 열리지 않아요(404). 그래도 저장할까요?\n${url}`)) return;
        if (new URL(chk.url).origin !== location.origin &&
            !confirm('다른 사이트의 수업자료예요. G키가 수업자료 안에서는 먹지 않고, 화면 오른쪽 아래 [모둠활동] 버튼으로만 전환돼요. 저장할까요?')) return;
        src = chk.url;
      }
      await saveLesson({ code, title: win.querySelector('.lesson-title').value.trim(), lesson_src: src, sort: parseInt(code, 10) || 0 });
      toast(`${code}차시를 저장했어요`, 'ok');
      await refreshLessons();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (e.target.closest('[data-lesson-del]')) {
    if (!confirm(`${code}차시 창을 삭제할까요? 보드는 지워지지 않아요.`)) return;
    try {
      await deleteLesson(code);
      if (startOpen === code) startOpen = null;
      toast('삭제했어요', 'ok');
      await refreshLessons();
    } catch (err) { toast(errMsg(err), 'error'); }
    return;
  }

  if (e.target.closest('[data-lesson-start]')) {
    startOpen = startOpen === code ? null : code;
    renderLessons();
    return;
  }

  const clsBtn = e.target.closest('[data-live]');
  if (clsBtn && l?.lesson_src) {
    const classId = Number(clsBtn.dataset.live);
    win.querySelectorAll('[data-live]').forEach((b) => { b.disabled = true; });
    try {
      // 그 반에 이 차시 보드가 있으면 오늘 보드로 (학생 반 페이지도 바로 그 차시 게시판으로)
      const b = lessonBoard(classId, code);
      const c = classes.find((x) => x.id === classId);
      if (b && c?.today_board_id !== b.id) {
        await setTodayBoard(classId, b.id);
        sendClassRefresh(classId);
      }
      localStorage.setItem(LIVE_CLASS, String(classId));
      location.href = `live.html?c=${classId}&l=${encodeURIComponent(code)}`;
    } catch (err) {
      toast(errMsg(err), 'error');
      win.querySelectorAll('[data-live]').forEach((x) => { x.disabled = false; });
    }
  }
});

// 첫 화면 오늘 수업 칩 / 다음 수업: 한 번 누르면 보드 만들기(없으면) → 오늘 보드 → 학생 화면 새로고침 → 수업 모드
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-go-live]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  if (a.dataset.busy) return;
  const [cid, code] = a.dataset.goLive.split(':');
  const classId = Number(cid);
  a.dataset.busy = '1';
  a.style.opacity = '.6';
  try {
    let b = lessonBoard(classId, code);
    if (!b) {
      const l = lessonWindows().find((x) => x.code === code);
      const [made] = await createBoards({ lesson_code: code, title: l?.title || code, sim_links: lessonSims(code) ?? [], items: [{ class_id: classId }], setToday: false });
      b = made;
      boards = await listBoards();
      b = lessonBoard(classId, code) ?? b;
    }
    const c = classes.find((x) => x.id === classId);
    if (b && c?.today_board_id !== b.id) {
      await setTodayBoard(classId, b.id);
      sendClassRefresh(classId);
    }
    localStorage.setItem(LIVE_CLASS, String(classId));
    location.href = a.href;
  } catch (err) {
    toast(errMsg(err), 'error');
    delete a.dataset.busy;
    a.style.opacity = '';
  }
});

$('lesson-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const code = f.code.value.trim();
  if (!/^[0-9A-Za-z-]{1,10}$/.test(code)) { toast('차시는 영어·숫자로 써 주세요', 'error'); return; }
  if (lessonWindows().some((l) => l.code === code)) { toast(`${code}차시 창이 이미 있어요`, 'error'); return; }
  try {
    await saveLesson({ code, title: f.title.value.trim(), lesson_src: null, sort: parseInt(code, 10) || 0 });
    f.reset();
    toast(`${code}차시 창을 만들었어요`, 'ok');
    await refreshLessons();
  } catch (err) { toast(errMsg(err), 'error'); }
});

/* ---------- 반별 잠금 ---------- */
// 반별 잠금: 학생 명단의 반 고르기 줄 오른쪽 스위치 (고른 반만)
function renderLocks() {
  const c = classes.find((x) => x.id === rosterClass);
  $('stu-lock').innerHTML = c ? `
    <span id="stu-lock-l" class="${c.locked ? 'is-locked' : ''}">${c.locked ? '잠김' : '열림'}</span>
    <button type="button" class="switch" role="switch" aria-checked="${!!c.locked}" data-lock="${c.id}" aria-labelledby="stu-lock-l" aria-describedby="stu-lock-d"><span></span></button>
    <span class="sr" id="stu-lock-d">${clsName(c.id)}반 잠금</span>` : '';
  $('stu-lock-note').classList.toggle('hidden', !c?.locked);
  $('stu-lock-note').textContent = c?.locked ? `${clsName(c.id)}반 잠김 · 로그인 안 됨` : '';
  updateHub();
}

$('stu-lock').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-lock]');
  if (!btn) return;
  const c = classes.find((x) => x.id === Number(btn.dataset.lock));
  const next = !c.locked;
  if (next && !confirm(`${clsName(c.id)}반을 잠글까요? 로그인해 있던 학생도 모두 로그아웃돼요.`)) return;
  btn.disabled = true;
  try {
    await setClassLock(c.id, next);
    c.locked = next;
    renderLocks();
    toast(next ? `${clsName(c.id)}반을 잠갔어요` : `${clsName(c.id)}반을 열었어요`, 'ok');
  } catch (err) {
    toast(errMsg(err), 'error');
    btn.disabled = false;
  }
});

/* ---------- 첫 화면 항목 ---------- */
function updateHub() {
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const ready = lessonWindows().filter((l) => l.lesson_src).length;
  if (lessons.length || boards.length) set('hub-lessons', `수업자료 준비 ${ready}차시`);
  const today = classes.filter((c) => c.today_board_id).length;
  if (classes.length) set('hub-boards', `오늘 보드 ${today}/${clsName(classes.length)}반`);
  const active = students.filter((s) => s.active);
  if (active.length) set('hub-roster', `학생 ${active.length}명 · 코드 없음 ${active.filter((s) => !s.has_code).length}명`);
  set('hub-nick', nickReqs.length ? `기다리는 신청 ${nickReqs.length}개` : '기다리는 신청 없음');
  $('hub-nick-badge').textContent = nickReqs.length;
  $('hub-nick-badge').classList.toggle('hidden', !nickReqs.length);
  const locked = classes.filter((c) => c.locked).map((c) => `${clsName(c.id)}반`);
  if (classes.length) set('hub-lock', locked.length ? `잠김: ${locked.join(', ')}` : '모두 열림');
  set('hub-presets', `버튼 ${presets.length}개`);
  set('hub-buys', buyReqs.length ? `기다리는 신청 ${buyReqs.length}개` : '기다리는 신청 없음');
  $('hub-buys-badge').textContent = buyReqs.length;
  $('hub-buys-badge').classList.toggle('hidden', !buyReqs.length);
  syncSideBadges();
}

// 예전 주소(#roster 등)는 합친 화면으로 (2026-11-22 메뉴 정리)
const ALIAS = { roster: 'students', nick: 'students', lock: 'students', grant: 'scores', coins: 'scores', 'moon-rpg': 'omok' };
function route() {
  let key = location.hash.slice(1);
  if (ALIAS[key]) { history.replaceState(null, '', `#${ALIAS[key]}`); key = ALIAS[key]; }
  let open = null;
  document.querySelectorAll('[data-panel]').forEach((p) => {
    const on = !!key && (p.dataset.panel === key || (p.dataset.also || '').split(' ').includes(key));
    p.classList.toggle('hidden', !on);
    if (on && !open) open = p;
  });
  // 첫 화면은 가운데 3D 장면만. 화면은 위 메뉴로 연다
  $('hero').classList.toggle('hidden', !!open);
  $('admin-body').classList.toggle('hidden', !open);
  document.body.classList.toggle('hero-on', !open);
  if (open) stopHero(); else startHero($('hero'));
  $('admin-h').textContent = open ? open.dataset.title : '관리';
  markSide(open ? key : '');
  scrollTo(0, 0);
  if (key === 'students') { refreshNicks().catch(() => {}); refreshNickAll().catch(() => {}); }
  loadPanel(key);
}

// 항목을 열 때 그 항목의 최신 내용 (로그인 전이면 조용히 넘어가고, 로그인 뒤 다시 부른다)
function loadPanel(key) {
  if (key === 'lessons') refreshLessons().catch(() => {});
  if (key === 'buys') refreshBuys(true).catch(() => {});
  if (key === 'shopset') refreshShopSet().catch(() => {});
  if (key === 'scores') { renderGrant(); refreshGrants().catch(() => {}); refreshCoins().catch(() => {}); }
  if (key === 'points') refreshPoints().catch(() => {});
  if (key === 'data') refreshArchive().catch(() => {});
  if (key === 'mats') refreshMats().catch(() => {});
  if (key === 'progress') refreshProgress().catch(() => {});
  if (key === 'ai') refreshAi().catch(() => {});
  if (key === '') todayPlan().then(showToday).catch(() => {});
}
initSide();
addEventListener('hashchange', route);
route();

/* ---------- 시작 ---------- */
// 서버가 가끔 시간 초과(522)로 한 번 실패한다 → 두 번 더 해 본다(반 버튼이 비는 일 막기, 2026-11-17)
const retry = async (fn, n = 2) => { try { return await fn(); } catch (err) { if (n <= 0) throw err; await new Promise((r) => setTimeout(r, 800)); return retry(fn, n - 1); } };
async function refresh() {
  [classes, boards, lessonMeta] = await Promise.all([retry(listClasses), retry(listBoards), retry(listLessons).catch(() => [])]);
  renderToday();
  renderBoards();
  renderLocks();
  renderLessons();
  if (location.hash === '#data') renderArchive();
  // 모둠 게시판 사진은 그 차시가 끝나면(어느 반의 오늘 보드도 아니면) 지운다
  cleanupPostPhotos().catch((err) => console.error(err));
}

/* ---------- 공유 자료실에서 웹 학습지 받기 (2026-11-12) ----------
   자료실(a11y526.github.io/science-share)의 웹 학습지 [내 포털에 넣기]가 이 화면을 teacher/?ws-in=1#lessons 로 새 창에 연다.
   여기서 'ws:ready'를 보내면 자료실이 {type:'ws:file', code, name, html}을 보내고, 받으면 'ws:got'으로 답한다.
   로그인 뒤 [학습지 올리기]와 같은 미리보기 창을 띄운다(선생님이 [저장]을 눌러야 들어간다). 정답이 든 html이라 자료실 주소에서 온 것만 받는다 */
const SHARE_ORIGINS = ['https://a11y526.github.io'];
let wsIncoming = null;
let wsGot = false; // 한 번만 받는다
let adminReady = false;
if (new URLSearchParams(location.search).has('ws-in') && window.opener) {
  const okOrigin = (o) => SHARE_ORIGINS.includes(o) || (location.hostname === 'localhost' && /^http:\/\/localhost(:\d+)?$/.test(o));
  addEventListener('message', (e) => {
    if (!okOrigin(e.origin) || e.data?.type !== 'ws:file' || wsGot) return;
    const { code, name, html } = e.data;
    if (!/^[0-9]{3}[A-Za-z0-9]*$/.test(String(code || '')) || typeof html !== 'string' || html.length > 8e6) return;
    wsGot = true;
    wsIncoming = { code, name: String(name || `${code}.html`).slice(0, 120), html };
    e.source?.postMessage({ type: 'ws:got' }, e.origin);
    history.replaceState(null, '', location.pathname + location.hash);
    if (adminReady) openIncoming();
  });
  let n = 0;
  const ping = setInterval(() => {
    if (wsGot || ++n > 600 || !window.opener) { clearInterval(ping); return; }
    try { window.opener.postMessage({ type: 'ws:ready' }, '*'); } catch { clearInterval(ping); }
  }, 500);
}
function openIncoming() {
  if (!wsIncoming) return;
  const { code, name, html } = wsIncoming;
  wsIncoming = null;
  if (location.hash !== '#lessons') location.hash = 'lessons';
  let parsed;
  try {
    parsed = parseWorksheet(html);
  } catch (err) {
    toast(err.message || '학습지를 읽지 못했어요', 'error');
    return;
  }
  sheetDraft = { code, file: { name: `공유 자료실 · ${name}` }, parsed };
  showSheetPreview();
  if (!lessonWindows().some((l) => l.code === code)) toast(`${code}차시 창이 아직 없어요. 저장해 두면 그 차시 창을 만들 때 바로 쓰여요`);
}

renderCreateForm();
teacherGate($('v-admin'), async () => {
  await refresh();
  await Promise.all([refreshStudents(), refreshPresets(), refreshNicks(), refreshBuys(), refreshPoints(), refreshLessons()]).catch((err) => toast(errMsg(err), 'error'));
  loadPanel(location.hash.slice(1));
  adminReady = true;
  openIncoming();
});
