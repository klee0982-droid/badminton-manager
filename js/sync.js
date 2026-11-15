// ── 여러 관리자 동시 운영 ──
// 세션 전체(출석·코트·대기·결과·요청·레슨…)를 서버(club_game_state.session)에 버전과 함께 저장.
// 저장은 save_session RPC: PIN 확인 + "내가 마지막으로 본 버전"일 때만 저장(compare-and-swap).
// 다른 관리자의 변경은 실시간 채널로 받아 바로 반영. 거의 동시에 누르면 늦은 쪽은 최신 상태로 맞추고 다시 하도록 안내.

var SYNC_VERSION_KEY = 'bdm_sync_version';
var _sync = { version: 0, lastJson: null, timer: null, inflight: false, again: false, applying: false, ready: false, missed: 0 };

function syncPin() { try { return sessionStorage.getItem('bdm_admin_pin') || ''; } catch(e) { return ''; } }

// 공유할 세션 (출석만 체크한 상태도 공유)
function syncSession() {
  if(!opsStarted() && present.size === 0) return null;
  var s = opsSnapshot();
  delete s.savedAt;
  s.opsManual = _opsManual.slice();
  s.opsPick = _opsPick;
  return s;
}

function scheduleSync() {
  if(!isAdmin || _sync.applying || !_sync.ready) return;
  clearTimeout(_sync.timer);
  _sync.timer = setTimeout(syncPush, 250);
}

async function syncPush() {
  if(!isAdmin || _sync.applying || !_sync.ready) return;
  var sess = syncSession();
  var json = JSON.stringify(sess);
  if(json === _sync.lastJson) return;               // 바뀐 게 없으면 저장 안 함
  if(_sync.inflight) { _sync.again = true; return; }
  _sync.inflight = true;
  var lostLabel = _opsUndo.length ? _opsUndo[_opsUndo.length - 1].label : '';
  try {
    var res = await db.rpc('save_session', {
      p_club_id: CLUB_ID, p_pin: syncPin(), p_expected: _sync.version,
      p_session: sess, p_live: buildLiveState()
    });
    if(res.error) throw res.error;
    var d = res.data || {};
    if(d.ok) {
      _sync.version = d.version; _sync.lastJson = json;
      syncSaveVersion(); setSyncBadge('저장됨', 'ok');
    } else if(d.error === 'conflict') {
      syncApply(d.session, d.version);
      opsToast('⚠ ' + (lostLabel ? '"' + lostLabel + '"' : '방금 작업') + '이 다른 관리자 변경과 겹쳐서 반영 안 됐어요 — 최신 화면에서 다시 해주세요');
    } else if(d.error === 'pin') {
      adminLogout();
      setAdminMsg('PIN이 바뀌었어요. 다시 로그인해주세요', 'err');
    }
  } catch(e) {
    console.warn('syncPush:', e && e.message || String(e));
    setSyncBadge('오류', 'bad');
    setTimeout(scheduleSync, 3000); // 네트워크 오류 → 잠시 후 재시도 (버전 비교로 덮어쓰기 없음)
  } finally {
    _sync.inflight = false;
    if(_sync.missed > _sync.version) { _sync.missed = 0; syncFetch(); }
    else if(_sync.again) { _sync.again = false; scheduleSync(); }
  }
}

function syncClearLocal() {
  present.clear(); courts = new Array(MAX_COURTS).fill(null); waitQueue = []; gameLog = []; eloDeltas = {}; sessionStats = {};
  turn = 0; partnerHistory = {}; opponentHistory = {}; pausedIds = []; currentSessionSaved = false; playRequests = {}; lessonIds = [];
  leftEarly.clear();
  members = members.filter(function(m){ return !m.isGuest; });
  _opsManual = []; _opsPick = 0;
  byId('play-main').style.display = 'none'; byId('play-empty').style.display = '';
  byId('result-main').style.display = 'none'; byId('result-empty').style.display = '';
}

// 서버 상태를 이 휴대폰에 반영 (반영 중에는 다시 저장하지 않음)
function syncApply(sess, version) {
  _sync.applying = true;
  try {
    if(sess) {
      opsApplySnapshot(sess);
      _opsManual = sess.opsManual || []; _opsPick = sess.opsPick || 0;
      if(sess.started) renderPlay();
      else { byId('play-main').style.display = 'none'; byId('play-empty').style.display = ''; }
    } else {
      syncClearLocal();
    }
    _opsUndo = []; // 다른 관리자 변경 위로 되돌리기 하지 않도록
    renderAll(); renderOps();
  } finally {
    _sync.applying = false;
  }
  _sync.version = version;
  _sync.lastJson = JSON.stringify(syncSession());
  syncSaveVersion(); opsPersist();
}

async function syncFetch() {
  if(!isAdmin) return;
  try {
    var r = await db.from('club_game_state').select('session,version').eq('club_id', CLUB_ID).maybeSingle();
    if(r.error) throw r.error;
    if(r.data && r.data.version > _sync.version && !_sync.inflight) {
      syncApply(r.data.session, r.data.version);
      opsToast('👥 다른 관리자 변경 반영됨');
    }
  } catch(e) { console.warn('syncFetch:', e && e.message || String(e)); }
}

// 실시간 채널 (supabase.js에서 호출)
function onRemoteGameState(row) {
  if(!isAdmin || !_sync.ready || !row || typeof row.version !== 'number') return;
  if(row.version <= _sync.version) return;              // 내 저장의 메아리 또는 이미 반영
  if(_sync.inflight) { _sync.missed = Math.max(_sync.missed, row.version); return; }
  syncApply(row.session, row.version);
  opsToast('👥 다른 관리자 변경 반영됨');
}

function syncSaveVersion() { try { localStorage.setItem(SYNC_VERSION_KEY, String(_sync.version)); } catch(e) {} }

// 로그인/새로고침 시: 서버가 기준
async function syncInit() {
  if(!isAdmin) return;
  if(!syncPin()) { // 이 기능 전에 로그인한 기기 → PIN 다시 필요
    adminLogout();
    setAdminMsg('여러 명 동시 운영 업데이트 — PIN으로 다시 로그인해주세요', 'err');
    return;
  }
  try {
    var r = await db.from('club_game_state').select('session,version').eq('club_id', CLUB_ID).maybeSingle();
    if(r.error) throw r.error;
    var row = r.data, localVer = Number(loadJson(SYNC_VERSION_KEY, -1));
    if(row && row.session) {
      syncApply(row.session, row.version);
    } else if(row && row.version > 0 && localVer >= 0 && localVer < row.version) {
      syncApply(null, row.version);                       // 다른 관리자가 이미 초기화함
    } else {
      _sync.version = row ? row.version : 0;              // 서버 비어 있음 → 이 기기 세션을 올림
    }
    _sync.ready = true;
    scheduleSync();
  } catch(e) {
    console.warn('syncInit:', e && e.message || String(e));
    setTimeout(syncInit, 5000);
  }
}

// ── 기존 저장 경로를 동기화로 연결 ──
// 관리자는 save_session으로만 저장(멤버용 현황도 같이 갱신). 멤버(비관리자)는 아무것도 쓰지 않음.
saveGameState = function() { if(isAdmin) scheduleSync(); return Promise.resolve(); };
scheduleLivePublish = scheduleSync;

(function(){
  document.addEventListener('visibilitychange', function(){ if(!document.hidden && _sync.ready) syncFetch(); });
  setInterval(function(){ if(_sync.ready && !document.hidden) syncFetch(); }, 20000); // 실시간 끊김 대비
  // syncInit은 loadFromSupabase 끝에서 호출 (멤버 목록이 먼저 있어야 게스트·이름이 맞음)
})();
