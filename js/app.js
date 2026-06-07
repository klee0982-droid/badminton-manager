// ── 글로벌 상태 ──
var isAdmin = sessionStorage.getItem('bdm_admin_ok') === '1';
var activeCourtCount = Number(localStorage.getItem('bdm_active_court_count') || 1);
var members = loadJson(STORAGE_KEY, defaultMembers());
var gameHistory = loadJson(HISTORY_KEY, []);
var present = new Set();
var courts = [null,null,null,null];
var waitQueue = [], gameLog = [], eloDeltas = {}, sessionStats = {};
var turn = 0;
var pausedIds = [];
var currentSessionSaved = false, selectedPlayerId = null;
var nextMemberId = Math.max.apply(null, members.map(function(m){return m.id;}).concat([0])) + 1;
var selectedForDelete = new Set();
var partnerHistory = {}, opponentHistory = {};

// ── 코트/대기 관리 ──
function pauseFromWait(id) {
  if(!requireAdmin()) return;
  id = Number(id);
  var m = members.find(function(x){return x.id===id;});
  if(!m) return;
  waitQueue = waitQueue.filter(function(p){return p.id!==id;});
  if(pausedIds.indexOf(id)<0) pausedIds.push(id);
  renderPlay();
  showMsg(m.name+' 휴식 처리','info');
}
function resumePlayer(id) {
  if(!requireAdmin()) return;
  id = Number(id);
  var m = members.find(function(x){return x.id===id;});
  if(!m) return;
  pausedIds = pausedIds.filter(function(x){return x!==id;});
  var alreadyWaiting = waitQueue.some(function(p){return p.id===id;});
  var inCourt = courts.some(function(c){return c&&c.teamA.concat(c.teamB).some(function(p){return p.id===id;});});
  if(present.has(id) && !alreadyWaiting && !inCourt) waitQueue.push(m);
  for(var i=0;i<activeCourtCount;i++) if(!courts[i]) assignNext(i);
  renderPlay(); renderAttend();
  showMsg(m.name+' 복귀 완료','info');
}
function bestReplacement(court, leavingId) {
  var current = court.teamA.concat(court.teamB).filter(function(p){return p.id!==leavingId;});
  if(waitQueue.length<1) return null;
  var best=null, bestScore=Infinity;
  waitQueue.forEach(function(cand){
    var group = current.concat([cand]);
    var asgn = makeAssignment(group);
    if(!asgn) return;
    var s = asgn.diff + current.reduce(function(sum,p){return sum+statOf(p.id).played;},0)*8;
    if(s<bestScore){bestScore=s; best={cand:cand, assignment:asgn};}
  });
  return best;
}
function replaceFromCourt(courtIdx, playerId) {
  if(!requireAdmin()) return;
  var c = courts[courtIdx];
  playerId = Number(playerId);
  var leaving = members.find(function(x){return x.id===playerId;});
  if(!c||!leaving) return;
  if(!waitQueue.length){showMsg('대기 중인 선수가 없습니다.','warn'); return;}
  openSwapPopup(courtIdx, leaving);
}
function confirmSwap(courtIdx, leavingId, candidateId) {
  var c = courts[courtIdx];
  var leaving = members.find(function(x){return x.id===leavingId;});
  var cand = waitQueue.find(function(p){return p.id===candidateId;});
  if(!c||!leaving||!cand) return;
  var newPlayers = c.teamA.concat(c.teamB)
    .filter(function(p){return p.id!==leavingId;})
    .concat([cand]);
  waitQueue = waitQueue.filter(function(p){return p.id!==candidateId;});
  waitQueue.unshift(leaving);
  courts[courtIdx] = makeAssignment(newPlayers);
  closeSwapPopup();
  renderPlay(); renderAttend();
  showMsg(leaving.name+' → '+cand.name+' 교체 ('+leaving.name+' 대기열 1순위)','info');
}
function assignSingleCourt(i) {
  if(!requireAdmin()) return;
  if(waitQueue.length<4) { showMsg('대기자가 4명 필요합니다.', 'warn'); return; }
  assignNext(i);
  renderPlay(); renderAttend();
  if(courts[i]) showMsg(COURT_NAMES[i]+' 배정 완료', 'info');
  else showMsg('배정 가능한 조합이 없습니다.', 'warn');
}

// ── 게임 흐름 ──
function resetAll() {
  if(!requireAdmin())return;
  present.clear(); courts=[null,null,null,null]; waitQueue=[]; gameLog=[]; eloDeltas={}; sessionStats={}; turn=0; partnerHistory={}; opponentHistory={}; pausedIds=[]; currentSessionSaved=false;
  byId('play-main').style.display='none'; byId('play-empty').style.display='';
  byId('result-main').style.display='none'; byId('result-empty').style.display='';
  renderAll();
}
function startGame() {
  if(!requireAdmin())return;
  if(present.size<4){showMsg('최소 4명이 필요합니다.');return;}
  courts=[null,null,null,null]; waitQueue=[]; gameLog=[]; eloDeltas={}; sessionStats={}; turn=0; partnerHistory={}; opponentHistory={}; pausedIds=[]; currentSessionSaved=false;
  var pool=members.filter(function(m){return present.has(m.id);}).sort(function(a,b){return b.elo-a.elo;});
  ensureStats(pool.map(function(p){return p.id;})); waitQueue=pool.slice();
  var cnt=Math.min(activeCourtCount,Math.floor(pool.length/4));
  for(var i=0;i<cnt;i++) assignNext(i);
  renderPlay(); renderAttend(); gotoTab('play');
}
function courtFinished(i) {
  if(!requireAdmin())return;
  var c=courts[i]; if(!c) return;
  var sa=parseInt(byId('sa-'+i).value,10)||0,sb=parseInt(byId('sb-'+i).value,10)||0;
  if(sa===0&&sb===0&&!confirm('0:0으로 기록할까요?')) return;
  if(sa===sb&&sa!==0&&!confirm('동점('+sa+':'+sb+')으로 기록할까요?')) return;
  var ch=calcElo(c.teamA,c.teamB,sa,sb);
  currentSessionSaved=false;
  gameLog.push({courtName:COURT_NAMES[i],teamA:c.teamA.slice(),teamB:c.teamB.slice(),scoreA:sa,scoreB:sb,deltaA:ch.deltaA,deltaB:ch.deltaB,expectedA:ch.expectedA,margin:ch.margin,kA:ch.kA,kB:ch.kB});
  c.teamA.forEach(function(p){eloDeltas[p.id]=(eloDeltas[p.id]||0)+ch.deltaA;});
  c.teamB.forEach(function(p){eloDeltas[p.id]=(eloDeltas[p.id]||0)+ch.deltaB;});
  var played=c.teamA.concat(c.teamB); turn++;
  played.forEach(function(p){ensureStats([p.id]);sessionStats[p.id].played++;sessionStats[p.id].lastTurn=turn;});
  recordPairings(c.teamA, c.teamB);
  waitQueue.push.apply(waitQueue,played);
  courts[i]=null;
  updateCourtCard(i); updateWaitSection(); renderAttend();
}
function finishDay() {
  if(!gameLog.length){showMsg('기록된 게임이 없습니다.','warn');return;}
  renderResult(); gotoTab('result');
}
function editGame(idx) {
  var g = gameLog[idx];
  if(!g) return;
  var newA = prompt('A팀 점수 (현재: '+g.scoreA+')', g.scoreA);
  if(newA===null) return;
  var newB = prompt('B팀 점수 (현재: '+g.scoreB+')', g.scoreB);
  if(newB===null) return;
  newA = Math.max(0, Math.min(99, Number(newA)||0));
  newB = Math.max(0, Math.min(99, Number(newB)||0));
  g.teamA.forEach(function(p){ eloDeltas[p.id]=(eloDeltas[p.id]||0)-g.deltaA; });
  g.teamB.forEach(function(p){ eloDeltas[p.id]=(eloDeltas[p.id]||0)-g.deltaB; });
  var ch = calcElo(g.teamA, g.teamB, newA, newB);
  g.scoreA=newA; g.scoreB=newB;
  g.deltaA=ch.deltaA; g.deltaB=ch.deltaB;
  g.expectedA=ch.expectedA; g.margin=ch.margin;
  g.teamA.forEach(function(p){ eloDeltas[p.id]=(eloDeltas[p.id]||0)+ch.deltaA; });
  g.teamB.forEach(function(p){ eloDeltas[p.id]=(eloDeltas[p.id]||0)+ch.deltaB; });
  currentSessionSaved=false;
  renderResult();
  showMsg('게임 '+(idx+1)+' 점수 수정 완료!','info');
}
function saveSession(status) {
  if(!gameLog.length||currentSessionSaved)return;
  var participants=new Set(); gameLog.forEach(function(g){g.teamA.concat(g.teamB).forEach(function(p){participants.add(p.id);});});
  var attendees = members.filter(function(m){ return present.has(m.id); }).map(function(m){
    return { id: m.id, name: m.name, elo: m.elo, gender: m.gender };
  });
  gameHistory.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    status: status,
    games: JSON.parse(JSON.stringify(gameLog)),
    deltas: Object.assign({}, eloDeltas),
    participantCount: participants.size,
    gameCount: gameLog.length,
    attendees: attendees
  });
  gameHistory=gameHistory.slice(0,100); currentSessionSaved=true; syncHistory(); renderData();
}
async function applyEloAndReset() {
  if(!requireAdmin())return;
  saveSession('ELO 반영');
  members.forEach(function(m){if(eloDeltas[m.id])m.elo=Math.max(100,Math.min(3000,m.elo+eloDeltas[m.id]));});
  await syncMembers(); resetAll(); gotoTab('attend'); showMsg('ELO 반영 완료!','info');
}
function discardAndReset() { if(!requireAdmin())return; saveSession('기록만 저장'); resetAll(); gotoTab('attend'); }

// ── 멤버 관리 ──
async function addMember() {
  if(!requireAdmin())return;
  var name=byId('n-name').value.trim(); if(!name)return;
  var finalName = name;
  if(members.some(function(m){return norm(m.name)===norm(name);})){
    var suffix = 'B';
    while(members.some(function(m){return norm(m.name)===norm(name+' '+suffix);})){
      suffix = String.fromCharCode(suffix.charCodeAt(0)+1);
      if(suffix>'Z'){showMsg('동명이인이 너무 많아요.','warn');return;}
    }
    finalName = name+' '+suffix;
    showMsg('"'+name+'"이 이미 있어 "'+finalName+'"으로 등록돼요.','warn');
  }
  var elo=Math.max(100,Math.min(3000,Number(byId('n-elo').value)||1000));
  var newId=nextMemberId++;
  members.push({id:newId,name:finalName,elo:elo,gender:byId('n-gender').value});
  byId('n-name').value='';
  renderAll();
  setTimeout(function(){
    var row=document.querySelector('[data-elo-id="'+newId+'"]');
    if(row){
      var mrow=row.closest('.mrow');
      if(mrow){
        mrow.style.transition='background .3s';
        mrow.style.background='var(--accent-light)';
        mrow.style.borderRadius='var(--radius-sm)';
        setTimeout(function(){ mrow.style.background=''; }, 2000);
      }
    }
  }, 50);
  await syncMembers();
  showMsg('"'+finalName+'" 추가 완료!','info');
}
async function updateElo(id,val) {
  if(!requireAdmin())return;
  var m=members.find(function(x){return x.id===Number(id);}); if(!m)return;
  m.elo=Math.max(100,Math.min(3000,Number(val)||1000)); renderAll(); await syncMembers();
}
async function updateGender(id) {
  if(!requireAdmin())return;
  var m=members.find(function(x){return x.id===Number(id);}); if(!m)return;
  m.gender=m.gender==='F'?'M':'F'; renderManage(); await syncMembers();
}
async function delMember(id) {
  if(!requireAdmin())return;
  id=Number(id);
  var m=members.find(function(x){return x.id===id;});
  if(!m)return;
  if(!confirm('"'+m.name+'"을(를) 삭제할까요?'))return;
  var backup=members.slice();
  members=members.filter(function(x){return x.id!==id;});
  present.delete(id);
  renderAll();
  try {
    var res=await db.from('badminton_members').delete().eq('club_id',CLUB_ID).eq('member_id',id);
    if(res.error) throw res.error;
    setSyncBadge('저장됨','ok');
    saveLocal();
  } catch(e){
    members=backup;
    present.add(id);
    renderAll();
    setSyncBadge('오류','bad');
    showMsg('"'+m.name+'" 삭제 실패. 다시 시도해주세요.','warn');
    console.warn('delMember:',e?.message||String(e));
  }
}

// ── 데이터/공유 ──
function shareLatest() {
  var latest = gameHistory.slice(0,1);
  var text = buildShareText(latest);
  byId('share-box').value = text;
  byId('share-box').select();
  document.execCommand('copy');
  showMsg('클립보드에 복사됐어요! 카카오톡에 붙여넣으세요.', 'info');
}
function shareAll() {
  var today = new Date().toDateString();
  var todaySessions = gameHistory.filter(function(h){
    return new Date(h.date).toDateString() === today;
  });
  if(!todaySessions.length) todaySessions = gameHistory.slice(0,3);
  var text = buildShareText(todaySessions);
  byId('share-box').value = text;
  byId('share-box').select();
  document.execCommand('copy');
  showMsg('클립보드에 복사됐어요! 카카오톡에 붙여넣으세요.', 'info');
}
function exportAttendance() {
  updateAttendanceBox();
  var box = byId('attendance-box');
  if(!box || !box.value) return;
  box.select();
  document.execCommand('copy');
  showMsg('출석 명단이 복사됐어요!', 'info');
}
function exportData() {
  byId('data-box').value=JSON.stringify({version:1,exportedAt:new Date().toISOString(),members:members,history:gameHistory},null,2);
  byId('data-msg').textContent='내보내기 완료.';
}
function importData() {
  if(!requireAdmin())return;
  try {
    var p=JSON.parse(byId('data-box').value);
    if(!p.members||!Array.isArray(p.members))throw new Error();
    members=p.members;
    gameHistory=Array.isArray(p.history)?p.history:gameHistory;
    nextMemberId=Math.max.apply(null,members.map(function(m){return m.id;}).concat([0]))+1;
    renderAll(); syncMembers(); syncHistory();
    byId('data-msg').textContent='가져오기 완료.';
  } catch(e){byId('data-msg').textContent='가져오기 실패.';}
}
function copyData() {
  if(!byId('data-box').value)exportData();
  byId('data-box').select();
  document.execCommand('copy');
  byId('data-msg').textContent='복사 완료.';
}
function clearHistory() {
  if(!requireAdmin())return;
  gameHistory=[]; saveLocal(); renderData();
  byId('data-msg').textContent='삭제 완료. Supabase는 Table Editor에서 직접 삭제하세요.';
}

// ── 테스트 ──
function runTests() {
  var f=[];
  function assert(n,c){if(!c)f.push(n);}
  var tp=[{id:1,name:'A',elo:1600,gender:'M'},{id:2,name:'B',elo:1500,gender:'M'},{id:3,name:'C',elo:900,gender:'M'},{id:4,name:'D',elo:880,gender:'M'},{id:5,name:'E',elo:1200,gender:'M'}];
  var wk=[{id:6,name:'W1',elo:900,gender:'M'},{id:7,name:'W2',elo:900,gender:'M'}],st=[{id:8,name:'S1',elo:1500,gender:'M'},{id:9,name:'S2',elo:1500,gender:'M'}];
  assert('combinations',combinations(tp,4).length===5);
  assert('selectFairGroup',selectFairGroup(tp).length===4);
  assert('makeAssignment',makeAssignment(tp.slice(0,4)).teamA.length===2);
  assert('elo underdog',calcElo(wk,st,21,19).deltaA>calcElo(st,wk,21,19).deltaA);
  var el=byId('test-status');
  if(el){
    if(f.length){el.textContent='테스트 실패: '+f.join(', ');el.style.color='var(--danger)';}
    else{el.textContent='테스트 통과';el.style.color='var(--text3)';}
  }
}

// ── 이벤트 바인딩 ──
function bind() {
  byId('admin-login-btn').addEventListener('click',adminLogin);
  byId('admin-logout-btn').addEventListener('click',adminLogout);
  byId('admin-pin').addEventListener('keydown',function(e){if(e.key==='Enter')adminLogin();});
  document.querySelector('.tab-bar').addEventListener('click',function(e){var b=e.target.closest('[data-tab]');if(b)gotoTab(b.getAttribute('data-tab'));});
  document.body.addEventListener('click',function(e){
    var cc=e.target.closest('[data-court-count]');if(cc){setActiveCourtCount(cc.getAttribute('data-court-count'));return;}
    var ps=e.target.closest('[data-player-select]');if(ps){selectPlayer(ps.getAttribute('data-player-select'));return;}
    var gt=e.target.closest('[data-gender-toggle]');if(gt){updateGender(gt.getAttribute('data-gender-toggle'));return;}
    var t=e.target.closest('[data-toggle]');if(t){toggleP(t.getAttribute('data-toggle'));return;}
    var ac=e.target.closest('[data-assign-court]');if(ac){assignSingleCourt(Number(ac.getAttribute('data-assign-court')));return;}
    var pw=e.target.closest('[data-pause-wait]');if(pw){pauseFromWait(pw.getAttribute('data-pause-wait'));return;}
    var rv=e.target.closest('[data-resume]');if(rv){resumePlayer(rv.getAttribute('data-resume'));return;}
    var rp=e.target.closest('[data-replace]');if(rp){var rArr=rp.getAttribute('data-replace').split(':');replaceFromCourt(Number(rArr[0]),Number(rArr[1]));return;}
    var sc=e.target.closest('[data-swap-confirm]');if(sc){var sArr=sc.getAttribute('data-swap-confirm').split(':');confirmSwap(Number(sArr[0]),Number(sArr[1]),Number(sArr[2]));return;}
    var sb=e.target.closest('[data-score-btn]');if(sb){var p=sb.getAttribute('data-score-btn').split(':');adjustCourtScore(Number(p[0]),p[1],Number(p[2]));return;}
    var wb=e.target.closest('[data-winner-score]');if(wb){var w=wb.getAttribute('data-winner-score').split(':');setWinnerScore(Number(w[0]),w[1]);return;}
    var cf=e.target.closest('[data-court-finish]');if(cf){courtFinished(Number(cf.getAttribute('data-court-finish')));return;}
    var eg=e.target.closest('[data-edit-game]');if(eg){if(requireAdmin())editGame(Number(eg.getAttribute('data-edit-game')));return;}
    var d=e.target.closest('[data-del]');if(d){delMember(d.getAttribute('data-del'));return;}
  });
  var eloDebounceTimer = null;
  document.body.addEventListener('input',function(e){
    if(e.target.matches('[data-elo-id]')){
      clearTimeout(eloDebounceTimer);
      e.target.style.borderColor = 'var(--warn)';
      eloDebounceTimer = setTimeout(function(){
        updateElo(e.target.getAttribute('data-elo-id'), e.target.value);
        e.target.style.borderColor = 'var(--accent)';
        setTimeout(function(){ e.target.style.borderColor = ''; }, 1000);
      }, 1000);
    }
  });
  byId('attend-search').addEventListener('input',renderAttend);
  byId('member-search').addEventListener('input',renderManage);
  byId('player-search').addEventListener('input',renderPlayerSearch);
  byId('start-btn').addEventListener('click',startGame);
  byId('reset-btn').addEventListener('click',resetAll);
  byId('back-attend-btn').addEventListener('click',function(){gotoTab('attend');});
  byId('status-toggle').addEventListener('click',function(){
    var list = byId('player-status-list');
    var toggle = byId('status-toggle');
    var isOpen = toggle.classList.contains('open');
    toggle.classList.toggle('open', !isOpen);
    list.style.display = isOpen ? 'none' : '';
  });
  byId('finish-btn').addEventListener('click',finishDay);
  byId('apply-btn').addEventListener('click',applyEloAndReset);
  byId('discard-btn').addEventListener('click',discardAndReset);
  byId('add-member-btn').addEventListener('click',addMember);
  byId('bulk-del-btn').addEventListener('click', async function(){
    if(!requireAdmin())return;
    if(!selectedForDelete.size)return;
    var names=members.filter(function(m){return selectedForDelete.has(m.id);}).map(function(m){return m.name;}).join(', ');
    if(!confirm(names+'\n\n위 '+selectedForDelete.size+'명을 삭제할까요?'))return;
    var ids=Array.from(selectedForDelete);
    members=members.filter(function(m){return !selectedForDelete.has(m.id);});
    ids.forEach(function(id){present.delete(id);});
    selectedForDelete.clear();
    renderAll();
    try {
      await db.from('badminton_members').delete().eq('club_id',CLUB_ID).in('member_id',ids);
      setSyncBadge('저장됨','ok');
    } catch(e){ console.warn('bulkDel:',e?.message||String(e)); setSyncBadge('오류','bad'); }
    saveLocal();
  });
  byId('bulk-cancel-btn').addEventListener('click', function(){
    selectedForDelete.clear(); renderManage();
  });
  document.body.addEventListener('change', function(e){
    if(e.target.matches('[data-check-del]')){
      var id=Number(e.target.getAttribute('data-check-del'));
      e.target.checked ? selectedForDelete.add(id) : selectedForDelete.delete(id);
      updateBulkBar();
      var row=e.target.closest('.mrow');
      if(row) row.style.cssText=e.target.checked?'background:var(--danger-light);border-radius:var(--radius-sm);padding:10px;':'';
      return;
    }
  });
  byId('export-btn').addEventListener('click',exportData);
  byId('export-attendance-btn').addEventListener('click',exportAttendance);
  byId('attendance-session-select').addEventListener('change',updateAttendanceBox);
  byId('share-latest-btn').addEventListener('click',shareLatest);
  byId('share-all-btn').addEventListener('click',shareAll);
  byId('copy-btn').addEventListener('click',copyData);
  byId('import-btn').addEventListener('click',importData);
  byId('clear-history-btn').addEventListener('click',function(){ if(window.confirm('세션 기록을 모두 삭제할까요?')) clearHistory(); });
}

// ── 초기화 ──
bind();
renderAdmin(); renderCourtConfig(); renderAttend(); renderManage(); renderPlayerSearch(); renderTierGuide(); renderData(); runTests(); loadFromSupabase();
