/* =========================================================================
   library.js — 홈(서가) 뷰 + 장면 목차 뷰
   ========================================================================= */
const state = { view:'main', activeFolder:null, openSession:null, editor:null };

function castForCard(ses){
  // PC, KPC 만 (NPC 제외)
  return (ses.characters || []).filter(c => c.role === 'PC' || c.role === 'KPC');
}

function renderFolders(){
  const el = $('#folders'); el.innerHTML = '';
  if(!state.activeFolder && DB.folders[0]) state.activeFolder = DB.folders[0].id;
  DB.folders.forEach(f => {
    const b = document.createElement('button');
    b.className = 'folder-tab' + (f.id === state.activeFolder ? ' active' : '');
    b.innerHTML = `${f.name}<span class="count">${f.sessions.length}</span>`;
    b.onclick = () => { state.activeFolder = f.id; renderFolders(); renderCards(); };
    el.appendChild(b);
  });
}

function renderCards(){
  const grid = $('#cardGrid'); grid.innerHTML = '';
  const folder = DB.folders.find(f => f.id === state.activeFolder);
  if(!folder || folder.sessions.length === 0){
    grid.innerHTML = `<div class="empty"><div class="big">아직 비어 있는 서가입니다</div>
      <div>상단의 <b>＋ 로그 등록</b>에서 첫 세션을 추가해 보세요.</div></div>`;
    return;
  }
  folder.sessions.forEach(ses => {
    const cast = castForCard(ses);
    const cover = resolveImg(ses.cardImage);
    const thumbBg = cover
      ? `background-image:url('${cover}')`
      : `background-image:radial-gradient(120% 90% at 25% 0%, rgba(124,45,45,.18), transparent 60%), linear-gradient(135deg,var(--paper-3),var(--paper-2))`;
    const castAv = cast.slice(0,5).map(c =>
      `<div class="avatar av" style="${avatarStyle(c)}"></div>`).join('');
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb" style="${thumbBg}">
        <div class="overlay">
          <div class="ov-title">${applyRich(ses.title)}</div>
          <div class="ov-date">${applyRich(ses.date || '')}</div>
          <div class="ov-cast">${castAv}</div>
        </div>
      </div>
      <div class="meta">
        <div class="t">${applyRich(ses.title)}</div>
        <div class="d">${applyRich(ses.date || '')} · 장면 ${ (ses.scenes||[]).length }개</div>
        <div class="f">${applyRich(ses.folder || '')}</div>
      </div>`;
    card.onclick = () => openSessionTOC(ses.id);
    grid.appendChild(card);
  });
}

function goMain(){
  closeViewer();
  state.view = 'main'; state.openSession = null;
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-main').classList.add('active');
  $('#topbar').style.display = '';
  renderFolders(); renderCards();
  window.scrollTo({ top:0 });
}

/* ---- 장면 목차 ---- */
function openSessionTOC(sessionId){
  const ses = findSession(sessionId);
  if(!ses){ toast('세션을 찾을 수 없습니다.'); return; }
  state.openSession = sessionId; state.view = 'toc';
  closeViewer();
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-toc').classList.add('active');
  $('#topbar').style.display = '';

  const cast = castForCard(ses).map(c =>
    `<div class="pc"><div class="avatar av" style="${avatarStyle(c)}"></div>
      <div><div class="nm">${applyRich(c.name)}</div><div class="rl">${c.role}</div></div></div>`).join('');

  const scenes = (ses.scenes || []).map((sc, idx) => `
    <div class="scene-item" onclick="openViewer('${ses.id}','${sc.id}')">
      <div class="no">${String(idx+1).padStart(2,'0')}</div>
      <div class="body">
        <div class="st">${applyRich(sc.title || '제목 없는 장면')}</div>
        <div class="meta">블록 ${ (sc.blocks||[]).length }개</div>
      </div>
      <div class="go">›</div>
    </div>`).join('') || `<div class="empty"><div class="big">아직 장면이 없습니다</div></div>`;

  $('#tocRoot').innerHTML = `
    <div class="toc">
      <div class="toc-top">
        <button class="btn ghost back" onclick="goMain()">← 서가</button>
        <span style="flex:1"></span>
        <button class="btn sm" onclick="editExistingSession('${ses.id}')">✎ 이 세션 편집</button>
      </div>
      <h1>${applyRich(ses.title)}</h1>
      <div class="sub">${applyRich(ses.folder || '')} · ${applyRich(ses.date || '')}</div>
      <div class="toc-cast">${cast}</div>
      <div class="scene-list">${scenes}</div>
    </div>`;
  window.scrollTo({ top:0 });
}
