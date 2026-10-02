/* =========================================================================
   app.js — 초기화 / 라우팅
   ========================================================================= */
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    if(state.view === 'viewer'){
      if(state.previewReturn && state.editor){ returnToEditor(); return; }
      if(state.openSession) openSessionTOC(state.openSession); else goMain();
    }
  }
});

(async function boot(){
  const info = await loadDB();
  goMain();
  loadYouTubeAPI();
})();
