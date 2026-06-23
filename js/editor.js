/* =========================================================================
   editor.js — 로그 등록 및 편집
   ========================================================================= */
const E = () => state.editor;
function activeScene(){ const e = E(); return e.scenes.find(s => s.id === e.activeScene) || null; }

function blankEditor(){
  return {
    id: genId(), folder:'', title:'', date:'', theme:'light', cardImage:'',
    characters:[ { id:genId(), name:'', role:'PC', color:'#7c2d2d', img:'' } ],
    scenes:[ { id:genId(), title:'장면 1', blocks:[] } ],
    activeScene:null
  };
}

function openEditor(){
  state.editor = blankEditor();
  state.editor.activeScene = state.editor.scenes[0].id;
  enterEditorView();
}

/* 기존 세션을 편집기로 불러오기 */
function editExistingSession(sessionId, sceneId){
  const ses = findSession(sessionId);
  if(!ses){ toast('세션을 찾을 수 없습니다.'); return; }
  state.editor = JSON.parse(JSON.stringify(ses));   // 깊은 복제
  if(!state.editor.scenes || !state.editor.scenes.length)
    state.editor.scenes = [{ id:genId(), title:'장면 1', blocks:[] }];
  state.editor.activeScene = sceneId && state.editor.scenes.find(s=>s.id===sceneId)
    ? sceneId : state.editor.scenes[0].id;
  enterEditorView();
}

function enterEditorView(){
  closeViewer();
  state.view = 'editor';
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-editor').classList.add('active');
  $('#topbar').style.display = '';
  renderEditor();
  window.scrollTo({ top:0 });
}

/* =========================== 렌더 =========================== */
function renderEditor(){
  const e = E();
  const folderOptions = DB.folders.map(f =>
    `<option value="${f.name}" ${f.name===e.folder?'selected':''}>${f.name}</option>`).join('');

  $('#editorRoot').innerHTML = `
    <h1>${e.id && findSession(e.id) ? '세션 편집' : '새 로그 등록'}</h1>
    <p class="lead">세션 정보와 등장인물을 먼저 정한 뒤, 장면별로 로그를 편집합니다.</p>

    <!-- 1) 폴더 / 세션 정보 -->
    <div class="panel">
      <h3><span class="step">1</span> 폴더 · 세션 정보</h3>
      <div class="field folder-pick">
        <div>
          <label class="fld">기존 폴더(캠페인) 선택</label>
          <select id="fFolderSel" onchange="editorPickFolder(this.value)">
            <option value="">— 선택 —</option>${folderOptions}
          </select>
        </div>
        <div>
          <label class="fld">또는 새 폴더 이름</label>
          <input type="text" id="fFolder" value="${escAttr(e.folder)}" placeholder="예: 단편 모음"
            oninput="E().folder=this.value">
        </div>
      </div>
      <div class="grid2">
        <div class="field"><label class="fld">세션 제목</label>
          <input type="text" id="fTitle" value="${escAttr(e.title)}" oninput="E().title=this.value" placeholder="예: 성벽을 넘어서"></div>
        <div class="field"><label class="fld">날짜</label>
          <input type="text" id="fDate" value="${escAttr(e.date)}" oninput="E().date=this.value" placeholder="예: 2024.11.03"></div>
      </div>
      <div class="grid2">
        <div class="field"><label class="fld">뷰어 기본 테마</label>
          <select id="fTheme" onchange="E().theme=this.value">
            <option value="light" ${e.theme==='light'?'selected':''}>라이트(아이보리)</option>
            <option value="dark" ${e.theme==='dark'?'selected':''}>다크(나이트)</option>
          </select></div>
        <div class="field"><label class="fld">세션 카드 이미지 경로</label>
          <input type="text" id="fCard" value="${escAttr(e.cardImage)}" oninput="E().cardImage=this.value" placeholder="image/세션명/_cover.png">
          <div class="hint">깃허브 경로를 적습니다. 예: <code>image/성벽을 넘어서/_cover.png</code></div></div>
      </div>
    </div>

    <!-- 2) 등장인물 -->
    <div class="panel">
      <h3><span class="step">2</span> 등장인물</h3>
      <p class="desc">역할 — <b>KPC/NPC</b>는 뷰어 왼쪽, <b>PC</b>는 오른쪽에 표시됩니다. 여기 없는 이름은 모두 NPC로 처리됩니다.</p>
      <div class="char-list" id="charList"></div>
      <button class="btn sm" style="margin-top:12px" onclick="editorAddChar()">＋ 캐릭터 추가</button>
    </div>

    <!-- 3) 장면 -->
    <div class="panel">
      <h3><span class="step">3</span> 장면</h3>
      <p class="desc">세션은 여러 장면으로 나뉩니다. 장면을 선택하면 아래에서 그 장면의 로그를 편집합니다.</p>
      <div class="scene-tabs" id="sceneTabs"></div>
      <button class="btn sm" onclick="editorAddScene()">＋ 장면 추가</button>
    </div>

    <!-- 4) 장면 로그 편집 -->
    <div class="panel" id="scenePanel"></div>

    <!-- 5) 저장 / 내보내기 -->
    <div class="panel">
      <h3><span class="step">4</span> 저장 · 내보내기</h3>
      <p class="desc">편집을 마치면 JSON 파일로 내려받아 깃허브 <code>data/sessions/</code> 에 올리고
        <code>data/manifest.json</code> 목록에 추가하면 페이지에 반영됩니다. (자세한 방법은 README 참고)</p>
      <textarea class="json-out" id="jsonOut" readonly placeholder="여기에 JSON 미리보기가 표시됩니다."></textarea>
      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" onclick="editorRefreshJSON()">JSON 생성</button>
        <button class="btn" onclick="editorCopyJSON()">복사</button>
        <button class="btn primary" onclick="editorDownloadJSON()">⬇ 세션 JSON 다운로드</button>
        <button class="btn ghost" onclick="editorPreview()">미리보기(현재 장면)</button>
      </div>
    </div>`;

  renderCharList();
  renderSceneTabs();
  renderScenePanel();
}

function escAttr(s){ return String(s==null?'':s).replace(/"/g,'&quot;'); }

/* ---- 폴더 선택 ---- */
function editorPickFolder(name){ if(name){ E().folder = name; $('#fFolder').value = name; } }

/* ---- 등장인물 ---- */
function renderCharList(){
  const wrap = $('#charList'); wrap.innerHTML = '';
  E().characters.forEach(c => {
    const url = resolveImg(c.img);
    const prev = url ? `background-image:url('${url}')` : `background-color:${c.color}`;
    const row = document.createElement('div');
    row.className = 'char-row';
    row.innerHTML = `
      <div class="avatar av-prev" data-prev="${c.id}" style="${prev}"></div>
      <input type="text" value="${escAttr(c.name)}" placeholder="이름" oninput="editorCharField('${c.id}','name',this.value)">
      <select onchange="editorCharField('${c.id}','role',this.value)">
        <option value="PC"  ${c.role==='PC'?'selected':''}>PC</option>
        <option value="KPC" ${c.role==='KPC'?'selected':''}>KPC</option>
        <option value="NPC" ${c.role==='NPC'?'selected':''}>NPC</option>
      </select>
      <input type="text" value="${escAttr(c.img)}" placeholder="image/세션명/캐릭터.png" oninput="editorCharField('${c.id}','img',this.value)">
      <input type="color" class="swatch" value="${c.color || '#7c2d2d'}" oninput="editorCharField('${c.id}','color',this.value)">
      <button class="del" title="삭제" onclick="editorRemoveChar('${c.id}')">✕</button>`;
    wrap.appendChild(row);
  });
}
function editorAddChar(){ E().characters.push({ id:genId(), name:'', role:'PC', color:'#7c2d2d', img:'' }); renderCharList(); }
function editorRemoveChar(id){ E().characters = E().characters.filter(c => c.id !== id); renderCharList(); }
function editorCharField(id, field, val){
  const c = E().characters.find(x => x.id === id); if(!c) return;
  c[field] = val;
  // 입력 도중 목록 전체를 다시 그리면 입력칸 포커스를 잃고(이미지 경로가 한 글자씩만 입력됨)
  // 색상 선택창도 닫히므로, 여기서는 모델만 갱신하고 미리보기 원만 즉석에서 바꾼다.
  if(field === 'color' || field === 'img'){
    const prev = document.querySelector('.av-prev[data-prev="' + id + '"]');
    if(prev){
      const url = resolveImg(c.img);
      prev.style.cssText = url
        ? "background-image:url('" + url + "')"
        : "background-image:none;background-color:" + c.color;
    }
  }
}

/* ---- 장면 ---- */
function renderSceneTabs(){
  const wrap = $('#sceneTabs'); wrap.innerHTML = '';
  E().scenes.forEach(sc => {
    const pill = document.createElement('div');
    pill.className = 'scene-pill' + (sc.id === E().activeScene ? ' active' : '');
    pill.innerHTML = `<span onclick="editorSelectScene('${sc.id}')">${applyRich(sc.title || '장면')}</span>
      <span class="x" title="삭제" onclick="editorRemoveScene('${sc.id}')">✕</span>`;
    wrap.appendChild(pill);
  });
}
function editorSelectScene(id){ E().activeScene = id; renderSceneTabs(); renderScenePanel(); }
function editorAddScene(){
  const sc = { id:genId(), title:'장면 ' + (E().scenes.length+1), blocks:[] };
  E().scenes.push(sc); E().activeScene = sc.id; renderSceneTabs(); renderScenePanel();
}
function editorRemoveScene(id){
  if(E().scenes.length <= 1){ toast('최소 한 개의 장면이 필요합니다.'); return; }
  E().scenes = E().scenes.filter(s => s.id !== id);
  if(E().activeScene === id) E().activeScene = E().scenes[0].id;
  renderSceneTabs(); renderScenePanel();
}
function editorRenameScene(val){ const sc = activeScene(); if(sc) sc.title = val; renderSceneTabs(); }

/* ---- 장면 패널(로그 편집) ---- */
function renderScenePanel(){
  const sc = activeScene();
  const panel = $('#scenePanel');
  if(!sc){ panel.innerHTML = '<p class="desc">편집할 장면을 선택하세요.</p>'; return; }
  panel.innerHTML = `
    <h3>장면 편집 — <input type="text" value="${escAttr(sc.title)}" style="width:auto; display:inline-block; max-width:260px"
      oninput="editorRenameScene(this.value)"></h3>
    <div class="field" style="margin-top:14px">
      <label class="fld">Roll20 로그 붙여넣기</label>
      <div class="paste-area" id="pasteArea" contenteditable="true" data-ph="여기에 Roll20 로그를 붙여넣으세요…"></div>
      <div class="paste-note">📌 이미지 자동 제거 · 볼드/기울임 서식 유지</div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn primary sm" onclick="editorConvert()">변환 → 블록</button>
        <button class="btn ghost sm" onclick="$('#pasteArea').innerHTML=''">비우기</button>
        <button class="btn ghost sm" onclick="editorLoadSample()">예시 로그 넣기</button>
      </div>
    </div>
    <div style="border-top:1px solid var(--line); margin:18px 0;"></div>
    <div class="blocks" id="blockList"></div>`;
  // 붙여넣기 시 이미지 제거
  const pa = $('#pasteArea');
  pa.addEventListener('paste', e => {
    e.preventDefault();
    const cb = e.clipboardData || window.clipboardData;
    let html = cb.getData('text/html');
    if(html) html = sanitizeHTML(html, ['p','br','b','strong','i','em','div','span']);
    else html = (cb.getData('text/plain')||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    document.execCommand('insertHTML', false, html);
    toast('이미지를 제거하고 텍스트만 붙여넣었습니다.');
  });
  renderBlocks();
}

function editorConvert(){
  const sc = activeScene(); if(!sc) return;
  const gm = E().characters.filter(c => c.role === 'NPC' && /gm|지엠|게임마스터/i.test(c.name)).map(c=>c.name);
  const blocks = parseRoll20($('#pasteArea').innerHTML, gm.length?gm:['GM']);
  if(blocks.length === 0){ toast('변환할 내용이 없습니다.'); return; }
  sc.blocks = sc.blocks.concat(blocks);
  $('#pasteArea').innerHTML = '';
  renderBlocks();
  toast(blocks.length + '개 블록으로 변환했습니다.');
}

function editorLoadSample(){
  $('#pasteArea').innerText =
`먼지 (GM):소리 없이 한 송이의 목을 꺾자 꽃송이 사이로 틈이 벌어집니다.
그리고 철창의 틈새로 달리아는 상대와 눈이 마주칩니다.
:람피온의 저택에서 한 번도 본 적 없는 사람입니다.
달리아 리모스:누구지? 몸을 살짝 더 기울인다. "너 누구야?"
달리아 리모스:"아, 잃어버린 걸 찾으러...!" 이 깊은... 깊은
달리아 리모스intelligence보통
실패
77vs.65
bonus / penalty
:깊은...숲...이었나? 기억이 가물가물합니다.
키셰:
지능기준치:65/32/13굴림:47판정결과:보통 성공
:혹시 빈민가에서 훔쳐 온 망토를 쓰면 따라갈 수 있을지도 모릅니다.`;
  toast('예시 로그를 넣었습니다. [변환]을 눌러보세요.');
}

/* ===================== 블록 목록 / 편집 ===================== */
function renderBlocks(){
  const sc = activeScene(); const wrap = $('#blockList'); wrap.innerHTML = '';
  if(!sc.blocks.length){
    wrap.innerHTML = `<div style="color:var(--ink-faint); font-size:13.5px; padding:10px 2px;">
      아직 블록이 없습니다. 위에서 로그를 변환하거나 아래 버튼으로 직접 추가하세요.</div>`;
  }
  wrap.appendChild(gapEl(0));
  sc.blocks.forEach((b, idx) => {
    wrap.appendChild(buildBlockCard(b, idx));
    wrap.appendChild(gapEl(idx+1));
  });
}
function gapEl(insertAt){
  const g = document.createElement('div');
  g.className = 'block-gap';
  g.innerHTML = `<button class="add-here" onclick="editorInsertMenu(${insertAt}, this)">＋ 여기에 블록 추가</button>`;
  return g;
}
let _insertAt = 0;
function editorInsertMenu(at){
  _insertAt = at;
  const types = [['narration-normal','일반 나레이션'],['narration-em','강조 나레이션'],['handout','핸드아웃'],['bgm','BGM'],['dialogue','대사'],['dice','주사위']];
  // 간단한 선택: prompt 대신 순환 메뉴 → 토스트로 안내하기보다 바로 일반 나레이션 추가 + 타입 변경 가능
  const menu = document.createElement('div');
  // 인라인 미니 메뉴를 토스트처럼 표시
  const html = types.map(t => `<button class="btn sm" onclick="editorInsertBlock('${t[0]}')">${t[1]}</button>`).join(' ');
  showInsertChooser(html);
}
function showInsertChooser(html){
  let m = $('#insertChooser');
  if(!m){ m = document.createElement('div'); m.id='insertChooser';
    m.style.cssText='position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:#fff;border:1px solid var(--line-2);box-shadow:0 10px 30px rgba(0,0,0,.18);border-radius:12px;padding:12px 14px;z-index:210;display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
    document.body.appendChild(m);
  }
  m.innerHTML = `<span style="font-size:12px;color:var(--ink-soft);font-weight:600;margin-right:4px">추가할 블록:</span>${html}
    <button class="btn ghost sm" onclick="$('#insertChooser').remove()">닫기</button>`;
}
function editorInsertBlock(type){
  const sc = activeScene(); let b;
  if(type === 'narration-normal') b = { id:genId(), type:'narration', emphasis:false, text:'' };
  else if(type === 'narration-em') b = { id:genId(), type:'narration', emphasis:true, text:'' };
  else if(type === 'handout') b = { id:genId(), type:'handout', style:'paper', title:'', body:'', image:'' };
  else if(type === 'bgm') b = { id:genId(), type:'bgm', ytId:'', title:'' };
  else if(type === 'dialogue') b = { id:genId(), type:'dialogue', speaker:(E().characters[0]||{}).name||'', segments:[{kind:'line',text:''}] };
  else if(type === 'dice') b = { id:genId(), type:'dice', kind:'check', speaker:(E().characters[0]||{}).name||'', item:'판정', grade:'보통', standard:'', roll:'', result:'' };
  sc.blocks.splice(_insertAt, 0, b);
  const m = $('#insertChooser'); if(m) m.remove();
  renderBlocks();
}

function speakerSelectHTML(b){
  const opts = E().characters.map(c => `<option value="${escAttr(c.name)}" ${c.name===b.speaker?'selected':''}>${applyRich(c.name)} (${c.role})</option>`).join('');
  const extra = (b.speaker && !E().characters.some(c=>c.name===b.speaker))
    ? `<option value="${escAttr(b.speaker)}" selected>${applyRich(b.speaker)} (미등록·NPC)</option>` : '';
  return `<select onchange="editorSetField('${b.id}','speaker',this.value)">${extra}${opts}</select>`;
}

const RT_TOOLBAR = `<div class="rt-toolbar">
  <button title="볼드" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
  <button title="기울임" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button></div>`;

function buildBlockCard(b, idx){
  const card = document.createElement('div');
  card.className = 'bcard';
  const tools = `<div class="b-tools">
    <button title="위로" onclick="editorMove('${b.id}',-1)">↑</button>
    <button title="아래로" onclick="editorMove('${b.id}',1)">↓</button>
    <button class="del" title="삭제" onclick="editorDeleteBlock('${b.id}')">✕</button></div>`;

  const typeSel = `<select onchange="editorSetBlockType('${b.id}',this.value)" style="width:auto;padding:5px 8px;font-size:12px;">
      <option value="narration-normal" ${b.type==='narration'&&!b.emphasis?'selected':''}>일반 나레이션</option>
      <option value="narration-em" ${b.type==='narration'&&b.emphasis?'selected':''}>강조 나레이션</option>
      <option value="dialogue" ${b.type==='dialogue'?'selected':''}>대사</option>
      <option value="dice" ${b.type==='dice'?'selected':''}>주사위</option>
      <option value="handout" ${b.type==='handout'?'selected':''}>핸드아웃</option>
      <option value="bgm" ${b.type==='bgm'?'selected':''}>BGM</option>
    </select>`;

  let body = '';
  if(b.type === 'narration'){
    const tag = b.emphasis ? '<span class="b-type narration-em">강조</span>' : '<span class="b-type narration">나레이션</span>';
    body = `<div class="b-head">${tag}${typeSel}<span class="spacer"></span>${tools}</div>
      ${RT_TOOLBAR}
      <div class="b-edit" contenteditable="true" data-bid="${b.id}" data-field="text"
        oninput="editorSaveInline(this)">${b.text||''}</div>`;
  }
  else if(b.type === 'dialogue'){
    const segs = (b.segments||[]).map((s,si) => `
      <div class="seg-row">
        <span class="kind"><select onchange="editorSetSeg('${b.id}',${si},this.value)">
          <option value="line" ${s.kind==='line'?'selected':''}>대사</option>
          <option value="narr" ${s.kind==='narr'?'selected':''}>지문</option></select></span>
        <div class="b-edit" contenteditable="true" data-bid="${b.id}" data-seg="${si}" oninput="editorSaveInline(this)">${s.text||''}</div>
        <button class="sdel" title="삭제" onclick="editorDelSeg('${b.id}',${si})">✕</button>
      </div>`).join('');
    body = `<div class="b-head"><span class="b-type dialogue">대사</span>${typeSel}<span class="spacer"></span>${tools}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:9px;">
        <span style="font-size:12px;color:var(--ink-soft);">화자</span>${speakerSelectHTML(b)}${RT_TOOLBAR}</div>
      ${segs}
      <button class="btn ghost sm" style="margin-top:4px" onclick="editorAddSeg('${b.id}')">＋ 줄 추가</button>`;
  }
  else if(b.type === 'dice'){
    const kindSel = `<select onchange="editorSetDiceKind('${b.id}',this.value)" style="width:auto;padding:5px 8px;font-size:12px;">
        <option value="check" ${b.kind!=='simple'?'selected':''}>기준치</option>
        <option value="simple" ${b.kind==='simple'?'selected':''}>단순 굴림</option></select>`;
    let fields = '';
    if(b.kind === 'simple') fields = `
      <div class="field"><label class="fld">판정명</label><input value="${escAttr(b.item)}" oninput="editorSetField('${b.id}','item',this.value)"></div>
      <div class="field"><label class="fld">공식</label><input value="${escAttr(b.formula)}" oninput="editorSetField('${b.id}','formula',this.value)"></div>
      <div class="field"><label class="fld">결과값</label><input value="${escAttr(b.roll)}" oninput="editorSetField('${b.id}','roll',this.value)"></div>
      <div class="field"><label class="fld">판정결과(선택)</label><input value="${escAttr(b.result)}" oninput="editorSetField('${b.id}','result',this.value)"></div>`;
    else fields = `
      <div class="field"><label class="fld">판정명</label><input value="${escAttr(b.item)}" oninput="editorSetField('${b.id}','item',this.value)"></div>
      <div class="field"><label class="fld">등급</label><input value="${escAttr(b.grade)}" oninput="editorSetField('${b.id}','grade',this.value)" placeholder="보통 등"></div>
      <div class="field"><label class="fld">기준치</label><input value="${escAttr(b.standard)}" oninput="editorSetField('${b.id}','standard',this.value)"></div>
      <div class="field"><label class="fld">굴림</label><input value="${escAttr(b.roll)}" oninput="editorSetField('${b.id}','roll',this.value)"></div>
      <div class="field"><label class="fld">판정결과</label><input value="${escAttr(b.result)}" oninput="editorSetField('${b.id}','result',this.value)"></div>`;
    body = `<div class="b-head"><span class="b-type dice">주사위</span>${typeSel}<span class="spacer"></span>${tools}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <span style="font-size:12px;color:var(--ink-soft);">화자</span>${speakerSelectHTML(b)}
        <span style="font-size:12px;color:var(--ink-soft);">유형</span>${kindSel}</div>
      <div class="dice-fields">${fields}</div>`;
  }
  else if(b.type === 'handout'){
    const styleSel = `<select onchange="editorSetField('${b.id}','style',this.value)" style="width:auto;padding:5px 8px;font-size:12px;">
        <option value="paper" ${b.style!=='digital'?'selected':''}>낡은 서류/쪽지</option>
        <option value="digital" ${b.style==='digital'?'selected':''}>디지털 문서</option></select>`;
    body = `<div class="b-head"><span class="b-type handout">핸드아웃</span>${typeSel}<span class="spacer"></span>${tools}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <span style="font-size:12px;color:var(--ink-soft);">스타일</span>${styleSel}</div>
      <div class="field"><label class="fld">제목</label>
        <input value="${escAttr(b.title)}" oninput="editorSetField('${b.id}','title',this.value)" placeholder="예: 발견한 쪽지"></div>
      <div class="field"><label class="fld">이미지 경로(선택)</label>
        <input value="${escAttr(b.image)}" oninput="editorSetField('${b.id}','image',this.value)" placeholder="image/세션명/핸드아웃.png"></div>
      <div class="field"><label class="fld">내용</label>${RT_TOOLBAR}
        <div class="b-edit" contenteditable="true" data-bid="${b.id}" data-field="body" oninput="editorSaveInline(this)">${b.body||''}</div></div>`;
  }
  else if(b.type === 'bgm'){
    body = `<div class="b-head"><span class="b-type bgm">BGM</span>${typeSel}<span class="spacer"></span>${tools}</div>
      <div class="bgm-fields">
        <div class="field"><label class="fld">유튜브 URL 또는 ID</label>
          <input value="${escAttr(b.ytId)}" oninput="editorSetYt('${b.id}',this.value)" placeholder="https://youtu.be/..."></div>
        <div class="field"><label class="fld">노래 제목</label>
          <input value="${escAttr(b.title)}" oninput="editorSetField('${b.id}','title',this.value)" placeholder="예: 설원 · 적막"></div>
      </div>`;
  }
  card.innerHTML = body;
  return card;
}

/* ---- 블록 조작 ---- */
function getBlock(id){ const sc = activeScene(); return sc ? sc.blocks.find(b => b.id === id) : null; }
function editorSaveInline(el){
  const b = getBlock(el.dataset.bid); if(!b) return;
  const html = editableToRich(el);        // <b>/<i>/<br> 보존(여러 줄)
  if(el.dataset.seg != null) b.segments[+el.dataset.seg].text = html;
  else if(el.dataset.field === 'body') b.body = html;
  else b.text = html;     // 재렌더 안 함 → 커서 유지
}
function editorSetField(id, field, val){ const b = getBlock(id); if(b) b[field] = val; }
function editorSetYt(id, val){ const b = getBlock(id); if(b) b.ytId = ytIdFromUrl(val); }
function editorMove(id, dir){
  const sc = activeScene(); const i = sc.blocks.findIndex(b => b.id === id);
  const j = i + dir; if(j < 0 || j >= sc.blocks.length) return;
  [sc.blocks[i], sc.blocks[j]] = [sc.blocks[j], sc.blocks[i]];
  renderBlocks();
}
function editorDeleteBlock(id){ const sc = activeScene(); sc.blocks = sc.blocks.filter(b => b.id !== id); renderBlocks(); }
function editorSetSeg(id, si, kind){ const b = getBlock(id); if(b) b.segments[si].kind = kind; }
function editorAddSeg(id){ const b = getBlock(id); if(b){ b.segments.push({kind:'line',text:''}); renderBlocks(); } }
function editorDelSeg(id, si){ const b = getBlock(id); if(b){ b.segments.splice(si,1); if(!b.segments.length) b.segments.push({kind:'line',text:''}); renderBlocks(); } }
function editorSetDiceKind(id, kind){
  const b = getBlock(id); if(!b) return;
  if(kind !== 'simple') kind = 'check';
  b.kind = kind;
  if(kind==='check'){ b.grade=b.grade||''; b.standard=b.standard||''; b.result=b.result||''; delete b.target; delete b.formula; }
  else { b.formula=b.formula||'1d100'; b.result=b.result||''; delete b.target; delete b.grade; delete b.standard; }
  renderBlocks();
}
function editorSetBlockType(id, t){
  const b = getBlock(id); if(!b) return;
  const text = b.text || b.body || (b.segments? b.segments.map(s=>s.text).join('<br>') : '');
  if(t === 'narration-normal'){ stripBlock(b,'narration'); b.emphasis=false; b.text=text; }
  else if(t === 'narration-em'){ stripBlock(b,'narration'); b.emphasis=true; b.text=text; }
  else if(t === 'dialogue'){ stripBlock(b,'dialogue'); b.speaker=b.speaker||(E().characters[0]||{}).name||''; b.segments=[{kind:'line',text:text}]; }
  else if(t === 'dice'){ stripBlock(b,'dice'); b.kind='check'; b.speaker=b.speaker||''; b.item=b.item||'판정'; b.grade='보통'; b.standard=''; b.roll=''; b.result=''; }
  else if(t === 'handout'){ stripBlock(b,'handout'); b.style='paper'; b.title=b.title||''; b.body=text; b.image=''; }
  else if(t === 'bgm'){ stripBlock(b,'bgm'); b.ytId=b.ytId||''; b.title=b.title||text||''; }
  renderBlocks();
}
function stripBlock(b, newType){
  ['emphasis','text','speaker','segments','kind','item','grade','roll','target','standard','formula','result','ytId','title','style','body','image'].forEach(k => delete b[k]);
  b.type = newType;
}

/* ===================== 내보내기 ===================== */
function editorToSession(){
  const e = E();
  return {
    id: e.id, folder: (e.folder||'기타').trim(), title: e.title.trim(),
    date: e.date.trim(), theme: e.theme, cardImage: e.cardImage.trim(),
    characters: e.characters.filter(c => c.name.trim()).map(c => ({ id:c.id, name:c.name.trim(), role:c.role, color:c.color, img:c.img.trim() })),
    scenes: e.scenes.map(s => ({ id:s.id, title:s.title.trim(), blocks:s.blocks }))
  };
}
function editorRefreshJSON(){ $('#jsonOut').value = JSON.stringify(editorToSession(), null, 2); toast('JSON을 생성했습니다.'); }
function editorCopyJSON(){
  editorRefreshJSON();
  navigator.clipboard?.writeText($('#jsonOut').value).then(()=>toast('클립보드에 복사했습니다.'), ()=>toast('복사 실패 — 직접 선택해 주세요.'));
}
function editorDownloadJSON(){
  const ses = editorToSession();
  if(!ses.title){ toast('세션 제목을 입력해 주세요.'); return; }
  const blob = new Blob([JSON.stringify(ses, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (ses.id || 'session') + '.json';
  a.click(); URL.revokeObjectURL(a.href);
  toast('세션 JSON을 내려받았습니다. data/sessions/ 에 올리고 manifest 에 추가하세요.');
}
function editorPreview(){
  const ses = editorToSession();
  upsertSessionInDB(ses);
  const sc = ses.scenes.find(s => s.id === E().activeScene) || ses.scenes[0];
  if(!sc || !(sc.blocks||[]).length){ toast('미리볼 블록이 없습니다.'); return; }
  openViewer(ses.id, sc.id);
}
