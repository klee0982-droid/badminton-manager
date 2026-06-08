// ── 시합 모드 (토너먼트) ──
var TOURNEY_KEY = 'bdm_tourneys_' + CLUB_ID;
var tourneys = loadJson(TOURNEY_KEY, []);
var _tView = tourneys.length ? tourneys[tourneys.length - 1].id : null;
var _tStep = 0; // 0=목록, 1=이름/종목, 2=참가자, 3=팀구성(복식)
var _td = {};

function saveTourneys() {
  localStorage.setItem(TOURNEY_KEY, JSON.stringify(tourneys));
  if(typeof saveTourneysToSupabase === 'function') saveTourneysToSupabase();
}

// ── 시드 배정 (BWF 표준 방식) ──
// 재귀적으로 브래킷 슬롯 순서 생성: 시드1과 시드2가 결승에서 만나도록
function seededSlots(n) {
  if(n <= 2) return [0, 1];
  var half = seededSlots(n / 2);
  var out = [];
  half.forEach(function(s) { out.push(s, n - 1 - s); });
  return out;
}

function teamAvgElo(team) {
  var ps = team.players.filter(Boolean);
  return ps.length ? ps.reduce(function(s, p){ return s + (p.elo || 1000); }, 0) / ps.length : 0;
}

// ── 브래킷 로직 ──
function pow2ceil(n) { var p = 1; while(p < n) p *= 2; return p; }

// 정원이 2의 배수일 때 표준 시드 브래킷 생성
function buildFullBracket(sorted) {
  var size = pow2ceil(Math.max(sorted.length, 2));
  var order = seededSlots(size);
  var slots = new Array(size).fill(null);
  order.forEach(function(seedIdx, slotIdx) {
    slots[slotIdx] = sorted[seedIdx] || null;
  });
  var out = [];
  for(var i = 0; i < slots.length; i += 2) {
    var t1 = slots[i], t2 = slots[i + 1];
    var w = (t1 && t2) ? null : t1 ? 1 : t2 ? 2 : -1;
    out.push({ t1: t1, t2: t2, winner: w, score: '' });
  }
  return out;
}

function roundWinners(round) {
  return round.map(function(m) {
    if(m.winner === 1) return m.t1;
    if(m.winner === 2) return m.t2;
    return null;
  }).filter(Boolean);
}

// t를 받아서 예선→본선 전환 처리
function buildNextRound(round, t) {
  var w = roundWinners(round);
  // 예선 완료 → directToR1 시드와 합쳐서 본선 브래킷 생성
  if(t && t.directToR1 && t.directToR1.length > 0 && t.rounds.length === 1) {
    var all = w.concat(t.directToR1).sort(function(a, b){ return teamAvgElo(b) - teamAvgElo(a); });
    return buildFullBracket(all);
  }
  if(w.length <= 1) return null;
  var out = [];
  for(var i = 0; i < w.length; i += 2) {
    var t1 = w[i], t2 = w[i + 1] || null;
    out.push({ t1: t1, t2: t2, winner: t2 ? null : 1, score: '' });
  }
  return out;
}

function collapseByeRounds(t) {
  while(t.rounds[t.rounds.length - 1].every(function(m){ return m.winner !== null; })) {
    var next = buildNextRound(t.rounds[t.rounds.length - 1], t);
    if(!next) { finalizeChampion(t); break; }
    t.rounds.push(next);
  }
}

function finalizeChampion(t) {
  var last = t.rounds[t.rounds.length - 1];
  var w = roundWinners(last);
  if(w.length === 1) { t.champion = w[0]; t.status = 'done'; }
}

function startTourney() {
  var teams = _td.teams;
  var sorted = teams.slice().sort(function(a, b){ return teamAvgElo(b) - teamAvgElo(a); });
  var B       = pow2ceil(Math.max(sorted.length, 2));
  var B_half  = B / 2;
  var isPow2  = sorted.length === B;

  var r0, directToR1;

  if(isPow2) {
    r0          = buildFullBracket(sorted);
    directToR1  = [];
  } else {
    // 비2의배수: 하위 시드끼리 예선, 상위 시드는 본선 직행
    var prelim  = sorted.length - B_half;          // 예선 경기 수
    var nPrelim = prelim * 2;                       // 예선 참가 인원 수
    directToR1  = sorted.slice(0, sorted.length - nPrelim); // 본선 직행 (상위)
    var pTeams  = sorted.slice(sorted.length - nPrelim);    // 예선 참가 (하위)
    r0 = [];
    for(var i = 0; i < prelim; i++) {
      // BWF: 높은시드 vs 낮은시드 페어링
      r0.push({ t1: pTeams[i], t2: pTeams[nPrelim - 1 - i], winner: null, score: '' });
    }
  }

  var t = {
    id: Date.now(),
    name: _td.name,
    type: _td.type,
    teams: teams,
    seededOrder: sorted,
    rounds: [r0],
    totalRounds: Math.ceil(Math.log2(B)),
    directToR1: directToR1,
    status: 'active',
    champion: null
  };
  collapseByeRounds(t);
  tourneys.push(t);
  _tView = t.id;
  _tStep = 0;
  _td = {};
  saveTourneys();
  renderTourneySection();
}

var _pendingWin = null; // {tId, ri, mi, side}

function recordWin(tId, ri, mi, side) {
  var t = tourneys.find(function(x){ return x.id === tId; });
  if(!t || t.status === 'done') return;
  var m = t.rounds[ri][mi];
  if(!m || m.winner !== null) return;
  _pendingWin = { tId: tId, ri: ri, mi: mi, side: side };
  var winTeam  = side === 1 ? m.t1 : m.t2;
  var loseTeam = side === 1 ? m.t2 : m.t1;
  byId('score-match-title').textContent = roundName(t, ri);
  byId('score-team1-name').textContent = tLabel(winTeam,  t.type).replace(/<[^>]+>/g,'') + ' (승)';
  byId('score-team2-name').textContent = tLabel(loseTeam, t.type).replace(/<[^>]+>/g,'') + ' (패)';
  byId('score-t1').value = 21;
  byId('score-t2').value = 0;
  byId('score-confirm-btn').onclick = confirmTourneyScore;
  byId('score-overlay').style.display = 'flex';
}

function adjustTourneyScore(team, delta) {
  var el = byId('score-t' + team);
  el.value = Math.max(0, Math.min(99, (Number(el.value) || 0) + delta));
}

function closeScoreInput() {
  byId('score-overlay').style.display = 'none';
  _pendingWin = null;
}

function confirmTourneyScore() {
  if(!_pendingWin) return;
  var s1 = Number(byId('score-t1').value) || 0;
  var s2 = Number(byId('score-t2').value) || 0;
  var score = s1 + '-' + s2;
  var p = _pendingWin;
  closeScoreInput();
  var t = tourneys.find(function(x){ return x.id === p.tId; });
  if(!t) return;
  var m = t.rounds[p.ri][p.mi];
  m.winner = p.side;
  m.score = score;
  var round = t.rounds[p.ri];
  if(round.every(function(m){ return m.winner !== null; })) {
    var next = buildNextRound(round, t);
    if(!next) finalizeChampion(t);
    else { t.rounds.push(next); collapseByeRounds(t); }
  }
  saveTourneys();
  renderTourneySection();
}

function undoWin(tId, ri, mi) {
  var t = tourneys.find(function(x){ return x.id === tId; });
  if(!t) return;
  t.rounds = t.rounds.slice(0, ri + 1);
  t.status = 'active';
  t.champion = null;
  t.rounds[ri][mi].winner = null;
  t.rounds[ri][mi].score = '';
  saveTourneys();
  renderTourneySection();
}

function deleteTourney(tId) {
  if(!confirm('이 대회를 삭제할까요?')) return;
  tourneys = tourneys.filter(function(t){ return t.id !== tId; });
  _tView = tourneys.length ? tourneys[tourneys.length - 1].id : null;
  saveTourneys();
  if(typeof deleteTourneyFromSupabase === 'function') deleteTourneyFromSupabase(tId);
  renderTourneySection();
}

// ── 이름/시드 헬퍼 ──
function tLabel(team, type) {
  if(!team) return 'BYE';
  if(type === 'singles') return esc(team.players[0].name);
  var p2 = team.players[1] ? esc(team.players[1].name) : '?';
  return esc(team.players[0].name) + ' / ' + p2;
}

function getSeedNum(t, team) {
  if(!team || !t.seededOrder) return 0;
  return t.seededOrder.findIndex(function(s){ return s.id === team.id; }) + 1;
}

function seedBadge(num) {
  if(num <= 0) return '';
  if(num <= 4) return '<span style="font-size:10px;background:var(--accent);color:#fff;border-radius:10px;padding:1px 6px;font-weight:700;margin-right:4px">'+num+'시드</span>';
  return '<span style="font-size:10px;background:var(--surface2);color:var(--text3);border-radius:10px;padding:1px 6px;font-weight:600;margin-right:4px">'+num+'번</span>';
}

function roundName(t, ri) {
  // 예선 라운드
  if(t.directToR1 && t.directToR1.length > 0 && ri === 0) return '예선';
  // 슬롯 수 × 2 = 이 라운드 참가 팀 수
  var n = t.rounds[ri].length * 2;
  var names = { 2:'결승', 4:'준결승', 8:'8강', 16:'16강', 32:'32강', 64:'64강' };
  return names[n] || (n + '강');
}

// ── 브래킷 트리 (본선) ──
function renderBracketTree(t, rounds, startRi) {
  var CW = 18, TH = 26, DH = 2, MH = TH*2+DH, LH = 18;
  var nR  = rounds.length;
  var n0  = Math.max.apply(null, rounds.map(function(r){ return r.length; }));
  // 슬롯 수에 따라 높이·폭 자동 조정
  var SH  = n0 <= 4 ? 72 : n0 <= 8 ? 64 : n0 <= 16 ? 54 : 46;
  var RW  = n0 <= 8 ? 112 : n0 <= 16 ? 100 : 90;
  var BH  = n0 * SH;
  var totalW = nR * RW + (nR-1) * CW;
  var totalH = BH + LH;

  var divs = '', svg = '';

  rounds.forEach(function(round, lri) {
    var ri     = startRi + lri;
    var N      = round.length;
    var slotH  = BH / N;
    var colX   = lri * (RW + CW);
    var isCurr = ri === t.rounds.length - 1 && t.status === 'active';

    divs += '<div style="position:absolute;left:'+colX+'px;top:0;width:'+RW+'px;height:'+LH+'px;'
      + 'text-align:center;font-size:9px;font-weight:700;letter-spacing:.03em;'
      + 'color:'+(isCurr?'var(--accent)':'var(--text3)')+';line-height:'+LH+'px">'
      + roundName(t, ri) + '</div>';

    round.forEach(function(m, mi) {
      if(!m.t1 && !m.t2) return;
      var cy   = LH + (mi+0.5)*slotH;
      var topY = cy - MH/2;
      var w1=m.winner===1, w2=m.winner===2, done=m.winner!==null;
      var isBye = !m.t1 || !m.t2;
      var canClick = isCurr && !done && !isBye && isAdmin;
      var s1=getSeedNum(t,m.t1), s2=getSeedNum(t,m.t2);

      var bg1=w1?'var(--accent-light)':'var(--surface2)', br1=w1?'var(--accent)':'var(--border)';
      var fc1=w1?'var(--accent)':(done&&!w1?'var(--text3)':(!m.t1?'var(--text3)':'var(--text)'));
      var bg2=w2?'var(--accent-light)':'var(--surface2)', br2=w2?'var(--accent)':'var(--border)';
      var fc2=w2?'var(--accent)':(done&&!w2?'var(--text3)':(!m.t2?'var(--text3)':'var(--text)'));
      var t1txt=m.t1?tLabel(m.t1,t.type).replace(/<[^>]+>/g,''):'TBD';
      var t2txt=m.t2?tLabel(m.t2,t.type).replace(/<[^>]+>/g,''):'TBD';
      var da1=canClick?' data-win="'+t.id+':'+ri+':'+mi+':1"':'';
      var da2=canClick?' data-win="'+t.id+':'+ri+':'+mi+':2"':'';
      var bs='position:absolute;width:'+RW+'px;height:'+TH+'px;display:flex;align-items:center;'
        +'padding:0 7px;overflow:hidden;white-space:nowrap;box-sizing:border-box;'
        +'font-size:11px;font-weight:'+(w1||w2?'800':'600')+';cursor:'+(canClick?'pointer':'default')+';';

      divs += '<div'+da1+' style="'+bs+'left:'+colX+'px;top:'+topY+'px;background:'+bg1+';border:1px solid '+br1+';border-radius:4px 4px 0 0;color:'+fc1+'">'
        +(s1&&m.t1?'<b style="font-size:9px;min-width:12px;opacity:.45;flex-shrink:0">'+s1+'</b>':'')
        +'<span style="overflow:hidden;text-overflow:ellipsis">'+t1txt+(w1?' ✓':'')+'</span></div>';
      divs += '<div style="position:absolute;left:'+colX+'px;top:'+(topY+TH)+'px;width:'+RW+'px;height:'+DH+'px;background:var(--border)">'
        +(m.score&&done?'<span style="position:absolute;right:4px;top:-8px;font-size:9px;color:var(--text3)">'+esc(m.score)+'</span>':'')+'</div>';
      divs += '<div'+da2+' style="'+bs+'left:'+colX+'px;top:'+(topY+TH+DH)+'px;background:'+bg2+';border:1px solid '+br2+';border-radius:0 0 4px 4px;color:'+fc2+'">'
        +(s2&&m.t2?'<b style="font-size:9px;min-width:12px;opacity:.45;flex-shrink:0">'+s2+'</b>':'')
        +'<span style="overflow:hidden;text-overflow:ellipsis">'+t2txt+(w2?' ✓':'')+'</span></div>';

      if(done && !isBye && isAdmin && isCurr) {
        divs += '<div data-undo="'+t.id+':'+ri+':'+mi+'" style="position:absolute;left:'+(colX+RW+1)+'px;top:'+(cy-11)+'px;width:16px;height:22px;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text3);cursor:pointer;z-index:5">↩</div>';
      }

      if(lri < nR-1) {
        var midX   = colX+RW+CW/2, rightX = colX+RW+CW;
        var nextN  = rounds[lri+1].length, nextSlotH = BH/nextN;
        var nextMi = Math.floor(mi/2);
        var nextCy = LH+(nextMi+0.5)*nextSlotH;
        svg += '<line x1="'+(colX+RW)+'" y1="'+cy+'" x2="'+midX+'" y2="'+cy+'" stroke="var(--border)" stroke-width="1.5"/>';
        if(mi%2===0) {
          var sibCy = LH+(mi+1.5)*slotH;
          svg += '<line x1="'+midX+'" y1="'+cy+'" x2="'+midX+'" y2="'+sibCy+'" stroke="var(--border)" stroke-width="1.5"/>';
          svg += '<line x1="'+midX+'" y1="'+nextCy+'" x2="'+rightX+'" y2="'+nextCy+'" stroke="var(--border)" stroke-width="1.5"/>';
        }
      }
    });
  });

  return '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:8px">'
    +'<div style="position:relative;width:'+totalW+'px;height:'+totalH+'px">'
    +divs
    +'<svg style="position:absolute;top:0;left:0;width:'+totalW+'px;height:'+totalH+'px;pointer-events:none;overflow:visible">'+svg+'</svg>'
    +'</div></div>';
}

// ── 브래킷 뷰 (예선 분리 처리) ──
function renderBracketView(t) {
  var hasPrelim = t.directToR1 && t.directToR1.length > 0;
  if(!hasPrelim) return renderBracketTree(t, t.rounds, 0);

  var html = '';
  // 예선 카드
  var r0 = t.rounds[0];
  var isCurrR0 = t.rounds.length === 1 && t.status === 'active';
  var manyPrelim = r0.length > 4;
  html += '<div style="margin-bottom:12px">';
  html += '<div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.05em;margin-bottom:7px">'
    + '예선전 <span style="font-weight:500">('+r0.length+'경기)</span></div>';

  if(manyPrelim) {
    // 5경기 이상: 2열 컴팩트 그리드
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px">';
    r0.forEach(function(m, mi) {
      var w1=m.winner===1, w2=m.winner===2, done=m.winner!==null;
      var canClick = isCurrR0 && !done && isAdmin;
      var s1=getSeedNum(t,m.t1), s2=getSeedNum(t,m.t2);
      var border = done ? '1.5px solid '+(w1||w2?'var(--accent)':'var(--border)') : '1.5px solid var(--border)';
      var bg = done ? (w1||w2?'var(--accent-light)':'var(--surface2)') : 'var(--surface2)';
      html += '<div style="background:'+bg+';border:'+border+';border-radius:8px;padding:7px 8px">';
      html += '<div style="font-size:9px;color:var(--text3);margin-bottom:3px">경기 '+(mi+1)+'</div>';
      // 팀1
      var fc1=w1?'var(--accent)':(done?'var(--text3)':'var(--text)');
      html += '<div '+(canClick?'data-win="'+t.id+':0:'+mi+':1"':'')+
        ' style="font-size:12px;font-weight:'+(w1?'800':'600')+';color:'+fc1+';cursor:'+(canClick?'pointer':'default')+';padding:3px 0">'
        +'<span style="font-size:9px;opacity:.5">'+s1+'시드 </span>'+esc(tLabel(m.t1,t.type).replace(/<[^>]+>/g,''))+(w1?' ✓':'')+'</div>';
      html += '<div style="font-size:9px;color:var(--text3);text-align:center;margin:1px 0">'+(m.score||'vs')+'</div>';
      // 팀2
      var fc2=w2?'var(--accent)':(done?'var(--text3)':'var(--text)');
      html += '<div '+(canClick?'data-win="'+t.id+':0:'+mi+':2"':'')+
        ' style="font-size:12px;font-weight:'+(w2?'800':'600')+';color:'+fc2+';cursor:'+(canClick?'pointer':'default')+';padding:3px 0">'
        +'<span style="font-size:9px;opacity:.5">'+s2+'시드 </span>'+esc(tLabel(m.t2,t.type).replace(/<[^>]+>/g,''))+(w2?' ✓':'')+'</div>';
      if(done && isAdmin && isCurrR0) html += '<div data-undo="'+t.id+':0:'+mi+'" style="font-size:10px;color:var(--text3);cursor:pointer;text-align:right;margin-top:2px">↩ 취소</div>';
      html += '</div>';
    });
    html += '</div>';
  } else {
    // 4경기 이하: 기존 가로 레이아웃
    r0.forEach(function(m, mi) {
      var w1=m.winner===1, w2=m.winner===2, done=m.winner!==null;
      var canClick = isCurrR0 && !done && isAdmin;
      var s1=getSeedNum(t,m.t1), s2=getSeedNum(t,m.t2);
      html += '<div style="display:flex;align-items:stretch;gap:6px;margin-bottom:6px">';
      var mk = function(side, team, w, s) {
        var bg=w?'var(--accent-light)':'var(--surface2)', br=w?'var(--accent)':'var(--border)', fc=w?'var(--accent)':(done?'var(--text3)':'var(--text)');
        return '<div '+(canClick?'data-win="'+t.id+':0:'+mi+':'+side+'"':'')+
          ' style="flex:1;padding:10px 8px;background:'+bg+';border:1.5px solid '+br+';border-radius:var(--radius-sm);'
          +'font-size:13px;font-weight:'+(w?'800':'600')+';color:'+fc+';cursor:'+(canClick?'pointer':'default')+';text-align:center">'
          +(s?'<span style="font-size:10px;opacity:.6">'+s+'시드 </span>':'')
          +esc(tLabel(team,t.type).replace(/<[^>]+>/g,''))+(w?' ✓':'')+'</div>';
      };
      html += mk(1, m.t1, w1, s1);
      html += '<div style="display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--text3);min-width:28px">'+(m.score||'vs')+'</div>';
      html += mk(2, m.t2, w2, s2);
      if(done && isAdmin && isCurrR0) html += '<button data-undo="'+t.id+':0:'+mi+'" style="padding:4px 8px;border:none;background:none;color:var(--text3);font-size:12px;cursor:pointer;align-self:center">↩</button>';
      html += '</div>';
    });
  }

  if(t.rounds.length === 1) {
    html += '<div style="text-align:center;padding:10px;font-size:12px;color:var(--text3)">예선 완료 후 본선 대진이 확정됩니다</div>';
  }
  html += '</div>';

  // 본선 브래킷 (rounds[1]+)
  if(t.rounds.length > 1) {
    html += '<div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.05em;margin-bottom:7px">본선</div>';
    html += renderBracketTree(t, t.rounds.slice(1), 1);
  }
  return html;
}

// ── 렌더링 ──
function renderTourneySection() {
  var el = byId('tourney-main');
  if(!el) return;

  if(_tStep > 0) { el.innerHTML = renderCreateFlow(); bindCreateFlow(); return; }

  var html = '';

  // 대회 목록 헤더
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
  html += '<div style="font-size:13px;font-weight:800;color:var(--text)">대회 목록 <span style="font-size:11px;font-weight:500;color:var(--text3)">'+tourneys.length+'개</span></div>';
  if(isAdmin) html += '<button data-new-tourney style="padding:7px 14px;border:1.5px solid var(--accent);border-radius:20px;background:var(--accent-light);color:var(--accent);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">+ 새 대회</button>';
  html += '</div>';

  if(tourneys.length > 0) {
    // 날짜·상태가 보이는 목록 형태
    html += '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">';
    // 최신순 정렬
    var sorted = tourneys.slice().sort(function(a,b){ return b.id - a.id; });
    sorted.forEach(function(t) {
      var on = t.id === _tView;
      var d  = new Date(t.id);
      var dateStr = (d.getMonth()+1)+'/'+(d.getDate())+' '+(d.getHours()<10?'0':'')+d.getHours()+':'+(d.getMinutes()<10?'0':'')+d.getMinutes();
      var statusTag = t.status === 'done'
        ? '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#fde68a;color:#92400e;font-weight:700;margin-left:6px">완료</span>'
        : '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--accent-light);color:var(--accent);font-weight:700;margin-left:6px">진행중</span>';
      var participantInfo = t.teams ? t.teams.length+'팀' : '';
      html += '<button data-tview="'+t.id+'" style="'
        + 'width:100%;padding:10px 14px;border-radius:var(--radius-sm);'
        + 'border:1.5px solid '+(on?'var(--accent)':'var(--border)')+';'
        + 'background:'+(on?'var(--accent-light)':'var(--surface)')+';'
        + 'cursor:pointer;font-family:inherit;text-align:left;display:flex;align-items:center;justify-content:space-between">'
        + '<div>'
        + '<span style="font-size:13px;font-weight:700;color:'+(on?'var(--accent)':'var(--text)')+'">'+(t.status==='done'?'🏆 ':'')+esc(t.name)+'</span>'
        + statusTag
        + '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+dateStr+(participantInfo?' · '+participantInfo:'')+(t.type==='doubles'?' · 복식':' · 단식')+'</div>'
        + '</div>'
        + '<span style="font-size:16px;color:'+(on?'var(--accent)':'var(--text3)')+'">'+( on?'●':'○')+'</span>'
        + '</button>';
    });
    html += '</div>';
  } else {
    html += '<div style="text-align:center;padding:24px 16px;color:var(--text3);font-size:13px">아직 대회가 없어요</div>';
  }

  var t = _tView ? tourneys.find(function(x){ return x.id === _tView; }) : null;
  if(!t) { el.innerHTML = html; bindTourneyMain(); return; }

  // 선택된 대회 구분선
  html += '<div style="border-top:1.5px solid var(--border);margin:4px 0 12px"></div>';
  html += '<div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:10px">'+(t.status==='done'?'🏆 ':'')+esc(t.name)+'</div>';

  // 시드 정보 카드
  if(t.seededOrder && t.seededOrder.length) {
    html += '<div style="background:var(--surface2);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:10px;font-size:12px;color:var(--text2)">'
      + '<span style="font-weight:700">ELO 시드 배정:</span> ';
    t.seededOrder.slice(0, 4).forEach(function(team, i) {
      html += (i+1)+'시드 '+tLabel(team, t.type).replace(/<[^>]+>/g,'')+(i<Math.min(3,t.seededOrder.length-1)?', ':'');
    });
    if(t.seededOrder.length > 4) html += ' 외 '+(t.seededOrder.length-4)+'명';
    html += '</div>';
  }

  // 우승 배너
  if(t.status === 'done' && t.champion) {
    html += '<div style="background:linear-gradient(135deg,#f6d365,#fda085);border-radius:var(--radius);padding:24px;text-align:center;margin-bottom:12px">'
      + '<div style="font-size:36px;margin-bottom:8px">🏆</div>'
      + '<div style="font-size:13px;font-weight:600;color:rgba(255,255,255,.85);margin-bottom:4px">우승</div>'
      + '<div style="font-size:22px;font-weight:800;color:#fff">'+tLabel(t.champion, t.type)+'</div>'
      + '</div>';
  }

  // 대진표 브래킷
  html += renderBracketView(t);

  html += '<div class="btn-row" style="gap:8px;margin-top:8px">';
  html += '<button data-share-t="'+t.id+'" style="flex:1;padding:13px;border:1.5px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2);color:var(--text2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">결과 공유 📋</button>';
  if(isAdmin) html += '<button data-del-t="'+t.id+'" style="padding:13px 14px;border:1.5px solid var(--danger-light);border-radius:var(--radius-sm);background:var(--danger-light);color:var(--danger);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">삭제</button>';
  html += '</div>';

  el.innerHTML = html;
  bindTourneyMain();
}

function bindTourneyMain() {
  var el = byId('tourney-main');
  if(!el) return;
  el.onclick = function(e) {
    var tv = e.target.closest('[data-tview]');
    if(tv) { _tView = Number(tv.getAttribute('data-tview')); renderTourneySection(); return; }
    var nt = e.target.closest('[data-new-tourney]');
    if(nt) { _tStep = 1; _td = { name: '', type: 'singles', selected: [], guests: [], teams: [], _pair: null }; renderTourneySection(); return; }
    var win = e.target.closest('[data-win]');
    if(win) { var p = win.getAttribute('data-win').split(':'); recordWin(Number(p[0]),Number(p[1]),Number(p[2]),Number(p[3])); return; }
    var undo = e.target.closest('[data-undo]');
    if(undo) { var q = undo.getAttribute('data-undo').split(':'); undoWin(Number(q[0]),Number(q[1]),Number(q[2])); return; }
    var sh = e.target.closest('[data-share-t]');
    if(sh) { shareTourney(Number(sh.getAttribute('data-share-t'))); return; }
    var dl = e.target.closest('[data-del-t]');
    if(dl) { deleteTourney(Number(dl.getAttribute('data-del-t'))); return; }
  };
}

// ── 생성 플로우 ──
function renderCreateFlow() {
  if(_tStep === 1) {
    return '<div class="card">'
      + '<div class="card-title">새 대회 만들기</div>'
      + '<div style="margin-bottom:14px">'
        + '<label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:6px">대회 이름</label>'
        + '<input id="tc-name" type="text" placeholder="예: 남자 단식, 혼합 복식" value="'+esc(_td.name)+'" style="width:100%;padding:11px 13px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:14px;font-family:inherit;background:var(--surface);color:var(--text);outline:none" />'
      + '</div>'
      + '<div style="margin-bottom:20px">'
        + '<label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:8px">종목</label>'
        + '<div style="display:flex;gap:8px">'
          + '<button data-tc-type="singles" style="flex:1;padding:13px;border-radius:var(--radius-sm);border:1.5px solid '+(_td.type==='singles'?'var(--accent)':'var(--border)')+';background:'+(_td.type==='singles'?'var(--accent-light)':'var(--surface)')+';color:'+(_td.type==='singles'?'var(--accent)':'var(--text2)')+';font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">단식</button>'
          + '<button data-tc-type="doubles" style="flex:1;padding:13px;border-radius:var(--radius-sm);border:1.5px solid '+(_td.type==='doubles'?'var(--accent)':'var(--border)')+';background:'+(_td.type==='doubles'?'var(--accent-light)':'var(--surface)')+';color:'+(_td.type==='doubles'?'var(--accent)':'var(--text2)')+';font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">복식</button>'
        + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:8px">'
        + '<button data-tc-cancel style="flex:1;padding:13px;border:1.5px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2);color:var(--text2);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">취소</button>'
        + '<button data-tc-next="1" style="flex:2;padding:13px;border:none;border-radius:var(--radius-sm);background:var(--accent);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">다음 →</button>'
      + '</div>'
    + '</div>';
  }

  if(_tStep === 2) {
    var allMembers = members.slice().sort(function(a,b){ return b.elo - a.elo; });
    var selectedCount = _td.selected.length + _td.guests.length;
    var html = '<div class="card">'
      + '<div class="card-title">'+esc(_td.name)+' · 참가자 선택</div>'
      + '<div style="font-size:12px;color:var(--text3);font-weight:500;margin-bottom:12px">ELO 순으로 정렬돼요. 선택된 순서대로 시드가 배정됩니다.</div>';

    // 멤버 목록
    allMembers.forEach(function(m) {
      var on = _td.selected.indexOf(m.id) >= 0;
      var isPresent = present.has(m.id);
      html += '<button data-tc-sel="'+m.id+'" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px 13px;border:1.5px solid '+(on?'var(--accent)':'var(--border)')+';border-radius:8px;background:'+(on?'var(--accent-light)':'var(--surface)')+';margin-bottom:6px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;color:'+(on?'var(--accent)':'var(--text)')+'"><span>'+esc(m.name)+(isPresent?' <span style="font-size:10px;color:var(--accent);font-weight:700">출석</span>':'')+'</span><span style="font-size:12px;color:var(--text3)">ELO '+m.elo+'&nbsp;&nbsp;'+(on?'✓':'')+'</span></button>';
    });

    // 게스트 목록
    if(_td.guests.length) {
      html += '<div style="font-size:12px;font-weight:700;color:var(--text2);margin:10px 0 6px">게스트</div>';
      _td.guests.forEach(function(g, gi) {
        html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 13px;border:1.5px solid var(--accent);border-radius:8px;background:var(--accent-light);margin-bottom:6px">'
          + '<span style="flex:1;font-size:14px;font-weight:600;color:var(--accent)">'+esc(g.name)+' <span style="font-size:11px;font-weight:500">(ELO '+g.elo+')</span></span>'
          + '<button data-tc-del-guest="'+gi+'" style="font-size:12px;color:var(--danger);background:none;border:none;cursor:pointer;font-weight:700">삭제</button>'
        + '</div>';
      });
    }

    // 게스트 추가 버튼
    html += '<button data-tc-add-guest style="width:100%;padding:10px;border:1.5px dashed var(--border);border-radius:8px;background:none;color:var(--text3);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:12px">+ 게스트 추가 (멤버가 아닌 참가자)</button>';

    html += '<div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:10px">'+selectedCount+'명 선택됨</div>';
    var canNext = selectedCount >= (_td.type === 'doubles' ? 4 : 2);
    html += '<div style="display:flex;gap:8px">'
      + '<button data-tc-cancel style="flex:1;padding:13px;border:1.5px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2);color:var(--text2);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">취소</button>'
      + '<button data-tc-next="2" style="flex:2;padding:13px;border:none;border-radius:var(--radius-sm);background:var(--accent);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;opacity:'+(canNext?'1':'.4')+'">'+(_td.type==='doubles'?'다음 →':'대회 시작 →')+'</button>'
    + '</div></div>';
    return html;
  }

  if(_tStep === 3) {
    var paired = new Set();
    _td.teams.forEach(function(team){ team.players.forEach(function(p){ if(p) paired.add(p.id); }); });
    var allSel = _getMergedSelected();
    var unpaired = allSel.filter(function(m){ return !paired.has(m.id); });
    var html = '<div class="card">'
      + '<div class="card-title">'+esc(_td.name)+' · 팀 구성</div>'
      + '<div style="font-size:12px;color:var(--text3);font-weight:500;margin-bottom:14px">두 명을 연속으로 탭해서 팀을 만드세요. ELO 기준으로 자동 배정도 가능해요.</div>'
      + '<button data-tc-autopair style="width:100%;padding:10px;border:1.5px solid var(--accent);border-radius:8px;background:var(--accent-light);color:var(--accent);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:14px">⚡ ELO 기준 자동 팀 배정</button>';

    if(_td.teams.length) {
      _td.teams.forEach(function(team, ti) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 13px;background:var(--accent-light);border:1.5px solid var(--accent-mid);border-radius:8px;margin-bottom:6px">'
          + '<span style="font-size:13px;font-weight:700;color:var(--accent)">팀 '+(ti+1)+'. '+esc(team.players[0].name)+' / '+esc(team.players[1].name)+' <span style="font-size:11px;font-weight:500">(합산 ELO '+Math.round(teamAvgElo(team)*2)+')</span></span>'
          + '<button data-tc-unteam="'+ti+'" style="font-size:11px;color:var(--danger);background:none;border:none;cursor:pointer;font-weight:700;padding:0 0 0 8px">해제</button>'
        + '</div>';
      });
    }

    if(unpaired.length) {
      html += '<div style="font-size:12px;font-weight:700;color:var(--text2);margin:10px 0 8px">미배정 ('+unpaired.length+'명)'+(unpaired.length%2?'  — 홀수: 한 명은 부전승':'')+'</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      unpaired.forEach(function(m) {
        var sel = _td._pair && _td._pair.id === m.id;
        html += '<button data-tc-pair="'+m.id+'" style="padding:8px 14px;border:1.5px solid '+(sel?'var(--accent)':'var(--border)')+';border-radius:20px;background:'+(sel?'var(--accent)':'var(--surface)')+';color:'+(sel?'#fff':'var(--text)')+';font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">'+esc(m.name)+'<span style="font-size:10px;color:'+(sel?'rgba(255,255,255,.7)':'var(--text3)')+';margin-left:4px">'+m.elo+'</span>'+(sel?' ✓':'')+'</button>';
      });
      html += '</div>';
    }

    var canStart = _td.teams.length >= 2;
    html += '<div style="display:flex;gap:8px;margin-top:16px">'
      + '<button data-tc-cancel style="flex:1;padding:13px;border:1.5px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2);color:var(--text2);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">취소</button>'
      + '<button data-tc-start style="flex:2;padding:13px;border:none;border-radius:var(--radius-sm);background:var(--accent);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;opacity:'+(canStart?'1':'.4')+'">대회 시작 →</button>'
    + '</div></div>';
    return html;
  }
  return '';
}

function _getMergedSelected() {
  var fromMembers = members.filter(function(m){ return _td.selected.indexOf(m.id) >= 0; });
  return fromMembers.concat(_td.guests);
}

function bindCreateFlow() {
  var el = byId('tourney-main');
  if(!el) return;
  el.onclick = function(e) {
    if(e.target.closest('[data-tc-cancel]')) { _tStep = 0; _td = {}; renderTourneySection(); return; }

    var type = e.target.closest('[data-tc-type]');
    if(type) { _td.type = type.getAttribute('data-tc-type'); renderTourneySection(); return; }

    var next = e.target.closest('[data-tc-next]');
    if(next) {
      var step = Number(next.getAttribute('data-tc-next'));
      if(step === 1) {
        var name = (byId('tc-name') || {value:''}).value.trim();
        if(!name) { alert('대회 이름을 입력해주세요'); return; }
        _td.name = name; _tStep = 2; renderTourneySection();
      } else if(step === 2) {
        var total = _td.selected.length + _td.guests.length;
        var minSel = _td.type === 'doubles' ? 4 : 2;
        if(total < minSel) return;
        if(_td.type === 'doubles') {
          _tStep = 3; _td.teams = []; _td._pair = null; renderTourneySection();
        } else {
          _td.teams = _getMergedSelected().map(function(m){ return { id: m.id, name: m.name, players: [m] }; });
          startTourney();
        }
      }
      return;
    }

    var sel = e.target.closest('[data-tc-sel]');
    if(sel) {
      var id = Number(sel.getAttribute('data-tc-sel'));
      var idx = _td.selected.indexOf(id);
      if(idx >= 0) _td.selected.splice(idx, 1); else _td.selected.push(id);
      renderTourneySection(); return;
    }

    if(e.target.closest('[data-tc-add-guest]')) {
      var gName = prompt('게스트 이름:');
      if(!gName || !gName.trim()) return;
      var gElo = prompt('ELO (모를 경우 1000 입력):', '1000');
      var gEloNum = Math.max(100, Math.min(3000, Number(gElo) || 1000));
      _td.guests.push({ id: 'g_' + Date.now(), name: gName.trim(), elo: gEloNum, players: [] });
      renderTourneySection(); return;
    }

    var delGuest = e.target.closest('[data-tc-del-guest]');
    if(delGuest) { _td.guests.splice(Number(delGuest.getAttribute('data-tc-del-guest')), 1); renderTourneySection(); return; }

    var pair = e.target.closest('[data-tc-pair]');
    if(pair) {
      var pid = pair.getAttribute('data-tc-pair');
      var pm = _getMergedSelected().find(function(m){ return String(m.id) === pid; });
      if(!pm) return;
      var alreadyPaired = _td.teams.some(function(t){ return t.players.some(function(p){ return p && String(p.id) === pid; }); });
      if(alreadyPaired) return;
      if(_td._pair) {
        if(String(_td._pair.id) === pid) { _td._pair = null; }
        else { _td.teams.push({ id: String(_td._pair.id)+'_'+pid, name: _td._pair.name+'/'+pm.name, players: [_td._pair, pm] }); _td._pair = null; }
      } else { _td._pair = pm; }
      renderTourneySection(); return;
    }

    var ut = e.target.closest('[data-tc-unteam]');
    if(ut) { _td.teams.splice(Number(ut.getAttribute('data-tc-unteam')), 1); _td._pair = null; renderTourneySection(); return; }

    // ELO 기준 자동 팀 배정 (강+약 페어링)
    if(e.target.closest('[data-tc-autopair]')) {
      var pool = _getMergedSelected().slice().sort(function(a,b){ return b.elo - a.elo; });
      _td.teams = [];
      _td._pair = null;
      while(pool.length >= 2) {
        var p1 = pool.shift(), p2 = pool.pop();
        _td.teams.push({ id: String(p1.id)+'_'+String(p2.id), name: p1.name+'/'+p2.name, players: [p1, p2] });
      }
      // 홀수면 마지막 한 명 남김
      renderTourneySection(); return;
    }

    var start = e.target.closest('[data-tc-start]');
    if(start) {
      if(_td.teams.length < 2) return;
      var paired2 = new Set();
      _td.teams.forEach(function(t){ t.players.forEach(function(p){ if(p) paired2.add(String(p.id)); }); });
      _getMergedSelected().filter(function(m){ return !paired2.has(String(m.id)); })
        .forEach(function(m){ _td.teams.push({ id: String(m.id), name: m.name, players: [m, null] }); });
      startTourney();
    }
  };
}

// ── 결과 공유 ──
function shareTourney(tId) {
  var t = tourneys.find(function(x){ return x.id === tId; });
  if(!t) return;
  var lines = ['🏸 ' + t.name + ' 대진 결과', ''];
  t.rounds.forEach(function(round, ri) {
    var real = round.filter(function(m){ return m.t1 && m.t2; });
    if(!real.length) return;
    lines.push('[ ' + roundName(t, ri) + ' ]');
    real.forEach(function(m) {
      var n1 = tLabel(m.t1, t.type).replace(/<[^>]+>/g, '');
      var n2 = tLabel(m.t2, t.type).replace(/<[^>]+>/g, '');
      if(m.winner === 1) lines.push('  ✓ ' + n1 + (m.score ? ' (' + m.score + ')' : '') + '  vs  ' + n2);
      else if(m.winner === 2) lines.push('  ' + n1 + '  vs  ✓ ' + n2 + (m.score ? ' (' + m.score + ')' : ''));
      else lines.push('  ' + n1 + '  vs  ' + n2 + '  (진행중)');
    });
    lines.push('');
  });
  if(t.champion) lines.push('🏆 우승: ' + tLabel(t.champion, t.type).replace(/<[^>]+>/g, ''));
  var text = lines.join('\n');
  navigator.clipboard.writeText(text).then(function(){
    alert('결과가 복사됐어요! 카카오톡에 붙여넣으세요 📋');
  }).catch(function(){
    prompt('복사하세요:', text);
  });
}
