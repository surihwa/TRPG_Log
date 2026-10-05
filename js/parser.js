/* =========================================================================
   parser.js — 원본 로그 HTML 가져오기
   --------------------------------------------------------------------------
   · Roll20    : 채팅 아카이브 페이지를 저장한 HTML (SingleFile 등)
   · 코코포리아 : 로그 출력(ccfolia - logs) HTML
   HTML 파일을 통째로 받아 DOM 구조로 메시지를 읽고, 사이트용 블록 배열로 바꾼다.
   결과: { format, title, date, blocks[], speakers[], stats }
   ========================================================================= */

/* ---- 형식 판별 ---- */
function detectLogFormat(html){
  const s = String(html || '');
  if(/<title>\s*ccfolia/i.test(s) || /<p[^>]*>\s*<span>\s*\[[^\]<]*\]\s*<\/span>/i.test(s)) return 'ccfolia';
  if(/roll20\.net/i.test(s) || /class=["']?message[\s"'][^>]*data-messageid/i.test(s)) return 'roll20';
  return 'unknown';
}

function importLogHTML(html, opts){
  const fmt = detectLogFormat(html);
  if(fmt === 'roll20')  return Object.assign({ format:'roll20' }, importRoll20(html, opts || {}));
  if(fmt === 'ccfolia') return Object.assign({ format:'ccfolia' }, importCcfolia(html, opts || {}));
  const e = new Error('unknown'); e.code = 'unknown'; throw e;
}

/* ---- 공용 도우미 ---- */
/* 나레이션으로 볼 화자: 이름이 비었거나 '(GM)' 포함, 또는 사용자가 지정한 나레이션 이름 목록에 있음 */
function isNarrationName(n, narrators){
  const s = String(n || '').trim();
  if(!s || /\(\s*gm\s*\)/i.test(s)) return true;
  return (narrators || []).some(x => String(x).trim() === s);
}
/* '관찰력 판정', '[이성 판정 (1/1d3)]' 같은 판정 안내 한 줄 */
const JUDGE_LABEL_RE = /^\[?\s*[^\[\]<>]{1,24}?\s*판정(?:\s*[(（][^)）]*[)）])?\s*\]?$/;
function stripTags(s){ return String(s == null ? '' : s).replace(/<[^>]+>/g, ''); }
function firstNum(s){ const m = String(s == null ? '' : s).match(/-?\d+/); return m ? m[0] : ''; }
function isNum(s){ return s != null && /^-?\d+(?:\.\d+)?$/.test(String(s).trim()); }

/* 크툴루 시트의 영문 판정명 → 한글 (앞의 '○○ 판정' 안내가 없을 때 사용) */
const COC_SKILL_KO = {
  'spot hidden':'관찰력', 'listen':'듣기', 'library use':'자료조사', 'psychology':'심리학',
  'sanity':'이성', 'san':'이성', 'power':'정신력', 'pow':'정신력', 'intelligence':'지능', 'int':'지능',
  'idea':'아이디어', 'know':'지식', 'size':'크기', 'siz':'크기', 'strength':'근력', 'str':'근력',
  'constitution':'건강', 'con':'건강', 'dexterity':'민첩성', 'dex':'민첩성', 'appearance':'외모', 'app':'외모',
  'education':'교육', 'edu':'교육', 'luck':'행운', 'own':'모국어', 'own language':'모국어', 'language (own)':'모국어',
  'persuade':'설득', 'fast talk':'말재주', 'charm':'매혹', 'intimidate':'위협', 'stealth':'은밀행동',
  'dodge':'회피', 'first aid':'응급처치', 'medicine':'의학', 'occult':'오컬트', 'history':'역사',
  'navigate':'길찾기', 'track':'추적', 'climb':'오르기', 'jump':'도약', 'swim':'수영', 'throw':'투척',
  'drive auto':'자동차 운전', 'locksmith':'자물쇠 따기', 'sleight of hand':'손놀림', 'credit rating':'신용',
  'accounting':'회계', 'anthropology':'인류학', 'archaeology':'고고학', 'electrical repair':'전기 수리',
  'mechanical repair':'기계 수리', 'law':'법률', 'natural world':'자연', 'cthulhu mythos':'크툴루 신화',
  'fighting (brawl)':'근접전(격투)', 'firearms (handgun)':'사격(권총)', 'firearms (rifle/shotgun)':'사격(라이플/산탄총)',
  'disguise':'변장', 'operate heavy machinery':'중장비 조작', 'ride':'승마', 'survival':'생존술'
};

/* ---- 가벼운 DOM 탐색 (브라우저 DOMParser 결과에 사용) ---- */
function _kids(n){ return Array.from((n && n.childNodes) || []); }
function _cls(el){ return (el && el.nodeType === 1 && el.getAttribute('class')) || ''; }
function hasCls(el, c){ return (' ' + _cls(el).trim().split(/\s+/).join(' ') + ' ').indexOf(' ' + c + ' ') >= 0; }
function clsHas(el, part){ return _cls(el).indexOf(part) >= 0; }
function tagIs(el, t){ return el && el.nodeType === 1 && el.tagName.toLowerCase() === t; }
function findAll(root, pred, stopInside){
  const out = [];
  (function walk(n){ _kids(n).forEach(ch => {
    if(ch.nodeType !== 1) return;
    if(pred(ch)){ out.push(ch); if(stopInside) return; }
    walk(ch);
  }); })(root);
  return out;
}
function findOne(root, pred){ return findAll(root, pred)[0] || null; }
function textOf(el){ return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
function wordsOf(el){           // <span>어려움</span><span>성공</span> → "어려움 성공"
  if(!el) return '';
  const parts = _kids(el).map(k => k.nodeType === 3 ? k.nodeValue : textOf(k)).map(t => String(t).trim()).filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/* 메시지 안에서 본문이 아닌 부분 */
const R20_SKIP = ['spacer', 'avatar', 'tstamp', 'by', 'flyout'];
function r20Skip(el){ return R20_SKIP.some(c => hasCls(el, c)); }

/* 메시지 본문 → 서식 텍스트(b/i/br만) */
function r20Rich(node){
  let out = '';
  _kids(node).forEach(ch => {
    if(ch.nodeType === 3){ out += escapeText(ch.nodeValue); return; }
    if(ch.nodeType !== 1 || r20Skip(ch)) return;
    const tag = ch.tagName.toLowerCase();
    if(['img','svg','script','style','template','form','audio','video','picture','iframe','button'].includes(tag)) return;
    if(tag === 'br'){ out += '<br>'; return; }
    if(hasCls(ch, 'inlinerollresult')){ out += escapeText(textOf(ch)); return; }
    if(tag === 'b' || tag === 'strong'){ out += '<b>' + r20Rich(ch) + '</b>'; return; }
    if(tag === 'i' || tag === 'em'){ out += '<i>' + r20Rich(ch) + '</i>'; return; }
    if(['div','p','li','ul','ol','h1','h2','h3','h4','h5','h6','blockquote','tr','table'].includes(tag)){
      out += '<br>' + r20Rich(ch) + '<br>'; return;
    }
    out += r20Rich(ch);
  });
  return out;
}
function tidyRich(s){
  let t = String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t\r\n\f]+/g, ' ');
  t = t.replace(/\s*<br>\s*/g, '<br>');
  for(let k = 0; k < 3; k++) t = t.replace(/<(b|i)>\s*<\/\1>/g, '');
  t = t.replace(/(<br>){3,}/g, '<br><br>').replace(/^(<br>)+|(<br>)+$/g, '');
  return t.trim();
}

/* 대사 본문을 따옴표 기준으로 대사(line)/지문(narr) 분리 — b/i 태그 균형 유지
   " “ ” : 따옴표 안 = 대사 (따옴표 기호도 그대로 유지)
   「」『』〔〕 : 괄호 안 = 대사 (괄호 기호 유지. 예: AI·통신 음성) */
const QUOTE_CH = new Set(['"', '\u201C', '\u201D']);
const _BRACKET = { '\u300C':'\u300D', '\u300E':'\u300F', '\u3014':'\u3015' };
function splitQuotedRich(html){
  const segs = [];
  const open = [];                       // 현재 열린 b/i
  let buf = '', inQ = false, closer = '';
  const closeAll = () => open.slice().reverse().map(t => '</' + t + '>').join('');
  const openAll  = () => open.map(t => '<' + t + '>').join('');
  function cut(){
    const text = tidyRich(buf + closeAll());
    if(stripTags(text).trim()) segs.push({ kind: inQ ? 'line' : 'narr', text });
    buf = openAll();
  }
  String(html || '').replace(/<\/?(?:b|i)>|<br>|[^<]+|</g, tok => {
    const m = tok.match(/^<(\/?)(b|i)>$/);
    if(m){
      if(m[1]){ const k = open.lastIndexOf(m[2]); if(k >= 0) open.splice(k, 1); }
      else open.push(m[2]);
      buf += tok; return tok;
    }
    if(tok === '<br>' || tok === '<'){ buf += tok; return tok; }
    for(const ch of tok){
      if(!inQ){
        if(QUOTE_CH.has(ch)){ cut(); inQ = true; closer = 'quote'; buf += ch; continue; }
        if(_BRACKET[ch]){ cut(); inQ = true; closer = _BRACKET[ch]; buf += ch; continue; }
      } else if(closer === 'quote' && QUOTE_CH.has(ch)){          // " “ ” 는 어느 것이든 닫힘으로 인정
        buf += ch; cut(); inQ = false; closer = ''; continue;
      } else if(ch === closer){
        buf += ch; cut(); inQ = false; closer = ''; continue;
      }
      buf += ch;
    }
    return tok;
  });
  cut();
  const merged = [];                     // 연달아 붙은 지문은 합치기
  segs.forEach(sg => {
    const last = merged[merged.length - 1];
    if(last && last.kind === sg.kind && sg.kind === 'narr') last.text += ' ' + sg.text;
    else merged.push(sg);
  });
  return merged;
}

/* ---- 블록 생성기 (Roll20 · 코코포리아 공용) ----
   같은 화자가 이어서 말하면 한 블록으로 묶고, 나레이션 화자의 판정 안내 줄은 강조 나레이션으로 뺀다. */
function makeBuilder(narrators){
  const blocks = []; let cur = null;
  const isNarr = n => isNarrationName(n, narrators);
  function flush(){
    if(!cur) return;
    if(cur.type === 'dialogue'){
      if(cur.segments.length) blocks.push({ id:genId(), type:'dialogue', speaker:cur.speaker,
        segments:cur.segments, _raw:cur.raw.join('<br>') });      // _raw: 나레이션 전환 시 원문 복원용(저장 안 됨)
    } else {
      const text = cur.lines.filter(l => stripTags(l).trim()).join('<br>');
      if(text) blocks.push({ id:genId(), type:'narration', emphasis:!!cur.emphasis, text });
    }
    cur = null;
  }
  function em(rich){
    if(!stripTags(rich).trim()) return;
    if(!cur || cur.type !== 'narration' || !cur.emphasis){ flush(); cur = { type:'narration', emphasis:true, lines:[] }; }
    cur.lines.push(rich);
  }
  /* 반환값: 대사로 들어갔으면 true */
  function text(speaker, rich){
    if(!stripTags(rich).trim()) return false;
    if(isNarr(speaker)){
      if(JUDGE_LABEL_RE.test(stripTags(rich).trim())){ em(rich); return false; }
      if(!cur || cur.type !== 'narration' || cur.emphasis){ flush(); cur = { type:'narration', emphasis:false, lines:[] }; }
      cur.lines.push(rich); return false;
    }
    if(!cur || cur.type !== 'dialogue' || cur.speaker !== speaker){ flush(); cur = { type:'dialogue', speaker, segments:[], raw:[] }; }
    splitQuotedRich(rich).forEach(sg => cur.segments.push(sg));
    cur.raw.push(rich);
    return true;
  }
  return { blocks, flush, em, text, isNarr,
           last(){ flush(); return blocks[blocks.length - 1] || null; },
           push(b){ flush(); blocks.push(b); } };
}

/* ---- 주사위 ---- */
function _cleanFormula(f){
  return String(f || '').replace(/(?:cs|cf)[<>=]?\d+/gi, '').replace(/\s+/g, '').replace(/^rolling/i, '');
}
function _formulaFromTitle(el){
  const t = (el && el.getAttribute('title')) || '';
  const m = t.replace(/<[^>]+>/g, '').match(/Rolling\s+(.+?)\s*=/i);
  return m ? _cleanFormula(m[1]) : '';
}
function _labelFromDesc(prev){
  if(!prev || prev.type !== 'narration') return '';
  const lines = String(prev.text || '').split('<br>');
  const last = stripTags(lines[lines.length - 1]).trim().replace(/^\[\s*/, '');
  const m = last.match(/^(.+?)\s*판정/);
  return m ? m[1].trim() : '';
}

/* 롤 템플릿(또는 표) → 주사위 블록 */
function r20Dice(tpl, speaker, prevBlock){
  const label = _labelFromDesc(prevBlock);
  const base = { id:genId(), type:'dice', speaker: speaker || '' };

  /* (1) 크툴루(CoC 7th) 템플릿: h1 판정명 · h3 등급 · 성공/실패 · 굴림 vs 기준치 */
  const h1 = findOne(tpl, el => tagIs(el, 'h1'));
  const rolls = findAll(tpl, el => hasCls(el, 'sheet-coc-roll__roll'), true);
  if(h1 && rolls.length){
    const en = textOf(h1);
    const grade = textOf(findOne(tpl, el => tagIs(el, 'h3'))) || '보통';
    const resEl = findOne(tpl, el => /sheet-coc-roll__(success|failure|fail|fumble|crit|extreme)/i.test(_cls(el)));
    return Object.assign(base, {
      kind:'check',
      item: label || COC_SKILL_KO[en.toLowerCase()] || en || '판정',
      grade, standard: firstNum(textOf(rolls[1])), roll: textOf(rolls[0]),
      result: wordsOf(resEl)
    });
  }

  /* (2) 표 템플릿: caption=판정명 / 기준치 · 굴림 · 판정결과 · (피해 · 고장) */
  const table = tagIs(tpl, 'table') ? tpl : findOne(tpl, el => tagIs(el, 'table'));
  if(table){
    const name = textOf(findOne(table, el => tagIs(el, 'caption'))) || textOf(findOne(table, el => tagIs(el, 'th')));
    const f = {};
    findAll(table, el => tagIs(el, 'tr')).forEach(tr => {
      const cells = findAll(tr, el => tagIs(el, 'td') || tagIs(el, 'th'), true);
      if(cells.length < 2) return;
      const key = (cells[0].getAttribute('data-i18n') || '') + ' ' + textOf(cells[0]);
      const val = textOf(cells[1]);
      if(/value|기준치/i.test(key)) f.standard = val;
      else if(/rolled|굴림/i.test(key)) f.roll = val;
      else if(/result|판정결과/i.test(key)) f.result = val;
      else if(/피해|damage/i.test(key)) f.damage = val;
    });
    if(f.damage != null){
      return Object.assign(base, { kind:'attack', item: name || label || '무기',
        standard: f.standard || '', roll: f.roll || '', result: f.result || '', damage: f.damage });
    }
    if(f.roll != null){
      return Object.assign(base, { kind:'check', item: label || name || '판정', grade:'보통',
        standard: firstNum(f.standard), roll: f.roll, result: f.result || '' });
    }
  }

  /* (3) 그 밖의 템플릿: 첫 인라인 굴림을 단순 굴림으로 */
  const ir = findOne(tpl, el => hasCls(el, 'inlinerollresult'));
  const name = textOf(findOne(tpl, el => tagIs(el, 'caption') || tagIs(el, 'h1') || tagIs(el, 'th')));
  return Object.assign(base, { kind:'simple', item: label || name || '굴림',
    formula: _formulaFromTitle(ir), roll: textOf(ir), result:'' });
}

/* 타임스탬프 "April 30, 2025 5:26PM" → "2025.04.30" */
const _MON = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
function _r20Date(s){
  const m = String(s || '').match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if(!m || !_MON[m[1].toLowerCase()]) return '';
  return m[3] + '.' + String(_MON[m[1].toLowerCase()]).padStart(2, '0') + '.' + m[2].padStart(2, '0');
}

/* ======================= Roll20 가져오기 ======================= */
function importRoll20(html, opts){
  const includeWhispers = !!opts.includeWhispers;
  const doc = new DOMParser().parseFromString(String(html), 'text/html');

  /* SingleFile 이 CSS 변수로 옮겨둔 아바타 이미지 */
  const sfImg = {};
  String(html).replace(/--sf-img-(\d+)\s*:\s*url\(\s*(["']?)(data:[^"')\s]+)\2\s*\)/g, (m, n, q, url) => { sfImg[n] = url; return m; });

  /* 제목: "Chat Log for [달리아&데시] 람피온의 저택 4부: ..." */
  const titleEl = doc.querySelector('title');
  let title = titleEl ? textOf(titleEl) : '';
  title = title.replace(/^chat\s*log\s*for\s*/i, '').replace(/^\[[^\]]*\]\s*/, '').trim();

  const msgs = findAll(doc.body || doc.documentElement, el => hasCls(el, 'message'), true);

  const B = makeBuilder(opts.narrators);
  const blocks = B.blocks, flush = B.flush, lastBlock = B.last, isNarr = B.isNarr;
  const speakers = new Map();            // name → {name,count,avatar,you,other}
  const dates = new Map();
  let curSpeaker = '', hiddenCount = 0, whisperCount = 0;
  const narrYou = { you:0, other:0 };
  function spk(name){
    if(!speakers.has(name)) speakers.set(name, { name, count:0, avatar:'', you:0, other:0 });
    return speakers.get(name);
  }
  function addText(speaker, rich){ if(B.text(speaker, rich)) spk(speaker).count++; }

  msgs.forEach(msg => {
    const isYou = hasCls(msg, 'you');
    const ts = textOf(findOne(msg, el => hasCls(el, 'tstamp')));
    if(ts){ const d = _r20Date(ts); if(d) dates.set(d, (dates.get(d) || 0) + 1); }

    const byEl = findOne(msg, el => hasCls(el, 'by'));
    const hasBy = !!byEl;
    if(hasBy){
      curSpeaker = textOf(byEl).replace(/[:：]\s*$/, '').trim();
    }

    /* 숨김 메시지 · 귓속말 */
    if(hasCls(msg, 'hidden-message') || /This message has been hidden/i.test(textOf(msg))){ hiddenCount++; flush(); return; }
    if(hasCls(msg, 'whisper') || hasCls(msg, 'private')){
      whisperCount++;
      if(!includeWhispers){ return; }
      curSpeaker = curSpeaker.replace(/^\((?:to|from)[^)]*\)\s*/i, '');
    }

    /* 화자 통계 · 아바타 */
    if(hasBy && !isNarr(curSpeaker)){
      const s = spk(curSpeaker);
      if(isYou) s.you++; else s.other++;
      if(!s.avatar){
        const img = findOne(findOne(msg, el => hasCls(el, 'avatar')) || msg, el => tagIs(el, 'img'));
        if(img){
          const st = img.getAttribute('style') || '';
          const v = st.match(/var\(--sf-img-(\d+)\)/);
          const src = img.getAttribute('src') || '';
          if(v && sfImg[v[1]]) s.avatar = sfImg[v[1]];
          else if(/^(https?:|data:image\/(png|jpe?g|gif|webp))/i.test(src)) s.avatar = src;
        }
      }
    } else if(hasBy){ if(isYou) narrYou.you++; else narrYou.other++; }

    if(hasBy) flush();                  // 화자 표기가 있으면 새 블록

    /* 장면 설명(desc) → 강조 나레이션 (연속되면 한 블록) */
    if(hasCls(msg, 'desc')){
      B.em(tidyRich(r20Rich(msg)));
      return;
    }
    /* 이모트 → 일반 나레이션 */
    if(hasCls(msg, 'emote')){
      flush();
      const rich = tidyRich(r20Rich(msg));
      if(stripTags(rich).trim()) blocks.push({ id:genId(), type:'narration', emphasis:false, text:rich });
      return;
    }
    /* /roll 결과 */
    if(hasCls(msg, 'rollresult')){
      const prev = lastBlock();
      const formula = _cleanFormula(textOf(findOne(msg, el => hasCls(el, 'formula'))));
      const roll = textOf(findOne(msg, el => hasCls(el, 'rolled')));
      blocks.push({ id:genId(), type:'dice', kind:'simple', speaker:curSpeaker,
        item: _labelFromDesc(prev) || (prev && prev.type === 'dice' ? prev.item : '') || '굴림', formula, roll, result:'' });
      return;
    }

    /* 일반 메시지 */
    const tpl = findOne(msg, el => /sheet-rolltemplate/.test(_cls(el)) || tagIs(el, 'table'));
    if(tpl){
      const prev = lastBlock();
      blocks.push(r20Dice(tpl, curSpeaker, prev));
      if(!isNarr(curSpeaker)) spk(curSpeaker).count++;
      return;
    }
    /* 인라인 굴림만 있는 메시지 → 단순 굴림 */
    const body = _kids(msg).filter(n => !(n.nodeType === 1 && r20Skip(n)));
    const inl = findAll(msg, el => hasCls(el, 'inlinerollresult'), true);
    const bodyText = body.map(n => n.nodeType === 3 ? n.nodeValue : textOf(n)).join('').trim();
    if(inl.length && bodyText === inl.map(textOf).join('').trim()){
      const prev = lastBlock();
      blocks.push({ id:genId(), type:'dice', kind:'simple', speaker:curSpeaker,
        item: (prev && prev.type === 'dice') ? prev.item : (_labelFromDesc(prev) || '굴림'),
        formula: _formulaFromTitle(inl[0]), roll: inl.map(textOf).join(', '), result:'' });
      return;
    }
    addText(curSpeaker, tidyRich(r20Rich(msg)));
  });
  flush();

  /* 날짜: 메시지가 가장 많은 날 */
  let date = '', best = 0;
  dates.forEach((n, d) => { if(n > best){ best = n; date = d; } });

  /* 역할 추정: 나레이션을 쓴 쪽(보통 GM)과 같은 쪽이면 NPC, 다른 쪽이면 PC */
  const gmIsYou = narrYou.you >= narrYou.other;
  const list = Array.from(speakers.values()).map(s => {
    const fromGM = gmIsYou ? s.you >= s.other : s.other > s.you;
    return { name:s.name, count:s.count, avatar:s.avatar, guessRole: fromGM ? 'NPC' : 'PC' };
  }).sort((a, b) => b.count - a.count);

  return { title, date, blocks, speakers:list,
           stats:{ messages:msgs.length, hidden:hiddenCount, whispers:whisperCount } };
}

/* ======================= 코코포리아 가져오기 ======================= */
/* 파일 이름 "[상서고] 헤스페리데스의 정원[main] (1).html" → "헤스페리데스의 정원" */
function _ccfTitle(fileName){
  return String(fileName || '').replace(/\.html?$/i, '').replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\[(?:main|other|info|雑談|メイン|情報|메인|잡담|정보)\]/gi, '')
    .replace(/^\s*\[[^\]]*\]\s*/, '').replace(/_+/g, ' ').trim();
}
function _normName(s){ return String(s || '').toLowerCase().replace(/[\s_\-\[\]()【】「」『』:：,.·!?~'"]+/g, ''); }

/* BCDice 결과 한 줄 → 주사위 블록
   "CC<=80 지능(아이디어) (1D100<=80) 보너스, 페널티 주사위[0] ＞ 74 ＞ 74 ＞ 보통 성공"
   "1D3 (1D3) ＞ 2" */
function ccfDice(text, speaker, prev){
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if(t.indexOf('＞') < 0) return null;
  const segs = t.split('＞').map(x => x.trim());
  const head = segs.shift();
  const fm = head.match(/^(.*?)\(([^()]*?\d*[dD]\d+[^()]*)\)\s*(.*)$/);
  if(!fm) return null;
  const pre = fm[1].trim().replace(/^#\d+\s*/, '');
  const formula = fm[2].replace(/\s+/g, '');
  const toks = pre.split(' ');
  const cmd = toks.shift() || '';
  let label = toks.join(' ').replace(/[【】]/g, '').trim();
  if(!label && !/\d*[dD]\d+|<=|CC|RES|CBR/i.test(cmd)) label = cmd;     // 명령어 없이 이름만 있는 경우
  const parts = segs.filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const nums = parts.filter(x => /^-?\d+$/.test(x));
  const roll = nums.length ? nums[nums.length - 1] : ((last.match(/-?\d+/) || [])[0] || '');
  const resText = /^-?\d+$/.test(last) ? '' : last;
  const fromLabel = _labelFromDesc(prev);
  const target = formula.match(/1D100<=(\d+)/i) || cmd.match(/<=\s*(\d+)/);
  if(target && resText && /성공|실패|펌블|크리|스페셜|成功|失敗|ファンブル|クリティカル|スペシャル/.test(resText)){
    return { id:genId(), type:'dice', kind:'check', speaker, item: label || fromLabel || '판정',
             grade:'보통', standard: target[1], roll, result: resText };
  }
  return { id:genId(), type:'dice', kind:'simple', speaker,
           item: label || fromLabel || (prev && prev.type === 'dice' ? prev.item : '') || '굴림',
           formula, roll, result: resText };
}

function importCcfolia(html, opts){
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const ps = findAll(doc.body || doc.documentElement, el => tagIs(el, 'p'), true);

  /* 1) 메시지 수집: [탭] 이름 : 본문 — 탭 표기([main] 등)는 무시, system(수치 변경 기록)은 제외 */
  const msgs = []; let systemCount = 0;
  ps.forEach(p => {
    const spans = _kids(p).filter(n => tagIs(n, 'span'));
    if(spans.length < 2) return;
    const nameEl = spans[spans.length - 2], bodyEl = spans[spans.length - 1];
    const name = textOf(nameEl).replace(/^\[[^\]]*\]\s*/, '').trim();
    if(/^system$/i.test(name)){ systemCount++; return; }
    const color = ((p.getAttribute('style') || '').match(/color\s*:\s*(#[0-9a-fA-F]{3,8})/) || [])[1] || '';
    msgs.push({ name, color, rich: tidyRich(r20Rich(bodyEl)), plain: textOf(bodyEl) });
  });

  /* 2) 나레이션 화자 자동 추정: 파일 이름(=방 이름)과 같은 이름이면서 가장 말이 많은 화자 */
  const counts = new Map(); msgs.forEach(m => counts.set(m.name, (counts.get(m.name) || 0) + 1));
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  const fileNorm = _normName(opts.fileName);
  const autoNarrators = [];
  const narrators = (opts.narrators || []).slice();
  if(opts.autoNarrator !== false && top && _normName(top[0]).length >= 2 && fileNorm.includes(_normName(top[0]))
     && !isNarrationName(top[0], narrators)){
    autoNarrators.push(top[0]); narrators.push(top[0]);
  }

  /* 3) 블록 만들기 */
  const B = makeBuilder(narrators);
  const speakers = new Map();
  const spk = n => { if(!speakers.has(n)) speakers.set(n, { name:n, count:0, colors:new Map(), rolled:false }); return speakers.get(n); };
  msgs.forEach(m => {
    const narr = B.isNarr(m.name);
    if(!narr && m.color){ const s = spk(m.name); s.colors.set(m.color, (s.colors.get(m.color) || 0) + 1); }
    const dice = m.plain.indexOf('＞') >= 0 ? ccfDice(m.plain, m.name, B.last()) : null;   // 후보일 때만 직전 블록 조회
    if(dice){
      B.push(dice);
      if(!narr){ const s = spk(m.name); s.count++; s.rolled = true; }
      return;
    }
    if(B.text(m.name, m.rich)) spk(m.name).count++;
  });
  B.flush();

  const list = Array.from(speakers.values()).map(s => {
    const color = Array.from(s.colors.entries()).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '';
    return { name:s.name, count:s.count, avatar:'', color, guessRole: s.rolled ? 'PC' : 'NPC' };
  }).sort((a, b) => b.count - a.count);

  return { title: autoNarrators[0] || _ccfTitle(opts.fileName), date:'', blocks:B.blocks, speakers:list, autoNarrators,
           stats:{ messages:msgs.length, hidden:0, whispers:0, system:systemCount } };
}

/* ---- 주사위 판정 분류 (뷰어에서 사용) ---- */
function diceVerdict(block){
  const r = block.result;
  if(r){
    if(/대성공|극단적\s*성공|크리/i.test(r)) return { cls:'crit', text:r };
    if(/대실패|펌블|극단적\s*실패/i.test(r)) return { cls:'fail', text:r };
    if(/실패/.test(r)) return { cls:'fail', text:r };
    if(/성공/.test(r)) return { cls:'ok', text:r };
    return { cls:'', text:r };
  }
  const std = firstNum(block.standard != null && block.standard !== '' ? block.standard : block.target);
  if((block.kind === 'check' || block.kind === 'vs') && isNum(block.roll) && std !== ''){
    return Number(block.roll) <= Number(std) ? { cls:'ok', text:'성공' } : { cls:'fail', text:'실패' };
  }
  return { cls:'', text:'' };
}
