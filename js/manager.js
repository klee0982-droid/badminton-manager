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
  _opsManual = []; _opsPick = 0;
  renderPlay(); renderAttend(); saveGameState(); renderOps();
  opsToast(COURT_NAMES[i] + ' 배정 완료 · 📢로 호출', true);
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
  var plan = opsCurrentPlan();
  if(plan) {
    var asg = makeAssignment(plan.group);
    lines.push('', '⏭ 다음 게임: ' + opsNames(asg.teamA) + ' vs ' + opsNames(asg.teamB));
  }
  var rest = waitQueue.filter(function(p){ return !plan || plan.group.indexOf(p) < 0; });
  if(rest.length) lines.push('⏳ 대기: ' + rest.map(function(p){ return p.name; }).join(', '));
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
    return '<button type="button" class="ops-pname" data-replace="' + i + ':' + p.id + '" title="탭해서 교체">' + esc(p.name) + '</button>';
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
    '<div class="ops-stats"><b>' + playing + '</b> 게임 중 · <b>' + waitQueue.length + '</b> 대기 · <b>' + pausedIds.length + '</b> 휴식 · <b>' + gameLog.length + '</b> 게임 완료</div>' +
    '<div class="ops-bar-r">' +
      '<div class="ops-stepper">' + opsStepperInner() + '</div>' +
      '<button type="button" class="btn" data-ops="copy-all">📋 전체 현황 복사</button>' +
    '</div></div>';

  // 다음 게임
  html += '<div class="ops-next">';
  if(plan) {
    var asg = makeAssignment(plan.group);
    var tag = plan.manual ? '직접 구성' : '추천 ' + (plan.idx + 1) + '/' + plan.total;
    html += '<div class="ops-next-hd"><span>⏭ 다음 게임</span><span class="ops-tag">' + tag + '</span><span class="ops-diff">팀 차이 Δ' + asg.diff + '</span></div>' +
      '<div class="ops-next-teams"><span>' + esc(opsNames(asg.teamA)) + '</span><em>vs</em><span>' + esc(opsNames(asg.teamB)) + '</span></div>' +
      '<div class="ops-next-actions">' +
        (plan.manual
          ? '<button type="button" class="btn" data-ops="clear-manual">선택 해제</button>'
          : (plan.total > 1 ? '<button type="button" class="btn" data-ops="cycle">↻ 다른 조합</button>' : '')) +
        '<button type="button" class="btn" data-ops="call-next">📢 미리 호출</button>' +
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
  html += '<div class="ops-wait"><div class="ops-wait-hd"><span>⏳ 대기 ' + waitQueue.length + '명</span>' +
    '<span class="ops-hint">이름을 눌러 4명을 고르면 직접 조를 짤 수 있어요</span></div><div class="ops-chips">';
  html += waitQueue.map(function(p){
    var picked = _opsManual.indexOf(p.id) >= 0, planned = !picked && inPlan.indexOf(p.id) >= 0;
    var s = statOf(p.id), rest = restScore(p.id);
    return '<div class="ops-chip' + (picked ? ' picked' : planned ? ' planned' : '') + (p.gender === 'F' ? ' f' : '') + '">' +
      '<button type="button" class="ops-chip-main" data-ops="pick" data-id="' + p.id + '">' +
        '<span class="ops-chip-name">' + esc(p.name) + '</span>' +
        '<span class="ops-chip-meta">' + s.played + '게임' + (rest > activeCourtCount + 1 ? ' · 오래 대기' : '') + '</span></button>' +
      '<button type="button" class="ops-chip-rest" data-pause-wait="' + p.id + '" title="휴식">💤</button></div>';
  }).join('') || '<div class="ops-empty-note">대기자 없음</div>';
  html += '</div>';
  if(pausedIds.length) {
    html += '<div class="ops-wait-hd" style="margin-top:12px"><span>💤 휴식 ' + pausedIds.length + '명</span><span class="ops-hint">눌러서 복귀</span></div><div class="ops-chips">' +
      pausedIds.map(function(id){ return members.find(function(m){ return m.id === id; }); }).filter(Boolean).map(function(p){
        return '<div class="ops-chip paused"><button type="button" class="ops-chip-main" data-resume="' + p.id + '"><span class="ops-chip-name">' + esc(p.name) + '</span><span class="ops-chip-meta">복귀</span></button></div>';
      }).join('') + '</div>';
  }
  html += '</div>';

  html += '<div class="btn-row ops-foot">' +
    '<button type="button" class="btn" data-ops="goto-attend">+ 늦게 온 사람 / 게스트</button>' +
    (_opsUndo.length ? '<button type="button" class="btn" data-ops="undo">↶ 되돌리기</button>' : '') +
    '<button type="button" class="btn primary" data-ops="finish-day" style="flex:1">종료 & 결과 →</button></div>';

  root.innerHTML = html;
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
      var plan = opsCurrentPlan(); if(!plan) return;
      var asg = makeAssignment(plan.group);
      opsCopy('⏭ 다음 게임 준비해주세요\n' + opsNames(asg.teamA) + '  vs  ' + opsNames(asg.teamB), '다음 게임 호출 문구 복사됨');
    }
    else if(act === 'copy-all') opsCopy(opsAllText(), '전체 현황 복사됨');
    else if(act === 'cycle') opsCyclePlan();
    else if(act === 'pick') opsToggleManual(b.getAttribute('data-id'));
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
    if(byId('tab-ops') && byId('tab-ops').classList.contains('active')) renderOps();
    return r;
  };
}
function opsInit() {
  opsBind();
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
  if(isAdmin) gotoTab('ops'); else renderOps();
}

opsInit();
