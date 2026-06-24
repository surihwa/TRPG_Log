/* =========================================================================
   data.js — 데이터 로딩 (깃허브 레포의 JSON) + 샘플 폴백
   --------------------------------------------------------------------------
   동작:
   1) data/manifest.json 을 읽어 세션 JSON 파일 목록을 가져온다.
   2) 각 세션 JSON(data/sessions/*.json)을 불러와 folder(캠페인)별로 묶는다.
   3) 네트워크가 없거나(file:// 로컬) 실패하면 아래 SAMPLE_DB 로 대체한다.
   ========================================================================= */

let DB = { folders: [] };   // { folders:[ {id,name,sessions:[...]} ] }

/* 예시 세션은 더 이상 사용하지 않습니다. (manifest.json 에 실제 세션을 등록해 사용하세요) */
const SAMPLE_SESSIONS = [];

function groupIntoFolders(sessions){
  const map = new Map();
  sessions.forEach(s => {
    const key = (s.folder || '기타').trim();
    if(!map.has(key)) map.set(key, { id:'f_'+key, name:key, sessions:[] });
    map.get(key).sessions.push(s);
  });
  return { folders: Array.from(map.values()) };
}

async function loadDB(){
  try{
    const res = await fetch(SITE_BASE + 'data/manifest.json', { cache:'no-store' });
    if(!res.ok) throw new Error('manifest ' + res.status);
    const manifest = await res.json();
    const paths = manifest.sessions || [];
    const sessions = [];
    for(const p of paths){
      try{
        const r = await fetch(SITE_BASE + p.replace(/^\//,''), { cache:'no-store' });
        if(r.ok) sessions.push(await r.json());
      }catch(e){ /* 개별 세션 실패는 건너뜀 */ }
    }
    DB = groupIntoFolders(sessions);
    return { source:'repo', count: sessions.length };
  }catch(e){
    DB = groupIntoFolders(JSON.parse(JSON.stringify(SAMPLE_SESSIONS)));
    return { source: SAMPLE_SESSIONS.length ? 'sample' : 'repo', count: SAMPLE_SESSIONS.length };
  }
}

/* 편집기에서 새 세션을 메모리상 DB 에 반영(미리보기용) */
function upsertSessionInDB(ses){
  let folder = DB.folders.find(f => f.name === (ses.folder || '기타'));
  if(!folder){ folder = { id:'f_'+ses.folder, name:ses.folder || '기타', sessions:[] }; DB.folders.push(folder); }
  const idx = folder.sessions.findIndex(s => s.id === ses.id);
  if(idx >= 0) folder.sessions[idx] = ses; else folder.sessions.unshift(ses);
}

function findSession(sessionId){
  for(const f of DB.folders){
    const s = f.sessions.find(x => x.id === sessionId);
    if(s) return s;
  }
  return null;
}
