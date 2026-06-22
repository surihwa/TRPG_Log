/* =========================================================================
   data.js — 데이터 로딩 (깃허브 레포의 JSON) + 샘플 폴백
   --------------------------------------------------------------------------
   동작:
   1) data/manifest.json 을 읽어 세션 JSON 파일 목록을 가져온다.
   2) 각 세션 JSON(data/sessions/*.json)을 불러와 folder(캠페인)별로 묶는다.
   3) 네트워크가 없거나(file:// 로컬) 실패하면 아래 SAMPLE_DB 로 대체한다.
   ========================================================================= */

let DB = { folders: [] };   // { folders:[ {id,name,sessions:[...]} ] }

/* 로컬/오프라인 폴백용 샘플 (실제 JSON 파일과 동일한 구조) */
const SAMPLE_SESSIONS = [
  {
    id:'ses_wall', folder:'단편 모음', title:'성벽을 넘어서', date:'2024.11.03', theme:'dark',
    cardImage:'image/성벽을 넘어서/_cover.png',
    characters:[
      { id:'c1', name:'에스티니앙',     role:'PC',  color:'#b5453a', img:'image/성벽을 넘어서/에스티니앙.png' },
      { id:'c2', name:'릴리아 올드로즈', role:'KPC', color:'#7d5ba6', img:'image/성벽을 넘어서/릴리아.png' },
      { id:'c3', name:'서리화',         role:'PC',  color:'#3d83a6', img:'' }
    ],
    scenes:[
      { id:'sc1', title:'성벽 잠입', blocks:[
        { id:'b1', type:'bgm', ytId:'jfKfPfyJRdk', title:'잠입 · 잿빛 긴장' },
        { id:'b2', type:'dialogue', speaker:'에스티니앙', segments:[
          { kind:'line', text:'한 번 들여보내줬다고 써먹을 때까지 써먹을 심산이시군, <b>공주님</b>.' },
          { kind:'narr', text:'중얼거리고는 경비병들에게 다가갑니다.' }
        ]},
        { id:'b3', type:'narration', emphasis:false, text:'두 사람은 성벽의 그림자에 몸을 붙인 채 숨을 죽인다.' },
        { id:'b4', type:'dialogue', speaker:'릴리아 올드로즈', segments:[
          { kind:'narr', text:'작게 속삭이며 손짓한다.' },
          { kind:'line', text:'지금이에요. 교대 시간은 <i>길지 않아요</i>.' }
        ]}
      ]},
      { id:'sc2', title:'설원', blocks:[
        { id:'b5', type:'bgm', ytId:'5qap5aO4i9A', title:'설원 · 적막' },
        { id:'b6', type:'narration', emphasis:true, text:'릴리아와 서리화, 그리고 에스티니앙은 차례차례 성벽의 작은 틈 사이로 빠져나온다. 사방에는 자작나무와 전나무가 빽빽하게 서 있고, 온통 흰빛이다.' },
        { id:'b7', type:'narration', emphasis:false, text:'멀리서 무언가 무너지는 소리가 들린다.' },
        { id:'b8', type:'dice', kind:'vs', speaker:'릴리아 올드로즈', item:'Sanity', grade:'보통', roll:'63', target:'79', result:'' },
        { id:'b9', type:'dice', kind:'vs', speaker:'에스티니앙', item:'Sanity', grade:'보통', roll:'52', target:'60', result:'' },
        { id:'b10', type:'dice', kind:'simple', speaker:'서리화', item:'행운', formula:'1d100', roll:'80', result:'' }
      ]}
    ]
  },
  {
    id:'ses_twodays', folder:'캠페인 A', title:'이틀이 남지 않았다', date:'2024.12.18', theme:'light',
    cardImage:'image/이틀이 남지 않았다/_cover.png',
    characters:[
      { id:'c4', name:'키셰',     role:'PC',  color:'#c2682f', img:'image/이틀이 남지 않았다/키셰.png' },
      { id:'c5', name:'샤헤리스', role:'KPC', color:'#2f8a78', img:'' }
    ],
    scenes:[
      { id:'sc3', title:'여명 전의 결심', blocks:[
        { id:'b11', type:'bgm', ytId:'lTRiuFIWV54', title:'여명 전 · 결심' },
        { id:'b12', type:'dialogue', speaker:'키셰', segments:[
          { kind:'narr', text:'언제나 마음대로 했지만, 샤헤리스의 허락 아닌 허락이 떨어졌으니 거리낄 게 없다.' },
          { kind:'line', text:'무엇이 되었든, 저는 주군과 함께 <i>살아남을</i> 거니까요.' },
          { kind:'narr', text:'걱정 말라는 듯 능청스레 웃어 보인다.' }
        ]},
        { id:'b13', type:'dialogue', speaker:'샤헤리스', segments:[
          { kind:'line', text:'…네 마음대로 해. 대신 <b>살아서</b> 돌아와.' }
        ]},
        { id:'b14', type:'narration', emphasis:true, text:'샤헤리스의 명령을 어기고 키셰는 성을 나선다. 시간이 이틀도 남지 않았으니, 밤이라고 맘 편히 잘 수도 없는 노릇이다.' },
        { id:'b15', type:'narration', emphasis:false, text:'지능 판정' },
        { id:'b16', type:'dice', kind:'check', speaker:'키셰', item:'지능', standard:'65/32/13', roll:'47', result:'보통 성공' },
        { id:'b17', type:'narration', emphasis:false, text:'혹시 빈민가에서 훔쳐 온 망토를 쓰면 그들을 따라갈 수 있을지도 모른다는 생각이 스쳐 지나간다.' }
      ]}
    ]
  }
];

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
    if(sessions.length === 0) throw new Error('empty');
    DB = groupIntoFolders(sessions);
    return { source:'repo', count: sessions.length };
  }catch(e){
    DB = groupIntoFolders(JSON.parse(JSON.stringify(SAMPLE_SESSIONS)));
    return { source:'sample', count: SAMPLE_SESSIONS.length };
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
