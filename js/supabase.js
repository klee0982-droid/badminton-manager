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
    } else { await syncMembers(); }
    var hr = await db.from('badminton_sessions').select('session_id,played_at,status,game_count,participant_count,payload').eq('club_id',CLUB_ID).order('played_at',{ascending:false}).limit(100);
    if(!hr.error&&hr.data) {
      gameHistory = hr.data.map(function(r){ var p=r.payload||{}; return {id:Number(r.session_id),date:r.played_at,status:r.status,gameCount:r.game_count,participantCount:r.participant_count,games:p.games||[],deltas:p.deltas||{},attendees:p.attendees||[]}; });
    }
    saveLocal(); renderAll(); setSyncBadge('연결됨','ok');
    byId('data-msg').textContent = 'Supabase 연결 완료: '+SUPABASE_URL;
  } catch(e) {
    console.warn('loadFromSupabase:',e?.message||String(e)); setSyncBadge('오류','bad');
    byId('data-msg').textContent = '연결 실패. 테이블/RLS/API key를 확인하세요.';
  }
}