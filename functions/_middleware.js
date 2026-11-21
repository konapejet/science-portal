// Cloudflare Pages 문지기 (2026-11-17): 학생이 수업자료 주소를 직접 열어 정답을 보지 못하게 한다.
//   lessons/… = 교사 로그인만, sims/… = 교사 또는 로그인한 학생, 나머지 = 그대로
// 로그인 표시는 쿠키(tj = 교사 Supabase 토큰, db.js / sp = 학생 출입증, login.js)이고, 진짜인지는 Supabase media_access로 확인한다.
// 관리 앱의 '반영 확인'은 X-Check-Key 머리글(Cloudflare 환경 변수 CHECK_KEY와 같은 값)로 통과한다.
// GitHub Pages(다른 선생님 판)에서는 이 폴더를 쓰지 않는다.
const SUPABASE_URL = 'https://sxejmhkevefwnpwldczt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gdlN0VcGUXOPkXLSqfJn0Q_VYES-EwK'; // 공개 키(site.js와 같음)
const OK_SECONDS = 300; // 한 번 확인한 출입증은 5분 동안 다시 묻지 않는다

// 교사 화면만 쓰는 스크립트(2026-11-17: 관리 화면 코드도 교사 로그인 전에는 안 보이게)
const TEACHER_JS = /^\/assets\/js\/pages\/(teacher[\w-]*|check|groups|live|quizshow-edit|quizshow-host|remote|reveal)\.js$/;

function need(path) {
  if (path.startsWith('/lessons/')) return 'teacher';
  if (path.startsWith('/teacher/') || path === '/teacher' || TEACHER_JS.test(path)) return 'teacher';
  if (path.startsWith('/sims/')) return 'student';
  return null;
}

// 교사 화면(HTML)이면 로그인 화면으로 보내고, 스크립트·수업자료면 401
function isPage(request, path) {
  return path.startsWith('/teacher') && !path.endsWith('.js') && (request.headers.get('Accept') || '').includes('text/html');
}

function cookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 확인 결과 기억(이 작업자 안, 메모리). *.pages.dev에서는 Cache API가 동작하지 않아서 Map을 쓴다
const SEEN = new Map(); // sha(tj|sp) → { role, at }
const STALE_SECONDS = 12 * 3600; // Supabase가 잠깐 응답하지 않으면(522 등) 12시간 안에 확인된 결과를 그대로 쓴다

// Supabase에 묻기: 'teacher' | 'student' | null(확인됨: 아님) | undefined(서버 오류로 모름)
async function ask(tj, sp) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/media_access', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + (tj || SUPABASE_KEY),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_token: /^[0-9a-f]{64}$/.test(sp) ? sp : null }),
      });
      if (r.ok) return (await r.json()) || null;
      if (r.status === 401 || r.status === 403) return tj && sp ? ask('', sp) : null; // 교사 토큰이 지났으면 학생 출입증으로만
    } catch {}
    await new Promise((res) => setTimeout(res, 600));
  }
  return undefined;
}

// 'teacher' | 'student' | null
async function who(tj, sp) {
  if (!tj && !/^[0-9a-f]{64}$/.test(sp)) return null;
  const key = await sha(tj + '|' + sp);
  const now = Date.now() / 1000;
  const hit = SEEN.get(key);
  if (hit && now - hit.at < OK_SECONDS) return hit.role;
  const role = await ask(tj, sp);
  if (role === undefined) return hit && now - hit.at < STALE_SECONDS ? hit.role : null;
  if (role) SEEN.set(key, { role, at: now });
  else SEEN.delete(key);
  if (SEEN.size > 5000) SEEN.clear();
  return role;
}

function denied(kind) {
  const msg = kind === 'teacher'
    ? '수업자료는 선생님 화면(수업 모드)에서만 열려요.'
    : '로그인한 뒤 반 페이지에서 열어 주세요.';
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인이 필요해요</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#0d0d0d;font-family:'Noto Sans KR',system-ui,sans-serif}
main{background:#f7f7f7;border-radius:28px;padding:40px 32px;max-width:420px;text-align:center}h1{font-size:28px;font-weight:900;margin:0 0 12px}
p{color:#5d5d5d;margin:0 0 24px}a{display:inline-block;background:#0d0d0d;color:#fff;border-radius:999px;padding:12px 24px;text-decoration:none;font-weight:700}</style></head>
<body><main><h1>로그인이 필요해요</h1><p>${msg}</p><a href="/" target="_top">처음 화면으로</a></main></body></html>`, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  const url = new URL(request.url);
  const kind = need(url.pathname);
  if (!kind) return next();

  const check = request.headers.get('X-Check-Key');
  if (check && env.CHECK_KEY && check === env.CHECK_KEY) return next();

  const role = await who(cookie(request, 'tj'), cookie(request, 'sp'));
  const ok = role === 'teacher' || (kind === 'student' && role === 'student');
  if (!ok) {
    if (isPage(request, url.pathname)) {
      return new Response(null, {
        status: 302,
        headers: { Location: '/login?next=' + encodeURIComponent(url.pathname + url.search + url.hash), 'Cache-Control': 'no-store' },
      });
    }
    return denied(kind);
  }

  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'private, no-cache'); // 중간 캐시에는 안 남기고, 브라우저는 ETag로 다시 확인(큰 3D 시뮬레이션은 304로 빨리)
  return out;
}
