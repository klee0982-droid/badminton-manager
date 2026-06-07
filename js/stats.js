// ── 오늘의 하이라이트 (결과 탭) ──
function renderSessionStats() {
  if(!gameLog.length) return;

  // MVP
  var mvpScores = {};
  gameLog.forEach(function(g) {
    var won = g.scoreA > g.scoreB ? 'A' : g.scoreB > g.scoreA ? 'B' : null;
    var winners = won==='A' ? g.teamA : won==='B' ? g.teamB : [];
    winners.forEach(function(p) { mvpScores[p.id] = (mvpScores[p.id]||0) + 1; });
  });
  Object.keys(eloDeltas).forEach(function(id) {
    if(eloDeltas[id]>0) mvpScores[id] = (mvpScores[id]||0) + eloDeltas[id]*0.1;
  });
  var mvpId = Object.keys(mvpScores).sort(function(a,b){return mvpScores[b]-mvpScores[a];})[0];
  var mvp = mvpId ? members.find(function(m){return m.id===Number(mvpId);}) : null;

  // 최다 연승
  var maxStreak = {}, curStreak = {};
  gameLog.forEach(function(g) {
    var won = g.scoreA > g.scoreB ? 'A' : g.scoreB > g.scoreA ? 'B' : null;
    g.teamA.concat(g.teamB).forEach(function(p) {
      if(!curStreak[p.id]) curStreak[p.id]=0;
      var inWin = won==='A' ? g.teamA.some(function(x){return x.id===p.id;}) : won==='B' ? g.teamB.some(function(x){return x.id===p.id;}) : false;
      if(inWin) { curStreak[p.id]++; if(!maxStreak[p.id]||curStreak[p.id]>maxStreak[p.id]) maxStreak[p.id]=curStreak[p.id]; }
      else curStreak[p.id]=0;
    });
  });
  var streakId = Object.keys(maxStreak).sort(function(a,b){return maxStreak[b]-maxStreak[a];})[0];
  var streakPlayer = streakId ? members.find(function(m){return m.id===Number(streakId);}) : null;
  var streakVal = streakId ? maxStreak[streakId] : 0;

  // 박빙
  var closest = gameLog.slice().sort(function(a,b){ return Math.abs(a.scoreA-a.scoreB) - Math.abs(b.scoreA-b.scoreB); })[0];

  // 역전왕
  var upsets = {};
  gameLog.forEach(function(g) {
    var won = g.scoreA > g.scoreB ? 'A' : g.scoreB > g.scoreA ? 'B' : null;
    var isUpset = (won==='A' && g.expectedA<0.45) || (won==='B' && g.expectedA>0.55);
    if(isUpset) {
      var winners = won==='A' ? g.teamA : g.teamB;
      winners.forEach(function(p){ upsets[p.id]=(upsets[p.id]||0)+1; });
    }
  });
  var upsetId = Object.keys(upsets).sort(function(a,b){return upsets[b]-upsets[a];})[0];
  var upsetPlayer = upsetId ? members.find(function(m){return m.id===Number(upsetId);}) : null;
  var upsetVal = upsetId ? upsets[upsetId] : 0;

  // 체력왕
  var stamina = {};
  gameLog.forEach(function(g) {
    var won = g.scoreA > g.scoreB ? 'A' : g.scoreB > g.scoreA ? 'B' : null;
    g.teamA.concat(g.teamB).forEach(function(p) {
      if(!stamina[p.id]) stamina[p.id]={played:0,wins:0};
      stamina[p.id].played++;
      var inWin = won==='A' ? g.teamA.some(function(x){return x.id===p.id;}) : won==='B' ? g.teamB.some(function(x){return x.id===p.id;}) : false;
      if(inWin) stamina[p.id].wins++;
    });
  });
  var staminaId = Object.keys(stamina)
    .filter(function(id){ return stamina[id].played >= 3; })
    .sort(function(a,b){
      var diff = stamina[b].wins/stamina[b].played - stamina[a].wins/stamina[a].played;
      return diff !== 0 ? diff : stamina[b].played - stamina[a].played;
    })[0];
  var staminaPlayer = staminaId ? members.find(function(m){return m.id===Number(staminaId);}) : null;
  var staminaData = staminaId ? stamina[staminaId] : null;

  // 찰떡 파트너
  var partnerWins = {}, partnerGames = {};
  gameLog.forEach(function(g) {
    var won = g.scoreA > g.scoreB ? 'A' : g.scoreB > g.scoreA ? 'B' : null;
    [g.teamA, g.teamB].forEach(function(team) {
      var didWin = (won==='A' && team===g.teamA) || (won==='B' && team===g.teamB);
      for(var i=0;i<team.length;i++) for(var j=i+1;j<team.length;j++) {
        var k = pairKey(team[i].id, team[j].id);
        partnerGames[k] = (partnerGames[k]||0)+1;
        if(didWin) partnerWins[k] = (partnerWins[k]||0)+1;
      }
    });
  });
  var bestPartnerKey = Object.keys(partnerGames)
    .filter(function(k){ return partnerGames[k]>=2; })
    .sort(function(a,b){ return (partnerWins[b]||0)/partnerGames[b] - (partnerWins[a]||0)/partnerGames[a]; })[0];
  var bestPartner = null;
  if(bestPartnerKey) {
    var pids = bestPartnerKey.split('-').map(Number);
    var p1 = members.find(function(m){return m.id===pids[0];}), p2 = members.find(function(m){return m.id===pids[1];});
    if(p1&&p2) bestPartner = { names: p1.name+'·'+p2.name, rate: Math.round((partnerWins[bestPartnerKey]||0)/partnerGames[bestPartnerKey]*100), games: partnerGames[bestPartnerKey] };
  }

  // 코트별 승률
  var courtStats = {};
  gameLog.forEach(function(g) {
    if(!courtStats[g.courtName]) courtStats[g.courtName]={aWin:0,bWin:0,total:0};
    courtStats[g.courtName].total++;
    if(g.scoreA>g.scoreB) courtStats[g.courtName].aWin++;
    else if(g.scoreB>g.scoreA) courtStats[g.courtName].bWin++;
  });

  // 렌더링
  var html = '<div class="card" style="margin-top:12px"><div class="card-title">오늘의 하이라이트</div><div style="display:flex;flex-direction:column;gap:10px">';

  if(mvp) html += _statRow('🏆', 'MVP · '+esc(mvp.name), '승리 기여 + ELO 상승 종합', 'var(--accent-light)');
  if(streakPlayer && streakVal >= 2) html += _statRow('🔥', streakVal+'연승 · '+esc(streakPlayer.name), '오늘 최다 연속 승리', 'var(--warn-light)');
  if(closest) {
    var cWon = closest.scoreA>closest.scoreB?'A팀':closest.scoreB>closest.scoreA?'B팀':'무승부';
    html += _statRow('⚡', '박빙 · '+closest.scoreA+':'+closest.scoreB+' ('+cWon+')', closest.teamA.map(function(p){return p.name;}).join('·')+' vs '+closest.teamB.map(function(p){return p.name;}).join('·'), 'var(--surface2)');
  }
  if(upsetPlayer && upsetVal >= 1) html += _statRow('💥', '역전왕 · '+esc(upsetPlayer.name), '오늘 업셋 '+upsetVal+'회', 'var(--danger-light)');
  if(staminaPlayer && staminaData) html += _statRow('💪', '체력왕 · '+esc(staminaPlayer.name), staminaData.played+'게임 · 승률 '+Math.round(staminaData.wins/staminaData.played*100)+'%', '#eef4fb');
  if(bestPartner) html += _statRow('🤝', '찰떡 파트너 · '+esc(bestPartner.names), '같이 뛰면 승률 '+bestPartner.rate+'% ('+bestPartner.games+'게임)', '#f3eefb');

  var courtHtml = Object.keys(courtStats).map(function(name){
    return name+' A팀 '+Math.round(courtStats[name].aWin/courtStats[name].total*100)+'% 승';
  }).join(' · ');
  if(courtHtml) html += _statRow('🏟️', '코트별 승률', courtHtml, 'var(--surface2)');

  html += '</div></div>';

  var existing = byId('session-stats-card');
  if(existing) existing.outerHTML = '<div id="session-stats-card">'+html+'</div>';
  else {
    var statsEl = byId('r-stats');
    if(statsEl) {
      var wrap = document.createElement('div');
      wrap.id = 'session-stats-card';
      wrap.innerHTML = html;
      statsEl.parentNode.insertBefore(wrap, statsEl.nextSibling);
    }
  }
}

// ── 개인 상세 통계 (내기록 탭) ──
function renderPlayerDetailStats(member, mx) {
  if(!mx.length) { var el=byId('player-detail-stats'); if(el) el.innerHTML=''; return; }

  // 최강 파트너
  var partnerW={}, partnerG={};
  mx.forEach(function(x){
    x.team.filter(function(p){return p.id!==member.id;}).forEach(function(p){
      partnerG[p.id]=(partnerG[p.id]||0)+1;
      if(x.result==='승') partnerW[p.id]=(partnerW[p.id]||0)+1;
    });
  });
  var bestPartnerId=Object.keys(partnerG).filter(function(k){return partnerG[k]>=2;}).sort(function(a,b){return (partnerW[b]||0)/partnerG[b]-(partnerW[a]||0)/partnerG[a];})[0];
  var bestPartner=bestPartnerId?members.find(function(m){return m.id===Number(bestPartnerId);}):null;
  var bestPartnerRate=bestPartnerId?Math.round((partnerW[bestPartnerId]||0)/partnerG[bestPartnerId]*100):0;
  var bestPartnerGames=bestPartnerId?partnerG[bestPartnerId]:0;

  // 천적
  var oppW={}, oppG={};
  mx.forEach(function(x){
    x.opp.forEach(function(p){
      oppG[p.id]=(oppG[p.id]||0)+1;
      if(x.result==='패') oppW[p.id]=(oppW[p.id]||0)+1;
    });
  });
  var nemesisId=Object.keys(oppG).filter(function(k){return oppG[k]>=2;}).sort(function(a,b){return (oppW[b]||0)/oppG[b]-(oppW[a]||0)/oppG[a];})[0];
  var nemesis=nemesisId?members.find(function(m){return m.id===Number(nemesisId);}):null;
  var nemesisRate=nemesisId?Math.round((oppW[nemesisId]||0)/oppG[nemesisId]*100):0;
  var nemesisGames=nemesisId?oppG[nemesisId]:0;

  // 최다 연승
  var maxStreak=0, curStreak=0;
  mx.forEach(function(x){
    if(x.result==='승'){ curStreak++; if(curStreak>maxStreak) maxStreak=curStreak; }
    else curStreak=0;
  });

  // 코트별 승률
  var courtS={};
  mx.forEach(function(x){
    if(!courtS[x.courtName]) courtS[x.courtName]={w:0,t:0};
    courtS[x.courtName].t++;
    if(x.result==='승') courtS[x.courtName].w++;
  });

  // 최근 폼
  var recentForm=mx.slice(-5).map(function(x){
    return x.result==='승' ? '<span style="color:var(--accent);font-weight:800">승</span>'
      : x.result==='패' ? '<span style="color:var(--danger);font-weight:800">패</span>'
      : '<span style="color:var(--text3);font-weight:800">무</span>';
  }).join(' → ');

  var html='<div class="card"><div class="card-title">개인 상세 통계</div><div style="display:flex;flex-direction:column;gap:10px">';
  html+='<div style="padding:10px;background:var(--surface2);border-radius:var(--radius-sm)"><div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:6px">최근 폼</div><div style="font-size:13px">'+recentForm+'</div></div>';
  if(bestPartner) html+=_statRow('🤝','최강 파트너 · '+esc(bestPartner.name),'같이 뛰면 승률 '+bestPartnerRate+'% ('+bestPartnerGames+'게임)','var(--accent-light)');
  if(nemesis) html+=_statRow('😈','천적 · '+esc(nemesis.name),'상대할 때 패율 '+nemesisRate+'% ('+nemesisGames+'게임)','var(--danger-light)');
  if(maxStreak>=2) html+=_statRow('🔥','최다 연승 · '+maxStreak+'연승','역대 최고 연속 승리','var(--warn-light)');

  var courtHtml=Object.keys(courtS).map(function(name){
    var s=courtS[name], rate=Math.round(s.w/s.t*100);
    return '<div style="text-align:center;flex:1;padding:8px;background:var(--surface);border-radius:var(--radius-sm);border:1px solid var(--border)"><div style="font-size:12px;font-weight:800">'+rate+'%</div><div style="font-size:10px;color:var(--text3);font-weight:600;margin-top:2px">'+esc(name)+'</div></div>';
  }).join('');
  if(courtHtml) html+='<div style="padding:10px;background:var(--surface2);border-radius:var(--radius-sm)"><div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:8px">코트별 승률</div><div style="display:flex;gap:6px">'+courtHtml+'</div></div>';

  html+='</div></div>';

  var existing=byId('player-detail-stats');
  if(existing){ existing.innerHTML=html; }
  else {
    var chart=byId('player-elo-chart');
    if(chart){
      var wrap=document.createElement('div');
      wrap.id='player-detail-stats';
      wrap.innerHTML=html;
      var chartCard=chart.closest('.card');
      if(chartCard) chartCard.parentNode.insertBefore(wrap,chartCard.nextSibling);
    }
  }
}

// ── 시즌 누적 통계 (데이터 탭) ──
function renderSeasonStats() {
  var allGames = [], allDeltas = {};
  gameHistory.forEach(function(h){
    (h.games||[]).forEach(function(g){ allGames.push(g); });
    Object.keys(h.deltas||{}).forEach(function(id){ allDeltas[id] = (allDeltas[id]||0) + (h.deltas[id]||0); });
  });

  // 통산 승률
  var seasonStats = {};
  allGames.forEach(function(g){
    var won = g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':null;
    g.teamA.concat(g.teamB).forEach(function(p){
      if(!seasonStats[p.id]) seasonStats[p.id]={name:p.name,played:0,wins:0};
      seasonStats[p.id].played++;
      var inWin = won==='A'?g.teamA.some(function(x){return x.id===p.id;}):won==='B'?g.teamB.some(function(x){return x.id===p.id;}):false;
      if(inWin) seasonStats[p.id].wins++;
    });
  });
  var seasonRanked = Object.keys(seasonStats)
    .filter(function(id){ return seasonStats[id].played>=5; })
    .map(function(id){ return Object.assign({id:id},seasonStats[id],{rate:Math.round(seasonStats[id].wins/seasonStats[id].played*100)}); })
    .sort(function(a,b){ return b.rate-a.rate; }).slice(0,5);

  // ELO 성장률
  var growthRanked = Object.keys(allDeltas)
    .map(function(id){ var m=members.find(function(x){return x.id===Number(id);}); return m ? {name:m.name, delta:allDeltas[id]} : null; })
    .filter(Boolean).sort(function(a,b){return b.delta-a.delta;}).slice(0,5);

  // 파트너 조합 누적
  var seasonPartner = {}, seasonPartnerGames = {};
  allGames.forEach(function(g){
    var won = g.scoreA>g.scoreB?'A':g.scoreB>g.scoreA?'B':null;
    [g.teamA,g.teamB].forEach(function(team){
      var didWin=(won==='A'&&team===g.teamA)||(won==='B'&&team===g.teamB);
      for(var i=0;i<team.length;i++) for(var j=i+1;j<team.length;j++){
        var k=pairKey(team[i].id,team[j].id);
        seasonPartnerGames[k]=(seasonPartnerGames[k]||0)+1;
        if(didWin) seasonPartner[k]=(seasonPartner[k]||0)+1;
      }
    });
  });
  var topPartnerKey = Object.keys(seasonPartnerGames)
    .filter(function(k){return seasonPartnerGames[k]>=3;})
    .sort(function(a,b){ return (seasonPartner[b]||0)/seasonPartnerGames[b]-(seasonPartner[a]||0)/seasonPartnerGames[a]; })[0];
  var topPartner = null;
  if(topPartnerKey){
    var tIds=topPartnerKey.split('-').map(Number);
    var tp1=members.find(function(m){return m.id===tIds[0];}), tp2=members.find(function(m){return m.id===tIds[1];});
    if(tp1&&tp2) topPartner={names:tp1.name+'·'+tp2.name, rate:Math.round((seasonPartner[topPartnerKey]||0)/seasonPartnerGames[topPartnerKey]*100), games:seasonPartnerGames[topPartnerKey]};
  }

  var seasonHtml = '<div class="card"><div class="card-title">시즌 누적 통계</div>';
  if(seasonRanked.length) {
    seasonHtml += '<div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:8px">🏅 통산 승률 (5게임 이상)</div>';
    seasonRanked.forEach(function(p,i){
      seasonHtml += '<div class="rank-row"><span class="rank-n">'+(i+1)+'</span><span class="rank-name">'+esc(p.name)+'</span><span style="font-size:11px;color:var(--text3)">'+p.played+'게임</span><span class="elo-delta delta-up">'+p.rate+'%</span></div>';
    });
  }
  if(growthRanked.length) {
    seasonHtml += '<div style="font-size:11px;font-weight:700;color:var(--text3);margin:12px 0 8px">📈 ELO 성장률</div>';
    growthRanked.forEach(function(p,i){
      var cls = p.delta>=0?'delta-up':'delta-dn';
      seasonHtml += '<div class="rank-row"><span class="rank-n">'+(i+1)+'</span><span class="rank-name">'+esc(p.name)+'</span><span class="elo-delta '+cls+'">'+(p.delta>=0?'+':'')+p.delta+'</span></div>';
    });
  }
  if(topPartner) {
    seasonHtml += '<div style="font-size:11px;font-weight:700;color:var(--text3);margin:12px 0 8px">🤝 최강 파트너 조합</div>';
    seasonHtml += '<div style="font-size:13px;font-weight:800;padding:8px 0">'+esc(topPartner.names)+' <span style="font-size:11px;color:var(--text3);font-weight:500">'+topPartner.games+'게임 · 승률 '+topPartner.rate+'%</span></div>';
  }
  seasonHtml += '</div>';

  var existingSeason = byId('season-stats-card');
  if(existingSeason) existingSeason.outerHTML = '<div id="season-stats-card">'+seasonHtml+'</div>';
  else {
    var histList = byId('history-list');
    if(histList) {
      var sw = document.createElement('div');
      sw.id = 'season-stats-card';
      sw.innerHTML = seasonHtml;
      histList.parentNode.insertBefore(sw, histList);
    }
  }
}

// ── 공통 stat row 헬퍼 ──
function _statRow(emoji, title, sub, bg) {
  return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:'+bg+';border-radius:var(--radius-sm)">'+
    '<span style="font-size:22px">'+emoji+'</span>'+
    '<div><div style="font-size:13px;font-weight:800">'+title+'</div>'+
    '<div style="font-size:11px;color:var(--text2);font-weight:500">'+sub+'</div></div></div>';
}