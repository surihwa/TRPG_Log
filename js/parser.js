/* =========================================================================
   parser.js — Roll20 로그 → 블록 배열 (정규식, 줄 단위)
   ========================================================================= */
const isNum   = s => s != null && /^-?\d+(?:\.\d+)?$/.test(String(s).trim());
const isVs    = s => s != null && /^vs\.?$/i.test(String(s).trim());
const isBonus = s => s != null && /bonus|penalty/i.test(String(s).trim());
const isRollFormula = s => s != null && /^rolling\s+\d*d\d+/i.test(String(s).trim());

/* contenteditable HTML → 줄 배열 (img 제거, b/i 보존, 블록요소·br = 줄바꿈) */
function htmlToLines(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
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

/* 줄바꿈형 주사위(vs. 구조) — 반드시 "이름" 줄에서 시작하고
   이름과 vs. 사이에 콜론·따옴표가 없는 빽빽한 블록일 때만 인식 */
function detectLineBreakDice(lines, start){
  const name = (lines[start] || '').trim();
  if(!name || /[:："“”]/.test(name) || name.length > 30) return null;
  for(let v = start + 3; v <= Math.min(start + 6, lines.length - 2); v++){
    if(!isVs((lines[v] || '').trim())) continue;
    const roll   = (lines[v-1] || '').trim();
    const target = (lines[v+1] || '').trim();
    if(!isNum(roll) || !isNum(target)) return null;
    // 이름과 vs. 사이의 줄은 모두 비어있지 않고 콜론/따옴표가 없어야 함
    let ok = true;
    for(let k = start + 1; k < v; k++){
      const t = (lines[k] || '').trim();
      if(t === '' || /[:："“”]/.test(t)){ ok = false; break; }
    }
    if(!ok) return null;
    const grade = (lines[v-2] || '').trim();
    const item  = (v - 3 >= start + 1) ? (lines[v-3] || '').trim() : '';
    let end = v + 1;
    if(lines[v+2] && isBonus(lines[v+2])) end = v + 2;
    return { block: { id: genId(), type: 'dice', kind:'vs', speaker: name,
                      item: item || '판정', grade, roll, target, result: '' }, end };
  }
  return null;
}

/* 단순 굴림형:  rolling 1d100 \n ( \n 80 \n ) \n = \n 80  */
function detectRollFormula(lines, start){
  const m = (lines[start] || '').trim().match(/^rolling\s+(\d*d\d+(?:\s*[+\-]\s*\d+)?)/i);
  if(!m) return null;
  const formula = m[1].replace(/\s+/g, '');
  // 이후 6줄 안에서 "=" 다음의 숫자를 결과로 채택, 없으면 마지막 숫자
  let result = '', lastNum = '', end = start;
  for(let j = start + 1; j < Math.min(start + 7, lines.length); j++){
    const t = (lines[j] || '').trim();
    if(t === '') { end = j; continue; }
    if(isRollFormula(t) || /[:：]/.test(t)) break;   // 다음 블록 시작
    if(/^=$/.test(t)){
      const nx = (lines[j+1] || '').trim();
      if(isNum(nx)){ result = nx; end = j + 1; break; }
    }
    if(isNum(t)){ lastNum = t; end = j; }
    if(/[A-Za-z가-힣]/.test(t) && !/^[()]$/.test(t)) break;
  }
  if(!result) result = lastNum;
  if(!result) return null;
  return { block: { id: genId(), type:'dice', kind:'simple', speaker:null,
                    item: '굴림', formula, roll: result, result: '' }, end };
}

/* 메인 파서 */
function parseRoll20(rawHtml, gmNames){
  const lines = htmlToLines(rawHtml);
  const blocks = [];
  const gmSet = new Set((gmNames || []).map(g => g.trim()).filter(Boolean));
  let pendingSpeaker = null;
  const N = lines.length;
  let i = 0;

  while(i < N){
    const line = (lines[i] || '').trim();
    if(line === ''){ i++; continue; }

    /* 1) 한 줄 결합형 주사위 */
    const one = line.match(/^(.*?)기준치\s*[:：]\s*(.+?)\s*굴림\s*[:：]\s*(.+?)\s*판정결과\s*[:：]\s*(.+)$/);
    if(one){
      blocks.push({ id: genId(), type:'dice', kind:'check', speaker: pendingSpeaker,
                    item: (one[1].trim() || '판정'), standard: one[2].trim(),
                    roll: one[3].trim(), result: one[4].trim() });
      pendingSpeaker = null; i++; continue;
    }

    /* 2) 줄 시작 콜론 → 화자 없는 (일반) 나레이션 */
    if(line[0] === ':' || line[0] === '：'){
      const rest = line.replace(/^[:：]\s*/, '');
      if(rest === ''){ pendingSpeaker = null; i++; continue; }
      blocks.push({ id: genId(), type:'narration', emphasis:false, text: applyRich(rest) });
      i++; continue;
    }

    /* 3) "이름: ..." 화자 패턴 (콜론 포함) */
    const sm = line.match(/^([^:：]{1,40})[:：](.*)$/);
    if(sm){
      const name = sm[1].trim();
      const rest = sm[2].trim();
      if(gmSet.has(name)){
        if(rest) blocks.push({ id: genId(), type:'narration', emphasis:true, text: applyRich(rest) });
        i++; continue;
      }
      if(rest === ''){ pendingSpeaker = name; i++; continue; }
      blocks.push({ id: genId(), type:'dialogue', speaker:name, segments: splitDialogueSegments(rest) });
      i++; continue;
    }

    /* 4) 단순 굴림형 (rolling 1d100 ... = 80) */
    if(isRollFormula(line)){
      const rf = detectRollFormula(lines, i);
      if(rf){ rf.block.speaker = pendingSpeaker; blocks.push(rf.block); pendingSpeaker = null; i = rf.end + 1; continue; }
    }

    /* 5) 줄바꿈형 vs 주사위 (콜론 없는 이름 줄에서만) */
    const lb = detectLineBreakDice(lines, i);
    if(lb){ blocks.push(lb.block); pendingSpeaker = null; i = lb.end + 1; continue; }

    /* 6) 이름만 있는 줄이고 다음이 주사위면 → 다음 주사위의 화자 후보 */
    const next = (lines[i+1] || '').trim();
    if(line.length <= 24 && (isRollFormula(next) || (isNum(next) && isVs((lines[i+2]||'').trim())))){
      pendingSpeaker = line; i++; continue;
    }

    /* 7) 그 외 → 일반 나레이션 */
    blocks.push({ id: genId(), type:'narration', emphasis:false, text: applyRich(line) });
    i++;
  }
  return blocks;
}

/* 주사위 등급 분류 */
function diceVerdict(block){
  if(block.result){
    const r = block.result;
    if(/대성공|극단적\s*성공|크리/i.test(r)) return { cls:'crit', text:r };
    if(/대실패|펌블|극단적\s*실패/i.test(r)) return { cls:'fail', text:r };
    if(/실패/.test(r)) return { cls:'fail', text:r };
    if(/성공/.test(r)) return { cls:'ok', text:r };
    return { cls:'', text:r };
  }
  if(block.kind === 'vs' && isNum(block.roll) && isNum(block.target)){
    const pass = Number(block.roll) <= Number(block.target);
    return pass ? { cls:'ok', text:'성공' } : { cls:'fail', text:'실패' };
  }
  return { cls:'', text:'' };
}
