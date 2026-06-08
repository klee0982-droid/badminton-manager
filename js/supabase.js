var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function setSyncBadge(text, type) {
  var el = byId('sync-badge'); if(!el) return;
  el.textContent = text;
  el.style.background = type==='ok'?'var(--accent-light)':type==='warn'?'var(--warn-light)':type==='bad'?'var(--danger-light)':'var(--surface2)';
  el.style.color = type==='ok'?'var(--accent)':type==='warn'?'var(--warn)':type==='bad'?'var(--danger)':'var(--text3)';
}

async function syncMembers() {
  saveLocal();
  try {
    var rows = members.map(function(m){ return {club_id:CLUB_ID,member_id:m.id,name:m.name,elo:m.elo,gender:m.gender||'M',updated_at:new Date().toISOString()}; });
    var res = await db.from('badminton_members').upsert(rows,{onConflict:'club_id,member_id'});
    if(res.error) throw res.error;
    setSyncBadge('저장됨','ok');
  } catch(e) { console.warn('syncMembers:',e?.message||String(e)); setSyncBadge('오류','bad'); }
}

async function syncHistory() {
  saveLocal();
  try {
    var rows = gameHistory.map(function(h){ return {club_id:CLUB_ID,session_id:h.id,played_at:h.date,status:h.status,game_count:h.gameCount,participant_count:h.participantCount,payload:{games:h.games||[],deltas:h.deltas||{},attendees:h.attendees||[]}}; });
    if(!rows.length) return;
    var res = await db.from('badminton_sessions').upsert(rows,{onConflict:'club_id,session_id'});
    if(res.error) throw res.error;
    setSyncBadge('저장됨','ok');
  } catch(e) { console.warn('syncHistory:',e?.message||String(e)); setSyncBadge('오류','bad'); }
}

async function updateClubSettings(currentPin, newName, newPin) {
  var res = await db.rpc('update_club_settings', {
    p_club_id: CLUB_ID,
    p_current_pin: currentPin,
    p_new_name: newName,
    p_new_pin: newPin
  });
  if(res.error) throw res.error;
  return res.data; // true = 성공, false = PIN 불일치
}

async function saveGameState() {
  try {
    var state = courts.some(function(c){return c!==null;}) || waitQueue.length
      ? {
          courts: courts.map(function(c){
            if(!c) return null;
            return {
              teamA: c.teamA.map(function(p){return {id:p.id,name:p.name};}),
              teamB: c.teamB.map(function(p){return {id:p.id,name:p.name};}),
              diff: c.diff
            };
          }),
          waitQueue: waitQueue.map(function(p){return {id:p.id,name:p.name};}),
          updatedAt: new Date().toISOString()
        }
      : null;
    await db.from('club_game_state').upsert(
      {club_id: CLUB_ID, game_state: state, updated_at: new Date().toISOString()},
      {onConflict: 'club_id'}
    );
  } catch(e) { console.warn('saveGameState:', e?.message||String(e)); }
}

var _liveTimer = null;
var _lastLiveState = null;
var _realtimeChannel = null;

function startLivePolling() {
  if(_liveTimer) return;
  refreshLive();
  _liveTimer = setInterval(refreshLive, 30000); // fallback: 30초 (Realtime이 주 수단)
}
function stopLivePolling() {
  if(_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
}
async function refreshLive() {
  try {
    var res = await db.from('club_game_state').select('game_state').eq('club_id',CLUB_ID).maybeSingle();
    if(res.data) { _lastLiveState = res.data.game_state; renderLiveView(_lastLiveState); }
  } catch(e) { console.warn('refreshLive:', e?.message||String(e)); }
}

function startRealtimeLive() {
  if(_realtimeChannel) return;
  _realtimeChannel = db.channel('live-'+CLUB_ID)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'club_game_state',
      filter: 'club_id=eq.'+CLUB_ID
    }, function(payload) {
      _lastLiveState = (payload.new || {}).game_state || null;
      renderLiveView(_lastLiveState);
    })
    .subscribe();
}

async function loadFromSupabase() {
  setSyncBadge('동기화 중','warn');
  try {
    // 클럽 정보 먼저 로드 (PIN 포함)
    var cr = await db.from('clubs').select('name,admin_pin').eq('club_id',CLUB_ID).maybeSingle();
    if(cr.error) throw cr.error;
    if(!cr.data) {
      setSyncBadge('오류','bad');
      byId('data-msg').textContent = '동호회를 찾을 수 없어요. ID를 확인해주세요.';
      return;
    }
    ADMIN_PIN = cr.data.admin_pin;
    // 헤더 타이틀 업데이트
    var titleEl = document.querySelector('.header-title');
    if(titleEl) titleEl.textContent = cr.data.name;
    document.title = cr.data.name + ' · 배드민턴 매니저';
    var mr = await db.from('badminton_members').select('member_id,name,elo,gender').eq('club_id',CLUB_ID).order('elo',{ascending:false});
    if(mr.error) throw mr.error;
    if(mr.data&&mr.data.length) {
      members = mr.data.map(function(r){ return {id:Number(r.member_id),name:r.name,elo:Number(r.elo),gender:r.gender||'M'}; });
      nextMemberId = Math.max.apply(null,members.map(function(m){return m.id;}).concat([0]))+1;
    } else {
      members = [];
      nextMemberId = 1;
    }
    var hr = await db.from('badminton_sessions').select('session_id,played_at,status,game_count,participant_count,payload').eq('club_id',CLUB_ID).order('played_at',{ascending:false}).limit(100);
    if(!hr.error&&hr.data) {
      gameHistory = hr.data.map(function(r){ var p=r.payload||{}; return {id:Number(r.session_id),date:r.played_at,status:r.status,gameCount:r.game_count,participantCount:r.participant_count,games:p.games||[],deltas:p.deltas||{},attendees:p.attendees||[]}; });
    }
    var gr = await db.from('club_game_state').select('game_state').eq('club_id',CLUB_ID).maybeSingle();
    _lastLiveState = gr.data ? gr.data.game_state : null;
    // 토너먼트 로드
    var tr = await db.from('club_tournaments').select('tourney_id,payload').eq('club_id',CLUB_ID).order('tourney_id',{ascending:false});
    if(!tr.error && tr.data && tr.data.length) {
      tourneys = tr.data.map(function(r){ return r.payload; }).filter(Boolean);
      if(!_tView && tourneys.length) _tView = tourneys[0].id;
      localStorage.setItem(TOURNEY_KEY, JSON.stringify(tourneys));
      renderTourneySection();
    }
    var nr = await db.from('club_notices').select('id,content,created_at').eq('club_id',CLUB_ID).order('created_at',{ascending:false});
    if(!nr.error && nr.data) notices = nr.data;
    saveLocal(); renderAll(); renderLiveView(_lastLiveState); startRealtimeLive(); setSyncBadge('연결됨','ok');
    byId('data-msg').textContent = 'Supabase 연결 완료: '+SUPABASE_URL;
  } catch(e) {
    console.warn('loadFromSupabase:',e?.message||String(e)); setSyncBadge('오류','bad');
    byId('data-msg').textContent = '연결 실패. 테이블/RLS/API key를 확인하세요.';
  }
}

async function saveTourneysToSupabase() {
  if(!tourneys || !tourneys.length) return;
  try {
    var rows = tourneys.map(function(t) {
      return { club_id: CLUB_ID, tourney_id: t.id, payload: t, updated_at: new Date().toISOString() };
    });
    await db.from('club_tournaments').upsert(rows, { onConflict: 'club_id,tourney_id' });
  } catch(e) { console.warn('saveTourneysToSupabase:', e?.message||String(e)); }
}

async function deleteTourneyFromSupabase(tId) {
  try {
    await db.from('club_tournaments').delete().eq('club_id', CLUB_ID).eq('tourney_id', tId);
  } catch(e) { console.warn('deleteTourneyFromSupabase:', e?.message||String(e)); }
}

async function saveNotice(text) {
  try {
    var res = await db.from('club_notices').insert({club_id:CLUB_ID, content:text});
    if(res.error) throw res.error;
    var nr = await db.from('club_notices').select('id,content,created_at').eq('club_id',CLUB_ID).order('created_at',{ascending:false});
    if(!nr.error && nr.data) { notices = nr.data; renderNotices(); }
    setSyncBadge('저장됨','ok');
  } catch(e) { console.warn('saveNotice:',e?.message||String(e)); showMsg('공지 저장 실패','warn'); }
}

async function deleteNotice(id) {
  try {
    await db.from('club_notices').delete().eq('id',id).eq('club_id',CLUB_ID);
    notices = notices.filter(function(n){ return n.id !== id; });
    renderNotices();
  } catch(e) { console.warn('deleteNotice:',e?.message||String(e)); }
}