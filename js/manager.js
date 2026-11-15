// ── 운영 (관리자 코트 컨트롤 뷰) ──
// 기존 전역 상태(courts, waitQueue, ...)와 매칭 로직을 그대로 사용하고,
// 관리자에게 필요한 것만 한 화면에 모은다:
//   다음 게임 미리보기 · 원탭 결과 기록 · 호출 문구 복사 · 되돌리기 · 새로고침 복구

var OPS_SESSION_KEY = 'bdm_ops_session';
var OPS_SESSION_TTL = 12 * 60 * 60 * 1000; // 12시간 지난 세션은 복구하지 않음
var _opsPick = 0;             // 추천 조합 중 몇 번째를 보고 있는지
var _opsManual = [];          // 직접 고른 선수 id (최대 4)
var _opsScores = {};          // 코트별 입력 중인 점수 {i:{a:'',b:''}}
var _opsUndo = [];            // 되돌리기 스냅샷 스택
var _opsRestoredGuests = [];  // 새로고침 후 복구한 게스트 (Supabase 로드 후 다시 붙임)
var _opsToastTimer = null;

function opsStarted() { var pm = byId('play-main'); return !!pm && pm.style.display !== 'none'; }

// ── 스냅샷 (되돌리기 · 새로고침 복구 공용) ──
function opsPlayer(p) { return { id:p.id, name:p.name, elo:p.elo, gender:p.gender, isGuest:!!p.isGuest }; }
function opsSnapshot() {
  return JSON.parse(JSON.stringify({
    v: 1,
    savedAt: Date.now(),
    started: opsStarted(),
    present: Array.from(present),
    leftEarly: Array.from(leftEarly),
    courts: courts.map(function(c){
      return c ? { teamA:c.teamA.map(opsPlayer), teamB:c.teamB.map(opsPlayer), diff:c.diff, startedAt:c.startedAt||null } : null;
    }),
    waitQueue: waitQueue.map(opsPlayer),
    pausedIds: pausedIds,
    gameLog: gameLog,
    eloDeltas: eloDeltas,
    sessionStats: sessionStats,
    turn: turn,
    partnerHistory: partnerHistory,
    opponentHistory: opponentHistory,
    activeCourtCount: activeCourtCount,
    currentSessionSaved: currentSessionSaved,
    playRequests: playRequests,
    lessonIds: lessonIds,
    guests: members.filter(function(m){ return m.isGuest; }).map(opsPlayer)
  }));
}
function opsApplySnapshot(s) {
  (s.guests || []).forEach(function(g){
    if(!members.some(function(m){ return m.id === g.id; })) members.push(g);
    if(g.id >= nextMemberId) nextMemberId = g.id + 1;
  });
  function resolve(p) { return members.find(function(m){ return m.id === p.id; }) || p; }
  present = new Set(s.present);
  leftEarly = new Set(s.leftEarly);
  courts = new Array(MAX_COURTS).fill(null);
  (s.courts || []).forEach(function(c, i){
    if(c && i < MAX_COURTS) courts[i] = { teamA:c.teamA.map(resolve), teamB:c.teamB.map(resolve), diff:c.diff, startedAt:c.startedAt };
  });
  waitQueue = s.waitQueue.map(resolve);
  pausedIds = s.pausedIds.slice();
  gameLog = s.gameLog; eloDeltas = s.eloDeltas; sessionStats = s.sessionStats; turn = s.turn;
  partnerHistory = s.partnerHistory; opponentHistory = s.opponentHistory;
  activeCourtCount = s.activeCourtCount; currentSessionSaved = s.currentSessionSaved;
  playRequests = s.playRequests || {};
  lessonIds = s.lessonIds || [];
  renderCourtConfig();
}

// ── 새로고침 복구 ──
function opsPersist() {
  try {
    if(opsStarted()) localStorage.setItem(OPS_SESSION_KEY, JSON.stringify(opsSnapshot()));
    else localStorage.removeItem(OPS_SESSION_KEY);
  } catch(e) {}
}
function opsRestore() {
  var s = loadJson(OPS_SESSION_KEY, null);
  if(!s || !s.started || Date.now() - s.savedAt > OPS_SESSION_TTL) return false;
  opsApplySnapshot(s);
  _opsRestoredGuests = s.guests || [];
  renderPlay(); renderAttend();
  return true;
}

// ── 되돌리기 ──
function opsPushUndo(label) {
  _opsUndo.push({ label: label, snap: opsSnapshot() });
  if(_opsUndo.length > 10) _opsUndo.shift();
}
function opsUndo() {
  var u = _opsUndo.pop(); if(!u) return;
  opsApplySnapshot(u.snap);
  renderPlay(); renderAttend(); saveGameState(); renderOps();
  opsToast('되돌렸어요: ' + u.label);
}

// ── 다음 게임 계획 ──
function opsPlans() { return rankFairGroups(waitQueue, 3); }
function opsCurrentPlan() {
  if(_opsManual.length === 4) {
    var g = _opsManual.map(function(id){ return waitQueue.find(function(p){ return p.id === id; }); }).filter(Boolean);
    if(g.length === 4) return { group:g, manual:true };
  }
  var plans = opsPlans();
  if(!plans.length) return null;
  if(_opsPick >= plans.length) _opsPick = 0;
  return { group:plans[_opsPick], manual:false, idx:_opsPick, total:plans.length };
}
// 현재 대기자 기준으로 다음 n게임을 순서대로 미리 계산
function opsUpcoming(n) {
  var first = opsCurrentPlan(); if(!first) return [];
  var out = [first], pool = waitQueue.filter(function(p){ return first.group.indexOf(p) < 0; });
  while(out.length < n) {
    var g = selectFairGroup(pool); if(!g) break;
    out.push({ group:g });
    pool = pool.filter(function(p){ return g.indexOf(p) < 0; });
  }
  return out;
}
function opsCyclePlan() { _opsManual = []; _opsPick++; renderOps(); }
function opsToggleManual(id) {
  id = Number(id);
  var at = _opsManual.indexOf(id);
  if(at >= 0) _opsManual.splice(at, 1);
  else if(_opsManual.length < 4) _opsManual.push(id);
  else { opsToast('4명까지만 고를 수 있어요'); return; }
  renderOps();
}
function opsAssign(i) {
  if(!requireAdmin()) return;
  if(courts[i]) return;
  var plan = opsCurrentPlan();
  if(!plan) { opsToast('대기자가 4명 이상 필요해요'); return; }
  opsPushUndo(COURT_NAMES[i] + ' 배정');
  removeSelected(plan.group);
  courts[i] = makeAssignment(plan.group);
  courts[i].startedAt = Date.now();
  var met = plan.group.filter(function(p){ var r = activeRequest(p); return r && requestSatisfied(r, plan.group); });
  noteGroupAssigned(plan.group);
  _opsManual = []; _opsPick = 0;
  renderPlay(); renderAttend(); saveGameState(); renderOps();
  opsToast(COURT_NAMES[i] + ' 배정 완료' + (met.length ? ' · 🎯 ' + met.map(function(p){ return p.name; }).join(', ') + ' 요청 반영' : '') + ' · 📢로 호출', true);
}

// ── 결과 기록 ──
function opsFinish(i, winner) {
  if(!requireAdmin()) return;
  var c = courts[i]; if(!c) return;
  var sc = _opsScores[i] || {};
  var a = parseInt(sc.a, 10), b = parseInt(sc.b, 10);
  var sa, sb;
  if(isNaN(a) || isNaN(b)) { sa = winner === 'a' ? 21 : 15; sb = winner === 'a' ? 15 : 21; }
  else {
    if(a === b) { opsToast('점수가 같아요. 점수를 확인해주세요'); return; }
    var hi = Math.max(a, b), lo = Math.min(a, b);
    sa = winner === 'a' ? hi : lo; sb = winner === 'a' ? lo : hi;
  }
  opsPushUndo(COURT_NAMES[i] + ' 결과');
  recordCourtResult(i, sa, sb);
  delete _opsScores[i];
  renderPlay(); renderAttend(); saveGameState(); renderOps();
  opsToast(COURT_NAMES[i] + ' ' + sa + ':' + sb + ' 기록됨', true);
}

// ── 레슨 ──
function opsSendToLesson(ids) {
  if(!requireAdmin() || !ids.length) return;
  opsPushUndo('레슨 보내기');
  var names = [], notes = [];
  ids = ids.map(Number);
  // 대기/휴식에서 먼저 빼서 교체 후보에 안 들어가게
  waitQueue = waitQueue.filter(function(p){ return ids.indexOf(p.id) < 0; });
  pausedIds = pausedIds.filter(function(x){ return ids.indexOf(x) < 0; });
  ids.forEach(function(id){
    var m = members.find(function(x){ return x.id === id; }); if(!m) return;
    for(var i = 0; i < MAX_COURTS; i++) {
      var c = courts[i];
      if(!c || !c.teamA.concat(c.teamB).some(function(p){ return p.id === id; })) continue;
      var rep = bestReplacement(c, id);
      if(rep) {
        var keep = c.teamA.concat(c.teamB).filter(function(p){ return p.id !== id; }).concat([rep.cand]);
        waitQueue = waitQueue.filter(function(p){ return p.id !== rep.cand.id; });
        courts[i] = makeAssignment(keep); courts[i].startedAt = c.startedAt || Date.now();
        notes.push(COURT_NAMES[i] + ' ' + rep.cand.name + ' 투입');
      } else {
        // 교체할 대기자가 없으면 그 게임은 취소, 나머지 3명은 대기열 맨 앞으로
        var rest3 = c.teamA.concat(c.teamB).filter(function(p){ return p.id !== id; });
        waitQueue.unshift.apply(waitQueue, rest3);
        courts[i] = null;
        notes.push(COURT_NAMES[i] + ' 게임 취소(대기자 없음)');
      }
    }
    if(lessonIds.indexOf(id) < 0) lessonIds.push(id);
    names.push(m.name);
  });
  _opsManual = _opsManual.filter(function(x){ return ids.indexOf(x) < 0; }); _opsPick = 0;
  renderPlay(); renderAttend(); saveGameState(); renderOps();
  opsToast('📚 ' + names.join(', ') + ' 레슨' + (notes.length ? ' · ' + notes.join(' · ') : ''), true);
}
function opsReturnFromLesson(ids) {
  if(!requireAdmin()) return;
  ids = ids.map(Number);
  var names = [];
  ids.forEach(function(id){
    lessonIds = lessonIds.filter(function(x){ return x !== id; });
    var m = members.find(function(x){ return x.id === id; });
    var busy = waitQueue.some(function(p){ return p.id === id; }) || courts.some(function(c){ return c && c.teamA.concat(c.teamB).some(function(p){ return p.id === id; }); });
    if(m && present.has(id) && !busy) { ensureStats([id]); waitQueue.push(m); names.push(m.name); }
  });
  renderPlay(); renderAttend(); saveGameState(); renderOps();
  if(names.length) opsToast(names.join(', ') + ' 레슨 끝 → 대기열 복귀');
}
var _opsLessonSel = [];
function opsOpenLesson() {
  _opsLessonSel = [];
  opsRenderLesson();
  byId('ops-lesson-overlay').style.display = 'flex';
}
function opsCloseLesson() { byId('ops-lesson-overlay').style.display = 'none'; }
function opsRenderLesson() {
  function btn(p, where) {
    var on = _opsLessonSel.indexOf(p.id) >= 0;
    return '<button type="button" class="ops-req-person ' + opsG(p) + (on ? ' on' : '') + '" data-lesson-pick="' + p.id + '" data-name="' + esc(norm(p.name)) + '">' + esc(p.name) + (where ? ' <small>' + where + '</small>' : '') + '</button>';
  }
  var onCourt = [];
  courts.slice(0, activeCourtCount).forEach(function(c, i){ if(c) c.teamA.concat(c.teamB).forEach(function(p){ onCourt.push(btn(p, (i + 1) + '코트')); }); });
  var paused = pausedIds.map(function(id){ return members.find(function(m){ return m.id === id; }); }).filter(Boolean);
  byId('ops-lesson-sheet').innerHTML =
    '<div class="swap-title">📚 레슨 보내기</div>' +
    '<div class="swap-sub">게임 중인 사람은 대기자 중 가장 잘 맞는 사람으로 자동 교체돼요. 레슨이 끝나면 운영 화면에서 눌러서 복귀시키세요.</div>' +
    '<input type="text" class="ops-req-search" id="ops-lesson-search" placeholder="이름 검색">' +
    '<div class="ops-lesson-scroll">' +
      (waitQueue.length ? '<div class="ops-req-sub">⏳ 대기</div><div class="ops-req-list">' + waitQueue.map(function(p){ return btn(p); }).join('') + '</div>' : '') +
      (onCourt.length ? '<div class="ops-req-sub" style="margin-top:10px">🏸 게임 중</div><div class="ops-req-list">' + onCourt.join('') + '</div>' : '') +
      (paused.length ? '<div class="ops-req-sub" style="margin-top:10px">💤 휴식</div><div class="ops-req-list">' + paused.map(function(p){ return btn(p); }).join('') + '</div>' : '') +
    '</div>' +
    '<button type="button" class="btn primary" data-lesson-send style="width:100%;margin-top:12px;padding:13px"' + (_opsLessonSel.length ? '' : ' disabled') + '>📚 ' + _opsLessonSel.length + '명 레슨 보내기</button>' +
    '<button type="button" class="swap-cancel" data-lesson-close>닫기</button>';
}
function opsFilterLesson() {
  var q = norm(byId('ops-lesson-search').value);
  document.querySelectorAll('#ops-lesson-sheet [data-lesson-pick]').forEach(function(b){
    b.hidden = !!q && b.getAttribute('data-name').indexOf(q) < 0 && !b.classList.contains('on');
  });
}
function opsBindLesson() {
  var ov = document.createElement('div');
  ov.className = 'swap-overlay'; ov.id = 'ops-lesson-overlay'; ov.style.display = 'none';
  ov.innerHTML = '<div class="swap-sheet" id="ops-lesson-sheet"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){
    if(e.target === ov || e.target.closest('[data-lesson-close]')) return opsCloseLesson();
    var b = e.target.closest('[data-lesson-pick]');
    if(b) {
      var id = Number(b.getAttribute('data-lesson-pick')), at = _opsLessonSel.indexOf(id);
      if(at >= 0) _opsLessonSel.splice(at, 1); else _opsLessonSel.push(id);
      var q = byId('ops-lesson-search').value;
      opsRenderLesson(); byId('ops-lesson-search').value = q; opsFilterLesson();
      return;
    }
    if(e.target.closest('[data-lesson-send]')) { var sel = _opsLessonSel.slice(); opsCloseLesson(); opsSendToLesson(sel); }
  });
  ov.addEventListener('input', function(e){ if(e.target.id === 'ops-lesson-search') opsFilterLesson(); });
}

// ── 요청 설정 시트 ──
var _opsReqFor = null, _opsReqWith = [];
function opsReqLabel(p) {
  var r = activeRequest(p); if(!r) return '';
  if(r.type === 'WITH') return '🤝 ' + r.with.map(function(id){ var m = members.find(function(x){ return x.id === id; }); return m ? m.name : '?'; }).join(', ');
  return '🎯 ' + REQUEST_TYPES[r.type];
}
function opsOpenRequest(id) {
  _opsReqFor = members.find(function(m){ return m.id === Number(id); }); if(!_opsReqFor) return;
  var cur = playRequests[_opsReqFor.id];
  _opsReqWith = cur && cur.type === 'WITH' ? cur.with.slice() : [];
  opsRenderRequest();
  byId('ops-req-overlay').style.display = 'flex';
}
function opsCloseRequest() { byId('ops-req-overlay').style.display = 'none'; _opsReqFor = null; }
function opsRenderRequest() {
  var p = _opsReqFor, cur = playRequests[p.id];
  var types = p.gender === 'F' ? ['WD', 'XD'] : ['MD', 'XD'];
  var others = members.filter(function(m){ return present.has(m.id) && m.id !== p.id; }).sort(function(a, b){ return a.name.localeCompare(b.name, 'ko'); });
  byId('ops-req-sheet').innerHTML =
    '<div class="swap-title">' + esc(p.name) + ' 요청</div>' +
    '<div class="swap-sub">요청을 위해 최대 ' + REQUEST_MAX_HOLD + '번의 코트 배정까지 양보하고, 그 뒤엔 일반 게임에 들어가요. 한 게임 하면 요청은 사라져요.</div>' +
    '<div class="ops-req-types">' + types.map(function(t){
      return '<button type="button" class="ops-req-type' + (cur && cur.type === t ? ' on' : '') + '" data-req-type="' + t + '">' + REQUEST_TYPES[t] + '</button>';
    }).join('') + '</div>' +
    '<div class="ops-req-sub">🤝 같이 칠 사람 <span>(최대 3명 · 같은 게임, 팀은 자동)</span></div>' +
    '<input type="text" class="ops-req-search" id="ops-req-search" placeholder="이름 검색">' +
    '<div class="ops-req-list" id="ops-req-list">' + others.map(function(m){
      var on = _opsReqWith.indexOf(m.id) >= 0;
      return '<button type="button" class="ops-req-person ' + opsG(m) + (on ? ' on' : '') + '" data-req-with="' + m.id + '" data-name="' + esc(norm(m.name)) + '">' + esc(m.name) + '</button>';
    }).join('') + '</div>' +
    '<div class="btn-row" style="margin-top:12px">' +
      (cur ? '<button type="button" class="btn danger" data-req-clear>요청 해제</button>' : '') +
      '<button type="button" class="btn primary" data-req-with-save style="flex:1"' + (_opsReqWith.length ? '' : ' disabled') + '>같이 칠 사람 저장 (' + _opsReqWith.length + ')</button>' +
    '</div>' +
    '<button type="button" class="swap-cancel" data-req-close>닫기</button>';
}
function opsSetRequest(r) {
  if(!requireAdmin()) return;
  var p = _opsReqFor;
  if(r) playRequests[p.id] = Object.assign({ held:0 }, r); else delete playRequests[p.id];
  _opsManual = []; _opsPick = 0;
  opsCloseRequest();
  opsPersist(); renderOps();
  opsToast(r ? p.name + ' — ' + (r.type === 'WITH' ? '같이 칠 사람' : REQUEST_TYPES[r.type]) + ' 요청 등록' : p.name + ' 요청 해제');
}
function opsBindRequest() {
  var ov = document.createElement('div');
  ov.className = 'swap-overlay'; ov.id = 'ops-req-overlay'; ov.style.display = 'none';
  ov.innerHTML = '<div class="swap-sheet" id="ops-req-sheet"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){
    if(e.target === ov || e.target.closest('[data-req-close]')) return opsCloseRequest();
    var t = e.target.closest('[data-req-type]');
    if(t) return opsSetRequest({ type: t.getAttribute('data-req-type') });
    var w = e.target.closest('[data-req-with]');
    if(w) {
      var id = Number(w.getAttribute('data-req-with')), at = _opsReqWith.indexOf(id);
      if(at >= 0) _opsReqWith.splice(at, 1);
      else if(_opsReqWith.length < 3) _opsReqWith.push(id);
      else return opsToast('3명까지 고를 수 있어요');
      var q = byId('ops-req-search').value;
      opsRenderRequest(); byId('ops-req-search').value = q; opsFilterReqList();
      return;
    }
    if(e.target.closest('[data-req-with-save]')) return opsSetRequest({ type:'WITH', with:_opsReqWith.slice() });
    if(e.target.closest('[data-req-clear]')) return opsSetRequest(null);
  });
  ov.addEventListener('input', function(e){ if(e.target.id === 'ops-req-search') opsFilterReqList(); });
}
function opsFilterReqList() {
  var q = norm(byId('ops-req-search').value);
  document.querySelectorAll('#ops-req-list [data-req-with]').forEach(function(b){
    b.hidden = !!q && b.getAttribute('data-name').indexOf(q) < 0 && !b.classList.contains('on');
  });
}

// ── 코트 수 (진행 중 세션 유지) ──
function opsSetCourts(n) {
  if(!requireAdmin()) return;
  n = Math.max(1, Math.min(MAX_COURTS, n));
  if(n === activeCourtCount) return;
  if(n < activeCourtCount) {
    var busy = courts.slice(n, activeCourtCount).filter(Boolean).length;
    if(busy && !confirm('게임 중인 코트 ' + busy + '개를 닫을까요? 선수들은 대기열 맨 앞으로 갑니다.')) return;
    for(var i = activeCourtCount - 1; i >= n; i--) {
      if(courts[i]) { waitQueue.unshift.apply(waitQueue, courts[i].teamA.concat(courts[i].teamB)); courts[i] = null; }
    }
  }
  activeCourtCount = n;
  localStorage.setItem('bdm_active_court_count', String(n));
  renderCourtConfig();
  if(opsStarted()) { renderPlay(); saveGameState(); }
  renderAttend(); renderOps();
}

// ── 호출 문구 ──
function opsG(p) { return p.gender === 'F' ? 'gf' : 'gm'; } // 성별 표시: 남 파랑 / 여 빨강
function opsNamesHtml(team) { return team.map(function(p){ return '<span class="gn ' + opsG(p) + '">' + esc(p.name) + '</span>'; }).join(' · '); }
function opsNames(team) { return team.map(function(p){ return p.name; }).join(' · '); }
function opsCourtText(i) {
  var c = courts[i];
  return '🏸 ' + COURT_NAMES[i] + '\n' + opsNames(c.teamA) + '  vs  ' + opsNames(c.teamB);
}
function opsAllText() {
  var d = new Date();
  var lines = ['📋 코트 현황 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'), ''];
  for(var i = 0; i < activeCourtCount; i++) {
    var c = courts[i];
    lines.push(COURT_NAMES[i] + ': ' + (c ? opsNames(c.teamA) + ' vs ' + opsNames(c.teamB) : '(비어 있음)'));
  }
  var up = opsUpcoming(3), queued = [];
  if(up.length) {
    lines.push('', '⏭ 다음 게임');
    up.forEach(function(u, k){ var a = makeAssignment(u.group); queued = queued.concat(u.group); lines.push((k + 1) + '. ' + opsNames(a.teamA) + ' vs ' + opsNames(a.teamB)); });
  }
  var rest = waitQueue.filter(function(p){ return queued.indexOf(p) < 0; });
  if(rest.length) lines.push('⏳ 대기: ' + rest.map(function(p){ return p.name; }).join(', '));
  var les = lessonIds.map(function(id){ var m = members.find(function(x){ return x.id === id; }); return m && m.name; }).filter(Boolean);
  if(les.length) lines.push('📚 레슨: ' + les.join(', '));
  return lines.join('\n');
}
function opsCopy(text, okMsg) {
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
  }
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
  else fallback();
  opsToast(okMsg || '복사됐어요! 단톡방에 붙여넣으세요');
}

// ── 토스트 ──
function opsToast(msg, withUndo) {
  var el = byId('ops-toast'); if(!el) return;
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (withUndo && _opsUndo.length ? '<button type="button" data-ops="undo">되돌리기</button>' : '');
  el.hidden = false;
  clearTimeout(_opsToastTimer);
  _opsToastTimer = setTimeout(function(){ el.hidden = true; }, withUndo ? 6000 : 2500);
}

// ── 렌더링 ──
function opsElapsed(c) {
  if(!c || !c.startedAt) return '';
  var m = Math.floor((Date.now() - c.startedAt) / 60000);
  return m < 1 ? '방금 시작' : m + '분째';
}
function opsTeamHtml(team, i, side) {
  return '<div class="ops-team ' + side + '">' + team.map(function(p){
    return '<button type="button" class="ops-pname ' + opsG(p) + '" data-replace="' + i + ':' + p.id + '" title="탭해서 교체">' + esc(p.name) + '</button>';
  }).join('') + '</div>';
}
function opsCourtHtml(i, plan) {
  var c = courts[i];
  if(!c) {
    var body = plan
      ? '<button type="button" class="ops-assign" data-ops="assign" data-i="' + i + '">다음 게임 배정 →</button>'
      : '<div class="ops-empty-note">대기 ' + waitQueue.length + '명 · 4명 필요</div>';
    return '<div class="ops-court empty"><div class="ops-court-hd"><span class="ops-court-name">' + COURT_NAMES[i] + '</span><span class="ops-free">비어 있음</span></div>' + body + '</div>';
  }
  var long = c.startedAt && Date.now() - c.startedAt > 25 * 60000;
  var sc = _opsScores[i] || { a:'', b:'' };
  return '<div class="ops-court">' +
    '<div class="ops-court-hd"><span class="ops-court-name">' + COURT_NAMES[i] + '</span>' +
      '<span class="ops-elapsed' + (long ? ' long' : '') + '" data-elapsed="' + i + '">' + opsElapsed(c) + '</span>' +
      '<button type="button" class="ops-icon" data-ops="call" data-i="' + i + '" title="호출 문구 복사">📢</button></div>' +
    '<div class="ops-match">' + opsTeamHtml(c.teamA, i, 'a') + '<div class="ops-vs">vs</div>' + opsTeamHtml(c.teamB, i, 'b') + '</div>' +
    '<div class="ops-result">' +
      '<button type="button" class="ops-win a" data-ops="win" data-i="' + i + '" data-side="a">A 승</button>' +
      '<input class="ops-score" inputmode="numeric" placeholder="21" data-ops-score="' + i + ':a" value="' + esc(sc.a) + '" aria-label="A팀 점수">' +
      '<span class="ops-colon">:</span>' +
      '<input class="ops-score" inputmode="numeric" placeholder="15" data-ops-score="' + i + ':b" value="' + esc(sc.b) + '" aria-label="B팀 점수">' +
      '<button type="button" class="ops-win b" data-ops="win" data-i="' + i + '" data-side="b">B 승</button>' +
    '</div></div>';
}
function opsRequestNotes(group) {
  var notes = [];
  group.forEach(function(p){
    var r = activeRequest(p);
    if(r && requestSatisfied(r, group)) notes.push('<span class="ops-note ok">🎯 ' + esc(p.name) + ' ' + (r.type === 'WITH' ? '같이 칠 사람' : REQUEST_TYPES[r.type]) + ' 요청 반영</span>');
    else if(r) notes.push('<span class="ops-note warn">' + esc(p.name) + ' 요청 대기 한도 끝 → 일반 게임</span>');
  });
  var minP = Math.min.apply(null, group.map(function(p){ return statOf(p.id).played; }));
  waitQueue.forEach(function(p){
    var r = activeRequest(p);
    if(r && group.indexOf(p) < 0 && statOf(p.id).played <= minP)
      notes.push('<span class="ops-note hold">⏳ ' + esc(p.name) + ' ' + (r.type === 'WITH' ? '같이 칠 사람' : REQUEST_TYPES[r.type]) + ' 기다리는 중 (양보 ' + r.held + '/' + REQUEST_MAX_HOLD + ')</span>');
  });
  return notes.length ? '<div class="ops-notes">' + notes.join('') + '</div>' : '';
}
function opsMetNotes(group) {
  var notes = group.filter(function(p){ var r = activeRequest(p); return r && requestSatisfied(r, group); })
    .map(function(p){ var r = activeRequest(p); return '<span class="ops-note ok">🎯 ' + esc(p.name) + ' ' + (r.type === 'WITH' ? '같이' : REQUEST_TYPES[r.type]) + '</span>'; });
  return notes.length ? '<div class="ops-notes">' + notes.join('') + '</div>' : '';
}
function opsStepperInner() {
  return '<button type="button" data-ops="courts" data-n="' + (activeCourtCount - 1) + '"' + (activeCourtCount <= 1 ? ' disabled' : '') + ' aria-label="코트 줄이기">−</button>' +
    '<span>' + activeCourtCount + '코트</span>' +
    '<button type="button" data-ops="courts" data-n="' + (activeCourtCount + 1) + '"' + (activeCourtCount >= MAX_COURTS ? ' disabled' : '') + ' aria-label="코트 늘리기">+</button>';
}
function renderOps() {
  var root = byId('ops-main'); if(!root) return;
  if(!isAdmin) {
    root.innerHTML = '<div class="alert info">위 관리자 바에서 PIN으로 로그인하면 코트 운영 화면이 열려요.</div>';
    return;
  }
  if(!opsStarted()) {
    root.innerHTML =
      '<div class="card ops-start">' +
        '<div class="ops-start-n">' + present.size + '명 출석</div>' +
        '<div class="ops-start-sub">게임이 아직 시작되지 않았어요</div>' +
        '<div class="ops-stepper ops-start-stepper">' + opsStepperInner() + '</div>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn" data-ops="goto-attend" style="flex:1">출석 체크</button>' +
          (present.size >= 4 ? '<button type="button" class="btn primary" data-ops="start" style="flex:1">게임 시작 →</button>' : '') +
        '</div></div>';
    return;
  }

  var playing = 0;
  courts.slice(0, activeCourtCount).forEach(function(c){ if(c) playing += 4; });
  var plan = opsCurrentPlan();
  var html = '';

  // 상단 요약 + 코트 수
  html += '<div class="ops-bar">' +
    '<div class="ops-stats"><b>' + playing + '</b> 게임 중 · <b>' + waitQueue.length + '</b> 대기 · <b>' + pausedIds.length + '</b> 휴식 · ' + (lessonIds.length ? '<b>' + lessonIds.length + '</b> 레슨 · ' : '') + '<b>' + gameLog.length + '</b> 게임 완료</div>' +
    '<div class="ops-bar-r">' +
      '<div class="ops-stepper">' + opsStepperInner() + '</div>' +
      '<button type="button" class="btn" data-ops="lesson">📚 레슨</button>' +
      '<button type="button" class="btn" data-ops="copy-all">📋 현황 복사</button>' +
    '</div></div>';

  // 다음 3게임
  var upcoming = opsUpcoming(3);
  html += '<div class="ops-next">';
  if(plan) {
    var tag = plan.manual ? '1번: 직접 구성' : '1번: 추천 ' + (plan.idx + 1) + '/' + plan.total;
    html += '<div class="ops-next-hd"><span>⏭ 다음 게임</span><span class="ops-tag">' + tag + '</span><span class="ops-diff">지금 대기자 기준</span></div>';
    upcoming.forEach(function(u, k){
      var a = makeAssignment(u.group);
      html += '<div class="ops-up' + (k === 0 ? ' first' : '') + '">' +
        '<span class="ops-up-n">' + (k + 1) + '</span>' +
        '<div class="ops-up-body"><div class="ops-next-teams"><span>' + opsNamesHtml(a.teamA) + '</span><span><em>vs</em> ' + opsNamesHtml(a.teamB) + '</span></div>' +
        (k === 0 ? opsRequestNotes(u.group) : opsMetNotes(u.group)) + '</div>' +
        '<span class="ops-up-diff">Δ' + a.diff + '</span></div>';
    });
    html += '<div class="ops-next-actions">' +
        (plan.manual
          ? '<button type="button" class="btn" data-ops="clear-manual">선택 해제</button>'
          : (plan.total > 1 ? '<button type="button" class="btn" data-ops="cycle">↻ 1번 다른 조합</button>' : '')) +
        '<button type="button" class="btn" data-ops="call-next">📢 다음 ' + upcoming.length + '게임 호출</button>' +
      '</div>';
  } else {
    html += '<div class="ops-next-hd"><span>⏭ 다음 게임</span></div><div class="ops-empty-note">대기자가 4명 이상이면 다음 조가 여기 표시돼요</div>';
  }
  html += '</div>';

  // 코트
  html += '<div class="ops-courts">';
  for(var i = 0; i < activeCourtCount; i++) html += opsCourtHtml(i, plan);
  html += '</div>';

  // 대기 / 휴식
  var inPlan = plan ? plan.group.map(function(p){ return p.id; }) : [];
  var order = {};
  upcoming.forEach(function(u, k){ u.group.forEach(function(p){ order[p.id] = k + 1; }); });
  html += '<div class="ops-wait"><div class="ops-wait-hd"><span>⏳ 대기 ' + waitQueue.length + '명</span>' +
    '<span class="ops-legend"><span class="gn gm">남</span><span class="gn gf">여</span></span>' +
    '<span class="ops-hint">이름 4명 선택 = 직접 조 짜기 · 🎯 = 남복/여복/혼복/같이 요청</span></div><div class="ops-chips">';
  html += waitQueue.map(function(p){
    var picked = _opsManual.indexOf(p.id) >= 0, planned = !picked && inPlan.indexOf(p.id) >= 0;
    var s = statOf(p.id), rest = restScore(p.id);
    return '<div class="ops-chip' + (picked ? ' picked' : planned ? ' planned' : '') + ' ' + opsG(p) + '">' +
      '<button type="button" class="ops-chip-main" data-ops="pick" data-id="' + p.id + '">' +
        '<span class="ops-chip-name">' + esc(p.name) + '</span>' +
        '<span class="ops-chip-meta">' + s.played + '게임' + (order[p.id] ? ' · 다음' + order[p.id] : '') + (rest > activeCourtCount + 1 ? ' · 오래 대기' : '') + '</span>' +
        (opsReqLabel(p) ? '<span class="ops-chip-req">' + esc(opsReqLabel(p)) + '</span>' : '') + '</button>' +
      '<div class="ops-chip-tools"><button type="button" class="ops-chip-rest" data-ops="req" data-id="' + p.id + '" title="요청 (남복/여복/혼복/같이)" aria-label="요청">🎯</button>' +
      '<button type="button" class="ops-chip-rest" data-pause-wait="' + p.id + '" title="휴식" aria-label="휴식">💤</button></div></div>';
  }).join('') || '<div class="ops-empty-note">대기자 없음</div>';
  html += '</div>';
  if(lessonIds.length) {
    html += '<div class="ops-wait-hd" style="margin-top:12px"><span>📚 레슨 중 ' + lessonIds.length + '명</span><span class="ops-hint">눌러서 복귀</span>' +
      (lessonIds.length > 1 ? '<button type="button" class="ops-link" data-ops="lesson-return-all">모두 복귀</button>' : '') + '</div><div class="ops-chips">' +
      lessonIds.map(function(id){ return members.find(function(m){ return m.id === id; }); }).filter(Boolean).map(function(p){
        return '<div class="ops-chip lesson ' + opsG(p) + '"><button type="button" class="ops-chip-main" data-ops="lesson-return" data-id="' + p.id + '"><span class="ops-chip-name">' + esc(p.name) + '</span><span class="ops-chip-meta">' + statOf(p.id).played + '게임 · 복귀</span></button></div>';
      }).join('') + '</div>';
  }
  if(pausedIds.length) {
    html += '<div class="ops-wait-hd" style="margin-top:12px"><span>💤 휴식 ' + pausedIds.length + '명</span><span class="ops-hint">눌러서 복귀</span></div><div class="ops-chips">' +
      pausedIds.map(function(id){ return members.find(function(m){ return m.id === id; }); }).filter(Boolean).map(function(p){
        return '<div class="ops-chip paused ' + opsG(p) + '"><button type="button" class="ops-chip-main" data-resume="' + p.id + '"><span class="ops-chip-name">' + esc(p.name) + '</span><span class="ops-chip-meta">복귀</span></button></div>';
      }).join('') + '</div>';
  }
  html += '</div>';

  html += '<div class="btn-row ops-foot">' +
    '<button type="button" class="btn" data-ops="goto-attend">+ 출석 · 게스트</button>' +
    (_opsUndo.length ? '<button type="button" class="btn" data-ops="undo">↶ 되돌리기</button>' : '') +
    '<button type="button" class="btn primary" data-ops="finish-day">종료 & 결과 →</button></div>';

  root.innerHTML = html;
  if(typeof scheduleLivePublish === 'function') scheduleLivePublish(); // 다음 게임/요청 변경도 멤버 화면에 반영
}
function opsTickElapsed() {
  document.querySelectorAll('[data-elapsed]').forEach(function(el){
    var c = courts[Number(el.getAttribute('data-elapsed'))];
    el.textContent = opsElapsed(c);
    el.classList.toggle('long', !!(c && c.startedAt && Date.now() - c.startedAt > 25 * 60000));
  });
}

// ── 이벤트 ──
function opsBind() {
  var root = byId('tab-ops');
  root.addEventListener('click', function(e){
    var b = e.target.closest('[data-ops]'); if(!b) return;
    var act = b.getAttribute('data-ops'), i = Number(b.getAttribute('data-i'));
    if(act === 'assign') opsAssign(i);
    else if(act === 'win') opsFinish(i, b.getAttribute('data-side'));
    else if(act === 'call') opsCopy(opsCourtText(i), COURT_NAMES[i] + ' 호출 문구 복사됨');
    else if(act === 'call-next') {
      var up = opsUpcoming(3); if(!up.length) return;
      opsCopy('⏭ 다음 게임 순서\n' + up.map(function(u, k){ var a = makeAssignment(u.group); return (k + 1) + '. ' + opsNames(a.teamA) + '  vs  ' + opsNames(a.teamB); }).join('\n'), '다음 ' + up.length + '게임 호출 문구 복사됨');
    }
    else if(act === 'copy-all') opsCopy(opsAllText(), '전체 현황 복사됨');
    else if(act === 'cycle') opsCyclePlan();
    else if(act === 'pick') opsToggleManual(b.getAttribute('data-id'));
    else if(act === 'req') opsOpenRequest(b.getAttribute('data-id'));
    else if(act === 'lesson') opsOpenLesson();
    else if(act === 'lesson-return') opsReturnFromLesson([b.getAttribute('data-id')]);
    else if(act === 'lesson-return-all') opsReturnFromLesson(lessonIds.slice());
    else if(act === 'clear-manual') { _opsManual = []; renderOps(); }
    else if(act === 'courts') opsSetCourts(Number(b.getAttribute('data-n')));
    else if(act === 'undo') opsUndo();
    else if(act === 'goto-attend') gotoTab('attend');
    else if(act === 'start') { startGame(); if(opsStarted()) gotoTab('ops'); }
    else if(act === 'finish-day') finishDay();
  });
  root.addEventListener('input', function(e){
    var k = e.target.getAttribute('data-ops-score'); if(!k) return;
    var parts = k.split(':');
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 2);
    _opsScores[parts[0]] = _opsScores[parts[0]] || { a:'', b:'' };
    _opsScores[parts[0]][parts[1]] = e.target.value;
  });
  byId('ops-toast').addEventListener('click', function(e){ if(e.target.closest('[data-ops="undo"]')) opsUndo(); });
  setInterval(opsTickElapsed, 20000);
}

// ── 기존 함수에 훅 연결: 상태가 바뀔 때마다 저장 + 운영 화면 갱신 ──
function opsHook(name) {
  var orig = window[name];
  window[name] = function() {
    var r = orig.apply(this, arguments);
    opsPersist();
    if(opsStarted() && typeof scheduleLivePublish === 'function') scheduleLivePublish();
    if(byId('tab-ops') && byId('tab-ops').classList.contains('active')) renderOps();
    return r;
  };
}
function opsInit() {
  opsBind();
  opsBindRequest();
  opsBindLesson();
  var restored = opsRestore();
  ['renderAttend', 'updateWaitSection', 'renderPlay', 'renderAdmin'].forEach(opsHook);
  // Supabase 로드(이미 진행 중)가 멤버 목록을 덮어써도 복구된 게스트가 사라지지 않게
  var origRenderAll = renderAll;
  renderAll = function() {
    _opsRestoredGuests.forEach(function(g){
      if(!members.some(function(m){ return m.id === g.id; })) members.push(g);
    });
    return origRenderAll.apply(this, arguments);
  };
  if(restored) opsToast('진행 중이던 게임을 복구했어요');
  // 공유 링크로 들어온 멤버는 바로 현황, 관리자는 운영
  if(isAdmin) gotoTab('ops'); else { renderOps(); gotoTab('live'); }
}

opsInit();
