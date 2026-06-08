var SUPABASE_URL = 'https://hvvxequwyjqbgxmnavbz.supabase.co';
var SUPABASE_KEY = 'sb_publishable_1Tmj2oW-SGR5KcnVbbq-iA_JEW_QmPb';
var _cp = window.location.pathname.match(/^\/club\/([^/]+)/);
var CLUB_ID      = new URLSearchParams(window.location.search).get('club') || (_cp && _cp[1]) || '';
var ADMIN_PIN    = ''; // clubs 테이블에서 로드됨
var STORAGE_KEY  = 'bdm_members_backup';
var HISTORY_KEY  = 'bdm_history_backup';
var COURT_NAMES  = ['코트 1', '코트 2', '코트 3', '코트 4'];
var MAX_COURTS   = 20;
var BEGINNER_ELO = 1000;
var ADVANCED_ELO = 1400;

var TIERS = [
  { l: 'E급', min: 100,  max: 799,  bg: '#F1EFE8', tc: '#5F5E5A' },
  { l: 'D급', min: 800,  max: 999,  bg: '#E6F1FB', tc: '#185FA5' },
  { l: 'C급', min: 1000, max: 1199, bg: '#EAF3DE', tc: '#27500A' },
  { l: 'B급', min: 1200, max: 1499, bg: '#FAEEDA', tc: '#633806' },
  { l: 'A급', min: 1500, max: 3000, bg: '#FAECE7', tc: '#993C1D' }
];

function defaultMembers() {
  return [
    {id:1,name:'김민수',elo:1650,gender:'M'},{id:2,name:'이지현',elo:1580,gender:'F'},
    {id:3,name:'박준혁',elo:1420,gender:'M'},{id:4,name:'최수진',elo:1390,gender:'F'},
    {id:5,name:'정태영',elo:1300,gender:'M'},{id:6,name:'한미래',elo:1180,gender:'F'},
    {id:7,name:'윤성호',elo:1150,gender:'M'},{id:8,name:'강예린',elo:1100,gender:'F'},
    {id:9,name:'임도현',elo:980,gender:'M'},{id:10,name:'서지우',elo:950,gender:'M'},
    {id:11,name:'오현아',elo:900,gender:'F'},{id:12,name:'배찬호',elo:820,gender:'M'},
    {id:13,name:'류찬영',elo:780,gender:'M'},{id:14,name:'신예지',elo:1050,gender:'F'}
  ];
}

// ── 유틸 ──
function byId(id) { return document.getElementById(id); }
function esc(v) { return String(v).replace(/[&<>"]/g, function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function norm(v) { return String(v||'').trim().toLowerCase(); }
function getTier(e) { for(var i=0;i<TIERS.length;i++) if(e>=TIERS[i].min&&e<=TIERS[i].max) return TIERS[i]; return TIERS[0]; }
function tierBadge(e) { var t=getTier(e); return '<span class="tier" style="background:'+t.bg+';color:'+t.tc+'">'+t.l+'</span>'; }
function getKFactor(e) { if(e<900)return 28; if(e<1100)return 24; if(e<1400)return 20; if(e<1600)return 16; return 14; }
function matchesFn(m,term) { return !term||norm(m.name).indexOf(term)>=0||String(m.elo).indexOf(term)>=0||norm(getTier(m.elo).l).indexOf(term)>=0; }
function gBadge(gender, asBtn, id) {
  var f = gender==='F', cls='gbadge '+(f?'f':'m'), lbl=f?'여':'남';
  if(asBtn) return '<button type="button" class="'+cls+'" title="클릭하여 성별 변경" data-gender-toggle="'+id+'">'+lbl+' ✎</button>';
  return '<span class="'+cls+'">'+lbl+'</span>';
}
function loadJson(k, fb) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch(e) { return fb; } }
function saveLocal() { try { localStorage.setItem(STORAGE_KEY,JSON.stringify(members)); localStorage.setItem(HISTORY_KEY,JSON.stringify(gameHistory)); } catch(e){} }
function pairKey(a,b) { return [a,b].sort(function(x,y){return x-y;}).join('-'); }