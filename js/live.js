// ── 현황 (공유 링크로 들어온 멤버용, 읽기 전용) ──
// 관리자 화면(운영)의 상태를 그대로 club_game_state에 올리고, 여기서 보여준다.

// 관리자 쪽: 오늘 상태 전체를 하나의 JSON으로 (구버전 화면 호환을 위해 courts/waitQueue 키 유지)
function buildLiveState() {
  var started = typeof opsStarted === 'function' ? opsStarted() : false;
  if(!started && !courts.some(function(c){ return c; }) && !waitQueue.length) return null;
  function P(p) {
    var s = statOf(p.id), out = { id:p.id, name:p.name, g:p.gender === 'F' ? 'F' : 'M', played:s.played };
    var lbl = typeof opsReqLabel === 'function' ? opsReqLabel(p) : '';
    if(lbl) out.req = lbl;
    return out;
  }
  function mem(id) { return members.find(function(m){ return m.id === id; }); }
  var up = [];
  try { up = typeof opsUpcoming === 'function' ? opsUpcoming(3) : []; } catch(e) {}
  return {
    v: 2,
    updatedAt: new Date().toISOString(),
    attendance: present.size,
    courtCount: activeCourtCount,
    courts: courts.slice(0, activeCourtCount).map(function(c){
      return c ? { teamA:c.teamA.map(P), teamB:c.teamB.map(P), diff:c.diff, startedAt:c.startedAt || null } : null;
    }),
    next: up.map(function(u){ var a = makeAssignment(u.group); return { teamA:a.teamA.map(P), teamB:a.teamB.map(P) }; }),
    waitQueue: waitQueue.map(P),
    paused: pausedIds.map(mem).filter(Boolean).map(P),
    lesson: lessonIds.map(mem).filter(Boolean).map(P),
    games: gameLog.map(function(g){
      return { court:g.courtName, a:g.teamA.map(function(p){ return p.name; }), b:g.teamB.map(function(p){ return p.name; }), sa:g.scoreA, sb:g.scoreB, at:g.at || null };
    })
  };
}

// 관리자 화면에서 무엇이든 바뀌면 잠시 모아서 한 번에 올림
var _livePublishTimer = null;
function scheduleLivePublish() {
  if(!isAdmin) return;
  clearTimeout(_livePublishTimer);
  _livePublishTimer = setTimeout(saveGameState, 700);
}

// ── 멤버 화면 ──
function liveElapsed(startedAt) {
  if(!startedAt) return '';
  var m = Math.floor((Date.now() - startedAt) / 60000);
  return m < 1 ? '방금 시작' : m + '분째';
}
function liveTime(iso) {
  var d = new Date(iso);
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}
function renderLiveView(state) {
  var el = byId('live-courts'); if(!el) return;
  var updEl = byId('live-updated');
  var hasAny = state && ((state.courts || []).some(function(c){ return c; }) || (state.waitQueue || []).length || (state.lesson || []).length);
  if(!hasAny) {
    el.innerHTML = '<div class="live-empty">⏸ 지금 진행 중인 게임이 없어요</div>';
    if(updEl) updEl.textContent = '';
    return;
  }
  var term = norm((byId('live-search') || { value:'' }).value);
  var wait = state.waitQueue || [], next = state.next || [], lesson = state.lesson || [], paused = state.paused || [], games = state.games || [];
  function hit(p) { return term && norm(p.name).indexOf(term) >= 0; }
  function nm(p) {
    return '<span class="gn ' + (p.g === 'F' ? 'gf' : p.g === 'M' ? 'gm' : '') + (hit(p) ? ' live-me' : '') + '">' + esc(p.name) + '</span>';
  }
  function names(team) { return team.map(nm).join(' · '); }

  var html = '';

  // 내 상태 (이름 검색 시)
  if(term) {
    var found = [];
    (state.courts || []).forEach(function(c, i){
      if(c) c.teamA.concat(c.teamB).forEach(function(p){ if(hit(p)) found.push([p, '🏸 ' + (i + 1) + '코트에서 게임 중' + (c.startedAt ? ' (' + liveElapsed(c.startedAt) + ')' : '')]); });
    });
    next.forEach(function(g, k){ g.teamA.concat(g.teamB).forEach(function(p){ if(hit(p)) found.push([p, '⏭ 다음 ' + (k + 1) + '번째 게임 — 준비해주세요']); }); });
    wait.forEach(function(p, k){ if(hit(p) && !found.some(function(f){ return f[0].id === p.id; })) found.push([p, '⏳ 대기 중 (' + (k + 1) + '번째)']); });
    lesson.forEach(function(p){ if(hit(p)) found.push([p, '📚 레슨 중']); });
    paused.forEach(function(p){ if(hit(p)) found.push([p, '💤 휴식 중']); });
    html += '<div class="live-me-card">' + (found.length
      ? found.map(function(f){ return '<div><b>' + esc(f[0].name) + '</b> ' + f[1] + (f[0].played != null ? ' <span>· 오늘 ' + f[0].played + '게임</span>' : '') + '</div>'; }).join('')
      : '<div>"' + esc(byId('live-search').value) + '" — 오늘 명단에 없어요</div>') + '</div>';
  }

  // 요약
  var playing = (state.courts || []).filter(function(c){ return c; }).length * 4;
  html += '<div class="live-stats">' +
    (state.attendance ? '<span><b>' + state.attendance + '</b> 출석</span>' : '') +
    '<span><b>' + playing + '</b> 게임 중</span><span><b>' + wait.length + '</b> 대기</span>' +
    (lesson.length ? '<span><b>' + lesson.length + '</b> 레슨</span>' : '') +
    (paused.length ? '<span><b>' + paused.length + '</b> 휴식</span>' : '') +
    (state.v ? '<span><b>' + games.length + '</b> 게임 완료</span>' : '') + '</div>';

  // 다음 게임
  if(next.length) {
    html += '<div class="ops-next live-next"><div class="ops-next-hd"><span>⏭ 다음 게임</span><span class="ops-diff">순서는 바뀔 수 있어요</span></div>' +
      next.map(function(g, k){
        return '<div class="ops-up' + (k === 0 ? ' first' : '') + '"><span class="ops-up-n">' + (k + 1) + '</span><div class="ops-up-body"><div class="ops-next-teams"><span>' + names(g.teamA) + '</span><span><em>vs</em> ' + names(g.teamB) + '</span></div></div></div>';
      }).join('') + '</div>';
  }

  // 코트
  html += '<div class="ops-courts">';
  (state.courts || []).forEach(function(c, i){
    if(!c) {
      if(state.v) html += '<div class="ops-court empty live-court"><div class="ops-court-hd"><span class="ops-court-name">' + (i + 1) + '코트</span><span class="ops-free">곧 배정</span></div></div>';
      return;
    }
    function team(t, side) { return '<div class="ops-team ' + side + '">' + t.map(function(p){ return '<div class="ops-pname ' + (p.g === 'F' ? 'gf' : p.g === 'M' ? 'gm' : '') + (hit(p) ? ' live-me' : '') + '">' + esc(p.name) + '</div>'; }).join('') + '</div>'; }
    html += '<div class="ops-court live-court"><div class="ops-court-hd"><span class="ops-court-name">' + (i + 1) + '코트</span>' +
      '<span class="ops-elapsed" data-live-elapsed="' + (c.startedAt || '') + '">' + liveElapsed(c.startedAt) + '</span></div>' +
      '<div class="ops-match">' + team(c.teamA, 'a') + '<div class="ops-vs">vs</div>' + team(c.teamB, 'b') + '</div></div>';
  });
  html += '</div>';

  // 대기 · 레슨 · 휴식
  function chips(list, cls, meta) {
    return '<div class="ops-chips">' + list.map(function(p, k){
      return '<div class="ops-chip ' + cls + ' ' + (p.g === 'F' ? 'gf' : 'gm') + (hit(p) ? ' live-hit' : '') + '"><div class="ops-chip-main">' +
        '<span class="ops-chip-name">' + esc(p.name) + '</span><span class="ops-chip-meta">' + meta(p, k) + '</span>' +
        (p.req ? '<span class="ops-chip-req">' + esc(p.req) + '</span>' : '') + '</div></div>';
    }).join('') + '</div>';
  }
  if(wait.length || lesson.length || paused.length) {
    html += '<div class="ops-wait">';
    if(wait.length) html += '<div class="ops-wait-hd"><span>⏳ 대기 ' + wait.length + '명</span><span class="ops-legend"><span class="gn gm">남</span><span class="gn gf">여</span></span></div>' +
      chips(wait, '', function(p, k){ return (k + 1) + '번째' + (p.played != null ? ' · ' + p.played + '게임' : ''); });
    if(lesson.length) html += '<div class="ops-wait-hd" style="margin-top:12px"><span>📚 레슨 중 ' + lesson.length + '명</span></div>' +
      chips(lesson, 'lesson', function(p){ return p.played != null ? p.played + '게임' : ''; });
    if(paused.length) html += '<div class="ops-wait-hd" style="margin-top:12px"><span>💤 휴식 ' + paused.length + '명</span></div>' +
      chips(paused, 'paused', function(p){ return p.played != null ? p.played + '게임' : ''; });
    html += '</div>';
  }

  // 오늘 끝난 게임 (최신순)
  if(games.length) {
    html += '<div class="live-games"><div class="ops-wait-hd"><span>📝 오늘 게임 ' + games.length + '개</span></div>' +
      games.slice().reverse().map(function(g, k){
        var aw = g.sa > g.sb, bw = g.sb > g.sa;
        function t(list) { return list.map(function(n){ return '<span' + (term && norm(n).indexOf(term) >= 0 ? ' class="live-me"' : '') + '>' + esc(n) + '</span>'; }).join(' · '); }
        return '<div class="live-game"><span class="live-game-n">' + (games.length - k) + '</span>' +
          '<div class="live-game-body"><div class="' + (aw ? 'w' : '') + '">' + t(g.a) + '</div><div class="' + (bw ? 'w' : '') + '">' + t(g.b) + '</div></div>' +
          '<div class="live-game-score"><b class="' + (aw ? 'w' : '') + '">' + g.sa + '</b><b class="' + (bw ? 'w' : '') + '">' + g.sb + '</b></div>' +
          '<div class="live-game-meta">' + esc(g.court || '') + (g.at ? '<br>' + liveTime(g.at) : '') + '</div></div>';
      }).join('') + '</div>';
  }

  el.innerHTML = html;
  if(updEl && state.updatedAt) {
    var d = new Date(state.updatedAt);
    updEl.textContent = '마지막 업데이트 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + ' · 자동 갱신';
  }
}
setInterval(function(){
  document.querySelectorAll('[data-live-elapsed]').forEach(function(e){
    var t = Number(e.getAttribute('data-live-elapsed')); if(t) e.textContent = liveElapsed(t);
  });
}, 20000);
