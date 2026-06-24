/* =========================================================================
   viewer.js — 시네마틱 장면 뷰어 + 인라인 BGM
   ========================================================================= */
let viewerSession = null;
let viewerScene   = null;

/* ---- 다이스 박스 (판정명 헤더 강조 + 화자 색상 반영) ---- */
function diceBoxHTML(ses, b){
  // 레거시 vs → 기준치(check)로 정규화
  if(b.kind === 'vs'){ b = Object.assign({}, b, { kind:'check', standard: b.standard || b.target }); }
  const v = diceVerdict(b);
  const name = applyRich(b.item || '판정');
  const ch = findChar(ses, b.speaker);
  const color = (ch && ch.color) || 'var(--seal)';
  let cells = '';
  if(b.kind === 'simple'){
    cells =
      `<div class="cell"><div class="k">${applyRich(b.formula || 'roll')}</div><div class="val">—</div></div>` +
      `<div class="cell roll"><div class="k">결과</div><div class="val">${applyRich(b.roll)}</div></div>`;
  } else if(b.kind === 'attack'){
    const parts = String(b.standard || '').split('/').map(s => s.trim()).filter(Boolean);
    const std3 = `<div class="cell std3"><div class="k">기준치</div>
        <div class="val std3-row">${parts.map(p=>`<span>${applyRich(p)}</span>`).join('')}</div></div>`;
    cells = std3 +
      `<div class="cell roll"><div class="k">굴림</div><div class="val">${applyRich(b.roll || '-')}</div></div>` +
      `<div class="cell dmg"><div class="k">피해</div><div class="val">${applyRich(b.damage || '-')}</div></div>`;
  } else { // check (기준치)
    const gradeCell = (b.grade && b.grade !== '-')
      ? `<div class="cell"><div class="k">등급</div><div class="val">${applyRich(b.grade)}</div></div>` : '';
    cells = gradeCell +
      `<div class="cell"><div class="k">기준치</div><div class="val">${applyRich(b.standard || '-')}</div></div>` +
      `<div class="cell roll"><div class="k">굴림</div><div class="val">${applyRich(b.roll || '-')}</div></div>`;
  }
  const result = v.text ? `<div class="result ${v.cls}">${applyRich(v.text)}</div>` : '';
  return (
    `<div class="v-dice" style="--dice-color:${color}">` +
      `<div class="dh"><span class="d20">⬢</span><span class="check-name">${name}</span><span class="roll-of">판정</span></div>` +
      `<div class="db">${cells}</div>${result}` +
    `</div>`
  );
}

/* ---- 블록 1개 → HTML ---- */
function viewerBlockHTML(ses, b){
  if(b.type === 'bgm'){
    return `<div class="v-bgm" data-yt="${b.ytId || ''}" onclick="toggleBgmBlock(this)">
        <button class="play">▶</button>
        <div class="info"><div class="lbl">BGM</div><div class="ttl">${applyRich(b.title || '음악')}</div></div>
        <div class="eq"><span></span><span></span><span></span></div>
      </div>`;
  }
  if(b.type === 'narration'){
    const cls = b.emphasis ? 'v-narr-em' : 'v-narr-normal';
    return `<div class="${cls}">${applyRich(b.text)}</div>`;
  }
  if(b.type === 'handout'){
    const style = (b.style === 'paper') ? 'paper' : 'digital';
    const icon  = style === 'paper' ? '✉' : '📄';
    const img   = b.image ? `<img class="ho-img" src="${resolveImg(b.image)}" alt="">` : '';
    const text  = b.body ? `<div class="ho-text">${applyRich(b.body)}</div>` : '';
    return (
      `<div class="v-handout ${style}">` +
        `<div class="ho-card">` +
          `<div class="ho-head" onclick="toggleHandout(this)">` +
            `<span class="ho-icon">${icon}</span>` +
            `<span class="ho-title">${applyRich(b.title || '핸드아웃')}</span>` +
            `<span class="ho-toggle"><span class="when-closed">펼치기 ▾</span><span class="when-open">접기 ▴</span></span>` +
          `</div>` +
          `<div class="ho-body"><div class="ho-inner">${img}${text}</div></div>` +
        `</div>` +
      `</div>`
    );
  }
  if(b.type === 'dice'){
    const who = b.speaker ? `<div class="who">${applyRich(b.speaker)}</div>` : '';
    return `<div class="v-dice-solo">${who}${diceBoxHTML(ses, b)}</div>`;
  }
  if(b.type === 'dialogue'){
    const ch    = findChar(ses, b.speaker);
    const color = (ch && ch.color) || 'var(--seal)';
    const side  = bubbleSide(charRole(ses, b.speaker));   // PC=right, KPC/NPC=left
    const segs  = (b.segments || []).map(s =>
      s.kind === 'line'
        ? `<div class="speech">${applyRich(s.text)}</div>`
        : `<span class="stage">${applyRich(s.text)}</span>`).join('');
    const bubbleStyle = side === 'right'
      ? `border-right-color:${color}` : `border-left-color:${color}`;
    return (
      `<div class="v-line ${side}">` +
        `<div class="avatar av" style="${avatarStyle(ch)};border:2px solid ${color}"></div>` +
        `<div class="v-bubble-wrap">` +
          `<div class="v-name" style="color:${color}">${applyRich(b.speaker || '')}</div>` +
          `<div class="v-bubble" style="${bubbleStyle}">${segs}__DICE_SLOT__</div>` +
        `</div>` +
      `</div>`
    );
  }
  return '';
}

/* ---- 장면 뷰어 열기 ---- */
function openViewer(sessionId, sceneId){
  const ses = findSession(sessionId);
  const sc  = ses && (ses.scenes || []).find(s => s.id === sceneId);
  if(!ses || !sc){ toast('장면을 찾을 수 없습니다.'); return; }
  viewerSession = ses; viewerScene = sc;
  const v = $('#viewer');
  v.className = 'viewer ' + (ses.theme === 'dark' ? 'dark' : 'light');

  const cast = castForCard(ses).map(c =>
    `<div class="pc"><div class="avatar av" style="${avatarStyle(c)};border-color:${c.color||'transparent'}"></div>
      <div class="nm">${applyRich(c.name)}</div><div class="tag">${c.role}</div></div>`).join('');

  const blocks = sc.blocks || [];
  const parts = [];
  for(let i = 0; i < blocks.length; i++){
    const b = blocks[i];
    if(b.type === 'dialogue'){
      let html = viewerBlockHTML(ses, b);
      const next = blocks[i+1];
      if(next && next.type === 'dice' && (next.speaker || '') === (b.speaker || '')){
        html = html.replace('__DICE_SLOT__', diceBoxHTML(ses, next)); i++;
      } else html = html.replace('__DICE_SLOT__', '');
      parts.push(html);
    } else parts.push(viewerBlockHTML(ses, b));
  }

  const sceneIdx = (ses.scenes || []).findIndex(s => s.id === sceneId);
  $('#viewerScroll').innerHTML =
    `<div class="v-bar"><div class="v-bar-inner">` +
      `<button class="v-iconbtn" title="장면 목차" onclick="openSessionTOC('${ses.id}')">☰</button>` +
      `<div class="v-title">${applyRich(sc.title || '장면')}<small>${applyRich(ses.title)} · ${applyRich(ses.date||'')}</small></div>` +
      `<span class="spacer"></span>` +
      `<button class="v-iconbtn" title="편집" onclick="editExistingSession('${ses.id}','${sc.id}')">✎</button>` +
      `<button class="v-iconbtn" title="라이트/다크" onclick="toggleViewerTheme()">◑</button>` +
    `</div></div>` +
    `<div class="v-cast"><div class="v-cast-inner">${cast || '<span style="color:var(--v-soft);font-size:13px">등장인물 없음</span>'}</div></div>` +
    `<div class="v-body">` +
      `<div class="v-scene-kicker">Scene ${String(sceneIdx+1).padStart(2,'0')}</div>` +
      `<h1 class="v-scene-title">${applyRich(sc.title || '')}</h1>` +
      `<div class="v-scene-date">${applyRich(ses.title)}</div>` +
      parts.join('') +
    `</div>`;

  v.classList.add('show');
  $('#topbar').style.display = 'none';
  document.body.style.overflow = 'hidden';
  state.view = 'viewer';
  $('#viewerScroll').scrollTop = 0;
  resetBgm();
}

function closeViewer(){
  const v = $('#viewer');
  if(v) v.classList.remove('show');
  document.body.style.overflow = '';
  stopBgm();
  viewerSession = null; viewerScene = null;
}
function toggleViewerTheme(){
  const v = $('#viewer');
  v.classList.toggle('dark'); v.classList.toggle('light');
  if(viewerSession) viewerSession.theme = v.classList.contains('dark') ? 'dark' : 'light';
}
function toggleHandout(headEl){
  const ho = headEl.closest('.v-handout');
  if(ho) ho.classList.toggle('open');
}

/* =========================================================================
   인라인 BGM — 수동 재생 / 자동 반복 / 한 번에 하나만(페이드 전환)
   ========================================================================= */
let ytPlayer = null, ytReady = false, fadeTimer = null;
let currentBgmEl = null;
const BGM_VOL = 60;

function loadYouTubeAPI(){
  if(window.YT && window.YT.Player){ onYouTubeIframeAPIReady(); return; }
  if(document.getElementById('yt-api-script')) return;
  const s = document.createElement('script');
  s.id = 'yt-api-script'; s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}
window.onYouTubeIframeAPIReady = function(){
  ytPlayer = new YT.Player('ytPlayer', {
    height:'0', width:'0',
    playerVars:{ autoplay:0, controls:0, disablekb:1, playsinline:1 },
    events:{
      onReady: () => { ytReady = true; ytPlayer.setVolume(0); },
      onStateChange: (e) => { if(e.data === YT.PlayerState.ENDED){ ytPlayer.seekTo(0); ytPlayer.playVideo(); } } // 자동 반복
    }
  });
};

function resetBgm(){ currentBgmEl = null; $$('#viewerScroll .v-bgm').forEach(el => setBgmUI(el, false)); }
function setBgmUI(el, on){
  if(!el) return;
  el.classList.toggle('playing', on);
  const btn = el.querySelector('.play'); if(btn) btn.textContent = on ? '⏸' : '▶';
}

function toggleBgmBlock(el){
  if(!ytReady){ toast('유튜브 플레이어 준비 중입니다. 잠시 후 다시 눌러주세요.'); return; }
  const ytId = el.getAttribute('data-yt');
  if(!ytId){ toast('이 BGM 블록에 유튜브 정보가 없습니다.'); return; }

  // 같은 블록을 다시 누르면 정지
  if(currentBgmEl === el){
    stopBgm(); return;
  }
  // 다른 곡이 재생 중이면 페이드아웃 후 새 곡 재생
  const startNew = () => {
    ytPlayer.loadVideoById(ytId);
    ytPlayer.setVolume(0); ytPlayer.playVideo();
    setBgmUI(el, true); currentBgmEl = el;
    let up = 0; clearInterval(fadeTimer);
    fadeTimer = setInterval(() => { up += 8; if(up >= BGM_VOL){ up = BGM_VOL; clearInterval(fadeTimer); } ytPlayer.setVolume(up); }, 70);
  };
  if(currentBgmEl){
    const prev = currentBgmEl;
    let vol = ytPlayer.getVolume ? ytPlayer.getVolume() : BGM_VOL;
    clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {
      vol -= 8;
      if(vol <= 0){ clearInterval(fadeTimer); setBgmUI(prev, false); startNew(); }
      else ytPlayer.setVolume(vol);
    }, 70);
  } else startNew();
}

function stopBgm(){
  clearInterval(fadeTimer);
  if(ytReady && ytPlayer){ try{ ytPlayer.stopVideo(); }catch(e){} }
  if(currentBgmEl) setBgmUI(currentBgmEl, false);
  currentBgmEl = null;
}
