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
  var range=eloRange(g), avg=avgElo(g);
  var eloScore = range * 1.2;
  if(range > 500) eloScore += 100;
  if(range > 800) eloScore += 200;
  var beg=g.filter(function(p){return p.elo<BEGINNER_ELO;}).length;
  var adv=g.filter(function(p){return p.elo>=ADVANCED_ELO;}).length;
  if(beg>=1 && adv>=2) eloScore += 150;
  var restBonus = rests.reduce(function(s,v){return s+v;},0) * 40;
  var avgPenalty = Math.abs(avg - 1150) * 0.1;
  var score = eloScore + recentPenalty(g) + pairingPenalty(g) - restBonus + avgPenalty;
  return (genderBalanceEnabled ? genderTier(g) * 10000000 : 0) + score;
}

// ── 조합 및 선택 ──
function combinations(arr,k) { var out=[]; function rec(s,c){if(c.length===k){out.push(c.slice());return;} for(var i=s;i<=arr.length-(k-c.length);i++){c.push(arr[i]);rec(i+1,c);c.pop();}} rec(0,[]); return out; }
function selectFairGroup(cands) {
  if(cands.length<4) return null;
  var minPlayed = Math.min.apply(null, cands.map(function(p){return statOf(p.id).played;}));
  var must = cands.filter(function(p){return statOf(p.id).played===minPlayed;});
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
function makeAssignment(players) {
  var p=players.slice().sort(function(a,b){return b.elo-a.elo;});
  var best=null, bestScore=Infinity;
  [[[p[0],p[1]],[p[2],p[3]]],[[p[0],p[2]],[p[1],p[3]]],[[p[0],p[3]],[p[1],p[2]]]].forEach(function(x){
    var ta=x[0],tb=x[1];
    var diff=Math.abs((ta[0].elo+ta[1].elo)-(tb[0].elo+tb[1].elo));
    var rep=(partnerHistory[pairKey(ta[0].id,ta[1].id)]||0)+(partnerHistory[pairKey(tb[0].id,tb[1].id)]||0);
    var eloScore = diff + rep*90;
    var score = (genderBalanceEnabled ? teamGenderTier(ta,tb) * 1000000 : 0) + eloScore;
    if(score<bestScore){bestScore=score; best={teamA:ta,teamB:tb,diff:Math.round(diff/2)};}
  });
  return best;
}
function removeSelected(g) { var ids=new Set(g.map(function(p){return p.id;})); waitQueue=waitQueue.filter(function(p){return !ids.has(p.id);}); }
function assignNext(i) { if(waitQueue.length<4){courts[i]=null;return false;} var g=selectFairGroup(waitQueue); if(!g){courts[i]=null;return false;} removeSelected(g); courts[i]=makeAssignment(g); return true; }