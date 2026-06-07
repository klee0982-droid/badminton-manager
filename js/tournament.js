// ── 시합 모드 (토너먼트) ──
var TOURNEY_KEY = 'bdm_tourneys_' + CLUB_ID;
var tourneys = loadJson(TOURNEY_KEY, []);
var _tView = tourneys.length ? tourneys[tourneys.length - 1].id : null;
var _tStep = 0; // 0=목록, 1=이름/종목, 2=참가자, 3=팀구성(복식)
var _td = {};

function saveTourneys() {
  localStorage.setItem(TOURNEY_KEY, JSON.stringify(tourneys));
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

function buildR1(teams) {
  // ELO 내림차순 정렬 → 시드 배정
  var sorted = teams.slice().sort(function(a, b){ return teamAvgElo(b) - teamAvgElo(a); });
  var size = pow2ceil(Math.max(sorted.length, 2));
  var order = seededSlots(size); // 시드 순서 → 슬롯 위치
  var slots = new Array(size).fill(null);
  order.forEach(function(seedIdx, slotIdx) {
    slots[slotIdx] = sorted[seedIdx] || null; // 시드 범위 초과 → null(부전승)
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

function buildNextRound(round) {
  var w = roundWinners(round);
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
    var next = buildNextRound(t.rounds[t.rounds.length - 1]);
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
  var totalRounds = Math.ceil(Math.log2(Math.max(teams.length, 2)));
  var r1 = buildR1(teams);
  // 시드 순서 기록 (표시용)
  var seededOrder = teams.slice().sort(function(a, b){ return teamAvgElo(b) - teamAvgElo(a); });
  var t = {
    id: Date.now(),
    name: _td.name,
    type: _td.type,
    teams: teams,
    seededOrder: seededOrder,
    rounds: [r1],
    totalRounds: totalRounds,
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

function recordWin(tId, ri, mi, side) {
  var t = tourneys.find(function(x){ return x.id === tId; });
  if(!t || t.status === 'done') return;
  var m = t.rounds[ri][mi];
  if(!m || m.winner !== null) return;
  var score = prompt('점수를 입력하세요 (선택, 예: 21-15):', '');
  if(score === null) return;
  m.winner = side;
  m.score = score.trim();
  var round = t.rounds[ri];
  if(round.every(function(m){ return m.winner !== null; })) {
    var next = buildNextRound(round);
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

var R_NAMES = { 1: '결승', 2: '준결승', 3: '4강', 4: '8강', 5: '16강', 6: '32강', 7: '64강' };
function roundName(t, ri) {
  var rem = t.totalRounds - ri;
  return R_NAMES[rem] || (Math.pow(2, rem) + '강');
}

// ── 렌더링 ──
function renderTourneySection() {
  var el = byId('tourney-main');
  if(!el) return;

  if(_tStep > 0) { el.innerHTML = renderCreateFlow(); bindCreateFlow(); return; }

  var html = '';

  if(tourneys.length > 0) {
    html += '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:10px">';
    tourneys.forEach(function(t) {
      var on = t.id === _tView;
      html += '<button data-tview="'+t.id+'" style="white-space:nowrap;padding:6px 14px;border-radius:20px;border:1.5px solid '+(on?'var(--accent)':'var(--border)')+';background:'+(on?'var(--accent-light)':'var(--surface)')+';color:'+(on?'var(--accent)':'var(--text2)')+';font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">'+(t.status==='done'?'🏆 ':'')+esc(t.name)+'</button>';
    });
    html += '</div>';
  }

  if(isAdmin) {
    html += '<button data-new-tourney style="width:100%;padding:12px;border:1.5px dashed var(--border);border-radius:var(--radius-sm);background:none;color:var(--text2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:12px">+ 새 대회 만들기</button>';
  }

  var t = _tView ? tourneys.find(function(x){ return x.id === _tView; }) : null;
  if(!t) {
    html += '<div style="text-align:center;padding:48px 16px;color:var(--text3);font-size:14px;font-weight:500">🏆 진행 중인 대회가 없어요</div>';
    el.innerHTML = html; bindTourneyMain(); return;
  }

  // 시드 정보 카드
  if(t.seededOrder && t.seededOrder.length) {
    html += '<div style="background:var(--surface2);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:12px;color:var(--text2)">'
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

  // 라운드
  t.rounds.forEach(function(round, ri) {
    var real = round.filter(function(m){ return m.t1 && m.t2; });
    if(!real.length) return;
    var isCurrent = ri === t.rounds.length - 1 && t.status === 'active';
    html += '<div class="card" style="margin-bottom:10px'+(isCurrent?'':';opacity:.55')+'">';
    html += '<div style="font-size:13px;font-weight:800;color:'+(isCurrent?'var(--accent)':'var(--text2)')+';margin-bottom:10px">'+roundName(t, ri)+'</div>';

    real.forEach(function(m) {
      var mi = round.indexOf(m);
      var done = m.winner !== null;
      var w1 = m.winner === 1, w2 = m.winner === 2;
      var canClick = isCurrent && !done && isAdmin;
      var s1 = getSeedNum(t, m.t1), s2 = getSeedNum(t, m.t2);

      html += '<div style="display:flex;align-items:stretch;gap:6px;margin-bottom:8px">';

      // 팀1
      html += '<div style="flex:1">';
      if(canClick) {
        html += '<button data-win="'+t.id+':'+ri+':'+mi+':1" style="width:100%;padding:10px 6px;background:var(--surface2);color:var(--text);border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;text-align:center">'+seedBadge(s1)+tLabel(m.t1, t.type)+'<br><span style="font-size:10px;color:var(--text3);font-weight:500">ELO '+(m.t1?Math.round(teamAvgElo(m.t1)):'')+'</span></button>';
      } else {
        html += '<div style="padding:10px 6px;background:'+(w1?'var(--accent-light)':'var(--surface2)')+';border:1.5px solid '+(w1?'var(--accent)':'var(--border)')+';border-radius:var(--radius-sm);font-size:13px;font-weight:'+(w1?'800':'600')+';color:'+(w1?'var(--accent)':done?'var(--text3)':'var(--text)')+';text-align:center">'+seedBadge(s1)+tLabel(m.t1, t.type)+(w1?' 🏆':'')+'</div>';
      }
      html += '</div>';

      // 가운데
      html += '<div style="display:flex;align-items:center;flex-direction:column;justify-content:center;font-size:10px;font-weight:700;color:var(--text3);min-width:28px;text-align:center">'+(m.score||'vs')+'</div>';

      // 팀2
      html += '<div style="flex:1">';
      if(canClick) {
        html += '<button data-win="'+t.id+':'+ri+':'+mi+':2" style="width:100%;padding:10px 6px;background:var(--surface2);color:var(--text);border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;text-align:center">'+seedBadge(s2)+tLabel(m.t2, t.type)+'<br><span style="font-size:10px;color:var(--text3);font-weight:500">ELO '+(m.t2?Math.round(teamAvgElo(m.t2)):'')+'</span></button>';
      } else {
        html += '<div style="padding:10px 6px;background:'+(w2?'var(--accent-light)':'var(--surface2)')+';border:1.5px solid '+(w2?'var(--accent)':'var(--border)')+';border-radius:var(--radius-sm);font-size:13px;font-weight:'+(w2?'800':'600')+';color:'+(w2?'var(--accent)':done?'var(--text3)':'var(--text)')+';text-align:center">'+seedBadge(s2)+tLabel(m.t2, t.type)+(w2?' 🏆':'')+'</div>';
      }
      html += '</div>';

      if(done && isAdmin && isCurrent) {
        html += '<button data-undo="'+t.id+':'+ri+':'+mi+'" style="padding:4px 8px;border:none;background:none;color:var(--text3);font-size:11px;cursor:pointer;align-self:center" title="취소">↩</button>';
      }
      html += '</div>';
    });
    html += '</div>';
  });

  html += '<div class="btn-row" style="gap:8px;margin-top:4px">';
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
