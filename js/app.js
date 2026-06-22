/* =========================================================================
   app.js — 초기화 / 라우팅
   ========================================================================= */
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    if(state.view === 'viewer'){ if(state.openSession) openSessionTOC(state.openSession); else goMain(); }
  }
});

(async function boot(){
  const info = await loadDB();
  goMain();
  loadYouTubeAPI();
  if(info.source === 'sample'){
    setTimeout(() => toast('샘플 데이터를 표시 중입니다. (data/manifest.json 로드 시 실제 로그가 표시됩니다)'), 600);
  }
})();
