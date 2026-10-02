/* =========================================================================
   editor.js — 로그 등록 · 편집
   --------------------------------------------------------------------------
   흐름: ① 세션 정보 → ② 원본 로그 HTML 불러오기(자동 변환) → ③ 등장인물 대응
         → ④ 로그 다듬기(장면 나누기 · BGM · 오타 수정 …) → ⑤ JSON 내보내기
   편집 중에는 로그 전체를 하나의 흐름(stream)으로 다루고, 그 사이에 '장면 구분'을
   끼워 장면을 나눈다. 저장할 때 장면별 블록 목록(scenes)으로 바꾼다.
   등장인물은 로그에 나온 이름(aliases)을 캐릭터에 연결하는 방식이다.
   ========================================================================= */
const E = () => state.editor;
const CHAR_PALETTE = ['#ab1240','#3d6fb6','#2f8a78','#c2682f','#7d5ba6','#8a6d1f','#b5453a','#4f7a3a','#b0527e','#2d6f8a'];
const TYPE_LABEL = { 'narration-normal':'나레이션', 'narration-em':'강조 나레이션', dialogue:'대사', dice:'주사위', handout:'핸드아웃', bgm:'BGM' };

/* ============================ 상태 ============================ */
function sceneMarker(title){ return { id:genId(), type:'scene', title: title || '새 장면' }; }
function blankEditor(){
  return {
    id: genId(), folder:'', title:'', date:'', theme:'light', cardImage:'',
    characters: [], stream: [ sceneMarker('장면 1') ],
    _avatars: {}, _sel: new Set(), _lastSel: null, _undo: [], _importMode: 'replace', _whispers: false
  };
}
function normChar(c){
  const aliases = Array.isArray(c.aliases) ? c.aliases.filter(Boolean).slice() : [];
  if(!aliases.length && c.name) aliases.push(c.name);
  return { id:c.id || genId(), name:c.name || aliases[0] || '', role:c.role || 'NPC',
           color:c.color || CHAR_PALETTE[0], img:c.img || '', aliases, unify: !!c.unify };
}
function sessionToEditor(ses){
  const e = blankEditor();
  ['id','folder','title','date','theme','cardImage'].forEach(k => { if(ses[k] != null) e[k] = ses[k]; });
  e.characters = (ses.characters || []).map(normChar);
  e.stream = [];
  (ses.scenes || []).forEach(sc => {
    e.stream.push({ id: sc.id || genId(), type:'scene', title: sc.title || '' });
    (sc.blocks || []).forEach(b => e.stream.push(JSON.parse(JSON.stringify(b))));
  });
  if(!e.stream.length || e.stream[0].type !== 'scene') e.stream.unshift(sceneMarker('장면 1'));
  return e;
}
function editorToSession(){
  const e = E();
  const scenes = []; let sc = null;
  e.stream.forEach(it => {
    if(it.type === 'scene'){ sc = { id: it.id, title: (it.title || '').trim() || '장면', blocks: [] }; scenes.push(sc); return; }
    if(!sc){ sc = { id: genId(), title:'장면 1', blocks: [] }; scenes.push(sc); }
    const b = {}; Object.keys(it).forEach(k => { if(k[0] !== '_') b[k] = it[k]; });
    sc.blocks.push(b);
  });
  return {
    id: e.id, folder: (e.folder || '기타').trim(), title: (e.title || '').trim(),
    date: (e.date || '').trim(), theme: e.theme, cardImage: (e.cardImage || '').trim(),
    characters: e.characters.filter(c => (c.name || '').trim() || c.aliases.length).map(c => ({
      id: c.id, name: (c.name || '').trim() || c.aliases[0], role: c.role, color: c.color,
      img: (c.img || '').trim(), aliases: Array.from(new Set(c.aliases)), unify: !!c.unify })),
    scenes
  };
}

/* 되돌리기 */
function snapshot(){
  const e = E();
  e._undo.push(JSON.stringify({ stream: e.stream, characters: e.characters }));
  if(e._undo.length > 30) e._undo.shift();
}
function editorUndo(){
  const e = E(); const s = e._undo.pop();
  if(!s){ toast('되돌릴 작업이 없습니다.'); return; }
  const o = JSON.parse(s); e.stream = o.stream; e.characters = o.characters; e._sel.clear();
  renderChars(); renderStream(); toast('되돌렸습니다.');
}

/* ============================ 진입 ============================ */
function openEditor(){ state.previewReturn = false; state.editor = blankEditor(); enterEditorView(); }
function editExistingSession(sessionId, sceneId){
  if(state.previewReturn && E() && E().id === sessionId){ returnToEditor(sceneId); return; }
  const ses = findSession(sessionId);
  if(!ses){ toast('세션을 찾을 수 없습니다.'); return; }
  state.previewReturn = false;
  state.editor = sessionToEditor(ses);
  enterEditorView();
  if(sceneId) setTimeout(() => editorJumpScene(sceneId, true), 60);
}
function showEditorView(){
  closeViewer();
  state.view = 'editor';
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-editor').classList.add('active');
  $('#topbar').style.display = '';
  renderEditor();
}
function enterEditorView(){ showEditorView(); window.scrollTo({ top: 0 }); }
function returnToEditor(sceneId){
  state.previewReturn = false;
  const y = E()._scrollY || 0;
  showEditorView();
  requestAnimationFrame(() => { if(sceneId) editorJumpScene(sceneId, true); else window.scrollTo({ top: y }); });
}

/* ============================ 전체 렌더 ============================ */
function escAttr(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function renderEditor(){
  const e = E();
  const isEdit = !!findSession(e.id);
  const folderOptions = DB.folders.map(f =>
    `<option value="${escAttr(f.name)}" ${f.name===e.folder?'selected':''}>${escAttr(f.name)}</option>`).join('');

  $('#editorRoot').innerHTML = `
    <h1>${isEdit ? '세션 편집' : '새 로그 등록'}</h1>
    <p class="lead">원본 로그 파일을 넣으면 자동으로 변환됩니다. 변환된 로그에서 장면을 나누고, BGM을 넣고, 오타를 고친 뒤 내보내세요.</p>

    <div class="panel">
      <h3><span class="step">1</span> 세션 정보</h3>
      <div class="field folder-pick">
        <div><label class="fld">기존 폴더(캠페인)</label>
          <select onchange="editorPickFolder(this.value)"><option value="">— 선택 —</option>${folderOptions}</select></div>
        <div><label class="fld">또는 새 폴더 이름</label>
          <input type="text" id="fFolder" value="${escAttr(e.folder)}" placeholder="예: 달데" oninput="E().folder=this.value"></div>
      </div>
      <div class="grid2">
        <div class="field"><label class="fld">세션 제목</label>
          <input type="text" id="fTitle" value="${escAttr(e.title)}" oninput="E().title=this.value" placeholder="로그를 불러오면 자동으로 채워집니다"></div>
        <div class="field"><label class="fld">날짜</label>
          <input type="text" id="fDate" value="${escAttr(e.date)}" oninput="E().date=this.value" placeholder="예: 2025.04.30"></div>
      </div>
      <div class="grid2">
        <div class="field"><label class="fld">뷰어 기본 테마</label>
          <select onchange="E().theme=this.value">
            <option value="light" ${e.theme==='light'?'selected':''}>라이트(아이보리)</option>
            <option value="dark" ${e.theme==='dark'?'selected':''}>다크(나이트)</option></select></div>
        <div class="field"><label class="fld">세션 카드 이미지 경로</label>
          <input type="text" value="${escAttr(e.cardImage)}" oninput="E().cardImage=this.value" placeholder="image/session_name/cover.png"></div>
      </div>
    </div>

    <div class="panel">
      <h3><span class="step">2</span> 원본 로그 불러오기</h3>
      <p class="desc">Roll20 채팅 아카이브를 저장한 <b>HTML 파일</b>을 넣으면 텍스트만 뽑아 자동으로 변환합니다.
        (코코포리아 로그는 준비 중) · 작업하던 <b>세션 JSON</b>을 넣으면 이어서 편집할 수 있습니다.</p>
      <label class="dropzone" id="dropZone">
        <input type="file" accept=".html,.htm,.json" onchange="editorFile(this.files[0]); this.value='';">
        <span class="dz-icon">⇪</span>
        <b>파일을 끌어다 놓거나 클릭해서 선택</b>
        <small>.html (Roll20 로그) · .json (세션 파일)</small>
      </label>
      <div class="imp-opts">
        <span id="impModeWrap">${importModeHTML()}</span>
        <label class="chk"><input type="checkbox" ${e._whispers?'checked':''} onchange="E()._whispers=this.checked"> 귓속말 포함</label>
      </div>
    </div>

    <div class="panel" id="charPanel"></div>

    <div class="panel log-panel">
      <h3><span class="step">4</span> 로그 다듬기</h3>
      <p class="desc">블록 사이의 <b>＋</b>로 장면 구분·BGM·핸드아웃 등을 끼워 넣고, 글자를 눌러 바로 고칩니다.
        체크박스를 누른 뒤 다른 체크박스를 <b>Shift+클릭</b>하면 범위를 한꺼번에 선택할 수 있습니다.</p>
      <div class="log-toolbar" id="logToolbar"></div>
      <div id="stream" class="stream"></div>
    </div>

    <div class="panel">
      <h3><span class="step">5</span> 저장 · 내보내기</h3>
      <p class="desc">JSON 파일로 내려받아 깃허브 <code>data/sessions/</code> 에 올리고
        <code>data/manifest.json</code> 목록에 경로를 추가하면 페이지에 반영됩니다.</p>
      <textarea class="json-out" id="jsonOut" readonly placeholder="여기에 JSON 미리보기가 표시됩니다."></textarea>
      <div class="btn-row">
        <button class="btn" onclick="editorRefreshJSON()">JSON 생성</button>
        <button class="btn" onclick="editorCopyJSON()">복사</button>
        <button class="btn primary" onclick="editorDownloadJSON()">⬇ 세션 JSON 다운로드</button>
      </div>
    </div>`;

  bindDropZone();
  renderChars();
  renderStream();
}
function editorPickFolder(name){ if(name){ E().folder = name; $('#fFolder').value = name; } }
function streamHasBlocks(){ return E().stream.some(it => it.type !== 'scene'); }
function importModeHTML(){
  const e = E();
  if(!streamHasBlocks()) return '';
  return `<label class="chk"><input type="radio" name="impMode" ${e._importMode==='replace'?'checked':''} onchange="E()._importMode='replace'"> 기존 로그를 교체</label>
          <label class="chk"><input type="radio" name="impMode" ${e._importMode==='append'?'checked':''} onchange="E()._importMode='append'"> 뒤에 이어 붙이기</label>`;
}

/* ============================ ② 파일 불러오기 ============================ */
function bindDropZone(){
  const dz = $('#dropZone'); if(!dz) return;
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if(f) editorFile(f); });
}
function readFileText(file){
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file, 'utf-8'); });
}
async function editorFile(file){
  if(!file) return;
  let text;
  try{ text = await readFileText(file); }catch(err){ toast('파일을 읽지 못했습니다.'); return; }

  if(/\.json$/i.test(file.name) || /^\s*\{/.test(text)){
    let obj; try{ obj = JSON.parse(text); }catch(err){ toast('JSON 형식이 올바르지 않습니다.'); return; }
    if(!obj || !Array.isArray(obj.scenes)){ toast('세션 JSON 파일이 아닙니다.'); return; }
    if(streamHasBlocks() && !confirm('지금 편집 중인 내용을 이 세션 파일로 바꿀까요?')) return;
    state.editor = sessionToEditor(obj);
    renderEditor(); toast('세션 파일을 불러왔습니다.');
    return;
  }

  toast('로그를 변환하는 중…');
  setTimeout(() => {
    let res;
    try{ res = importLogHTML(text, { includeWhispers: E()._whispers }); }
    catch(err){
      if(err.code === 'ccfolia') toast('코코포리아 로그는 곧 지원될 예정입니다.');
      else if(err.code === 'unknown') toast('인식할 수 없는 로그 형식입니다. Roll20 채팅 아카이브를 저장한 HTML인지 확인해 주세요.');
      else { console.error(err); toast('변환 중 오류가 발생했습니다.'); }
      return;
    }
    applyImport(res);
  }, 30);
}
function applyImport(res){
  const e = E();
  snapshot();
  if(e._importMode === 'append' && streamHasBlocks()) e.stream.push(...res.blocks);
  else e.stream = [ sceneMarker('장면 1'), ...res.blocks ];
  if(!e.title && res.title) e.title = res.title;
  if(!e.date && res.date) e.date = res.date;

  let added = 0;
  res.speakers.forEach(s => {
    if(s.avatar) e._avatars[s.name] = s.avatar;
    if(isNarrationName(s.name) || findChar(e, s.name)) return;
    e.characters.push(normChar({ name:s.name, aliases:[s.name], role:s.guessRole, color:nextColor() }));
    added++;
  });
  e._sel.clear();
  renderEditor();
  toast(`메시지 ${res.stats.messages}개 → 블록 ${res.blocks.length}개 · 새 등장인물 ${added}명` +
        (res.stats.hidden ? ` · 숨김 메시지 ${res.stats.hidden}개 제외` : ''));
}
function nextColor(){
  const used = new Set(E().characters.map(c => c.color));
  return CHAR_PALETTE.find(c => !used.has(c)) || CHAR_PALETTE[E().characters.length % CHAR_PALETTE.length];
}

/* ============================ ③ 등장인물 ============================ */
function speakerCounts(){
  const m = new Map();
  E().stream.forEach(b => {
    if((b.type === 'dialogue' || b.type === 'dice') && b.speaker && !isNarrationName(b.speaker))
      m.set(b.speaker, (m.get(b.speaker) || 0) + 1);
  });
  return m;
}
function charPreviewStyle(c){
  const url = resolveImg(c.img);
  if(url) return `background-image:url('${url}')`;
  const av = c.aliases.map(a => E()._avatars[a]).find(Boolean);
  if(av) return `background-image:url('${av}')`;
  return `background-color:${c.color}`;
}
function renderChars(){
  const e = E(); const panel = $('#charPanel'); if(!panel) return;
  const counts = speakerCounts();
  const unlinked = Array.from(counts.keys()).filter(n => !findChar(e, n));
  const moveOpts = (exceptId) => e.characters.filter(c => c.id !== exceptId)
    .map(c => `<option value="${c.id}">→ ${escAttr(c.name || c.aliases[0] || '이름 없음')}</option>`).join('');

  const cards = e.characters.map(c => {
    const chips = c.aliases.map(a => {
      const thumb = e._avatars[a] ? `<span class="al-thumb" style="background-image:url('${e._avatars[a]}')"></span>` : '';
      return `<span class="alias">${thumb}<span class="al-name">${escAttr(a)}</span><small>${counts.get(a) || 0}</small>
        <select title="다른 캐릭터로 옮기기" data-a="${escAttr(a)}" onchange="editorMoveAlias('${c.id}', this.dataset.a, this.value)">
          <option value="">옮기기…</option>${moveOpts(c.id)}<option value="__new">새 캐릭터로 분리</option></select>
        ${e._avatars[a] ? `<button class="al-save" title="로그의 프로필 사진 저장" data-a="${escAttr(a)}" onclick="editorSaveAvatar(this.dataset.a)">⬇</button>` : ''}
      </span>`; }).join('') || '<span class="muted">연결된 로그 이름 없음</span>';
    return `
      <div class="ch-card">
        <div class="avatar ch-av" data-prev="${c.id}" style="${charPreviewStyle(c)}"></div>
        <div class="ch-main">
          <div class="ch-row">
            <input type="text" class="ch-name" value="${escAttr(c.name)}" placeholder="대표 이름" oninput="editorCharField('${c.id}','name',this.value)">
            <select class="ch-role" onchange="editorCharField('${c.id}','role',this.value)">
              ${['PC','KPC','NPC'].map(r => `<option value="${r}" ${c.role===r?'selected':''}>${r}</option>`).join('')}</select>
            <input type="color" class="swatch" value="${c.color}" oninput="editorCharField('${c.id}','color',this.value)" title="색상">
            <button class="icon-btn" title="이 캐릭터의 대사를 모두 나레이션으로" onclick="editorCharToNarration('${c.id}')">☰</button>
            <button class="icon-btn danger" title="캐릭터 삭제" onclick="editorRemoveChar('${c.id}')">✕</button>
          </div>
          <input type="text" class="ch-img" value="${escAttr(c.img)}" placeholder="프로필 이미지 경로 (예: image/dalde/dahlia.png)" oninput="editorCharField('${c.id}','img',this.value)">
          <div class="aliases"><span class="al-label">로그 이름</span>${chips}</div>
          <label class="chk small"><input type="checkbox" ${c.unify?'checked':''} onchange="editorCharField('${c.id}','unify',this.checked)">
            뷰어에서 대표 이름으로 통일해 표시 <span class="muted">(끄면 로그에 적힌 이름 그대로)</span></label>
        </div>
      </div>`;
  }).join('');

  const unl = unlinked.length ? `
    <div class="unlinked"><span class="al-label">연결되지 않은 로그 이름</span>
      ${unlinked.map(n => `<span class="alias warn"><span class="al-name">${escAttr(n)}</span><small>${counts.get(n)}</small>
        <select data-a="${escAttr(n)}" onchange="editorLinkName(this.dataset.a, this.value)">
          <option value="">연결…</option>${moveOpts(null)}<option value="__new">새 캐릭터로</option></select></span>`).join('')}
    </div>` : '';

  panel.innerHTML = `
    <h3><span class="step">3</span> 등장인물</h3>
    <p class="desc">로그에 나온 화자 이름이 자동으로 캐릭터가 됩니다. 같은 캐릭터가 여러 이름으로 나왔다면
      <b>옮기기</b>로 한 캐릭터에 묶어 주세요. <b>PC</b>는 뷰어 오른쪽, <b>KPC·NPC</b>는 왼쪽에 표시됩니다.</p>
    <div class="ch-list">${cards || '<div class="empty-note">로그를 불러오면 등장인물이 여기에 나타납니다.</div>'}</div>
    ${unl}
    <button class="btn sm" style="margin-top:12px" onclick="editorAddChar()">＋ 캐릭터 직접 추가</button>`;
}
function getChar(id){ return E().characters.find(c => c.id === id); }
function editorCharField(id, field, val){
  const c = getChar(id); if(!c) return;
  c[field] = val;
  // 입력 중 전체 재렌더 금지(포커스·색상창 유지) → 미리보기 원만 갱신
  if(field === 'color' || field === 'img'){
    const prev = $(`.ch-av[data-prev="${id}"]`);
    if(prev) prev.style.cssText = charPreviewStyle(c);
  }
}
function editorAddChar(){
  E().characters.push(normChar({ name:'', aliases:[], role:'NPC', color:nextColor() }));
  renderChars();
}
function editorRemoveChar(id){
  const c = getChar(id); if(!c) return;
  if(!confirm(`'${c.name || c.aliases[0] || '이름 없음'}' 캐릭터를 삭제할까요?\n(로그의 대사는 그대로 남고, 이름은 '연결되지 않은 로그 이름'으로 옮겨집니다)`)) return;
  snapshot();
  E().characters = E().characters.filter(x => x.id !== id);
  renderChars(); renderStream();
}
function editorMoveAlias(fromId, alias, to){
  if(!to) return;
  const e = E(); const from = getChar(fromId); if(!from) return;
  snapshot();
  from.aliases = from.aliases.filter(a => a !== alias);
  if(to === '__new') e.characters.push(normChar({ name:alias, aliases:[alias], role:from.role, color:nextColor() }));
  else { const t = getChar(to); if(t && !t.aliases.includes(alias)) t.aliases.push(alias); }
  if(!from.aliases.length) e.characters = e.characters.filter(x => x !== from);   // 이름이 모두 빠진 캐릭터는 정리
  renderChars(); renderStream();
}
function editorLinkName(name, to){
  if(!to) return;
  const e = E(); snapshot();
  if(to === '__new') e.characters.push(normChar({ name, aliases:[name], role:'NPC', color:nextColor() }));
  else { const t = getChar(to); if(t && !t.aliases.includes(name)) t.aliases.push(name); }
  renderChars(); renderStream();
}
function editorCharToNarration(id){
  const c = getChar(id); if(!c) return;
  if(!confirm(`'${c.name}'의 대사 블록을 모두 나레이션으로 바꿀까요?\n(GM이 캐릭터 이름으로 서술한 경우 등)`)) return;
  snapshot();
  const names = new Set(c.aliases.concat([c.name]));
  E().stream.forEach(b => {
    if(b.type === 'dialogue' && names.has(b.speaker)){
      const text = blockPlainRich(b);
      stripBlock(b, 'narration'); b.emphasis = false; b.text = text;
    }
  });
  E().characters = E().characters.filter(x => x.id !== id);
  renderChars(); renderStream();
}
function editorSaveAvatar(alias){
  const url = E()._avatars[alias]; if(!url) return;
  const ext = ((url.match(/^data:image\/(\w+)/) || [])[1] || 'png').replace('jpeg', 'jpg');
  const a = document.createElement('a');
  a.href = url; a.download = alias.replace(/[\\/:*?"<>|\s]+/g, '_') + '.' + ext;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ============================ ④ 로그 흐름 ============================ */
function streamIndex(id){ return E().stream.findIndex(it => it.id === id); }
function getBlock(id){ return E().stream.find(it => it.id === id); }

function renderToolbar(){
  const e = E(); const tb = $('#logToolbar'); if(!tb) return;
  const scenes = e.stream.filter(it => it.type === 'scene');
  const nBlocks = e.stream.length - scenes.length;
  const sel = e._sel.size;
  tb.innerHTML = `
    <div class="lt-row">
      <button class="tb-btn" title="굵게 (Ctrl+B)" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button>
      <button class="tb-btn" title="기울임 (Ctrl+I)" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button>
      <span class="tb-sep"></span>
      <button class="tb-btn wide" title="되돌리기 (Ctrl+Z)" onclick="editorUndo()">↶ 되돌리기</button>
      <span class="tb-sep"></span>
      <select class="tb-jump" onchange="if(this.value){editorJumpScene(this.value);} this.value='';">
        <option value="">장면으로 이동…</option>
        ${scenes.map((s, i) => `<option value="${s.id}">${String(i+1).padStart(2,'0')}. ${escAttr(s.title || '장면')}</option>`).join('')}
      </select>
      <span class="tb-info">장면 ${scenes.length} · 블록 ${nBlocks}</span>
    </div>
    <div class="lt-row sel-row ${sel ? 'show' : ''}">
      <b>${sel}개 선택</b>
      <button class="tb-btn wide" onclick="editorBulk('merge')">하나로 합치기</button>
      <button class="tb-btn wide" onclick="editorBulk('narration')">나레이션으로</button>
      <button class="tb-btn wide" onclick="editorBulk('em')">강조 나레이션으로</button>
      <button class="tb-btn wide danger" onclick="editorBulk('delete')">삭제</button>
      <button class="tb-btn wide" onclick="editorClearSel()">선택 해제</button>
    </div>`;
}

function renderStream(){
  const e = E(); const root = $('#stream'); if(!root) return;
  const y = window.scrollY;
  let sceneNo = 0;
  const parts = [];
  _namesCache = speakerNames();
  e.stream.forEach((it, i) => {
    if(i > 0) parts.push(gapHTML(i));
    if(it.type === 'scene'){ sceneNo++; parts.push(sceneCardHTML(it, sceneNo, i)); }
    else parts.push(blockCardHTML(it));
  });
  parts.push(gapHTML(e.stream.length));
  _namesCache = null;
  if(!streamHasBlocks()) parts.push('<div class="empty-note">② 에서 로그 파일을 불러오거나, ＋ 버튼으로 블록을 직접 추가하세요.</div>');
  root.innerHTML = parts.join('');
  renderToolbar();
  const mw = $('#impModeWrap'); if(mw) mw.innerHTML = importModeHTML();
  window.scrollTo({ top: y });
}
function gapHTML(at){
  return `<div class="gap"><button class="gap-btn" onclick="editorInsertMenu(${at}, this)" title="여기에 추가">＋</button></div>`;
}
function sceneCardHTML(s, no, idx){
  return `<div class="scard" id="sc_${s.id}" data-bid="${s.id}">
      <span class="s-kicker">SCENE ${String(no).padStart(2,'0')}</span>
      <input type="text" class="s-title" value="${escAttr(s.title)}" placeholder="장면 제목" oninput="getBlock('${s.id}').title=this.value">
      <button class="tb-btn wide" onclick="editorPreview('${s.id}')">▶ 미리보기</button>
      ${idx > 0 ? `<button class="tb-btn wide" title="이 구분을 지우고 앞 장면과 합치기" onclick="editorRemoveScene('${s.id}')">구분 삭제</button>` : ''}
    </div>`;
}
function typeKey(b){ return b.type === 'narration' ? (b.emphasis ? 'narration-em' : 'narration-normal') : b.type; }

function speakerNames(){
  const e = E(); const set = new Set();
  e.characters.forEach(c => { c.aliases.forEach(a => set.add(a)); if(c.name) set.add(c.name); });
  e.stream.forEach(b => { if(b.speaker && !isNarrationName(b.speaker)) set.add(b.speaker); });
  return Array.from(set);
}
function speakerFieldHTML(b, names){
  const opts = names.map(n => `<option value="${escAttr(n)}" ${n===b.speaker?'selected':''}>${escAttr(n)}</option>`).join('');
  return `<select class="spk-sel" onchange="editorSetSpeaker('${b.id}', this.value)">
      <option value="">화자…</option>${opts}</select>
    <input type="text" class="spk-free" value="${escAttr(b.speaker || '')}" placeholder="이름 직접 입력"
      onchange="editorSetSpeaker('${b.id}', this.value)" title="목록에 없는 이름(임시 NPC)을 직접 적을 수 있습니다">`;
}

let _namesCache = null;
function blockCardHTML(b){
  const tk = typeKey(b);
  const hasSpk = (b.type === 'dialogue' || b.type === 'dice');
  const ch = hasSpk ? findChar(E(), b.speaker) : null;
  const accent = ch ? `style="--acc:${ch.color}"` : '';
  const typeSel = `<select class="type-sel" onchange="editorSetBlockType('${b.id}', this.value)">
      ${Object.keys(TYPE_LABEL).map(k => `<option value="${k}" ${k===tk?'selected':''}>${TYPE_LABEL[k]}</option>`).join('')}</select>`;
  const head = `<div class="b-head">
      <input type="checkbox" class="b-chk" ${E()._sel.has(b.id)?'checked':''} onclick="editorSelect(event,'${b.id}')" title="선택 (Shift+클릭: 범위 선택)">
      ${typeSel}
      ${hasSpk ? speakerFieldHTML(b, _namesCache || speakerNames()) : ''}
      <span class="spacer"></span>
      <button class="icon-btn" title="여기서 장면 나누기" onclick="editorSplitScene('${b.id}')">✂</button>
      <button class="icon-btn" title="위 블록과 합치기" onclick="editorMergeUp('${b.id}')">⤒</button>
      <button class="icon-btn" title="위로" onclick="editorMove('${b.id}',-1)">↑</button>
      <button class="icon-btn" title="아래로" onclick="editorMove('${b.id}',1)">↓</button>
      <button class="icon-btn danger" title="삭제" onclick="editorDelete('${b.id}')">✕</button>
    </div>`;

  let body = '';
  if(b.type === 'narration'){
    body = `<div class="b-edit" contenteditable="true" data-bid="${b.id}" data-field="text" oninput="editorSaveInline(this)">${applyRich(b.text)}</div>`;
  }
  else if(b.type === 'dialogue'){
    body = (b.segments || []).map((s, k) => `
      <div class="seg-row">
        <select class="seg-kind" onchange="editorSetSeg('${b.id}',${k},this.value)">
          <option value="line" ${s.kind==='line'?'selected':''}>대사</option>
          <option value="narr" ${s.kind==='narr'?'selected':''}>지문</option></select>
        <div class="b-edit ${s.kind}" contenteditable="true" data-bid="${b.id}" data-seg="${k}" oninput="editorSaveInline(this)">${applyRich(s.text)}</div>
        <button class="icon-btn" title="이 줄 삭제" onclick="editorDelSeg('${b.id}',${k})">✕</button>
      </div>`).join('') +
      `<button class="add-seg" onclick="editorAddSeg('${b.id}')">＋ 줄 추가</button>`;
  }
  else if(b.type === 'dice'){
    const kind = b.kind === 'attack' ? 'attack' : b.kind === 'simple' ? 'simple' : 'check';
    const f = (key, label, ph) => `<div class="field"><label class="fld">${label}</label>
      <input type="text" value="${escAttr(b[key])}" placeholder="${ph || ''}" oninput="getBlock('${b.id}')['${key}']=this.value"></div>`;
    const kindSel = `<select class="kind-sel" onchange="editorSetDiceKind('${b.id}',this.value)">
        <option value="check" ${kind==='check'?'selected':''}>기준치</option>
        <option value="attack" ${kind==='attack'?'selected':''}>공격</option>
        <option value="simple" ${kind==='simple'?'selected':''}>단순 굴림</option></select>`;
    const fields = kind === 'check'
      ? f('item','판정명') + f('grade','등급','보통') + f('standard','기준치') + f('roll','굴림') + f('result','판정결과')
      : kind === 'attack'
      ? f('item','무기') + f('standard','기준치','45/22/9') + f('roll','굴림') + f('result','판정결과') + f('damage','피해')
      : f('item','판정명') + f('formula','공식','1d100') + f('roll','결과값') + f('result','판정결과(선택)');
    body = `<div class="dice-kind">유형 ${kindSel}</div><div class="dice-fields">${fields}</div>`;
  }
  else if(b.type === 'handout'){
    body = `<div class="grid-ho">
        <div class="field"><label class="fld">스타일</label>
          <select onchange="getBlock('${b.id}').style=this.value">
            <option value="paper" ${b.style!=='digital'?'selected':''}>낡은 서류 · 쪽지</option>
            <option value="digital" ${b.style==='digital'?'selected':''}>디지털 문서</option></select></div>
        <div class="field"><label class="fld">제목</label>
          <input type="text" value="${escAttr(b.title)}" placeholder="예: 발견한 쪽지" oninput="getBlock('${b.id}').title=this.value"></div>
        <div class="field"><label class="fld">이미지 경로(선택)</label>
          <input type="text" value="${escAttr(b.image)}" placeholder="image/session/handout.png" oninput="getBlock('${b.id}').image=this.value"></div>
      </div>
      <label class="fld">내용</label>
      <div class="b-edit" contenteditable="true" data-bid="${b.id}" data-field="body" oninput="editorSaveInline(this)">${applyRich(b.body)}</div>`;
  }
  else if(b.type === 'bgm'){
    body = `<div class="bgm-fields">
        <div class="field"><label class="fld">유튜브 주소</label>
          <input type="text" value="${escAttr(b.ytId ? 'https://youtu.be/' + b.ytId : '')}" placeholder="https://youtu.be/..." onchange="getBlock('${b.id}').ytId=ytIdFromUrl(this.value)"></div>
        <div class="field"><label class="fld">곡 제목</label>
          <input type="text" value="${escAttr(b.title)}" placeholder="표시할 곡 이름" oninput="getBlock('${b.id}').title=this.value"></div>
      </div>`;
  }
  return `<div class="bcard t-${tk} ${E()._sel.has(b.id)?'sel':''}" data-bid="${b.id}" ${accent}>${head}<div class="b-body">${body}</div></div>`;
}

/* ---- 인라인 편집 저장 (재렌더 없음 → 커서 유지) ---- */
function editorSaveInline(el){
  const b = getBlock(el.dataset.bid); if(!b) return;
  const html = editableToRich(el);
  if(el.dataset.seg != null){ if(b.segments[+el.dataset.seg]) b.segments[+el.dataset.seg].text = html; }
  else if(el.dataset.field === 'body') b.body = html;
  else b.text = html;
}

/* ---- 삽입 ---- */
function editorInsertMenu(at, btn){
  const old = $('#insertChooser'); if(old) old.remove();
  const menu = document.createElement('div');
  menu.id = 'insertChooser'; menu.className = 'insert-chooser';
  const items = [['scene','✂ 장면 나누기'],['bgm','♪ BGM'],['handout','✉ 핸드아웃'],['narration-normal','나레이션'],
                 ['narration-em','강조 나레이션'],['dialogue','대사'],['dice','주사위']];
  menu.innerHTML = items.map(([k, l]) => `<button onclick="editorInsert(${at},'${k}')">${l}</button>`).join('') +
    `<button class="x" onclick="this.parentNode.remove()">닫기</button>`;
  btn.parentNode.appendChild(menu);
}
function newBlock(kind){
  const c0 = E().characters[0];
  const firstName = c0 ? (c0.aliases[0] || c0.name) : '';
  switch(kind){
    case 'narration-normal': return { id:genId(), type:'narration', emphasis:false, text:'' };
    case 'narration-em':     return { id:genId(), type:'narration', emphasis:true,  text:'' };
    case 'dialogue': return { id:genId(), type:'dialogue', speaker:firstName, segments:[{ kind:'line', text:'' }] };
    case 'dice':     return { id:genId(), type:'dice', kind:'check', speaker:firstName, item:'판정', grade:'보통', standard:'', roll:'', result:'' };
    case 'handout':  return { id:genId(), type:'handout', style:'paper', title:'', body:'', image:'' };
    case 'bgm':      return { id:genId(), type:'bgm', ytId:'', title:'' };
  }
  return null;
}
function editorInsert(at, kind){
  snapshot();
  const e = E();
  at = Math.max(1, at);   // 첫 장면 구분 앞에는 넣지 않음
  if(kind === 'scene'){
    const n = e.stream.slice(0, at).filter(it => it.type === 'scene').length + 1;
    e.stream.splice(at, 0, sceneMarker('장면 ' + n));
  } else e.stream.splice(at, 0, newBlock(kind));
  renderStream();
  const it = e.stream[at];
  const card = it && $(`[data-bid="${it.id}"]`);
  if(card){ const f = card.querySelector('.s-title, .b-edit, .b-body input[type=text]'); if(f) f.focus(); }
}

/* ---- 장면 ---- */
function editorSplitScene(id){
  const i = streamIndex(id); if(i < 0) return;
  if(E().stream[i-1] && E().stream[i-1].type === 'scene'){ toast('이미 장면의 첫 블록입니다.'); return; }
  editorInsert(i, 'scene');
}
function editorRemoveScene(id){
  const i = streamIndex(id); if(i <= 0) return;
  snapshot(); E().stream.splice(i, 1); renderStream();
}
function editorJumpScene(id, instant){
  const el = $('#sc_' + id); if(!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 140;
  window.scrollTo({ top, behavior: instant ? 'auto' : 'smooth' });
}

/* ---- 이동 · 삭제 · 합치기 ---- */
function editorMove(id, dir){
  const s = E().stream; const i = streamIndex(id); const j = i + dir;
  if(i < 0 || j < 1 || j >= s.length) return;   // 첫 장면 구분 앞으로는 못 감
  snapshot();
  [s[i], s[j]] = [s[j], s[i]];
  renderStream();
}
function editorDelete(id){
  snapshot();
  E().stream = E().stream.filter(it => it.id !== id); E()._sel.delete(id);
  renderStream(); renderChars();
}
function blockPlainRich(b){
  if(b.type === 'narration') return b.text || '';
  if(b.type === 'dialogue') return (b.segments || []).map(s => s.kind === 'line' ? '"' + s.text + '"' : s.text).join(' ');
  if(b.type === 'handout') return b.body || '';
  return '';
}
function mergeInto(a, b){
  if(['dice','bgm'].includes(a.type) || ['dice','bgm'].includes(b.type)) return false;
  if(a.type === 'dialogue'){
    if(b.type === 'dialogue') a.segments.push(...b.segments);
    else a.segments.push({ kind:'narr', text: blockPlainRich(b) });
  } else if(a.type === 'narration'){
    a.text = [a.text, blockPlainRich(b)].filter(Boolean).join('<br>');
  } else if(a.type === 'handout'){
    a.body = [a.body, blockPlainRich(b)].filter(Boolean).join('<br>');
  }
  return true;
}
function editorMergeUp(id){
  const s = E().stream; const i = streamIndex(id);
  const prev = s[i-1];
  if(!prev || prev.type === 'scene'){ toast('같은 장면 안의 위 블록과만 합칠 수 있습니다.'); return; }
  snapshot();
  if(!mergeInto(prev, s[i])){ E()._undo.pop(); toast('주사위·BGM 블록은 합칠 수 없습니다.'); return; }
  s.splice(i, 1);
  renderStream(); renderChars();
}

/* ---- 선택 ---- */
function editorSelect(ev, id){
  const e = E();
  const blocks = e.stream.filter(it => it.type !== 'scene').map(it => it.id);
  const on = ev.target.checked;
  if(ev.shiftKey && e._lastSel){
    const a = blocks.indexOf(e._lastSel), b = blocks.indexOf(id);
    if(a >= 0 && b >= 0){
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for(let k = lo; k <= hi; k++){ if(on) e._sel.add(blocks[k]); else e._sel.delete(blocks[k]); }
    }
  } else { if(on) e._sel.add(id); else e._sel.delete(id); }
  e._lastSel = id;
  $$('#stream .bcard').forEach(card => {
    const s = e._sel.has(card.dataset.bid);
    card.classList.toggle('sel', s);
    const cb = card.querySelector('.b-chk'); if(cb) cb.checked = s;
  });
  renderToolbar();
}
function editorClearSel(){
  E()._sel.clear();
  $$('#stream .bcard.sel').forEach(c => { c.classList.remove('sel'); const cb = c.querySelector('.b-chk'); if(cb) cb.checked = false; });
  renderToolbar();
}
function editorBulk(op){
  const e = E(); if(!e._sel.size) return;
  const items = e.stream.filter(it => e._sel.has(it.id));
  if(op === 'delete'){
    if(items.length > 3 && !confirm(`${items.length}개 블록을 삭제할까요? (되돌리기 가능)`)) return;
    snapshot(); e.stream = e.stream.filter(it => !e._sel.has(it.id));
  }
  else if(op === 'merge'){
    if(items.length < 2){ toast('두 개 이상 선택해 주세요.'); return; }
    snapshot();
    const first = items[0]; let skipped = 0;
    items.slice(1).forEach(b => { if(mergeInto(first, b)) e.stream = e.stream.filter(it => it !== b); else skipped++; });
    if(skipped) toast(`주사위·BGM ${skipped}개는 합치지 않았습니다.`);
  }
  else if(op === 'narration' || op === 'em'){
    snapshot();
    items.forEach(b => {
      if(b.type === 'dialogue' || b.type === 'narration' || b.type === 'handout'){
        const text = blockPlainRich(b); stripBlock(b, 'narration'); b.emphasis = (op === 'em'); b.text = text;
      }
    });
  }
  e._sel.clear();
  renderStream(); renderChars();
}

/* ---- 블록 속성 ---- */
function editorSetSpeaker(id, name){
  const b = getBlock(id); if(!b) return;
  b.speaker = String(name || '').trim();
  const card = $(`.bcard[data-bid="${id}"]`);
  if(card){
    const ch = findChar(E(), b.speaker);
    if(ch) card.style.setProperty('--acc', ch.color); else card.style.removeProperty('--acc');
    const sel = card.querySelector('.spk-sel'), free = card.querySelector('.spk-free');
    if(free) free.value = b.speaker;
    if(sel){
      if(b.speaker && !Array.from(sel.options).some(o => o.value === b.speaker)){
        const o = document.createElement('option'); o.value = o.textContent = b.speaker; sel.appendChild(o);
      }
      sel.value = b.speaker;
    }
  }
  renderChars();
}
function editorSetSeg(id, k, kind){
  const b = getBlock(id); if(!b || !b.segments[k]) return;
  b.segments[k].kind = kind;
  const row = $(`.bcard[data-bid="${id}"] .b-edit[data-seg="${k}"]`);
  if(row){ row.classList.remove('line', 'narr'); row.classList.add(kind); }
}
function editorAddSeg(id){ const b = getBlock(id); if(!b) return; b.segments.push({ kind:'narr', text:'' }); renderStream(); }
function editorDelSeg(id, k){
  const b = getBlock(id); if(!b) return;
  snapshot(); b.segments.splice(k, 1);
  if(!b.segments.length) E().stream = E().stream.filter(it => it !== b);
  renderStream();
}
function editorSetDiceKind(id, kind){
  const b = getBlock(id); if(!b) return;
  b.kind = kind;
  if(kind === 'check'){ b.grade = b.grade || '보통'; delete b.formula; delete b.damage; }
  else if(kind === 'attack'){ b.damage = b.damage || ''; delete b.grade; delete b.formula; }
  else { b.formula = b.formula || '1d100'; delete b.grade; delete b.standard; delete b.damage; }
  renderStream();
}
function editorSetBlockType(id, t){
  const b = getBlock(id); if(!b) return;
  snapshot();
  const text = blockPlainRich(b);
  const speaker = b.speaker;
  const oldSegs = b.type === 'dialogue' ? b.segments : null;
  if(t === 'narration-normal' || t === 'narration-em'){
    stripBlock(b, 'narration'); b.emphasis = (t === 'narration-em'); b.text = text;
  } else if(t === 'dialogue'){
    const segs = oldSegs || (text ? splitQuotedRich(text) : []);
    stripBlock(b, 'dialogue');
    b.speaker = speaker || newBlock('dialogue').speaker;
    b.segments = segs.length ? segs : [{ kind:'line', text:'' }];
  } else {
    const nb = newBlock(t); stripBlock(b, nb.type);
    Object.keys(nb).forEach(k => { if(k !== 'id') b[k] = nb[k]; });
    if(t === 'handout') b.body = text;
    if(t === 'dice' && speaker) b.speaker = speaker;
  }
  renderStream(); renderChars();
}
function stripBlock(b, newType){
  Object.keys(b).forEach(k => { if(k !== 'id') delete b[k]; });
  b.type = newType;
}

/* ============================ ⑤ 내보내기 · 미리보기 ============================ */
function editorRefreshJSON(){ $('#jsonOut').value = JSON.stringify(editorToSession(), null, 2); toast('JSON을 생성했습니다.'); }
function editorCopyJSON(){
  editorRefreshJSON();
  navigator.clipboard?.writeText($('#jsonOut').value).then(() => toast('클립보드에 복사했습니다.'), () => toast('복사 실패 — 직접 선택해 주세요.'));
}
function editorDownloadJSON(){
  const ses = editorToSession();
  if(!ses.title){ toast('세션 제목을 입력해 주세요.'); return; }
  const blob = new Blob([JSON.stringify(ses, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (ses.id || 'session') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('세션 JSON을 내려받았습니다. data/sessions/ 에 올리고 manifest 에 추가하세요.');
}
function editorPreview(sceneId){
  const ses = editorToSession();
  const sc = ses.scenes.find(s => s.id === sceneId) || ses.scenes[0];
  if(!sc || !sc.blocks.length){ toast('이 장면에는 아직 블록이 없습니다.'); return; }
  E()._scrollY = window.scrollY;
  upsertSessionInDB(ses);
  state.previewReturn = true;
  openViewer(ses.id, sc.id);
}

/* 단축키: 편집 화면에서 입력칸 밖일 때 Ctrl+Z = 되돌리기 */
document.addEventListener('keydown', ev => {
  if(state.view !== 'editor' || !E()) return;
  const t = ev.target;
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z' && !typing){ ev.preventDefault(); editorUndo(); }
});
