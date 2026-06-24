/* =========================================================================
   parser.js — Roll20 로그 → 블록 배열
   --------------------------------------------------------------------------
   규칙
   - 블록은 줄 안의 화자 ':' 기호로 나눈다. 다음 화자가 나오기 전까지는
     이전 화자(대사) 또는 나레이션을 그대로 유지하여 한 블록(여러 줄)으로 본다.
   - ':' 앞의 화자명이 비었거나 '(GM)' 이 포함되면 나레이션으로 본다.
   - 주사위 유형은 2가지: 기준치(check), 단순 굴림(simple).
     · 기준치 필드: 판정명/등급/기준치/굴림/판정결과
     · 두 형식(줄바꿈형 'vs.' 구조 + 한 줄형 '기준치:..굴림:..판정결과:..')을 하나로 통일
     · 기준치가 65/32/13 처럼 여러 값이면 가장 앞 값(65)을 자동 입력
   ========================================================================= */
const isNum   = s => s != null && /^-?\d+(?:\.\d+)?$/.test(String(s).trim());
const isBonus = s => s != null && /bonus|penalty/i.test(String(s).trim());
const isRollFormula = s => s != null && /^rolling\s+\d*d\d+/i.test(String(s).trim());
const GRADE_RE = /(대단히\s*어려운|대단히\s*어려움|어려운\s*성공|어려운|어려움|보통|쉬운|쉬움|극단적|불가능|곤란)\s*$/;
function firstNum(s){ const m = String(s == null ? '' : s).match(/-?\d+/); return m ? m[0] : ''; }
function stripTags(s){ return String(s == null ? '' : s).replace(/<[^>]+>/g, ''); }

/* contenteditable HTML → 줄 배열 (img 제거, b/i 보존, 블록요소·br = 줄바꿈) */
function htmlToLines(html){
  const tmp = document.createElement('div');
  const ALLOWED = ['br','b','strong','i','em','div','p','li','tr','h1','h2','h3','h4','h5','section','article','blockquote'];
  tmp.innerHTML = escapeStrayAngles(html || '', ALLOWED);
  tmp.querySelectorAll('img, picture, svg, script, style, video, audio').forEach(n => n.remove());
  function ser(node){
    let out = '';
    node.childNodes.forEach(child => {
      if(child.nodeType === 3){ out += child.nodeValue; return; }
      if(child.nodeType !== 1) return;
      const tag = child.tagName.toLowerCase();
      if(tag === 'br'){ out += '\n'; return; }
      if(tag === 'b' || tag === 'strong'){ out += '<b>' + ser(child) + '</b>'; return; }
      if(tag === 'i' || tag === 'em'){ out += '<i>' + ser(child) + '</i>'; return; }
      const block = ['div','p','li','tr','h1','h2','h3','h4','h5','section','article','blockquote'].includes(tag);
      if(block) out += '\n' + ser(child) + '\n'; else out += ser(child);
    });
    return out;
  }
  return ser(tmp).replace(/\u00a0/g, ' ').split('\n');
}

/* 따옴표 기준 분해: 안=대사(line), 밖=지문(narr) */
function splitDialogueSegments(text){
  const norm = String(text).replace(/[\u201C\u201D]/g, '"');
  const parts = norm.split('"');
  const segs = [];
  parts.forEach((p, idx) => {
    const t = p.trim();
    if(!t) return;
    segs.push({ kind: (idx % 2 === 1) ? 'line' : 'narr', text: applyRich(t) });
  });
  if(segs.length === 0) segs.push({ kind: 'narr', text: applyRich(text) });
  return segs;
}

/* 단순 굴림형:  rolling 1d100 \n ( \n 80 \n ) \n = \n 80 */
function detectRollFormula(lines, start){
  const m = stripTags(lines[start] || '').trim().match(/^rolling\s+(\d*d\d+(?:\s*[+\-]\s*\d+)?)/i);
  if(!m) return null;
  const formula = m[1].replace(/\s+/g, '');
  let result = '', lastNum = '', end = start;
  for(let j = start + 1; j < Math.min(start + 8, lines.length); j++){
    const t = stripTags(lines[j] || '').trim();
    if(t === ''){ end = j; continue; }
    if(isRollFormula(t) || /[:：]/.test(t)) break;
    if(/^=$/.test(t)){
      const nx = stripTags(lines[j+1] || '').trim();
      if(isNum(nx)){ result = nx; end = j + 1; break; }
    }
    if(isNum(t)){ lastNum = t; end = j; continue; }
    if(/^[()=]$/.test(t)){ end = j; continue; }
    break;
  }
  if(!result) result = lastNum;
  if(!result) return null;
  return { block: { id: genId(), type:'dice', kind:'simple', speaker:null,
                    item:'굴림', formula, roll: result, result:'' }, end };
}

/* PASS 0 — 주사위 구간 탐지 */
function findDiceSpans(lines){
  const spans = [];
  const N = lines.length;
  const used = new Array(N).fill(false);
  for(let i = 0; i < N; i++){
    if(used[i]) continue;
    const t = stripTags(lines[i] || '').trim();
    if(t === '') continue;

    /* 한 줄형 공격(무기/기준치 3개/굴림/판정결과/피해) — 기준치 뒤의 '고장' 항목은 표시하지 않고 건너뜀 */
    const atk = t.match(/^(.*?)기준치\s*[:：]\s*([0-9/]+)\s*고장\s*[:：]\s*.*?굴림\s*[:：]\s*(\d+)\s*판정결과\s*[:：]\s*(.+?)\s*피해\s*[:：]\s*(.+)$/);
    if(atk){
      spans.push({ start:i, end:i, block:{ id:genId(), type:'dice', kind:'attack', speaker:null,
        item:(atk[1].trim() || '무기'), standard:atk[2].trim(),
        roll:atk[3].trim(), result:atk[4].trim(), damage:atk[5].trim() } });
      used[i] = true; continue;
    }

    /* 한 줄형 기준치 */
    const one = t.match(/^(.*?)기준치\s*[:：]\s*([0-9/]+)\s*굴림\s*[:：]\s*(\d+)\s*판정결과\s*[:：]\s*(.+)$/);
    if(one){
      spans.push({ start:i, end:i, block:{ id:genId(), type:'dice', kind:'check', speaker:null,
        item:(one[1].trim() || '판정'), grade:'보통', standard:firstNum(one[2]),
        roll:one[3].trim(), result:one[4].trim() } });
      used[i] = true; continue;
    }

    /* 단순 굴림 */
    if(isRollFormula(t)){
      const rf = detectRollFormula(lines, i);
      if(rf){ spans.push({ start:i, end:rf.end, block:rf.block }); for(let k=i;k<=rf.end;k++) used[k]=true; continue; }
    }

    /* 줄바꿈형 vs → 기준치로 통일 */
    const vsm = t.match(/(\d+)\s*vs\.?\s*(\d+)/i);
    if(vsm){
      const roll = vsm[1], standard = vsm[2];
      let headIdx = i - 1, result = '';
      const p1 = stripTags(lines[i-1] || '').trim();
      if(p1 && !/[:：]/.test(p1) && !/\d+\s*vs/i.test(p1) && /(대성공|대실패|성공|실패|펌블|크리)/.test(p1)){
        result = p1; headIdx = i - 2;
      }
      const head = stripTags(lines[headIdx] || '').trim();
      let item = '판정', grade = '', stripName = false;
      if(head && !/[:：]/.test(head)){
        let rest = head;
        const gm = rest.match(GRADE_RE);
        if(gm){ grade = gm[1].replace(/\s+/g,' ').trim(); rest = rest.slice(0, gm.index).trim(); }
        item = rest || '판정';   // 이름+판정명 (이름은 fold 단계에서 제거)
        stripName = true;
      } else { headIdx = i; }
      if(!grade) grade = '보통';   // 등급 표기가 없으면 기본값
      let end = i;
      if(lines[i+1] && isBonus(stripTags(lines[i+1]))) end = i + 1;
      const start = Math.min(headIdx, i);
      spans.push({ start, end, block:{ id:genId(), type:'dice', kind:'check', speaker:null,
        item, grade, standard, roll, result, _stripName:stripName } });
      for(let k=start;k<=end;k++) used[k]=true;
      continue;
    }
  }
  spans.sort((a,b) => a.start - b.start);
  return spans;
}

/* 메인 파서 */
function parseRoll20(rawHtml, gmNames){
  const lines = htmlToLines(rawHtml);
  const gmSet = new Set((gmNames || []).map(g => g.trim()).filter(Boolean));
  const spans = findDiceSpans(lines);
  const spanByStart = new Map(); spans.forEach(s => spanByStart.set(s.start, s));
  const inSpan = new Array(lines.length).fill(false);
  spans.forEach(s => { for(let k=s.start;k<=s.end;k++) inSpan[k] = true; });

  const blocks = [];
  let cur = null;             // {type:'dialogue', speaker, segs:[]} | {type:'narration', lines:[]}
  let lastSpeaker = null;

  function flush(){
    if(!cur) return;
    if(cur.type === 'dialogue'){
      const segs = cur.segs.filter(s => stripTags(s.text).trim() !== '');
      if(segs.length) blocks.push({ id:genId(), type:'dialogue', speaker:cur.speaker, segments:segs });
    } else {
      const text = cur.lines.filter(l => stripTags(l).trim() !== '').join('<br>');
      if(text) blocks.push({ id:genId(), type:'narration', emphasis:false, text });
    }
    cur = null;
  }
  function startSpeaker(name, content){
    flush();
    const isNarr = (name === '' || /\(\s*gm\s*\)/i.test(name) || gmSet.has(name));
    if(isNarr){
      cur = { type:'narration', lines:[] };
      if(content) cur.lines.push(applyRich(content));
    } else {
      lastSpeaker = name;
      cur = { type:'dialogue', speaker:name, segs:[] };
      if(content) splitDialogueSegments(content).forEach(s => cur.segs.push(s));
    }
  }

  for(let i = 0; i < lines.length; i++){
    if(inSpan[i]){
      if(spanByStart.has(i)){
        const sp = spanByStart.get(i);
        const b = sp.block;
        b.speaker = lastSpeaker;
        if(b._stripName && lastSpeaker && b.item && b.item.indexOf(lastSpeaker) === 0){
          b.item = b.item.slice(lastSpeaker.length).trim() || '판정';
        }
        delete b._stripName;
        flush();
        blocks.push(b);
        i = sp.end;
      }
      continue;
    }
    const raw = lines[i];
    const trimmed = raw.trim();
    if(trimmed === '') continue;          // 빈 줄은 같은 블록 유지

    const plain = stripTags(raw);
    const sm = plain.match(/^([^:："\u201C\u201D]{0,30})[:：]([\s\S]*)$/);
    if(sm){
      const name = sm[1].trim();
      const idx = raw.search(/[:：]/);
      const content = raw.slice(idx + 1).trim();
      startSpeaker(name, content);
      continue;
    }
    if(!cur) cur = { type:'narration', lines:[] };
    if(cur.type === 'dialogue') splitDialogueSegments(trimmed).forEach(s => cur.segs.push(s));
    else cur.lines.push(applyRich(trimmed));
  }
  flush();
  return blocks;
}

/* 주사위 판정 분류 */
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
    const pass = Number(block.roll) <= Number(std);
    return pass ? { cls:'ok', text:'성공' } : { cls:'fail', text:'실패' };
  }
  return { cls:'', text:'' };
}
