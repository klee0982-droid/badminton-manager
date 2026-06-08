var _memberSort = 'name';

// ── 관리자 ──
function renderAdmin() {
  document.body.classList.toggle('admin-on', isAdmin);
  byId('admin-status').textContent = isAdmin ? '관리자' : '보기';
  byId('admin-login-btn').style.display  = isAdmin ? 'none' : '';
  byId('admin-logout-btn').style.display = isAdmin ? '' : 'none';
  byId('admin-pin').style.display        = isAdmin ? 'none' : '';
  var sc = byId('settings-card');
  if(sc) {
    sc.style.display = isAdmin ? '' : 'none';
    if(isAdmin) {
      var titleEl = document.querySelector('.header-title');
      var nameInput = byId('settings-name');
      if(nameInput && titleEl && !nameInput.value) nameInput.value = titleEl.textContent;
    }
  }
  var nw = byId('notice-admin-wrap');
  if(nw) nw.style.display = isAdmin ? '' : 'none';
  renderNotices();
}
function requireAdmin() {
  if(isAdmin) return true;
  setAdminMsg('관리자 PIN이 필요합니다', 'err');
  byId('admin-pin') && byId('admin-pin').focus();
  return false;
}
function setAdminMsg(msg, type) {
  var el = byId('admin-msg'); if(!el) return;
  el.textContent = msg;
  el.style.color = type==='ok' ? 'var(--accent)' : 'var(--danger)';
  el.style.display = '';
  if(type==='ok') setTimeout(function(){ el.style.display='none'; }, 2000);
}
function adminLogin() {
  if(byId('admin-pin').value===ADMIN_PIN) {
    isAdmin=true; sessionStorage.setItem('bdm_admin_ok','1'); byId('admin-pin').value='';
    renderAdmin(); renderManage();
    setAdminMsg('관리자 모드 활성화', 'ok');
  } else {
    setAdminMsg('PIN이 틀렸습니다', 'err');
    byId('admin-pin').value=''; byId('admin-pin').focus();
  }
}
function adminLogout() { isAdmin=false; sessionStorage.removeItem('bdm_admin_ok'); renderAdmin(); renderManage(); }

// ── 코트 설정 ──
function renderCourtConfig() {
  activeCourtCount = Math.max(1,Math.min(MAX_COURTS,activeCourtCount));
  document.querySelectorAll('[data-court-count]').forEach(function(btn){ btn.classList.toggle('active',Number(btn.getAttribute('data-court-count'))===activeCourtCount); });
  byId('court-config-hint').textContent = activeCourtCount+'코트';
}
function setActiveCourtCount(n) {
  if(!requireAdmin()) return;
  activeCourtCount=Math.max(1,Math.min(MAX_COURTS,Number(n)||1));
  localStorage.setItem('bdm_active_court_count',String(activeCourtCount));
  courts=[null,null,null,null]; waitQueue=[]; gameLog=[]; eloDeltas={}; sessionStats={}; turn=0; partnerHistory={}; opponentHistory={}; pausedIds=[];
  byId('play-main').style.display='none'; byId('play-empty').style.display='';
  byId('result-main').style.display='none'; byId('result-empty').style.display='';
  renderCourtConfig(); renderAttend();
}

// ── 탭 이동 ──
function gotoTab(tab) {
  ['attend','live','play','result','members','player','tourney','data'].forEach(function(id){ byId('tab-'+id).classList.toggle('active',id===tab); });
  document.querySelectorAll('.tab').forEach(function(btn){ btn.classList.toggle('active',btn.getAttribute('data-tab')===tab); });
  if(tab==='data') renderData();
  if(tab==='player') renderPlayerSearch();
  if(tab==='tourney') renderTourneySection();
  if(tab==='live') startLivePolling(); else stopLivePolling();
}

// ── 출석 ──
function showMsg(msg,type) { var el=byId('attend-alert'); el.className='alert '+(type||'warn'); el.textContent=msg; el.style.display=''; setTimeout(function(){el.style.display='none';},3000); }
function renderSelected() {
  var sel=members.filter(function(m){return present.has(m.id);}).sort(function(a,b){return a.name.localeCompare(b.name,'ko');});
  byId('selected-strip').innerHTML=sel.length?sel.map(function(m){return '<button type="button" class="sel-pill" data-toggle="'+m.id+'">'+esc(m.name)+' ×</button>';}).join(''):'<span style="font-size:12px;color:var(--text3);font-weight:500">선택된 멤버 없음</span>';
}
function renderAttend() {
  var ob = byId('onboarding-overlay');
  if(ob) ob.style.display = members.length === 0 ? 'flex' : 'none';
  if(members.length === 0) return;

  var term=norm(byId('attend-search').value);
  var filtered=members.slice().sort(function(a,b){return a.name.localeCompare(b.name,'ko');}).filter(function(m){return matchesFn(m,term);});
  byId('attend-search-count').textContent=filtered.length+'명';
  renderSelected();
  byId('mgrid').innerHTML=filtered.length?filtered.map(function(m){
    var on=present.has(m.id), early=leftEarly.has(m.id);
    if(early) return '<button type="button" class="chip left-early" data-toggle="'+m.id+'"><span><div class="cname">'+esc(m.name)+' '+gBadge(m.gender,false)+'</div><div class="ctap">조기 퇴장 (출석 인정)</div></span><span class="chip-r">'+tierBadge(m.elo)+'<span class="celo">'+m.elo+'</span></span></button>';
    return '<button type="button" class="chip'+(on?' present':'')+'" data-toggle="'+m.id+'"><span><div class="cname">'+esc(m.name)+' '+gBadge(m.gender,false)+'</div><div class="ctap">'+(on?'✓ 출석':'탭하여 출석')+'</div></span><span class="chip-r">'+tierBadge(m.elo)+'<span class="celo">'+m.elo+'</span></span></button>';
  }).join(''):'<div class="empty">검색 결과 없음</div>';
  var n=present.size,c=Math.min(activeCourtCount,Math.floor(n/4));
  byId('s-total').textContent=n; byId('s-courts').textContent=c;
  byId('s-wait').textContent=Math.max(0,n-c*4); byId('s-games').textContent=gameLog.length;
}
function toggleP(id) {
  if(!requireAdmin()) return;
  id = Number(id);
  var gameStarted = byId('play-main') && byId('play-main').style.display !== 'none';
  if(present.has(id)) {
    present.delete(id);
    waitQueue = waitQueue.filter(function(p){ return p.id !== id; });
    if(gameStarted) leftEarly.add(id);
  } else {
    leftEarly.delete(id);
    present.add(id);
    if(gameStarted) {
      var m = members.find(function(x){ return x.id === id; });
      var inCourt = courts.some(function(c){ return c && c.teamA.concat(c.teamB).some(function(p){ return p.id === id; }); });
      var inWait = waitQueue.some(function(p){ return p.id === id; });
      var inPaused = pausedIds.indexOf(id) >= 0;
      if(m && !inCourt && !inWait && !inPaused) {
        ensureStats([id]); waitQueue.push(m);
        showMsg(m.name + ' 대기열에 추가됐어요!', 'info');
        updateWaitSection();
      }
    }
  }
  renderAttend();
}

// ── 현황 (읽기 전용) ──
function renderLiveView(state) {
  var el = byId('live-courts'); if(!el) return;
  var updEl = byId('live-updated');
  if(!state || (!state.courts.some(function(c){return c;}) && !state.waitQueue.length)) {
    el.innerHTML = '<div style="text-align:center;padding:48px 16px;color:var(--text3);font-size:14px;font-weight:500">⏸ 현재 진행 중인 게임이 없어요</div>';
    if(updEl) updEl.textContent = '';
    return;
  }
  var term = (byId('live-search')||{value:''}).value.trim().toLowerCase();
  function hi(name) {
    var matched = term && name.toLowerCase().indexOf(term) >= 0;
    return matched
      ? '<span style="background:var(--accent);color:#fff;padding:2px 8px;border-radius:20px;font-weight:700">'+esc(name)+' 👈</span>'
      : '<span style="padding:2px 8px">'+esc(name)+'</span>';
  }
  var html = '';
  var COURT_NAMES = ['1코트','2코트','3코트','4코트'];
  state.courts.forEach(function(c, i) {
    if(!c) return;
    html += '<div class="card" style="margin-bottom:12px">' +
      '<div style="font-size:13px;font-weight:800;color:var(--accent);margin-bottom:10px">🏸 '+COURT_NAMES[i]+'</div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        '<div style="flex:1;background:var(--surface2);border-radius:8px;padding:10px 12px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:6px">A팀</div>' +
          '<div style="font-size:14px;font-weight:600;line-height:1.8">'+c.teamA.map(function(p){return hi(p.name);}).join('<br>')+'</div>' +
        '</div>' +
        '<div style="font-size:18px;font-weight:800;color:var(--text3)">vs</div>' +
        '<div style="flex:1;background:var(--surface2);border-radius:8px;padding:10px 12px">' +
          '<div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:6px">B팀</div>' +
          '<div style="font-size:14px;font-weight:600;line-height:1.8">'+c.teamB.map(function(p){return hi(p.name);}).join('<br>')+'</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  });
  if(state.waitQueue && state.waitQueue.length) {
    html += '<div class="card">' +
      '<div style="font-size:13px;font-weight:800;color:var(--text2);margin-bottom:10px">⏳ 대기 중 ('+state.waitQueue.length+'명)</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px">'+
        state.waitQueue.map(function(p, idx){
          var matched = term && p.name.toLowerCase().indexOf(term) >= 0;
          return '<span style="'+(matched?'background:var(--accent);color:#fff;':'background:var(--surface2);color:var(--text);')+'padding:5px 12px;border-radius:20px;font-size:13px;font-weight:600">'+(idx+1)+'. '+esc(p.name)+(matched?' 👈':'')+'</span>';
        }).join('') +
      '</div>' +
    '</div>';
  }
  el.innerHTML = html;
  if(updEl) {
    var d = new Date(state.updatedAt);
    updEl.textContent = '마지막 업데이트: '+d.getHours()+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');
  }
}
// 검색 이벤트는 한 번만 바인딩 (최신 state는 supabase.js의 _lastLiveState 참조)
(function() {
  var el = byId('live-search'); if(!el || el._liveBound) return;
  el._liveBound = true;
  el.addEventListener('input', function(){ if(typeof _lastLiveState!=='undefined') renderLiveView(_lastLiveState); });
})();

// ── 게임 진행 ──
function renderTeam(label,players,side,avg,courtIdx) {
  var cls=side==='a'?'ta':'tb';
  return '<div class="team-block '+cls+'"><div class="team-hd '+cls+'"><span>'+label+'</span><small>평균 '+avg+'</small></div><div class="team-players">'+players.map(function(p){
    var swapBtn=isAdmin?'<button class="mini-btn swap" data-replace="'+courtIdx+':'+p.id+'">교체</button>':'';
    return '<div class="ptag '+cls+'"><span class="ptag-name">'+esc(p.name)+'</span><span style="font-size:11px;font-weight:600;opacity:.65">'+p.elo+'</span>'+gBadge(p.gender,false)+swapBtn+'</div>';
  }).join('')+'</div></div>';
}
function updateCourtCard(i) {
  var c=courts[i],el=byId('court-slot-'+i); if(!el) return;
  if(!c) {
    el.className='court-card court-'+i;
    var canAssign = waitQueue.length>=4;
    var assignBtn = isAdmin && canAssign
      ? '<button class="btn primary" style="width:100%;font-size:16px;padding:18px;margin-bottom:6px" data-assign-court="'+i+'">다음 게임 배정 →</button>'
      : '<div style="font-size:13px;color:var(--text3);font-weight:600;text-align:center;padding:12px 0">대기자 '+waitQueue.length+'명 · 4명 필요</div>';
    el.innerHTML='<div class="court-head"><span class="court-name">'+COURT_NAMES[i]+'</span><span style="font-size:11px;color:var(--text3)">대기 중</span></div>'+
      '<div class="court-body"><div class="team-block ta" style="display:flex;align-items:center;justify-content:center;min-height:100px">'+assignBtn+'</div>'+
      '<div class="vs-sep">-</div><div class="team-block tb" style="display:flex;align-items:center;justify-content:center;min-height:100px"><div style="font-size:12px;color:var(--text3);font-weight:600;text-align:center">게임 종료</div></div></div>';
    return;
  }
  var aA=avgElo(c.teamA),aB=avgElo(c.teamB),d=c.diff;
  var dcls=d<=80?'diff-g':d<=200?'diff-m':'diff-b',dlbl=(d<=80?'균형':d<=200?'보통':'실력차')+' Δ'+d;
  var exp=Math.round(expectedScore(aA,aB)*100);
  el.className='court-card court-'+i;
  el.innerHTML='<div class="court-head"><span class="court-name">'+COURT_NAMES[i]+'</span><span class="diff-tag '+dcls+'">'+dlbl+'</span></div>'+
    '<div class="court-body">'+
    renderTeam('A팀',c.teamA,'a',aA,i)+'<div class="vs-sep">vs</div>'+renderTeam('B팀',c.teamB,'b',aB,i)+
    '<div class="elo-hint">승률 예상: <b>A '+exp+'%</b> · B '+(100-exp)+'%</div>'+
    '<div class="score-ui">'+
      '<div class="score-panel"><div class="score-label ta">A팀</div><div class="score-val" id="sa-view-'+i+'">0</div><div class="score-btns"><button class="score-btn" data-score-btn="'+i+':a:-1">−</button><button class="score-btn" data-score-btn="'+i+':a:1">+</button></div></div>'+
      '<div class="score-panel"><div class="score-label tb">B팀</div><div class="score-val" id="sb-view-'+i+'">0</div><div class="score-btns"><button class="score-btn" data-score-btn="'+i+':b:-1">−</button><button class="score-btn" data-score-btn="'+i+':b:1">+</button></div></div>'+
    '</div>'+
    '<input type="hidden" id="sa-'+i+'" value="0"><input type="hidden" id="sb-'+i+'" value="0">'+
    '<div class="quick-row"><button class="quick-btn ta" data-winner-score="'+i+':a">A팀 승리</button><button class="quick-btn tb" data-winner-score="'+i+':b">B팀 승리</button></div>'+
    '<button class="finish-btn" data-court-finish="'+i+'">완료 → 다음 게임</button>'+
    '</div>';
}
function setCourtScore(i,a,b) {
  a=Math.max(0,Math.min(99,Number(a)||0)); b=Math.max(0,Math.min(99,Number(b)||0));
  var ai=byId('sa-'+i),bi=byId('sb-'+i); if(!ai||!bi) return;
  ai.value=a; bi.value=b;
  var av=byId('sa-view-'+i),bv=byId('sb-view-'+i);
  if(av)av.textContent=a; if(bv)bv.textContent=b;
}
function adjustCourtScore(i,side,delta) { var a=parseInt(byId('sa-'+i).value,10)||0,b=parseInt(byId('sb-'+i).value,10)||0; if(side==='a')a+=Number(delta);else b+=Number(delta); setCourtScore(i,a,b); }
function setWinnerScore(i,side) { side==='a'?setCourtScore(i,21,15):setCourtScore(i,15,21); }

function updateWaitSection() {
  var playingIds = new Set();
  courts.forEach(function(c){ if(c) c.teamA.concat(c.teamB).forEach(function(p){ playingIds.add(p.id); }); });
  byId('sb-playing').textContent = playingIds.size;
  byId('sb-waiting').textContent = waitQueue.length;
  byId('sb-paused').textContent  = pausedIds.length;
  var rows = '';
  waitQueue.forEach(function(p){
    var played = statOf(p.id).played, rest = restScore(p.id);
    var longWait = rest > activeCourtCount + 1;
    rows += '<div class="ps-row waiting"><span class="ps-name">'+esc(p.name)+'</span>'+
      (longWait?'<span class="ps-wait">오래 대기 중</span>':'')+
      '<span class="ps-games">'+played+'게임 · '+rest+'게임째 대기</span>'+
      '<button class="mini-btn pause" data-pause-wait="'+p.id+'">휴식</button></div>';
  });
  pausedIds.map(function(id){ return members.find(function(m){ return m.id===id; }); }).filter(Boolean).forEach(function(p){
    rows += '<div class="ps-row paused"><span class="ps-name">'+esc(p.name)+'</span><span class="ps-games">'+statOf(p.id).played+'게임</span><button class="mini-btn resume" data-resume="'+p.id+'">복귀</button></div>';
  });
  byId('player-status-list').innerHTML = rows || '<div style="font-size:12px;color:var(--text3);padding:8px 0">참여자 없음</div>';
  byId('paused-section').style.display = 'none';
  var cand = selectFairGroup(waitQueue);
  byId('queue-hint').textContent = waitQueue.length>=4&&cand ? '추천: '+cand.map(function(p){return p.name;}).join(', ') : '배정까지 '+Math.max(0,4-waitQueue.length)+'명 더 필요';
}
function renderPlay() {
  byId('play-empty').style.display='none'; byId('play-main').style.display='';
  var grid=byId('court-grid');
  if(!grid.children.length || grid.children.length!==activeCourtCount) {
    grid.innerHTML=courts.slice(0,activeCourtCount).map(function(_,i){return '<div id="court-slot-'+i+'"></div>';}).join('');
  }
  grid.classList.toggle('multi', activeCourtCount >= 2);
  grid.classList.toggle('multi-4', activeCourtCount === 4);
  for(var i=0;i<activeCourtCount;i++) updateCourtCard(i);
  updateWaitSection();
}

// ── 교체 팝업 ──
function openSwapPopup(courtIdx, leaving) {
  byId('swap-title').textContent = leaving.name + ' 교체';
  byId('swap-sub').textContent = '대기 중인 선수 중 교체할 사람을 선택하세요.';
  byId('swap-list').innerHTML = waitQueue.map(function(p) {
    var t = getTier(p.elo), eloDiff = p.elo - leaving.elo;
    var diffStr = eloDiff > 0 ? '+'+eloDiff : String(eloDiff);
    var diffColor = Math.abs(eloDiff) <= 100 ? 'var(--accent)' : Math.abs(eloDiff) <= 250 ? 'var(--warn)' : 'var(--danger)';
    return '<div class="swap-item" data-swap-confirm="'+courtIdx+':'+leaving.id+':'+p.id+'">'+
      '<div><div class="swap-item-name">'+esc(p.name)+'</div><div class="swap-item-info">'+p.elo+' · '+statOf(p.id).played+'게임</div></div>'+
      '<span class="tier" style="background:'+t.bg+';color:'+t.tc+'">'+t.l+'</span>'+gBadge(p.gender, false)+
      '<span style="font-size:12px;font-weight:800;color:'+diffColor+'">'+diffStr+'</span></div>';
  }).join('') || '<div style="font-size:13px;color:var(--text3);padding:12px 0;text-align:center">대기자 없음</div>';
  byId('swap-overlay').style.display = 'flex';
}
function closeSwapPopup() { byId('swap-overlay').style.display = 'none'; }
function closeOnboarding() { byId('onboarding-overlay').style.display = 'none'; gotoTab('members'); }

// ── 결과 ──
function renderResult() {
  byId('result-empty').style.display='none'; byId('result-main').style.display='';
  var today=new Date();
  byId('r-date').textContent=today.getFullYear()+'년 '+(today.getMonth()+1)+'월 '+today.getDate()+'일';
  byId('r-sub').textContent='총 '+gameLog.length+'게임';
  renderSessionStats();
  var participants=new Set(); gameLog.forEach(function(g){g.teamA.concat(g.teamB).forEach(function(p){participants.add(p.id);});});
  var counts=Array.from(participants).map(function(id){return statOf(id).played;}),minG=counts.length?Math.min.apply(null,counts):0,maxG=counts.length?Math.max.apply(null,counts):0;
  byId('r-stats').innerHTML='<div class="rstat"><div class="n">'+gameLog.length+'</div><div class="l">게임</div></div><div class="rstat"><div class="n">'+participants.size+'</div><div class="l">참여</div></div><div class="rstat"><div class="n">'+minG+'~'+maxG+'</div><div class="l">개인 게임수</div></div>';
  var maxAbs=Math.max.apply(null,Object.keys(eloDeltas).map(function(k){return Math.abs(eloDeltas[k]);}).concat([1]));
  var ranked=Array.from(participants).map(function(id){var m=members.find(function(x){return x.id===id;});return Object.assign({},m,{delta:eloDeltas[id]||0,played:statOf(id).played});}).sort(function(a,b){return b.delta-a.delta;});
  byId('r-rankings').innerHTML=ranked.map(function(p,i){
    var t=getTier(p.elo),sign=p.delta>0?'+':'',cls=p.delta>0?'delta-up':p.delta<0?'delta-dn':'delta-eq',pct=Math.round(Math.abs(p.delta)/maxAbs*100);
    return '<div class="rank-row"><span class="rank-n">'+(i+1)+'</span><span class="rank-name">'+esc(p.name)+'</span><span class="tier" style="background:'+t.bg+';color:'+t.tc+'">'+t.l+'</span><span class="elo-delta '+cls+'">'+sign+p.delta+'</span><div class="elo-bar"><div class="elo-fill" style="width:'+pct+'%;background:'+(p.delta>0?'#2d7a3a':p.delta<0?'#c0392b':'#aaa')+'"></div></div></div>';
  }).join('');
  byId('r-games').innerHTML=gameLog.map(function(g,i){
    var won=g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':'',ud=(g.expectedA<.5&&won==='A')||(g.expectedA>.5&&won==='B');
    return '<div class="game-log"><div class="game-num" style="display:flex;justify-content:space-between;align-items:center">'+
      '<span>게임 '+(i+1)+' · '+g.courtName+(ud?' · 업셋':'')+'</span>'+
      (isAdmin?'<button class="mini-btn swap" data-edit-game="'+i+'">수정</button>':'')+
      '</div><div class="game-teams"><div class="game-team">'+g.teamA.map(function(p){return '<span class="ptag ta" style="font-size:12px;padding:4px 8px;min-height:0">'+esc(p.name)+'</span>';}).join('')+'</div>'+
      '<div style="display:flex;align-items:center;gap:4px"><div class="gscore '+(won==='A'?'win':won==='B'?'lose':'')+'">'+g.scoreA+'</div><span style="color:var(--text3);font-size:12px">:</span><div class="gscore '+(won==='B'?'win':won==='A'?'lose':'')+'">'+g.scoreB+'</div></div>'+
      '<div class="game-team" style="justify-content:flex-end">'+g.teamB.map(function(p){return '<span class="ptag tb" style="font-size:12px;padding:4px 8px;min-height:0">'+esc(p.name)+'</span>';}).join('')+'</div></div>'+
      '<div class="game-note">A '+(g.deltaA>=0?'+':'')+g.deltaA+' · B '+(g.deltaB>=0?'+':'')+g.deltaB+'</div></div>';
  }).join('');
}

// ── 멤버 관리 ──
function renderTierGuide() {
  byId('tier-guide').innerHTML=TIERS.map(function(t){return '<div class="tier-cell" style="background:'+t.bg+';color:'+t.tc+'"><strong>'+t.l+'</strong><span>'+t.min+'~'+t.max+'</span></div>';}).join('');
}
function updateBulkBar() {
  var bar=byId('bulk-bar');
  if(!isAdmin){bar.style.display='none';return;}
  bar.style.display=selectedForDelete.size>0?'flex':'none';
  byId('bulk-count').textContent=selectedForDelete.size+'명 선택';
}
function renderManage() {
  var term=norm(byId('member-search').value);
  var sorted=members.slice().sort(function(a,b){
    if(_memberSort==='elo') return b.elo-a.elo;
    if(_memberSort==='elo-asc') return a.elo-b.elo;
    return a.name.localeCompare(b.name,'ko');
  });
  var filtered=sorted.filter(function(m){return matchesFn(m,term);});
  var maxElo=Math.max.apply(null,members.map(function(m){return m.elo;}).concat([1]));
  var avgElo=members.length?Math.round(members.reduce(function(s,m){return s+m.elo;},0)/members.length):0;
  var presentCount=members.filter(function(m){return present.has(m.id)||leftEarly.has(m.id);}).length;

  byId('member-search-count').textContent=filtered.length+'명';

  var sb=byId('member-stats-bar');
  if(sb) sb.innerHTML='<span>총 <b>'+members.length+'</b>명</span><span style="color:var(--border)">|</span><span>평균 ELO <b>'+avgElo+'</b></span>'+(presentCount?'<span style="color:var(--border)">|</span><span style="color:var(--accent);font-weight:700">오늘 출석 '+presentCount+'명</span>':'');

  var sortBar=byId('member-sort-bar');
  if(sortBar) sortBar.innerHTML=
    ['name','elo','elo-asc'].map(function(k){
      var lbl=k==='name'?'이름순':k==='elo'?'ELO↓':'ELO↑';
      return '<button class="sort-btn'+((_memberSort===k)?' active':'')+'" data-sort="'+k+'">'+lbl+'</button>';
    }).join('');

  byId('mlist').innerHTML=filtered.length?filtered.map(function(m){
    var t=getTier(m.elo),pct=Math.round(m.elo/maxElo*100);
    var checked=selectedForDelete.has(m.id);
    var isPresent=present.has(m.id), isEarly=leftEarly.has(m.id);
    var statusBadge=isPresent?'<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:var(--accent-light);color:var(--accent);font-weight:700">출석</span>':isEarly?'<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:#f5f0ff;color:#7c4dff;font-weight:700">퇴장</span>':'';
    var checkBox=isAdmin?'<input type="checkbox" data-check-del="'+m.id+'" '+(checked?'checked':'')+' style="width:16px;height:16px;cursor:pointer;accent-color:var(--danger);flex-shrink:0"/>':'';
    return '<div class="mrow" style="'+(checked?'background:var(--danger-light);border-radius:var(--radius-sm);padding:10px;':'')+'">'+checkBox+'<span class="mname">'+esc(m.name)+'</span>'+gBadge(m.gender,isAdmin,m.id)+'<span class="tier" style="background:'+t.bg+';color:'+t.tc+'">'+t.l+'</span>'+statusBadge+'<input class="elo-input" type="number" value="'+m.elo+'" min="100" max="3000" data-elo-id="'+m.id+'" '+(isAdmin?'':'disabled')+'/><div class="elo-bar"><div class="elo-fill" style="width:'+pct+'%;background:'+t.tc+'"></div></div><button class="del-btn" data-del="'+m.id+'">×</button></div>';
  }).join(''):'<div class="empty">검색 결과 없음</div>';
  updateBulkBar();
}

// ── 내기록 ──
function renderPlayerSearch() {
  var term=norm(byId('player-search').value);
  var results=term?members.filter(function(m){return matchesFn(m,term);}).slice(0,12):[];
  byId('player-search-count').textContent=results.length+'명';
  byId('player-search-results').innerHTML=results.length?results.map(function(m){return '<button type="button" class="sel-pill" data-player-select="'+m.id+'">'+esc(m.name)+' · '+m.elo+'</button>';}).join(''):'<span style="font-size:12px;color:var(--text3);font-weight:500">이름을 입력하면 검색 결과가 나옵니다.</span>';
}
function selectPlayer(id) { selectedPlayerId=Number(id); renderPlayerHistory(); }
function getPlayerMatches(memberId) {
  var rows=[];
  gameHistory.slice().reverse().forEach(function(session){
    (session.games||[]).forEach(function(g){
      var inA=(g.teamA||[]).some(function(p){return Number(p.id)===Number(memberId);}),inB=(g.teamB||[]).some(function(p){return Number(p.id)===Number(memberId);});
      if(!inA&&!inB)return;
      var sFor=inA?g.scoreA:g.scoreB,sAgainst=inA?g.scoreB:g.scoreA,delta=inA?g.deltaA:g.deltaB;
      rows.push({date:session.date,courtName:g.courtName||'',side:inA?'A':'B',scoreFor:sFor,scoreAgainst:sAgainst,delta:delta||0,result:sFor>sAgainst?'승':sFor<sAgainst?'패':'무',team:(inA?g.teamA:g.teamB)||[],opp:(inA?g.teamB:g.teamA)||[]});
    });
  });
  return rows.reverse();
}
function renderPlayerHistory() {
  var m=members.find(function(x){return x.id===selectedPlayerId;});
  if(!m){byId('player-empty').style.display='';byId('player-main').style.display='none';return;}
  byId('player-empty').style.display='none'; byId('player-main').style.display='';
  var mx=getPlayerMatches(m.id);
  byId('player-name-title').textContent=m.name+' · ELO '+m.elo;
  var wins=mx.filter(function(x){return x.result==='승';}).length,losses=mx.filter(function(x){return x.result==='패';}).length,total=mx.length,rate=total?Math.round(wins/total*100):0,totDelta=mx.reduce(function(s,x){return s+x.delta;},0);
  byId('player-summary').innerHTML='<div class="pstat"><div class="v">'+total+'</div><div class="l">게임</div></div><div class="pstat"><div class="v">'+wins+'승'+losses+'패</div><div class="l">전적</div></div><div class="pstat"><div class="v">'+rate+'%</div><div class="l">승률</div></div><div class="pstat"><div class="v">'+(totDelta>=0?'+':'')+totDelta+'</div><div class="l">ELO</div></div>';
  renderPlayerChart(m,mx);
  renderPlayerDetailStats(m, mx);
  byId('player-match-list').innerHTML=mx.length?mx.slice(0,30).map(function(x){
    var d=new Date(x.date),cls=x.result==='승'?'mb-win':x.result==='패'?'mb-loss':'mb-draw';
    return '<div class="match-card"><div class="match-top"><div><div class="match-title">'+d.toLocaleDateString('ko-KR')+' · '+esc(x.courtName)+' · '+x.side+'팀</div><div class="match-meta">'+x.team.map(function(p){return esc(p.name);}).join(', ')+' vs '+x.opp.map(function(p){return esc(p.name);}).join(', ')+'</div></div><span class="match-badge '+cls+'">'+x.result+'</span></div><div style="font-size:11px;color:var(--text3);font-weight:500">'+x.scoreFor+':'+x.scoreAgainst+' · ELO '+(x.delta>=0?'+':'')+x.delta+'</div></div>';
  }).join(''):'<div class="empty">아직 기록이 없습니다.</div>';
}
function renderPlayerChart(member,mx) {
  var svg=byId('player-elo-chart'),label=byId('player-chart-label');
  if(!mx.length){svg.innerHTML='<text x="320" y="80" text-anchor="middle" fill="#a8a8a2" font-size="13">기록 없음</text>';label.textContent='';return;}
  var deltas=mx.map(function(m){return m.delta||0;}),tmp=member.elo;
  for(var i=0;i<deltas.length;i++) tmp-=deltas[i];
  var values=[tmp]; deltas.forEach(function(d){values.push(values[values.length-1]+d);});
  var min=Math.min.apply(null,values),max=Math.max.apply(null,values),pad=18,w=640,h=160,iW=w-pad*2,iH=h-pad*2,range=Math.max(1,max-min);
  var pts=values.map(function(v,i){return {x:pad+(values.length===1?0:(i/(values.length-1))*iW),y:pad+(1-(v-min)/range)*iH};});
  svg.innerHTML='<line x1="'+pad+'" y1="'+(h-pad)+'" x2="'+(w-pad)+'" y2="'+(h-pad)+'" stroke="#e8e8e4"/>'+
    '<polyline points="'+pts.map(function(p){return p.x+','+p.y;}).join(' ')+'" fill="none" stroke="#2d7a3a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>'+
    pts.map(function(p){return '<circle cx="'+p.x+'" cy="'+p.y+'" r="3.5" fill="#2d7a3a"/>';}).join('')+
    '<text x="'+pad+'" y="14" fill="#a8a8a2" font-size="11">'+max+'</text><text x="'+pad+'" y="'+(h-4)+'" fill="#a8a8a2" font-size="11">'+min+'</text>';
  label.textContent='시작 '+values[0]+' → 현재 '+values[values.length-1]+' ('+mx.length+'게임)';
}

// ── 데이터 탭 ──
function renderData() {
  if(selectedPlayerId) renderPlayerHistory();
  renderAttendanceSelect();
  renderSeasonStats();
  var list=byId('history-list'); if(!list)return;
  list.innerHTML=gameHistory.length?gameHistory.map(function(h){
    var d=new Date(h.date);

    // 하이라이트 계산
    var games=h.games||[], deltas=h.deltas||{};
    var highlights=[];

    // MVP
    var mvpScores={};
    games.forEach(function(g){
      var won=g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':null;
      (won==='A'?g.teamA:won==='B'?g.teamB:[]).forEach(function(p){mvpScores[p.id]=(mvpScores[p.id]||0)+1;});
    });
    Object.keys(deltas).forEach(function(id){if(deltas[id]>0)mvpScores[id]=(mvpScores[id]||0)+deltas[id]*0.1;});
    var mvpId=Object.keys(mvpScores).sort(function(a,b){return mvpScores[b]-mvpScores[a];})[0];
    var mvpName=mvpId?_findName(h,Number(mvpId)):null;
    if(mvpName) highlights.push('🏆 '+mvpName);

    // 최다 연승
    var maxStreak={},curStreak={};
    games.forEach(function(g){
      var won=g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':null;
      (g.teamA||[]).concat(g.teamB||[]).forEach(function(p){
        if(!curStreak[p.id])curStreak[p.id]=0;
        var inWin=won==='A'?(g.teamA||[]).some(function(x){return x.id===p.id;}):won==='B'?(g.teamB||[]).some(function(x){return x.id===p.id;}):false;
        if(inWin){curStreak[p.id]++;if(!maxStreak[p.id]||curStreak[p.id]>maxStreak[p.id])maxStreak[p.id]=curStreak[p.id];}
        else curStreak[p.id]=0;
      });
    });
    var streakId=Object.keys(maxStreak).sort(function(a,b){return maxStreak[b]-maxStreak[a];})[0];
    if(streakId&&maxStreak[streakId]>=2) highlights.push('🔥 '+maxStreak[streakId]+'연승 '+_findName(h,Number(streakId)));

    // ELO 1위
    var topDelta=Object.keys(deltas).sort(function(a,b){return deltas[b]-deltas[a];})[0];
    if(topDelta&&deltas[topDelta]>0) highlights.push('📈 +'+deltas[topDelta]+' '+(_findName(h,Number(topDelta))||''));

    // 출석 명단
    var attendeeHtml='';
    if(h.attendees&&h.attendees.length){
      attendeeHtml='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">'+
        h.attendees.map(function(a){
          return '<span style="font-size:11px;padding:2px 7px;border-radius:999px;background:var(--surface2);color:var(--text2);font-weight:600">'+esc(a.name)+'</span>';
        }).join('')+'</div>';
    }

    var highlightHtml=highlights.length?'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">'+
      highlights.map(function(t){
        return '<span style="font-size:11px;padding:3px 8px;border-radius:999px;background:var(--accent-light);color:var(--accent);font-weight:700">'+esc(t)+'</span>';
      }).join('')+'</div>':'';

    return '<div class="hist-row" style="flex-direction:column;align-items:flex-start;gap:4px">'+
      '<div style="display:flex;justify-content:space-between;width:100%;align-items:center">'+
      '<div style="font-size:13px;font-weight:700">'+d.toLocaleDateString('ko-KR')+' '+d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})+'</div>'+
      '<div style="font-size:11px;color:var(--text3);font-weight:500">'+esc(h.status||'저장')+' · '+h.gameCount+'게임</div></div>'+
      '<div style="font-size:11px;color:var(--text3);font-weight:500">출석 '+(h.attendees?h.attendees.length:h.participantCount)+'명</div>'+
      highlightHtml+attendeeHtml+'</div>';
  }).join(''):'<div class="empty">세션 기록 없음</div>';
}
function renderAttendanceSelect() {
  var sel = byId('attendance-session-select'); if(!sel) return;
  if(!gameHistory.length) { sel.innerHTML='<option>세션 없음</option>'; return; }
  sel.innerHTML = gameHistory.map(function(h, i) {
    var d = new Date(h.date);
    return '<option value="'+i+'">'+d.toLocaleDateString('ko-KR')+' '+d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})+' · '+(h.attendees ? h.attendees.length : h.participantCount)+'명</option>';
  }).join('');
  updateAttendanceBox();
}
function updateAttendanceBox() {
  var sel = byId('attendance-session-select'), box = byId('attendance-box');
  if(!sel || !box || !gameHistory.length) return;
  var h = gameHistory[Number(sel.value) || 0]; if(!h) return;
  var d = new Date(h.date), lines = ['📋 출석 명단', d.toLocaleDateString('ko-KR')+' '+d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}), ''];
  var attendees = h.attendees || [];
  if(attendees.length) {
    var males = attendees.filter(function(a){ return a.gender==='M'; });
    var females = attendees.filter(function(a){ return a.gender==='F'; });
    lines.push('남자 ('+males.length+'명): '+males.map(function(a){return a.name;}).join(', '));
    lines.push('여자 ('+females.length+'명): '+females.map(function(a){return a.name;}).join(', '));
    lines.push('');
    lines.push('전체 ('+attendees.length+'명): '+attendees.map(function(a){return a.name;}).join(', '));
  } else { lines.push('출석 데이터 없음 (이전 세션)'); }
  box.value = lines.join('\n');
}
function _findName(session, id) {
  if(session.attendees) {
    var a = session.attendees.find(function(x){ return Number(x.id)===id; });
    if(a) return a.name;
  }
  var found = null;
  (session.games||[]).forEach(function(g) {
    (g.teamA||[]).concat(g.teamB||[]).forEach(function(p) {
      if(Number(p.id)===id) found=p.name;
    });
  });
  if(!found) { var m=members.find(function(x){return x.id===id;}); if(m) found=m.name; }
  return found;
}
function buildShareText(sessionList) {
  if(!sessionList.length) return '공유할 세션 기록이 없습니다.';
  var lines = [];
  sessionList.forEach(function(h) {
    var d = new Date(h.date);
    var dateStr = d.getFullYear()+'년 '+(d.getMonth()+1)+'월 '+d.getDate()+'일 '+d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
    lines.push('🏸 '+dateStr+' 배드민턴 결과');
    lines.push('총 '+h.gameCount+'게임 · '+h.participantCount+'명 참여');
    lines.push('');
    var games = h.games || [], deltas = h.deltas || {};

    // MVP
    var mvpScores = {};
    games.forEach(function(g) {
      var won = g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':null;
      (won==='A'?g.teamA:won==='B'?g.teamB:[]).forEach(function(p){ mvpScores[p.id]=(mvpScores[p.id]||0)+1; });
    });
    Object.keys(deltas).forEach(function(id){ if(deltas[id]>0) mvpScores[id]=(mvpScores[id]||0)+deltas[id]*0.1; });
    var mvpId=Object.keys(mvpScores).sort(function(a,b){return mvpScores[b]-mvpScores[a];})[0];
    var mvpName=mvpId?_findName(h,Number(mvpId)):null;

    // 최다 연승
    var maxStreak={}, curStreak={};
    games.forEach(function(g) {
      var won=g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':null;
      (g.teamA||[]).concat(g.teamB||[]).forEach(function(p) {
        if(!curStreak[p.id]) curStreak[p.id]=0;
        var inWin=won==='A'?(g.teamA||[]).some(function(x){return x.id===p.id;}):won==='B'?(g.teamB||[]).some(function(x){return x.id===p.id;}):false;
        if(inWin){curStreak[p.id]++;if(!maxStreak[p.id]||curStreak[p.id]>maxStreak[p.id])maxStreak[p.id]=curStreak[p.id];}
        else curStreak[p.id]=0;
      });
    });
    var streakId=Object.keys(maxStreak).sort(function(a,b){return maxStreak[b]-maxStreak[a];})[0];
    var streakName=streakId&&maxStreak[streakId]>=2?_findName(h,Number(streakId)):null;
    var streakVal=streakId?maxStreak[streakId]:0;

    // 박빙
    var closest=games.slice().sort(function(a,b){return Math.abs(a.scoreA-a.scoreB)-Math.abs(b.scoreA-b.scoreB);})[0];

    // 역전왕
    var upsets={};
    games.forEach(function(g) {
      var won=g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':null;
      if((won==='A'&&g.expectedA<0.45)||(won==='B'&&g.expectedA>0.55))
        (won==='A'?g.teamA:g.teamB||[]).forEach(function(p){upsets[p.id]=(upsets[p.id]||0)+1;});
    });
    var upsetId=Object.keys(upsets).sort(function(a,b){return upsets[b]-upsets[a];})[0];
    var upsetName=upsetId?_findName(h,Number(upsetId)):null;
    var upsetVal=upsetId?upsets[upsetId]:0;

    // 체력왕
    var stamina={};
    games.forEach(function(g) {
      var won=g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':null;
      (g.teamA||[]).concat(g.teamB||[]).forEach(function(p) {
        if(!stamina[p.id]) stamina[p.id]={name:p.name,played:0,wins:0};
        stamina[p.id].played++;
        var inWin=won==='A'?(g.teamA||[]).some(function(x){return x.id===p.id;}):won==='B'?(g.teamB||[]).some(function(x){return x.id===p.id;}):false;
        if(inWin) stamina[p.id].wins++;
      });
    });
    var staminaId=Object.keys(stamina).filter(function(id){return stamina[id].played>=3;})
      .sort(function(a,b){var d=stamina[b].wins/stamina[b].played-stamina[a].wins/stamina[a].played;return d!==0?d:stamina[b].played-stamina[a].played;})[0];

    // 찰떡 파트너
    var pWins={},pGames={};
    games.forEach(function(g) {
      var won=g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':null;
      [g.teamA,g.teamB].forEach(function(team){
        var didWin=(won==='A'&&team===g.teamA)||(won==='B'&&team===g.teamB);
        for(var i=0;i<(team||[]).length;i++) for(var j=i+1;j<(team||[]).length;j++){
          var k=[team[i].id,team[j].id].sort(function(a,b){return a-b;}).join('-');
          pGames[k]=(pGames[k]||0)+1; if(didWin) pWins[k]=(pWins[k]||0)+1;
        }
      });
    });
    var bestPKey=Object.keys(pGames).filter(function(k){return pGames[k]>=2;})
      .sort(function(a,b){return (pWins[b]||0)/pGames[b]-(pWins[a]||0)/pGames[a];})[0];
    var bestPartnerStr=null;
    if(bestPKey){
      var pids=bestPKey.split('-').map(Number);
      var pn1=_findName(h,pids[0]),pn2=_findName(h,pids[1]);
      if(pn1&&pn2) bestPartnerStr=pn1+'·'+pn2+' (승률 '+Math.round((pWins[bestPKey]||0)/pGames[bestPKey]*100)+'%)';
    }

    // 하이라이트 출력
    if(mvpName||streakName||closest||upsetName||staminaId||bestPartnerStr){
      if(mvpName)          lines.push('🏆 MVP · '+mvpName);
      if(streakName)       lines.push('🔥 '+streakVal+'연승 · '+streakName);
      if(closest){
        var cWon=closest.scoreA>closest.scoreB?'A팀':closest.scoreB>closest.scoreA?'B팀':'무승부';
        lines.push('⚡ 박빙 · '+closest.scoreA+':'+closest.scoreB+' ('+cWon+')');
      }
      if(upsetName&&upsetVal>=1) lines.push('💥 역전왕 · '+upsetName+' (업셋 '+upsetVal+'회)');
      if(staminaId){var s=stamina[staminaId];lines.push('💪 체력왕 · '+s.name+' ('+s.played+'게임 · 승률 '+Math.round(s.wins/s.played*100)+'%)');}
      if(bestPartnerStr)   lines.push('🤝 찰떡 파트너 · '+bestPartnerStr);
      lines.push('');
    }

    // ELO 변동
    var ranked=Object.keys(deltas).map(function(id){return{id:Number(id),delta:deltas[id]};}).filter(function(x){return x.delta!==0;}).sort(function(a,b){return b.delta-a.delta;});
    if(ranked.length){
      lines.push('📊 ELO 변동');
      ranked.slice(0,6).forEach(function(x,i){
        var name=_findName(h,x.id)||'ID'+x.id;
        lines.push((i===0?'🥇':i===1?'🥈':i===2?'🥉':'  ')+' '+name+' '+(x.delta>0?'+':'')+x.delta);
      });
      lines.push('');
    }

    // 게임 기록
    if(games.length){
      lines.push('🎮 게임 기록');
      games.forEach(function(g,i){
        var tA=(g.teamA||[]).map(function(p){return p.name;}).join('·');
        var tB=(g.teamB||[]).map(function(p){return p.name;}).join('·');
        var won=g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':'';
        lines.push((i+1)+'. '+(won==='A'?'✅ ':'')+tA+' '+g.scoreA+':'+g.scoreB+' '+(won==='B'?'✅ ':'')+tB);
      });
    }
    lines.push(''); lines.push('─────────────────'); lines.push('');
  });
  return lines.join('\n').trim();
}

function renderNotices() {
  var el=byId('notices-section'); if(!el) return;
  var nw=byId('notice-admin-wrap'); if(nw) nw.style.display=isAdmin?'':'none';
  if(!notices.length){el.innerHTML='';return;}
  el.innerHTML=notices.map(function(n){
    var d=new Date(n.created_at);
    var dateStr=(d.getMonth()+1)+'.'+(d.getDate());
    return '<div class="notice-item">'+
      '<span class="notice-icon">📢</span>'+
      '<span class="notice-text">'+esc(n.content)+'</span>'+
      '<span class="notice-date">'+dateStr+'</span>'+
      (isAdmin?'<button class="notice-del" data-del-notice="'+n.id+'">×</button>':'')+
    '</div>';
  }).join('');
}

function renderAll() { renderAttend(); renderManage(); renderData(); renderNotices(); }