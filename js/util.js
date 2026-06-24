/* =========================================================================
   util.js — 공용 유틸리티
   ========================================================================= */

/* 이미지 경로 베이스.
   - 깃허브 프로젝트 페이지(username.github.io/TRPG_Log/)에서 그대로 동작합니다.
   - 캐릭터/커버 이미지 경로는 "image/세션명/캐릭터.png" 형태로 저장합니다.
   - 사용자가 "TRPG_Log/image/..." 처럼 레포명을 붙여 적어도 자동으로 정리됩니다. */
const SITE_BASE = (function(){
  // 현재 문서 위치 기준 디렉터리. (file:// 로컬에서도 상대경로로 동작)
  const path = location.pathname;
  return path.endsWith('/') ? path : path.replace(/[^/]*$/, '');
})();

function resolveImg(p){
  if(!p) return '';
  let s = String(p).trim();
  if(!s) return '';
  if(/^https?:\/\//i.test(s)) return s;          // 외부 URL 은 그대로
  s = s.replace(/^\/+/, '');                      // 앞쪽 슬래시 제거
  s = s.replace(/^TRPG_Log\//i, '');              // 레포명 접두사 정리
  return SITE_BASE + s;
}

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let _idn = 0;
function genId(){ return 'id_' + (Date.now().toString(36)) + '_' + (_idn++).toString(36); }

let _toastT = null;
function toast(msg){
  let el = $('#toast');
  if(!el){ el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove('show'), 2400);
}

/* 아바타 — 이미지가 있으면 사진, 없으면 글자 없는 단색 원 */
function avatarStyle(ch){
  const url = ch ? resolveImg(ch.img) : '';
  if(url) return `background-image:url('${url}')`;
  return `background-color:${(ch && ch.color) || '#9a9a9a'}`;
}

/* Rich Text 위생: <b>,<strong>,<i>,<em>,<br> 만 허용 후 b/i/br 로 정규화 */
function applyRich(str){
  let s = String(str == null ? '' : str);
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\u0001br\u0002');
  s = s.replace(/<\s*(\/?)\s*(b|strong|i|em)\s*>/gi, '\u0001$1$2\u0002');
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/\u0001(\/?)(?:b|strong)\u0002/gi, (m, sl) => '<' + sl + 'b>')
       .replace(/\u0001(\/?)(?:i|em)\u0002/gi,    (m, sl) => '<' + sl + 'i>')
       .replace(/\u0001br\u0002/gi, '<br>');
  return s;
}

/* contenteditable → 이스케이프된 텍스트 + <b>/<i>/<br> (여러 줄 지원) */
function escapeText(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function editableToRich(el){
  function ser(node){
    let out = '';
    node.childNodes.forEach(ch => {
      if(ch.nodeType === 3){ out += escapeText(ch.nodeValue); return; }
      if(ch.nodeType !== 1) return;
      const tag = ch.tagName.toLowerCase();
      if(tag === 'br'){ out += '<br>'; return; }
      if(tag === 'b' || tag === 'strong'){ out += '<b>' + ser(ch) + '</b>'; return; }
      if(tag === 'i' || tag === 'em'){ out += '<i>' + ser(ch) + '</i>'; return; }
      const block = ['div','p','li','tr','h1','h2','h3','h4','section','article','blockquote'].includes(tag);
      if(block){ if(out && !/<br>\s*$/.test(out)) out += '<br>'; out += ser(ch); }
      else out += ser(ch);
    });
    return out;
  }
  return ser(el).replace(/(\s*<br>\s*)+$/i, '').replace(/^(\s*<br>\s*)+/i, '').replace(/\u00a0/g, ' ');
}

/* 허용된 태그 외의 '<','>' 는 모두 안전하게 텍스트로 escape.
   (로그 안에 '<생각>', '<3' 같은 문자가 있으면 알 수 없는 HTML 태그로 잘못 해석되어
   내용이 통째로 사라지는 문제를 막기 위해, DOM에 넣기 전에 반드시 이 함수를 거친다.) */
function escapeStrayAngles(html, tagNames){
  const s = String(html == null ? '' : html);
  const pat = tagNames.join('|');
  const re = new RegExp('(<\\/?(?:' + pat + ')(?:\\s[^<>]*)?\\/?>)|([<>])', 'gi');
  return s.replace(re, (m, tag, lone) => tag ? tag : (lone === '<' ? '&lt;' : '&gt;'));
}

/* HTML → 허용 태그만 남기는 위생 처리 */
function sanitizeHTML(html, allowed){
  const tmp = document.createElement('div');
  tmp.innerHTML = escapeStrayAngles(html || '', allowed);
  tmp.querySelectorAll('img, picture, svg, script, style, video, audio, iframe').forEach(n => n.remove());
  tmp.querySelectorAll('*').forEach(node => {
    Array.from(node.attributes).forEach(a => node.removeAttribute(a.name));
    const tag = node.tagName.toLowerCase();
    if(!allowed.includes(tag)){
      const parent = node.parentNode;
      while(node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
    }
  });
  return tmp.innerHTML;
}
const HANDOUT_TAGS = ['p','br','b','strong','i','em','h4','ul','ol','li'];
const INLINE_TAGS  = ['b','strong','i','em','br'];

/* contenteditable 내부 → b/i 만 남긴 깔끔한 HTML */
function cleanInlineHTML(el){
  const norm = sanitizeHTML(el.innerHTML, INLINE_TAGS);
  // strong/em → b/i
  return norm.replace(/<\/?strong>/gi, m => m[1] === '/' ? '</b>' : '<b>')
             .replace(/<\/?em>/gi,     m => m[1] === '/' ? '</i>' : '<i>')
             .replace(/<br\s*\/?>/gi, ' ')
             .trim();
}

/* 캐릭터 역할 */
function charRole(session, name){
  const c = findChar(session, name);
  return c ? (c.role || 'NPC') : 'NPC';   // 설정에 없는 캐릭터는 NPC 취급
}
function findChar(session, name){
  const key = String(name || '').trim();
  return ((session && session.characters) || []).find(c => c.name.trim() === key) || null;
}
/* PC = 오른쪽, KPC/NPC = 왼쪽 */
function bubbleSide(role){ return role === 'PC' ? 'right' : 'left'; }

/* 유튜브 URL/ID → 11자리 video id */
function ytIdFromUrl(s){
  if(!s) return '';
  s = String(s).trim();
  const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  if(m) return m[1];
  if(/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return s;
}
