// ── ELO 계산 ──
function avgElo(g) { return Math.round(g.reduce(function(s,p){return s+p.elo;},0)/g.length); }
function eloRange(g) { return Math.max.apply(null,g.map(function(p){return p.elo;}))-Math.min.apply(null,g.map(function(p){return p.elo;})); }
function avgK(t) { return Math.round(t.reduce(function(s,p){return s+getKFactor(p.elo);},0)/t.length); }
function expectedScore(a,b) { return 1/(1+Math.pow(10,(b-a)/400)); }
function marginMult(a,b) { return 1+Math.min(0.3,Math.abs(a-b)/21*0.3); }
function actualScore(a,b) { return a>b?1:a<b?0:0.5; }
function calcElo(tA,tB,sA,sB) {
  var aA=avgElo(tA),aB=avgElo(tB),eA=expectedScore(aA,aB),margin=marginMult(sA,sB),kA=avgK(tA),kB=avgK(tB),actA=actualScore(sA,sB);
  return {deltaA:Math.round(kA*margin*(actA-eA)),deltaB:Math.round(kB*margin*((1-actA)-(1-eA))),expectedA:eA,margin:margin,kA:kA,kB:kB};
}

// ── 세션 통계 ──
function ensureStats(ids) { ids.forEach(function(id){ if(!sessionStats[id]) sessionStats[id]={played:0,lastTurn:-1}; }); }
function statOf(id) { return sessionStats[id]||{played:0,lastTurn:-1}; }
function restScore(id) { var s=statOf(id); return s.lastTurn<0?2:Math.max(0,turn-s.lastTurn); }

// ── 성별 우선순위 ──
function genderTier(g) {
  var m=g.filter(function(p){return p.gender==='M';}).length, f=g.length-m;
  if(m===2 && f===2) return 0;
  if(m===4 || f===4) return 1;
  return 2;
}
function isMixed(team) { return team[0].gender !== team[1].gender; }
function teamGenderTier(ta, tb) {
  var mixA=isMixed(ta), mixB=isMixed(tb);
  if(mixA && mixB) return 0;
  if(!mixA && !mixB && ta[0].gender===tb[0].gender) return 1;
  if(mixA || mixB) return 2;
  return 3;
}

// ── 파트너/상대 히스토리 ──
function recordPairings(teamA, teamB) {
  for(var i=0;i<teamA.length;i++) for(var j=i+1;j<teamA.length;j++) {
    var k=pairKey(teamA[i].id,teamA[j].id);
    partnerHistory[k]=(partnerHistory[k]||0)+1;
  }
  for(var i=0;i<teamB.length;i++) for(var j=i+1;j<teamB.length;j++) {
    var k=pairKey(teamB[i].id,teamB[j].id);
    partnerHistory[k]=(partnerHistory[k]||0)+1;
  }
  teamA.forEach(function(a){ teamB.forEach(function(b){
    var k=pairKey(a.id,b.id);
    opponentHistory[k]=(opponentHistory[k]||0)+1;
  });});
}

// ── 페널티 계산 ──
function recentPenalty(g) {
  var pen=0;
  var recent=gameLog.slice().reverse();
  recent.forEach(function(gl, idx){
    var decay = 1 / (idx + 1);
    var ids=g.map(function(p){return p.id;});
    var all=(gl.teamA||[]).concat(gl.teamB||[]).map(function(p){return p.id;});
    var ov=ids.filter(function(id){return all.indexOf(id)>=0;}).length;
    if(ov>=4) pen += 600 * decay;
    else if(ov>=3) pen += 350 * decay;
    else if(ov>=2) pen += 150 * decay;
  });
  return pen;
}
function pairingPenalty(g) {
  var pen=0;
  for(var i=0;i<g.length;i++) for(var j=i+1;j<g.length;j++) {
    var k=pairKey(g[i].id,g[j].id);
    pen += (partnerHistory[k]||0) * 60;
    pen += (opponentHistory[k]||0) * 30;
  }
  return pen;
}
function scoreGroup(g) {
  var rests=g.map(function(p){return restScore(p.id);});
  var range=eloRange(g);
  var eloScore = range * 1.2;
  if(range > 500) eloScore += 100;
  if(range > 800) eloScore += 200;
  var beg=g.filter(function(p){return p.elo<BEGINNER_ELO;}).length;
  var adv=g.filter(function(p){return p.elo>=ADVANCED_ELO;}).length;
  if(beg>=1 && adv>=2) eloScore += 150;
  var restBonus = rests.reduce(function(s,v){return s+v;},0) * 40;
  var score = eloScore + recentPenalty(g) + pairingPenalty(g) - restBonus;
  return (genderBalanceEnabled ? genderTier(g) * 10000000 : 0) + score;
}

// ── 조합 및 선택 ──
function combinations(arr,k) { var out=[]; function rec(s,c){if(c.length===k){out.push(c.slice());return;} for(var i=s;i<=arr.length-(k-c.length);i++){c.push(arr[i]);rec(i+1,c);c.pop();}} rec(0,[]); return out; }
function selectFairGroupBase(cands) {
  if(cands.length<4) return null;
  var minPlayed = Math.min.apply(null, cands.map(function(p){return statOf(p.id).played;}));
  var must = cands.filter(function(p){return statOf(p.id).played===minPlayed;});
  // 조합 폭발 방지: 가장 오래 쉰 순서로 최대 10명
  if(must.length>10) must=must.slice().sort(function(a,b){return restScore(b.id)-restScore(a.id);}).slice(0,10);
  var groups = [];
  if(must.length>=4){
    groups = combinations(must,4);
  } else {
    var need = 4-must.length;
    var fillers = cands.filter(function(p){return statOf(p.id).played>minPlayed;})
      .sort(function(a,b){
        var pd = statOf(a.id).played - statOf(b.id).played;
        if(pd!==0) return pd;
        return restScore(b.id) - restScore(a.id);
      }).slice(0,12);
    groups = combinations(fillers,need).map(function(fill){return must.concat(fill);});
  }
  if(!groups.length) return null;
  var best=null, score=Infinity;
  groups.forEach(function(g){var s=scoreGroup(g);if(s<score){best=g;score=s;}});
  return best;
}
// ── 요청 (남복/여복/혼복/같이) ──
function activeRequest(p) {
  var r = playRequests[p.id]; if(!r) return null;
  if(r.type === 'WITH') {
    var w = (r.with || []).filter(function(id){ return present.has(id) && id !== p.id; });
    if(!w.length) return null;
    return { type:'WITH', with:w, held:r.held||0 };
  }
  return r;
}
function requestSatisfied(r, g) {
  var m = g.filter(function(x){ return x.gender === 'M'; }).length;
  if(r.type === 'MD') return m === 4;
  if(r.type === 'WD') return m === 0;
  if(r.type === 'XD') return m === 2;
  if(r.type === 'WITH') { var ids = g.map(function(x){ return x.id; }); return r.with.every(function(id){ return ids.indexOf(id) >= 0; }); }
  return true;
}
// 아직 양보 가능한(대기 한도 안 넘은) 요청자가 원치 않는 게임에 들어가면 false
function groupRespectsRequests(g) {
  return g.every(function(p){
    var r = activeRequest(p);
    return !r || r.held >= REQUEST_MAX_HOLD || requestSatisfied(r, g);
  });
}
function isHoldable(p) { var r = activeRequest(p); return !!r && r.held < REQUEST_MAX_HOLD; }
function byPriority(a, b) {
  var pd = statOf(a.id).played - statOf(b.id).played;
  return pd !== 0 ? pd : restScore(b.id) - restScore(a.id);
}
// 차례가 된 요청자의 요청을 만족하는 최선의 조
function requestGroup(cands) {
  var minPlayed = Math.min.apply(null, cands.map(function(p){ return statOf(p.id).played; }));
  var due = cands.filter(function(p){
    var r = activeRequest(p);
    return r && (statOf(p.id).played <= minPlayed || r.held > 0);
  }).sort(function(a, b){
    var hd = (activeRequest(b).held) - (activeRequest(a).held);
    return hd !== 0 ? hd : byPriority(a, b);
  });
  for(var d = 0; d < due.length; d++) {
    var req = due[d], r = activeRequest(req), groups = [];
    var others = cands.filter(function(p){ return p !== req; });
    if(r.type === 'MD' || r.type === 'WD') {
      var g = r.type === 'MD' ? 'M' : 'F';
      if(req.gender !== g) continue;
      combinations(others.filter(function(p){ return p.gender === g; }).sort(byPriority).slice(0, 9), 3)
        .forEach(function(c){ groups.push([req].concat(c)); });
    } else if(r.type === 'XD') {
      var same = others.filter(function(p){ return p.gender === req.gender; }).sort(byPriority).slice(0, 8);
      var opp  = others.filter(function(p){ return p.gender !== req.gender; }).sort(byPriority).slice(0, 8);
      var oppPairs = combinations(opp, 2);
      same.forEach(function(s){ oppPairs.forEach(function(op){ groups.push([req, s].concat(op)); }); });
    } else if(r.type === 'WITH') {
      var mates = r.with.map(function(id){ return others.find(function(p){ return p.id === id; }); });
      if(mates.some(function(x){ return !x; })) continue; // 같이 칠 사람이 아직 코트에 있음 → 대기
      mates = mates.slice(0, 3);
      var need = 3 - mates.length, rest = others.filter(function(p){ return mates.indexOf(p) < 0; }).sort(byPriority).slice(0, 9);
      if(need === 0) groups.push([req].concat(mates));
      else combinations(rest, need).forEach(function(c){ groups.push([req].concat(mates, c)); });
    }
    var best = null, bestScore = Infinity;
    groups.forEach(function(g){
      if(!groupRespectsRequests(g)) return;
      // 요청이 성별 균형보다 우선. 단, 게임 수가 적은 사람을 강하게 우선 (공정성)
      var extra = g.reduce(function(sum, p){ return sum + statOf(p.id).played - minPlayed; }, 0);
      var s = scoreGroup(g) % 10000000 + extra * 1000;
      if(s < bestScore) { bestScore = s; best = g; }
    });
    if(best) return best;
  }
  return null;
}
function selectFairGroup(cands) {
  if(cands.length < 4) return null;
  var rg = requestGroup(cands);
  if(rg) return rg;
  // 요청을 아직 만족 못 하는 요청자는 이번 조에서 양보 (한도 안에서)
  if(cands.some(isHoldable)) {
    var g = selectFairGroupBase(cands.filter(function(p){ return !isHoldable(p); }));
    if(g) return g;
  }
  return selectFairGroupBase(cands);
}
// 실제로 코트에 배정됐을 때: 양보한 요청자 대기 카운트 +1, 배정된 사람의 요청은 사용 처리
function noteGroupAssigned(group) {
  var minP = Math.min.apply(null, group.map(function(p){ return statOf(p.id).played; }));
  waitQueue.forEach(function(p){
    var r = playRequests[p.id];
    if(r && statOf(p.id).played <= minP) r.held = (r.held || 0) + 1;
  });
  group.forEach(function(p){ delete playRequests[p.id]; });
}
// 같은 후보군을 점수순으로 정렬해 상위 n개 반환 (운영 뷰의 '다른 조합'용)
function rankFairGroups(cands, n) {
  if(cands.length<4) return [];
  var first = selectFairGroup(cands);
  if(!first) return [];
  var minPlayed = Math.min.apply(null, cands.map(function(p){return statOf(p.id).played;}));
  var pool = cands.slice().sort(function(a,b){
    var pd = statOf(a.id).played - statOf(b.id).played;
    if(pd!==0) return pd;
    return restScore(b.id) - restScore(a.id);
  }).slice(0, 10);
  var seen = {}, out = [];
  function key(g){ return g.map(function(p){return p.id;}).sort(function(a,b){return a-b;}).join('-'); }
  seen[key(first)] = true; out.push(first);
  combinations(pool,4).map(function(g){return {g:g,s:scoreGroup(g)};})
    .sort(function(a,b){return a.s-b.s;})
    .forEach(function(x){ if(out.length<n && !seen[key(x.g)] && groupRespectsRequests(x.g)){ seen[key(x.g)]=true; out.push(x.g); } });
  return out;
}
function makeAssignment(players) {
  var p=players.slice().sort(function(a,b){return b.elo-a.elo;});
  var forceMixed=players.some(function(x){ var r=activeRequest(x); return r && r.type==='XD'; });
  var best=null, bestScore=Infinity;
  [[[p[0],p[1]],[p[2],p[3]]],[[p[0],p[2]],[p[1],p[3]]],[[p[0],p[3]],[p[1],p[2]]]].forEach(function(x){
    var ta=x[0],tb=x[1];
    // 팀 간 ELO 합 차이
    var diff=Math.abs((ta[0].elo+ta[1].elo)-(tb[0].elo+tb[1].elo));
    // 팀 내 ELO 편차 페널티 (큰 실력차 파트너 억제)
    var spreadA=Math.abs(ta[0].elo-ta[1].elo), spreadB=Math.abs(tb[0].elo-tb[1].elo);
    var spreadPenalty=(spreadA+spreadB)*0.4;
    // 파트너 반복 페널티
    var partnerRep=(partnerHistory[pairKey(ta[0].id,ta[1].id)]||0)+(partnerHistory[pairKey(tb[0].id,tb[1].id)]||0);
    // 상대 반복 페널티 (같은 상대 계속 만남 억제)
    var oppRep=0;
    ta.forEach(function(a){tb.forEach(function(b){oppRep+=(opponentHistory[pairKey(a.id,b.id)]||0);});});
    var eloScore = diff + spreadPenalty + partnerRep*90 + oppRep*45;
    var score = (genderBalanceEnabled || forceMixed ? teamGenderTier(ta,tb) * 1000000 : 0) + eloScore;
    if(score<bestScore){bestScore=score; best={teamA:ta,teamB:tb,diff:Math.round(diff/2)};}
  });
  return best;
}
function removeSelected(g) { var ids=new Set(g.map(function(p){return p.id;})); waitQueue=waitQueue.filter(function(p){return !ids.has(p.id);}); }
function assignNext(i) { if(waitQueue.length<4){courts[i]=null;return false;} var g=selectFairGroup(waitQueue); if(!g){courts[i]=null;return false;} removeSelected(g); courts[i]=makeAssignment(g); noteGroupAssigned(g); if(courts[i]) courts[i].startedAt=Date.now(); return true; }