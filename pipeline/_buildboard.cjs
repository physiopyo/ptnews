// PT뉴스 메인(레일) 레이아웃 빌더 — _news/*.json + guide/*.sections.json → 웹/board/index.html
const fs = require('fs');

function J(f, d) { try { return JSON.parse(fs.readFileSync('_news/' + f, 'utf8')); } catch (e) { return d; } }
function J2(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }
const GMAN = J2('../guide/img/_manifest.json', {});
function gimg(slug) { return (GMAN[slug] || []).map(function (p) { return 'guide/' + p; }); }
function gpdf(slug) { return 'guide/img/' + slug + '.pdf'; }

const ko = J('ko.json', []);
const press = J('press.json', []);
const insure = J('insure.json', []);
const CO = J('coaction.json', {});
const buzz = J('buzz.json', {});

const NOW = Date.now();
function relTime(dt) {
  if (!dt) return '';
  const t = new Date(dt).getTime(); if (isNaN(t)) return '';
  let s = (NOW - t) / 1000; if (s < 0) s = 0;
  const h = s / 3600, d = h / 24;
  if (h < 1) return Math.max(1, Math.floor(s / 60)) + '분 전';
  if (h < 24) return Math.floor(h) + '시간 전';
  if (d < 2) return '어제';
  if (d < 8) return Math.floor(d) + '일 전';
  return '';
}
function dday(iso) { const ms = new Date(iso + 'T23:59:59+09:00').getTime() - NOW; return Math.max(0, Math.ceil(ms / 86400000)); }
const nf = n => Number(n || 0).toLocaleString('en-US');

function art(o, ch, outlet, author) {
  return { title: o.title || '', outlet: outlet || o.chip || '', author: author || '', date: o.disp || o.date || '', ago: relTime(o.dt), img: o.img || '', url: o.url || '#', summary: (o.summary || o.desc || ''), ch: ch, tags: (ch === 'ins' ? ['보험사'] : []), dt: o.dt || '' };
}
const articles = [].concat(
  ko.map(o => art(o, 'ko', '서울일보', '고영준')),
  press.map(o => art(o, 'press', o.chip, '')),
  insure.map(o => art(o, 'ins', o.chip, ''))
).sort((a, b) => String(b.dt).localeCompare(String(a.dt)));

const petitions = [
  { dl: '7.17(금) 마감', dday: dday('2026-07-17'), count: CO.petition ? nf(CO.petition) : '3,165', pct: (CO.petitionPct != null ? CO.petitionPct : 6), title: '도수치료 관리급여화 고시 및 체외충격파 횟수 제한 정책 철회·시행유예 촉구', desc: '국민의 치료 선택권과 물리치료사의 생존권을 위협하는 관리급여 고시의 철회 및 충분한 사회적 논의를 요구합니다.', url: 'https://petitions.assembly.go.kr/proceed/onGoingAll/527DFB9D4A5222D7E064ECE7A7064E8B' },
  { dl: '7.20(월) 마감', dday: dday('2026-07-20'), count: CO.petition2 ? nf(CO.petition2) : '1,202', pct: (CO.petition2Pct != null ? CO.petition2Pct : 2), title: '안면마비 재활 분야 관리급여 기준 철회 및 산정 특례 적용 요청', desc: '획일적 기준으로 재활 치료가 필요한 환자가 배제되지 않도록, 안면마비 등 특수 재활 영역의 별도 산정을 요청합니다.', url: 'https://petitions.assembly.go.kr/proceed/onGoingAll/52523590A2A26BDEE064B49691C6967B' }
];

const stmts = [
  { date: '6.15', org: '대한림프도수치료학회 (KALMT)', badge: '최초', pages: ['img/stmt/lymph.webp'] },
  { date: '6.16', org: '대한골반건강물리치료학회', badge: '', pages: ['img/stmt/gb1.webp', 'img/stmt/gb2.webp', 'img/stmt/gb3.webp', 'img/stmt/gb4.webp', 'img/stmt/gb5.webp', 'img/stmt/gb6.webp'] },
  { date: '6.16', org: '대한소아통합수기물리치료학회 (KPIMT)', badge: '', pages: ['img/stmt/kpimt1.webp', 'img/stmt/kpimt2.webp', 'img/stmt/kpimt3.webp'] },
  { date: '6.16', org: '대한물리치료사협회 경근분과학회', badge: '', pages: ['img/stmt/gyeong.webp'] },
  { date: '6.17', org: '대한정형도수물리치료학회 부산지부', badge: '', pages: ['img/stmt/busan.webp'] },
  { date: '6.17', org: '대한기능도수물리치료학회 (FMT)', badge: '', pages: ['img/stmt/fmt1.webp', 'img/stmt/fmt2.webp', 'img/stmt/fmt3.webp'] },
  { date: '6.19', org: '대한정형도수물리치료학회 광주지부', badge: '', pages: ['img/stmt/gwangju.webp'] },
  { date: '6.20', org: '대한정형도수물리치료학회 충남지부', badge: '', pages: ['img/stmt/chungnam.webp'] },
  { date: '6.22', org: '대한근골격발란스테이핑물리치료학회 서울시회', badge: '', pages: ['img/stmt/balance1.webp', 'img/stmt/balance2.webp'] },
  { date: '6.23', org: '대한연부조직도수물리치료학회 (KAS)', badge: '', pages: ['img/stmt/yeonbu1.webp', 'img/stmt/yeonbu2.webp'] },
  { date: '6.23', org: 'APPI (Team APPI)', badge: '', pages: ['img/stmt/appi1.jpg', 'img/stmt/appi2.jpg', 'img/stmt/appi3.jpg', 'img/stmt/appi4.jpg'] },
  { date: '6.23', org: '대한칼텐보른-에브엔스 정형도수물리치료학회 (KEOMT)', badge: '', pages: ['img/stmt/keomt1.png', 'img/stmt/keomt2.png'] },
  { date: '6.23', org: '대한근골격 ESWT 물리치료연구회', badge: '', pages: ['img/stmt/eswt1.webp', 'img/stmt/eswt2.webp'] },
  { date: '6.23', org: '대한자세운동과학회', badge: '', pages: ['img/stmt/jase1.webp', 'img/stmt/jase2.webp', 'img/stmt/jase3.webp'] },
  { date: '6.27', org: '37대 전국물리치료(학)과 학생학술연구회', badge: '전국학생회', pages: ['img/stuhak1.webp', 'img/stuhak2b.webp'] }
];

const docs = [
  { title: '「건강보험 행위 급여·비급여 목록표 및 급여 상대가치점수」 일부개정 (확정고시)', org: '보건복지부 고시 · 2026.6.29', url: 'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&act=view&list_no=1491036&tag=&nPage=1' },
  { title: '「선별급여 지정 및 실시 등에 관한 기준」 일부개정고시 (확정)', org: '보건복지부 고시 · 2026.6.29', url: 'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&act=view&list_no=1491037&tag=&nPage=1' },
  { title: '「요양급여의 적용기준 및 방법에 관한 세부사항」 일부개정고시 (확정)', org: '보건복지부 고시 · 2026.6.29', url: 'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&act=view&list_no=1491038&tag=&nPage=1' },
  { title: '「요양급여비용 청구방법·심사청구서·명세서 서식 및 작성요령」 일부개정고시 (확정)', org: '보건복지부 고시 · 2026.6.29', url: 'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&act=view&list_no=1491039&tag=&nPage=1' },
  { title: '도수치료 관리급여 기준 질의응답 (수정본)', org: '건강보험심사평가원 · 2026.6.29', url: 'https://www.hira.or.kr' },
  { title: '도수치료 관리시스템 API 개발가이드', org: '심평원 요양기관 업무포털(ef.hira) · 2026.6.24', url: 'https://ef.hira.or.kr/efweb/index.do?sso=ok' },
  { title: '체외충격파 의료기관 자율 가이드라인 (부위당 6회·연 12회)', org: '보건복지부 보도자료 · 2026.6.17', url: 'https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1490900&mid=a10503010100' },
  { title: '도수치료 관리시스템 개발 설명회 자료·질의응답·사용자 매뉴얼', org: '건강보험심사평가원 공지 · 2026.6.8', url: 'https://www.hira.or.kr/bbsDummy.do?pgmid=HIRAA020002000100&brdScnBltNo=4&brdBltNo=12102' },
  { title: '도수치료 관리급여 전환 위한 3종 고시 개정안 행정예고 (고시 원문·질의응답 PDF)', org: '보건복지부 보도자료 · 2026.6.19', url: 'https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1490937&mid=a10503010100' },
  { title: '도수치료 회당 4만원대 수가 적용, 주2회·연간 최대 24회 제한 (제10차 건정심 의결)', org: '보건복지부 보도자료 · 2026.6.4', url: 'https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&act=view&list_no=1490729' },
  { title: '도수치료 등 관리급여 적용 항목 선정 (비급여관리정책협의체)', org: '보건복지부 보도자료 · 2025.12.9', url: 'https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=1488167&act=view' },
  { title: '자동차보험진료수가에 관한 기준 (자보 도수치료 단가·인정기준 원문)', org: '국토교통부 고시 · 국가법령정보센터', url: 'https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000242216' },
  { title: '(의료기관 안내용) 도수치료 산재보험 업무처리 방법 안내', org: '근로복지공단 고용·산재보험 토탈서비스 공지 · 2026.6.29', url: 'https://total.comwel.or.kr/' }
];

const notices = [
  { badge: '국회 일정', color: '#3A6EA5', date: '6.30', title: '국회토론회 「중증질환자 피해사례로 본 실손보험·관리급여 제도의 문제점 및 개선방안」', img: 'img/notice_assembly2.jpg', body: `일시 : 2026년 6월 30일(화) 10:00~12:00
장소 : 국회의원회관 제1세미나실
주최 : 국회의원 이주영(개혁신당)
주관 : 대한의사협회, 한국중증질환연합회
좌장 : 이태연, 사회 : 안치현 (대한의사협회 보험이사)
발제1 : 관리급여 추진의 문제점과 바람직한 비급여 관리 대안 (이봉근)
발제2 : 중증질환자 피해사례로 본 실손보험 제도의 문제점 및 개선안 (최태형 변호사)
이후 환자 피해사례 발표, 지정토론(의료계·환자단체·보험업계·금융계·정부), 질의응답` },
  { badge: '국회 일정', color: '#3A6EA5', date: '6.30', title: '「지역사회통합돌봄, 성인지 관점에서의 대안모색」 토론회', img: 'img/notice_assembly1.jpg', body: `일시 : 2026년 6월 30일(화) 오전 10시
장소 : 국회 의원회관 제8간담회실
주최 : 국회부의장 남인순, 한국여성연구소, 한국여성단체연합
좌장 : 김희강(고려대 행정학과 교수)
발표 : 송다영(인천대), 최나리(젠더로 다시 여는 연구소), 백경흔(이화여대)
토론 : 장수정, 허민숙, 이정아
안건 : 의료·요양 등 지역 돌봄 통합지원에 관한 법률의 성인지 분석과 개선 방안` },
  { badge: '집회 확정', color: '#D8483A', date: '6.22', title: "6.28 집회 'Plan A' 최종 확정 (경복궁 동십자각 14:00)", body: `안녕하세요. 대한물리치료사협회(이하 '대물협') 및 회원 대표 운영진에서 알려드립니다.

대물협과 의협의 논의 끝에, 의협은 의협대로 대물협은 대물협대로 같은 날 각자의 장소에서 목소리를 내기로 최종 결정되었습니다.

이에 저희 집회는 6월 28일 경복궁 동십자각에서 이전에 공지드린 [Plan A]로 진행됩니다.

모두 많이 기다리셨을 텐데, 빠르게 다음 공지 올리겠습니다. 감사합니다.

[Plan A] 우리의 힘으로 진행한다
날짜 : 2026년 6월 28일(일)
장소 : 경복궁 동십자각
시간 : 14:00 ~ 16:00
수용 인원 : 1,000명` },
  { badge: '자유방', color: '#3E9E78', date: '6.22', title: '각 시도회 도수치료 관리급여 대응 현황 제보 요청', body: `각 지역에 계신 물리치료사 회원 여러분께 알려드립니다.

관리급여로 인한 치료사 생존권 위협이 턱 앞까지 다가왔습니다. 우리 생존권을 두고 각 시도 물리치료사회가 회원을 지켜주고 있는지, [도수치료 관리급여]에 대한 각 시도회의 활동 현황을 파악하고자 합니다.

회원님들께서 가입되어 계신 각 지역 밴드·인스타그램·페이스북 등 SNS에 올라온 협회의 활동 소식이나 공지가 있다면 적극적인 제보 부탁드립니다.

제보 내용 : 각 시도회 밴드·인스타 등 SNS의 도수치료 관리급여 관련 활동/공지 캡쳐본, 또는 내부 분위기·내부 관계자 제보 (철저한 익명 보장)

제보 방법 : '바보' 방장에게 개인 카톡

각 시도 물리치료사회가 우리 권익을 위해 어떤 도움을 주고 있는지 파악하려는 취지입니다. 감사합니다.` },
  { badge: '중앙협회', color: '#8C72D6', date: '6.22', title: '대한물리치료사협회 고용위기대응센터 : 권고사직·고용피해 안내', img: 'img/notice_kpta.jpg', body: '대한물리치료사협회 고용위기대응센터 안내입니다. 권고사직·사직서(자진퇴사) 작성 주의, 도수치료 관리급여 고용피해 전문가(노무사) 상담 안내. 노무사 류시나 010-3704-8756.' },
  { badge: '집회 공지', color: '#D8483A', date: '6.21', title: '6.28 총궐기 1차 확정안 (Plan A·B) 안내', body: `안녕하세요. 대한물리치료사협회(이하 '대물협') 및 회원 대표 운영진에서 알려드립니다.

회원 여러분, 많이 기다리셨습니다. 조금 더 빨리 확정된 소식을 전해드리지 못해 죄송합니다. 협회장님과 긴밀히 논의한 끝에 1차 확정안을 먼저 공유드립니다.

[Plan A] 우리의 힘으로 진행한다 : 6월 28일(일) 14:00~16:00, 경복궁 동십자각, 수용 인원 1,000명

[Plan B] 대한의사협회(이하 '의협')와의 연대 : 6월 28일(일) 16:00~18:00, 대한문 일대, 수용 인원 미정

요약 : Plan A 또는 Plan B로 진행 예정

[협회장님 의견] "목소리를 더 크고 효과적으로 전달할 수 있다면, 수용 인원 등을 확인한 후 의협과 연대하는 방향도 고려해 보자"는 제안을 주셨습니다.

내일(6월 22일, 월) 대물협과 의협이 직접 만나 구체적인 논의를 진행합니다. 연대가 성사되면 시너지를 위해 시간이나 장소가 일부 조정될 수 있으며, 불가피할 경우 Plan A 장소에서 진행합니다.

회원님들께 드리는 약속 : 주말이라 오늘 의협의 최종 확답을 받기는 어렵습니다. 하지만 분명히 약속드립니다. 내일 의협과의 논의 끝에 동행이 안 된다면, Plan A(6월 28일 14시, 경복궁 동십자각)는 틀림없이 진행됩니다.

이번 집회는 우리의 정당한 권리를 찾기 위한 필수 과정입니다. 답답하셨을 텐데도 믿고 기다려 주신 회원 여러분께 진심으로 감사드립니다. 내일 최종 조율이 끝나는 대로 가장 먼저 공지 올리겠습니다.

우선 6월 28일(일) 일정 비워두시고 조금만 더 지켜봐 주시기 바랍니다. 감사합니다.

김동현 비대위원장 올림` }
];

const guide = {
  clinician: { label: '치료사용', subs: [
    { slug: 'dosu-clinician', label: '도수치료', pages: gimg('dosu-clinician'), pdf: gpdf('dosu-clinician') },
    { slug: 'eswt-clinician', label: '체외충격파', pages: gimg('eswt-clinician'), pdf: gpdf('eswt-clinician') },
    { slug: 'faq', label: '채팅 FAQ', pages: gimg('dosu-faq').concat(gimg('eswt-faq')), pdf: null }
  ] },
  patient: { label: '환자용', items: [{ label: '도수치료', img: (gimg('dosu-patient')[0] || '') }, { label: '체외충격파', img: (gimg('eswt-patient')[0] || '') }] }
};

const _bt = (buzz.naver && buzz.naver.totals) || buzz.totals || {};
function _vol(k) { const t = _bt[k] || {}; return (t.blog || 0) + (t.news || 0) + (t.cafe || 0) + (t.daumcafe || 0); }
function _spark(series) { if (!Array.isArray(series) || !series.length) return []; const mx = Math.max.apply(null, series) || 1; const step = Math.max(1, Math.round(series.length / 46)); const out = []; for (let i = 0; i < series.length; i += step) out.push(Math.round((Number(series[i]) || 0) / mx * 100)); return out; }
const _kw = (buzz.keywords || []).map(function (k) { return { k: k, vol: _vol(k), rel: ((buzz.related_naver && buzz.related_naver[k]) || []).slice(0, 7), spark: _spark(buzz.trend && buzz.trend.series && buzz.trend.series[k]) }; }).sort(function (a, b) { return b.vol - a.vol; });
const opinion = { against: 96, forp: 4, rally: '1,000+', petTotal: nf((CO.petition || 0) + (CO.petition2 || 0)), timeframe: (buzz.timeframe === 'today 3-m' ? '최근 3개월' : (buzz.timeframe || '')), buzzUpdated: (buzz.updated || ''), kw: _kw };
const BUZZ = { keywords: buzz.keywords || [], trend: buzz.trend || {}, related_naver: buzz.related_naver || {}, related_google: buzz.related_google || {}, updated: buzz.updated || '', naver: { datalab: (buzz.naver && buzz.naver.datalab) || {}, totals: (buzz.naver && buzz.naver.totals) || {}, channel_daily: (buzz.naver && buzz.naver.channel_daily) || {}, hourly: (buzz.naver && buzz.naver.hourly) || {}, sentiment: (buzz.naver && buzz.naver.sentiment) || {}, related_weeks: (buzz.naver && buzz.naver.related_weeks) || {} } };

const DATA = { articles, petitions, stmts, docs, notices, guide, opinion, buzz: BUZZ, updated: (CO.updated || '') };

const CSS = `:root{--accent:#1a1a1a;--ink:#1a1a1a;--sub:#8c8c8c;--line:#ececec;--bg:#ffffff}
html,body{margin:0}body{background:var(--bg);font-family:'Noto Sans KR',system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}a{color:inherit}
::-webkit-scrollbar{height:6px;width:6px}::-webkit-scrollbar-thumb{background:#d7d2c8;border-radius:6px}
.topnav::-webkit-scrollbar{display:none}.topnav{scrollbar-width:none;-ms-overflow-style:none}
.hero{overflow:hidden;max-height:470px;opacity:1;margin:22px 40px 4px;transition:max-height .55s cubic-bezier(.4,0,.2,1),opacity .55s cubic-bezier(.4,0,.2,1),margin .55s cubic-bezier(.4,0,.2,1)}
.hero.collapsed{max-height:0;opacity:0;margin:0 40px}
.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 1.1s ease}
.hero-img.on{opacity:1}
.dot{width:7px;height:7px;border-radius:4px;border:none;background:rgba(255,255,255,.5);cursor:pointer;padding:0;transition:width .35s ease,background .35s ease}
.dot.on{width:24px;background:#fff}
.heropz{width:34px;height:34px;border:none;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;filter:drop-shadow(0 1px 4px rgba(0,0,0,.7))}.heropz svg{width:18px;height:18px}
.navbtn{display:flex;align-items:center;gap:7px;padding:12px 2px;margin:0 24px -1px 0;border:none;border-bottom:2px solid transparent;background:transparent;color:#a3a3a3;font:600 13.5px 'Noto Sans KR';cursor:pointer;white-space:nowrap}
.navbtn.active{border-bottom-color:#1a1a1a;color:#1a1a1a;font-weight:700}
.chip{flex:none;padding:8px 14px;border-radius:19px;border:1px solid #e2ddd3;background:#fff;color:#57534b;font:600 12.5px 'Noto Sans KR';white-space:nowrap;cursor:pointer}
.chip.active{border-color:#1c1a17;background:#1c1a17;color:#fff}
.art{display:flex;align-items:center;gap:16px;padding:18px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
.art:hover h3{color:#000}
.gdoc{color:#3a3a3a;font-size:14px;line-height:1.8}
.gdoc h1{font-size:20px;font-family:'Noto Serif KR',serif;border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin:4px 0 14px}
.gdoc h2{font-size:16px;font-family:'Noto Serif KR',serif;margin:20px 0 9px;border-left:4px solid #1a1a1a;padding-left:10px}
.gdoc h3{font-size:14.5px;font-weight:700;margin:15px 0 6px}
.gdoc h4{font-size:13.5px;font-weight:700;color:#57534b;margin:12px 0 5px}
.gdoc p{margin:8px 0}.gdoc ul,.gdoc ol{margin:8px 0 12px 1.3em;padding:0}.gdoc li{margin:6px 0}.gdoc li.sub{list-style:circle;color:#6c665d}
.gdoc p.src{color:#8c8c8c;font-size:12.5px;background:#faf8f4;border-left:3px solid #d7d2c8;padding:6px 11px;margin:5px 0 10px;border-radius:0 5px 5px 0}
.gdoc table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}.gdoc th,.gdoc td{border:1px solid #e2ddd3;padding:7px 9px;text-align:left;vertical-align:top}.gdoc th{background:#f5f2ec}
.gdoc pre{background:#faf8f4;border:1px solid #ececec;border-radius:6px;padding:12px;white-space:pre-wrap;font-size:12.5px}
.gdoc hr{border:none;border-top:1px solid #ececec;margin:14px 0}
@media(max-width:900px){.hero{margin:0 0 4px!important}.herobox{height:150px!important;border-radius:0!important}.grid{grid-template-columns:1fr!important;gap:22px!important;padding:20px 0 60px!important}.wrap{padding:0 18px!important}nav.topnav{padding:14px 0 0!important;margin:0 18px!important}aside.rail{display:none!important}.herotxt{padding:14px 18px 0!important}.heroctl{left:18px!important;bottom:8px!important}.hero h2{font-size:34px!important;letter-spacing:-1.2px!important}.updbar{display:none!important}.updm{display:block!important}}`;

const BODY = `<div style="min-height:100vh"><div style="max-width:1300px;margin:0 auto">
  <div id="hero" class="hero">
    <div class="herobox" style="position:relative;height:235px;overflow:hidden;background:#111;border-radius:18px">
      <img class="hero-img on" src="img/hero-1.jpg" alt="전국 물리치료사 총궐기대회" style="object-position:center 60%">
      <img class="hero-img" src="img/hero-2.jpg" alt="" style="object-position:center 52%">
      <img class="hero-img" src="img/hero-3.jpg" alt="" style="object-position:center 62%">
      <div style="position:absolute;inset:0;background:linear-gradient(100deg,rgba(10,11,14,.6) 0%,rgba(10,11,14,.28) 48%,rgba(10,11,14,.06) 100%)"></div>
      <div class="herotxt" style="position:absolute;inset:0;padding:30px 48px 0;display:flex;flex-direction:column;justify-content:flex-start">
        <h2 style="margin:0;font-family:'Noto Serif KR',serif;font-weight:700;font-size:64px;line-height:1.14;letter-spacing:-2.2px;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.6),0 4px 34px rgba(0,0,0,.35);max-width:600px;word-break:keep-all">환자의 치료권을<br>지킵니다</h2>
      </div>
      <div class="heroctl" style="position:absolute;left:48px;bottom:10px;display:flex;align-items:center;gap:13px;z-index:3">
        <button id="heroPause" class="heropz" type="button" aria-label="슬라이드 일시정지"></button>
        <div id="heroDots" style="display:flex;align-items:center;gap:7px"></div>
      </div>
    </div>
  </div>
  <nav class="topnav" id="topnav" style="display:flex;padding:18px 0 0;margin:0 40px;border-bottom:1px solid #ececec;overflow-x:auto;overflow-y:hidden"></nav>
  <div class="wrap" style="max-width:none;margin:0;padding:0 40px">
    <div class="grid" id="grid" style="display:grid;grid-template-columns:minmax(0,1fr) 316px;gap:34px;padding:26px 0 70px;align-items:start">
      <div id="center" style="min-width:0"></div>
      <aside class="rail" id="rail" style="position:sticky;top:20px;display:flex;flex-direction:column;gap:16px"></aside>
    </div>
  </div>
</div></div><div id="lb"></div>`;

const CLIENT = `(function(){
"use strict";
var state={sec:'home',channel:'all',gmode:'clinician',gsub:0,gsec:0,gcols:2,nOpen:{},sort:{news:'new',notice:'new',stmt:'new',docs:'new'},buzzKw:'',buzzView:'all4',buzzMetric:'cnt',buzzPeriod:'3개월',buzzSentCh:'community',buzzCntCh:'all',buzzZoom:1,buzzPanelPer:'3개월',newsN:10,imgLB:null,lb:null};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function svg(inner){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:18px;height:18px">'+inner+'</svg>';}
function isNew(a){return /(^7\\.)|(^6\\.30)/.test(a.date)||/시간 전|분 전/.test(a.ago);}
function authorTail(a){return a.author?' · '+a.author+' 기자':'';}
function agoText(a){return a.ago||a.date;}
var NAV=[
 {k:'home',label:'홈',icon:'<path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/>'},
 {k:'news',label:'뉴스',icon:'<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/><line x1="7" y1="17" x2="13" y2="17"/>'},
 {k:'notice',label:'공지사항',icon:'<path d="M12 3a5 5 0 0 0-5 5v4l-1.5 2.5h13L17 12V8a5 5 0 0 0-5-5z"/><path d="M10 19a2 2 0 0 0 4 0"/>'},
 {k:'pet',label:'청원',icon:'<path d="M6 3h8l5 5v13H6z"/><path d="M9 13l2 2 4-4"/>'},
 {k:'docs',label:'자료실',icon:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'},
 {k:'stmt',label:'성명문',icon:'<path d="M4 5h16v11H9l-4 4z"/>'},
 {k:'opin',label:'여론',icon:'<line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="6"/><line x1="18" y1="20" x2="18" y2="10"/>'},
 {k:'guide',label:'가이드',icon:'<path d="M5 4h11l3 3v13H5z"/><line x1="8" y1="9" x2="15" y2="9"/><line x1="8" y1="13" x2="15" y2="13"/>'}
];
var CHANNELS=[{k:'all',l:'전체보기'},{k:'ko',l:'고영준 기자 · 서울일보'},{k:'press',l:'언론 보도'},{k:'ins',l:'보험사 문제'}];
function filtered(){var ch=state.channel;var A=DATA.articles;if(ch==='ko')return A.filter(function(a){return a.ch==='ko';});if(ch==='press')return A.filter(function(a){return a.ch==='press';});if(ch==='ins')return A.filter(function(a){return a.ch==='ins';});return A.slice();}
function renderNav(){var btns=NAV.map(function(n){return '<button class="navbtn'+(state.sec===n.k?' active':'')+'" data-nav="'+n.k+'">'+svg(n.icon)+'<span>'+n.label+'</span></button>';}).join('');var ptsite='<a href="https://ptsite-nine.vercel.app" target="_blank" rel="noopener" style="flex:none;align-self:center;display:inline-flex;align-items:center;gap:6px;margin:0 10px 8px 0;padding:7px 12px;border:1.5px solid #cfd8e2;border-radius:9px;font-size:12.5px;font-weight:700;color:#3a6ea5;text-decoration:none;white-space:nowrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:15px;height:15px"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>물리치료학과 학생들에게</a>';var ktalk='<a href="https://open.kakao.com/o/pCuo1Fzi" target="_blank" rel="noopener" style="flex:none;align-self:center;display:inline-flex;align-items:center;gap:6px;margin:0 0 8px;padding:8px 14px;background:#FEE500;border-radius:10px;font-size:12.5px;font-weight:800;color:#1a1a1a;text-decoration:none;white-space:nowrap"><span style="font-size:14px">💬</span>도수치료 관리급여 저지 단톡방</a>';document.getElementById('topnav').innerHTML=btns+'<span style="flex:1;min-width:10px"></span>'+ptsite+ktalk;}
function applyHero(){document.getElementById('hero').classList.toggle('collapsed',state.sec!=='home');}
function thumb(a){if(!a.img)return '';return '<div style="flex:none;width:90px;height:62px;border-radius:8px;overflow:hidden;background:#eee"><img src="'+a.img+'" alt="" style="width:100%;height:100%;object-fit:cover;object-position:center 32%"></div>';}
function ymd(s){var m=String(s).match(/(\\d{4})\\.(\\d{1,2})\\.(\\d{1,2})/);if(m)return (+m[1])*10000+(+m[2])*100+(+m[3]);var m2=String(s).match(/(\\d{1,2})\\.(\\d{1,2})/);if(m2)return 20260000+(+m2[1])*100+(+m2[2]);return 0;}
function sortIcon(){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:13px;height:13px"><path d="M7 4v15M7 4L4 7M7 4l3 3"/><path d="M17 20V5M17 20l-3-3M17 20l3-3"/></svg>';}
function sortBtn(sec){var v=(state.sort&&state.sort[sec])||'new';return '<button class="chip" data-sort="'+sec+'" style="flex:none;display:inline-flex;align-items:center;gap:5px">'+sortIcon()+(v==='old'?'오래된순':'최신순')+'</button>';}
function newsHTML(){
 var list=filtered();var nso=(state.sort&&state.sort.news)||'new';list.sort(function(a,b){return nso==='old'?String(a.dt).localeCompare(String(b.dt)):String(b.dt).localeCompare(String(a.dt));});var pin=null;list.forEach(function(a){if((a.author||'').indexOf('고영준')>=0&&(!pin||String(a.dt)>String(pin.dt)))pin=a;});var lead,rest;if(pin){lead=pin;rest=list.filter(function(x){return x!==pin;});}else{lead=list[0];rest=list.slice(1);}
 var chips=CHANNELS.map(function(c){return '<button class="chip'+(c.k===state.channel?' active':'')+'" data-chan="'+c.k+'">'+esc(c.l)+'</button>';}).join('');
 var leadHTML='';
 if(lead){
   var li=lead.img?'<img src="'+lead.img+'" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 40%">':'';
   var lb=isNew(lead)?'<span style="position:absolute;left:10px;top:10px;font-size:10px;font-weight:700;color:#fff;background:#d0322a;border-radius:5px;padding:3px 8px;letter-spacing:.5px">NEW</span>':'';
   leadHTML='<a href="'+esc(lead.url)+'" target="_blank" rel="noopener" style="display:flex;flex-wrap:wrap;gap:22px;padding-bottom:24px;margin-bottom:6px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit">'
    +'<div style="flex:1 1 210px;min-width:190px;max-width:280px;position:relative;border-radius:11px;overflow:hidden;background:#eee;aspect-ratio:16/10">'+li+lb+'</div>'
    +'<div style="flex:1 1 300px;min-width:280px;display:flex;flex-direction:column;justify-content:center;gap:11px">'
      +'<div style="font-size:12px;color:var(--sub)"><span style="color:var(--ink);font-weight:700">'+esc(lead.outlet)+'</span>'+esc(authorTail(lead))+' · <span style="color:#d0322a;font-weight:600">'+esc(agoText(lead))+'</span></div>'
      +'<h2 style="margin:0;font-family:\\'Noto Serif KR\\',serif;font-weight:700;font-size:23px;line-height:1.36;letter-spacing:-.5px">'+esc(lead.title)+'</h2>'
      +(lead.summary?'<p style="margin:0;font-size:13.5px;line-height:1.7;color:#5c5850">'+esc(lead.summary)+'</p>':'')
    +'</div></a>';
 }
 var nN=Math.max(1,state.newsN||10);var shown=rest.slice(0,nN-1);var restHTML=shown.map(function(a){
   var badge=isNew(a)?'<span style="align-self:flex-start;font-size:9.5px;font-weight:700;color:#fff;background:#d0322a;border-radius:5px;padding:2px 7px;letter-spacing:.5px">NEW</span>':'';
   return '<a href="'+esc(a.url)+'" target="_blank" rel="noopener" class="art"><div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:7px">'+badge
    +'<h3 style="margin:0;font-family:\\'Noto Serif KR\\',serif;font-weight:600;font-size:16.5px;line-height:1.45;letter-spacing:-.3px">'+esc(a.title)+'</h3>'
    +'<div style="font-size:12px;color:var(--sub)"><span style="color:#6c665d;font-weight:600">'+esc(a.outlet)+'</span>'+esc(authorTail(a))+' · <span style="color:#d0322a;font-weight:600">'+esc(agoText(a))+'</span></div>'
   +'</div>'+thumb(a)+'</a>';
 }).join('');
 var _rem=rest.length-shown.length;var moreBtn=_rem>0?'<div style="display:flex;justify-content:center;margin-top:22px"><button data-more="1" style="cursor:pointer;font:700 13.5px \\'Noto Sans KR\\',sans-serif;color:var(--ink);background:#fff;border:1.5px solid #d9d4ca;border-radius:11px;padding:12px 30px">기사 더보기 <span style="color:#d0322a">+'+Math.min(10,_rem)+'</span> <span style="color:var(--sub);font-weight:600">· 남은 '+_rem+'건</span></button></div>':'';
 return '<div style="display:flex;align-items:center;gap:8px;padding-bottom:4px;margin-bottom:8px;overflow-x:auto">'+sortBtn('news')+chips
  +'<span class="updbar" style="margin-left:auto;flex:none;font-size:12px;color:var(--sub);white-space:nowrap">갱신 '+esc(DATA.updated||'')+'</span></div>'
  +'<div style="position:relative"><div style="position:absolute;top:1px;right:0;z-index:1;text-align:right;line-height:1.35"><span class="updm" style="display:none;font-size:11px;font-weight:600;color:var(--sub)">갱신 '+esc(DATA.updated||'')+'</span><span style="display:block;font-size:12.5px;font-weight:600;color:var(--sub)">'+list.length+'건</span></div>'+leadHTML+restHTML+'</div>'+moreBtn;
}
function petCard(p,strong){
 var badgeStyle=strong?'color:#fff;background:var(--accent)':'color:#7a746c;background:#f0ece5';
 var barColor=strong?'var(--accent)':'#8a857c';var barBg=strong?'#ededed':'#efece5';
 return '<div style="background:#fff;border:1px solid #ececec;border-radius:15px;padding:22px 24px">'
  +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span style="font-size:11.5px;font-weight:700;border-radius:6px;padding:4px 10px;'+badgeStyle+'">D-'+p.dday+' · '+esc(p.dl)+'</span><span style="font-size:12.5px;color:var(--sub)">동의 '+esc(p.count)+'명 · '+p.pct+'%</span></div>'
  +'<h3 style="margin:0 0 10px;font-family:\\'Noto Serif KR\\',serif;font-weight:700;font-size:18px;line-height:1.5;letter-spacing:-.3px">'+esc(p.title)+'</h3>'
  +'<p style="margin:0 0 14px;font-size:13.5px;line-height:1.7;color:#5c5850">'+esc(p.desc)+'</p>'
  +'<div style="height:6px;border-radius:4px;background:'+barBg+';overflow:hidden;margin-bottom:16px"><div style="width:'+p.pct+'%;height:100%;background:'+barColor+'"></div></div>'
  +'<a href="'+esc(p.url)+'" target="_blank" rel="noopener" style="display:inline-block;font-size:13.5px;font-weight:700;'+(strong?'color:#fff;background:var(--accent)':'color:var(--ink);border:1.5px solid #d9d4ca')+';border-radius:10px;padding:11px 22px;text-decoration:none">국회 국민동의청원 참여</a>'
 +'</div>';
}
function petHTML(){return '<div style="display:flex;flex-direction:column;gap:16px">'+DATA.petitions.map(function(p,i){return petCard(p,i===0);}).join('')+'</div>';}
function docsHTML(){
 var dso=(state.sort&&state.sort.docs)||'new';var ds=DATA.docs.slice().sort(function(a,b){var av=ymd(a.org),bv=ymd(b.org);return dso==='old'?av-bv:bv-av;});var rows=ds.map(function(d){return '<a href="'+esc(d.url)+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:15px;padding:18px 22px;border-bottom:1px solid #f1efe9;text-decoration:none;color:inherit">'
  +'<div style="flex:none;width:40px;height:40px;border-radius:10px;background:#eef2f6;color:#3f5a78;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:20px;height:20px"><path d="M7 3h7l4 4v14H7z"/><line x1="10" y1="11" x2="16" y2="11"/><line x1="10" y1="15" x2="16" y2="15"/></svg></div>'
  +'<div style="flex:1;min-width:0"><h3 style="margin:0 0 4px;font-weight:600;font-size:15px;line-height:1.5">'+esc(d.title)+'</h3><div style="font-size:12px;color:var(--sub)">'+esc(d.org)+'</div></div>'
  +'<span style="flex:none;font-size:12.5px;font-weight:600;color:var(--accent)">원문 보기 →</span></a>';}).join('');
 return '<div style="display:flex;margin-bottom:10px">'+sortBtn('docs')+'</div><div style="background:#fff;border:1px solid var(--line);border-radius:15px;overflow:hidden">'+rows+'</div>';
}
function stmtHTML(){
 function badgeH(s,blue){return s.badge?'<span style="flex:none;font-size:10px;font-weight:700;color:'+(blue?'#2f5c8f':'var(--accent)')+';background:'+(blue?'#e9f1fa':'#eeeeee')+';border-radius:5px;padding:2px 7px">'+esc(s.badge)+'</span>':'';}
 function rowH(s,i,bb){return '<a href="#" data-lb="'+i+'" style="display:flex;align-items:center;gap:15px;padding:15px 20px'+(bb?';border-bottom:1px solid #f1efe9':'')+';text-decoration:none;color:inherit">'
   +'<div style="flex:none;width:48px;text-align:center"><div style="font-family:\\'Noto Serif KR\\',serif;font-weight:700;font-size:15px">'+esc(s.date)+'</div></div>'
   +'<div style="flex:1;min-width:0;display:flex;align-items:center;gap:9px;flex-wrap:wrap"><h3 style="margin:0;font-weight:500;font-size:14.5px;line-height:1.5">'+esc(s.org)+'</h3>'+badgeH(s,false)+'</div>'
   +'<span style="flex:none;font-size:12.5px;font-weight:600;color:var(--sub)">성명문 →</span></a>';}
 var pinned=[],rest=[];
 DATA.stmts.forEach(function(s,i){if(s.badge==='최초'||s.badge==='전국학생회')pinned.push([s,i]);else rest.push([s,i]);});
 var sso=(state.sort&&state.sort.stmt)||'new';rest.sort(function(a,b){var av=ymd(a[0].date),bv=ymd(b[0].date);return sso==='old'?av-bv:bv-av;});
 var pinHTML=pinned.map(function(p){return '<div style="border:2px solid #3a6ea5;border-radius:13px;overflow:hidden;margin-bottom:10px;background:#fff;box-shadow:0 2px 10px rgba(58,110,165,.12)">'
   +'<a href="#" data-lb="'+p[1]+'" style="display:flex;align-items:center;gap:15px;padding:15px 20px;text-decoration:none;color:inherit">'
   +'<div style="flex:none;width:48px;text-align:center"><div style="font-family:\\'Noto Serif KR\\',serif;font-weight:700;font-size:15px;color:#2f5c8f">'+esc(p[0].date)+'</div></div>'
   +'<div style="flex:1;min-width:0;display:flex;align-items:center;gap:9px;flex-wrap:wrap"><h3 style="margin:0;font-weight:700;font-size:14.5px;line-height:1.5">'+esc(p[0].org)+'</h3>'+badgeH(p[0],true)+'</div>'
   +'<span style="flex:none;font-size:12.5px;font-weight:700;color:#2f5c8f">성명문 →</span></a></div>';}).join('');
 var restHTML='<div style="background:#fff;border:1px solid var(--line);border-radius:15px;overflow:hidden">'+rest.map(function(p,k){return rowH(p[0],p[1],k<rest.length-1);}).join('')+'</div>';
 return '<div style="display:flex;margin-bottom:10px">'+sortBtn('stmt')+'</div>'+pinHTML+restHTML;
}
function sparkSVG(arr){if(!arr||!arr.length)return '';var w=260,h=42,n=arr.length;var pts=arr.map(function(v,i){var x=(n<2?0:(i/(n-1))*w);var y=h-3-(Math.max(0,Math.min(100,v))/100)*(h-8);return x.toFixed(1)+','+y.toFixed(1);}).join(' ');return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="width:100%;height:42px;display:block"><polyline points="'+pts+'" fill="none" stroke="#c0392b" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';}
function buzzChartSVG(dates, values, color, unit, zoom){
  if(!dates.length||!values.length) return '<div style="color:#8c8c8c;font-size:14px;padding:30px;text-align:center;">데이터 없음</div>';
  var n=dates.length, W=900, H=270, pl=46, pr=18, pt=14, pb=28;
  var mx=Math.max.apply(null, values); if(!(mx>0)) mx=1; var ymax=(Math.ceil(mx/10)*10||10)/(zoom||1); if(ymax<1)ymax=1;
  function X(i){return pl+(n<=1?0:i/(n-1)*(W-pl-pr));}
  function Y(v){return H-pb-(v/ymax)*(H-pt-pb);}
  function fmt(v){v=Math.round(v);return v>=1000?(v/1000).toFixed(v>=10000?0:1)+'k':(''+v);}
  var grid='';
  [0,0.5,1].forEach(function(f){var val=ymax*f;var y=Y(val);grid+='<line x1="'+pl+'" y1="'+y.toFixed(1)+'" x2="'+(W-pr)+'" y2="'+y.toFixed(1)+'" stroke="rgba(0,0,0,.07)"/><text x="'+(pl-6)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" font-size="13" fill="#8c8c8c">'+fmt(val)+'</text>';});
  var dpath=values.map(function(v,i){return (i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1);}).join(' ');
  var area='M'+X(0).toFixed(1)+' '+(H-pb)+' '+values.map(function(v,i){return 'L'+X(i).toFixed(1)+' '+Y(v).toFixed(1);}).join(' ')+' L'+X(n-1).toFixed(1)+' '+(H-pb)+' Z';
  var dots='', hov='', sw=(n>1?(W-pl-pr)/(n-1):W);
  values.forEach(function(v,i){var x=X(i),y=Y(v);if(i%9===0||i===n-1)dots+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="2.6" fill="'+color+'"/>';var dt=(dates[i]||'').slice(5).replace('-','.');var lbl=(unit==='지수')?('지수 '+v):(v.toLocaleString('ko-KR')+'건');hov+='<rect x="'+(x-sw/2).toFixed(1)+'" y="'+pt+'" width="'+sw.toFixed(1)+'" height="'+(H-pt-pb)+'" fill="transparent" data-tip="'+dt+' · '+lbl+'"/>';});
  var xlab='';
  [0,Math.floor(n/4),Math.floor(n/2),Math.floor(n*3/4),n-1].forEach(function(i){var dt=(dates[i]||'').slice(5).replace('-','.');xlab+='<text x="'+X(i).toFixed(1)+'" y="'+(H-9)+'" text-anchor="'+(i===0?'start':i===n-1?'end':'middle')+'" font-size="13" fill="#8c8c8c">'+dt+'</text>';});
  return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;overflow:hidden;"><defs><linearGradient id="bzg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+color+'" stop-opacity="0.28"/><stop offset="1" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>'+grid+'<path d="'+area+'" fill="url(#bzg)" stroke="none"/><path d="'+dpath+'" fill="none" stroke="'+color+'" stroke-width="2.2" stroke-linejoin="round"/>'+dots+xlab+hov+'</svg>';
}
function buzzMultiSVG(dates, series, unit, hourly, zoom){
  if(!dates.length||!series.length) return '<div style="color:#8c8c8c;font-size:14px;padding:30px;text-align:center;">데이터 없음</div>';
  var n=dates.length, W=900,H=270,pl=46,pr=18,pt=14,pb=28;
  var mx=0; series.forEach(function(s){(s.values||[]).forEach(function(v){if(v>mx)mx=v;});}); if(!(mx>0))mx=1; var ymax=(Math.ceil(mx/10)*10||10)/(zoom||1); if(ymax<1)ymax=1;
  function X(i){return pl+(n<=1?0:i/(n-1)*(W-pl-pr));}
  function Y(v){return H-pb-(v/ymax)*(H-pt-pb);}
  function fmt(v){v=Math.round(v);return v>=1000?(v/1000).toFixed(v>=10000?0:1)+'k':(''+v);}
  var grid='';
  [0,0.5,1].forEach(function(f){var val=ymax*f;var y=Y(val);grid+='<line x1="'+pl+'" y1="'+y.toFixed(1)+'" x2="'+(W-pr)+'" y2="'+y.toFixed(1)+'" stroke="rgba(0,0,0,.07)"/><text x="'+(pl-6)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" font-size="13" fill="#8c8c8c">'+fmt(val)+'</text>';});
  var lines='';
  series.forEach(function(s){var vals=s.values||[];var d=vals.map(function(v,i){return (i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1);}).join(' ');lines+='<path d="'+d+'" fill="none" stroke="'+s.color+'" stroke-width="2.2" stroke-linejoin="round"/>';vals.forEach(function(v,i){if(n<=31||i===n-1){lines+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="'+(n<=2?3.6:2.6)+'" fill="'+s.color+'"/>';}});});
  var hov='', sw=(n>1?(W-pl-pr)/(n-1):W);
  for(var i=0;i<n;i++){var dt=hourly?(dates[i]||'').slice(5):(dates[i]||'').slice(5).replace('-','.');var parts=series.map(function(s){return s.name+' '+((s.values||[])[i]||0);}).join(' · ');hov+='<rect x="'+(X(i)-sw/2).toFixed(1)+'" y="'+pt+'" width="'+sw.toFixed(1)+'" height="'+(H-pt-pb)+'" fill="transparent" data-tip="'+dt+' · '+parts+'"/>';}
  var xlab='';
  [0,Math.floor(n/4),Math.floor(n/2),Math.floor(n*3/4),n-1].forEach(function(i){var dt=hourly?((dates[i]||'').split(' ')[1]||''):(dates[i]||'').slice(5).replace('-','.');xlab+='<text x="'+X(i).toFixed(1)+'" y="'+(H-9)+'" text-anchor="'+(i===0?'start':i===n-1?'end':'middle')+'" font-size="13" fill="#8c8c8c">'+dt+'</text>';});
  return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;overflow:hidden;">'+grid+lines+xlab+hov+'</svg>';
}
function __renderD3Cloud(){var el=document.getElementById('d3cloud');if(!el)return;var CL=(window.d3&&window.d3.layout&&window.d3.layout.cloud)||(window.layout&&window.layout.cloud);if(!CL)return;var W=el.clientWidth||el.offsetWidth,H=el.clientHeight||el.offsetHeight;if(!W||!H)return;var raw;try{raw=JSON.parse(decodeURIComponent(el.dataset.w||'[]'));}catch(e){return;}if(!raw.length){el.innerHTML='';return;}var key='fg:'+W+'x'+H+':'+(el.dataset.w||'');if(window.__cloudCache&&window.__cloudCache.key===key){el.innerHTML=window.__cloudCache.svg;return;}var vals=raw.map(function(r){return r[1];}),mx=Math.max.apply(null,vals),mn=Math.min.apply(null,vals);var maxF;function fz(v){var t=(mx===mn)?1:(Math.sqrt(v)-Math.sqrt(mn))/(Math.sqrt(mx)-Math.sqrt(mn));return Math.round(13+t*(maxF-13));}function col(p){return p>0?'#8B5CF6':(p<0?'#E2403A':'#E0C04A');}function bbox(out){var a=1e9,b=-1e9;out.forEach(function(d){var hw=(''+d.text).length*d.size*0.5;if(d.x-hw<a)a=d.x-hw;if(d.x+hw>b)b=d.x+hw;});return {a:a,b:b};}var defs=[['pos',raw.filter(function(r){return r[2]>0;}),W*0.46],['neu',raw.filter(function(r){return r[2]===0;}),W*0.30],['neg',raw.filter(function(r){return r[2]<0;}),W*0.46]];var gMaxF=Math.min(46,Math.round(H*0.44)),fitc=defs.filter(function(d){return d[1].length;}).map(function(d){var bw=Math.max(40,d[2]);return Math.sqrt(0.58*bw*H/(0.75*d[1].length));});maxF=Math.max(18,Math.min.apply(null,[gMaxF].concat(fitc)));var R={},pending=0;defs.forEach(function(d){if(d[1].length)pending++;});if(!pending){el.innerHTML='';return;}function finish(){var cx=W/2,gap=14,parts=[];function emit(res,off){if(!res)return;res.out.forEach(function(d){var ax=(off+d.x).toFixed(1),ay=(H/2+d.y).toFixed(1);parts.push('<text text-anchor="middle" dy="0.32em" transform="translate('+ax+','+ay+')" font-family="Noto Sans KR, sans-serif" font-weight="'+(d.value/mx>0.5?900:700)+'" font-size="'+d.size+'" fill="'+col(d.p)+'">'+esc(d.text)+'</text>');});}var offN=cx;var posRT=R.neu?(offN+R.neu.bb.a-gap):(cx-gap/2);var offP=R.pos?(posRT-R.pos.bb.b):0;var negLT=R.neu?(offN+R.neu.bb.b+gap):(cx+gap/2);var offNg=R.neg?(negLT-R.neg.bb.a):0;if(R.pos&&offP+R.pos.bb.a<4)offP=4-R.pos.bb.a;if(R.neg&&offNg+R.neg.bb.b>W-4)offNg=W-4-R.neg.bb.b;emit(R.pos,offP);emit(R.neu,offN);emit(R.neg,offNg);var svg='<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="display:block;">'+parts.join('')+'</svg>';window.__cloudCache={key:key,svg:svg};var e2=document.getElementById('d3cloud');if(e2)e2.innerHTML=svg;}defs.forEach(function(d){if(!d[1].length)return;var words=d[1].map(function(r){return {text:r[0],value:r[1],p:r[2],size:fz(r[1])};});CL().size([Math.max(40,d[2]),H]).words(words).padding(1).spiral('archimedean').rotate(0).font('Noto Sans KR, sans-serif').fontSize(function(w){return w.size;}).on('end',function(out){R[d[0]]={out:out,bb:bbox(out)};if(--pending===0)finish();}).start();});}
window.__renderD3Cloud=__renderD3Cloud;
function buzzPanel(){
  var b=DATA.buzz||{};
  var COL={'도수치료':'#E2403A','관리급여':'#5B86C8','실손보험':'#46C088','체외충격파':'#E0922C','물리치료사':'#2BB8C4'};
  var keys=(b.keywords)||['도수치료'];
  var kw=(state.buzzKw&&keys.indexOf(state.buzzKw)>=0)?state.buzzKw:keys[0];
  var view=(['cnt','senti'].indexOf(state.buzzView)>=0)?state.buzzView:'all4';
  var col=COL[kw]||'#5B86C8';
  var nv=b.naver||{};
  var dl=(nv.datalab&&nv.datalab.dates&&nv.datalab.dates.length)?nv.datalab:{dates:(b.trend&&b.trend.dates)||[],series:(b.trend&&b.trend.series)||{}};
  var totals=(nv.totals&&nv.totals[kw])||{};
  function nf(n){return (n||0).toLocaleString('ko-KR');}
  var OFF='border:1px solid #e2ddd3;background:#fff;color:#57534b';
  var tabs=keys.map(function(k){var on=(view!=='all4')&&(k===kw);var c=COL[k]||'#5B86C8';return '<button data-act="buzzkw" data-kw="'+esc(k)+'" style="flex:none;cursor:pointer;font-size:13px;font-weight:700;padding:6px 12px;border-radius:8px;white-space:nowrap;'+(on?'border:1px solid '+c+';background:'+c+';color:#fff':OFF)+';">'+esc(k)+'</button>';}).join('');
  var allBtn='<button data-act="buzzview" data-view="all4" style="flex:none;cursor:pointer;font-size:13px;font-weight:700;padding:6px 12px;border-radius:8px;white-space:nowrap;'+(view==='all4'?'border:1px solid #1a1a1a;background:#1a1a1a;color:#fff':OFF)+';">종합</button>';
  var PER={'1일':1,'1주일':7,'1개월':30,'3개월':90,'6개월':180,'1년':365};
  var PORDER=['1일','1주일','1개월','3개월'];
  var metric=(['cnt','nidx','gidx'].indexOf(state.buzzMetric)>=0)?state.buzzMetric:'cnt';
  var zoom=+state.buzzZoom||1;if(zoom<1)zoom=1;
  var zoomCtl='<div style="position:absolute;top:8px;right:10px;display:flex;align-items:center;gap:5px;z-index:3;"><button data-act="buzzzoom" data-z="out" style="cursor:pointer;width:26px;height:26px;border-radius:7px;border:1px solid #e2ddd3;background:#fff;color:#57534b;font-size:16px;font-weight:800;line-height:1;padding:0;">−</button>'+(zoom>1?'<span style="font-size:11px;font-weight:700;color:#8c8c8c;background:#fff;border:1px solid #e2ddd3;padding:3px 7px;border-radius:6px;">×'+zoom+'</span>':'')+'<button data-act="buzzzoom" data-z="in" style="cursor:pointer;width:26px;height:26px;border-radius:7px;border:1px solid #e2ddd3;background:#fff;color:#57534b;font-size:16px;font-weight:800;line-height:1;padding:0;">+</button></div>';
  var daily=(nv.channel_daily&&nv.channel_daily[kw])||[];
  var gtr=(b.trend)||{dates:[],series:{}};
  if(metric==='gidx'&&!(gtr.dates&&gtr.dates.length))metric='cnt';
  function spanOf(ds){if(!ds||!ds.length)return 0;return Math.round((Date.parse(ds[ds.length-1])-Date.parse(ds[0]))/86400000)+1;}
  var spanDays=(metric==='cnt')?spanOf(daily.map(function(x){return x.date;})):(metric==='gidx')?spanOf(gtr.dates||[]):spanOf((dl.dates)||[]);
  var availPers=PORDER.filter(function(p){return PER[p]<=Math.max(1,spanDays)+2;});
  if(!availPers.length)availPers=['1일'];
  var per=(state.buzzPeriod&&availPers.indexOf(state.buzzPeriod)>=0)?state.buzzPeriod:(availPers.indexOf('3개월')>=0?'3개월':availPers[availPers.length-1]);
  var chartInner='', legend='', unit='건';
  if(metric==='cnt'){
    var isHr=(per==='1일');
    var rows;
    if(isHr){var hsrc=(nv.hourly&&nv.hourly[kw])||[];rows=hsrc.map(function(pc,hi){var pa=hi>0?hsrc[hi-1]:null;var sd=pa&&(pa.t||'').slice(0,10)===(pc.t||'').slice(0,10);return {t:pc.t,news:sd?Math.max(0,(pc.news||0)-(pa.news||0)):(pc.news||0),blog:sd?Math.max(0,(pc.blog||0)-(pa.blog||0)):(pc.blog||0),cafe:sd?Math.max(0,(pc.cafe||0)-(pa.cafe||0)):(pc.cafe||0)};});}else{rows=daily.slice(Math.max(0,daily.length-PER[per]));}
    var cdates=rows.map(function(x){return isHr?x.t:x.date;});
    var CCH=[['all','전체'],['news','뉴스'],['blog','블로그'],['cafe','카페']];
    var cch=(state.buzzCntCh&&CCH.some(function(x){return x[0]===state.buzzCntCh;}))?state.buzzCntCh:'all';
    var allser=[{name:'뉴스',color:'#5B86C8',key:'news',values:rows.map(function(x){return x.news||0;})},{name:'블로그',color:'#46C088',key:'blog',values:rows.map(function(x){return x.blog||0;})},{name:'카페',color:'#E0922C',key:'cafe',values:rows.map(function(x){return x.cafe||0;})}];
    var cser=(cch==='all')?allser:allser.filter(function(s){return s.key===cch;});
    var cchBtns=CCH.map(function(x){var on=x[0]===cch;var cc=x[0]==='news'?'#5B86C8':x[0]==='blog'?'#46C088':x[0]==='cafe'?'#E0922C':'#1a1a1a';return '<button data-act="buzzcntch" data-cch="'+x[0]+'" style="flex:none;cursor:pointer;font-size:12px;font-weight:700;padding:3px 11px;border-radius:7px;'+(on?'border:1px solid '+cc+';background:'+cc+';color:#fff':OFF)+';">'+x[1]+'</button>';}).join('');
    legend='<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:4px 2px 7px;">'+cchBtns+'</div>';
    chartInner=buzzMultiSVG(cdates, cser, '건', isHr, zoom);
  } else {
    if(per==='1일'){chartInner='<div style="color:#8c8c8c;font-size:13px;padding:34px 16px;text-align:center;line-height:1.6;">검색 지수는 일(日) 단위 상대지수예요. 1주일 이상을 선택해 주세요.</div>';unit='지수';}
    else {var srcD,srcV;if(metric==='gidx'){srcD=gtr.dates||[];srcV=(gtr.series&&gtr.series[kw])||[];unit='지수';}else{srcD=dl.dates||[];srcV=(dl.series&&dl.series[kw])||[];unit='지수';}var ss=Math.max(0,srcD.length-PER[per]);chartInner=buzzChartSVG(srcD.slice(ss),srcV.slice(ss),col,unit,zoom);}
  }
  var perBtns=availPers.map(function(p){var on=p===per;return '<button data-act="buzzper" data-per="'+p+'" style="flex:none;cursor:pointer;font-size:12px;font-weight:700;padding:4px 10px;border-radius:7px;'+(on?'border:1px solid '+col+';background:'+col+';color:#fff':OFF)+';">'+p+'</button>';}).join('');
  var metBtns=[['cnt','언급 건수',true],['nidx','네이버 지수',!!(dl.dates&&dl.dates.length)],['gidx','구글 지수',!!(gtr.dates&&gtr.dates.length)]].filter(function(m){return m[2];}).map(function(m){var on=metric===m[0];return '<button data-act="buzzmetric" data-met="'+m[0]+'" style="flex:none;cursor:pointer;font-size:12.5px;font-weight:700;padding:5px 11px;border-radius:7px;'+(on?'border:1px solid '+col+';background:'+col+';color:#fff':OFF)+';">'+m[1]+'</button>';}).join('');
  var chartNote=(metric==='cnt')?'':'<div style="font-size:11.5px;color:#8c8c8c;margin:0 0 12px;line-height:1.5;">※ 검색량 상대지수(표시 기간 내 최다일=100). 실제 검색 횟수가 아니라 관심도 추이예요.</div>';
  var chart='<div style="position:relative;border:1px solid #ececec;border-radius:12px;padding:6px 8px 2px;background:#faf9f6;margin-bottom:8px;">'+zoomCtl+legend+chartInner+'</div>'+chartNote;
  var cdAll=nv.channel_daily||{}, hrAll=nv.hourly||{};
  var sumIsHr=(per==='1일'); var sumDates, sumSer;
  if(sumIsHr){var h0=hrAll[keys[0]]||[];sumDates=h0.map(function(x){return x.t;});sumSer=keys.map(function(k){var hh=hrAll[k]||[];return {name:k,color:COL[k]||'#5B86C8',values:hh.map(function(c,i){var ct=(c.news||0)+(c.blog||0)+(c.cafe||0);if(i===0)return ct;var a=hh[i-1];var at=(a.news||0)+(a.blog||0)+(a.cafe||0);return ((a.t||'').slice(0,10)===(c.t||'').slice(0,10))?Math.max(0,ct-at):ct;})};});}
  else{var sliceN=PER[per]||90;var sumRef=(cdAll[keys[0]]||[]);sumRef=sumRef.slice(Math.max(0,sumRef.length-sliceN));sumDates=sumRef.map(function(x){return x.date;});sumSer=keys.map(function(k){var rs=(cdAll[k]||[]);rs=rs.slice(Math.max(0,rs.length-sliceN));return {name:k,color:COL[k]||'#5B86C8',values:rs.map(function(x){return x.total||0;})};});}
  var sumLegend='<div style="display:flex;flex-wrap:wrap;gap:14px;margin:4px 2px 7px;font-size:12.5px;font-weight:700;">'+keys.map(function(k){return '<span style="color:'+(COL[k]||'#5B86C8')+';">● '+esc(k)+'</span>';}).join('')+'</div>';
  var sumChart='<div style="position:relative;border:1px solid #ececec;border-radius:12px;padding:6px 8px 2px;background:#faf9f6;margin-bottom:8px;">'+zoomCtl+sumLegend+buzzMultiSVG(sumDates,sumSer,'건',sumIsHr,zoom)+'</div>';
  var sentiRaw=(nv.sentiment&&nv.sentiment[kw])||[];
  var sentiCh=Array.isArray(sentiRaw)?{community:sentiRaw}:(sentiRaw||{});
  if(!sentiCh.community&&sentiCh.all)sentiCh.community=sentiCh.all;
  var SCH=[['community','전체'],['blog','블로그'],['cafe','커뮤니티']];
  var sch=(state.buzzSentCh&&SCH.some(function(x){return x[0]===state.buzzSentCh;}))?state.buzzSentCh:'community';
  var senti=sentiCh[sch]||sentiCh.community||[];
  var schBtns=SCH.map(function(x){var avail=!!(sentiCh[x[0]]&&sentiCh[x[0]].length);var on=x[0]===sch;return '<button data-act="buzzsent" data-sch="'+x[0]+'"'+(avail?'':' disabled')+' style="flex:none;cursor:'+(avail?'pointer':'default')+';font-size:12px;font-weight:700;padding:4px 11px;border-radius:7px;'+(on?'border:1px solid '+col+';background:'+col+';color:#fff':(avail?OFF:'border:1px solid #eee;background:#fafafa;color:#c9c4ba'))+';">'+x[1]+'</button>';}).join('');
  var cloud='<div id="d3cloud" data-w="'+encodeURIComponent(JSON.stringify(senti.map(function(x){return [x.w,x.c,x.p];})))+'" style="position:absolute;inset:0;"></div>';
  var posN=senti.filter(function(x){return x.p>0;}).length, negN=senti.filter(function(x){return x.p<0;}).length, neuN=senti.filter(function(x){return x.p===0;}).length;
  var weeks=(nv.related_weeks&&nv.related_weeks[kw])||[];
  function rankMap(items){var m={};(items||[]).forEach(function(it,i){m[it.w]=i;});return m;}
  var wcols=weeks.map(function(wk,wi){var prev=wi>0?rankMap(weeks[wi-1].items):null;var rws=(wk.items||[]).slice(0,15).map(function(it,i){var delta='';if(prev){if(!(it.w in prev))delta='<span style="color:#E2403A;font-weight:800;font-size:9px;">NEW</span>';else{var d=prev[it.w]-i;delta=d>0?'<span style="color:#E2403A;">▲'+d+'</span>':(d<0?'<span style="color:#5B86C8;">▼'+(-d)+'</span>':'<span style="color:#c9c4ba;">-</span>');}}return '<div style="display:flex;align-items:center;gap:4px;font-size:13px;padding:2px 0;"><span style="flex:none;width:13px;color:#a3a3a3;font-weight:800;">'+(i+1)+'</span><span style="flex:1;min-width:0;color:#1a1a1a;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(it.w)+'</span><span style="flex:none;width:26px;text-align:right;color:#8c8c8c;">'+it.c+'</span><span style="flex:none;width:22px;text-align:right;font-weight:800;">'+delta+'</span></div>';}).join('');return '<div style="flex:1;min-width:150px;border:1px solid #ececec;border-radius:12px;padding:10px 11px;background:#faf9f6;overflow:hidden;"><div style="font-size:13.5px;font-weight:800;color:'+col+';margin-bottom:8px;">'+esc(wk.label)+' <span style="font-size:11px;font-weight:600;color:#a3a3a3;">주</span></div>'+rws+'</div>';}).join('')||'<div style="color:#a3a3a3;font-size:13px;padding:10px;">데이터 없음</div>';
  function wkAhead(o){var d=new Date();d.setDate(d.getDate()+o*7);var dow=(d.getDay()+6)%7;var mo=new Date(d);mo.setDate(d.getDate()-dow);var su=new Date(mo);su.setDate(mo.getDate()+6);function f(x){return (x.getMonth()+1)+'.'+x.getDate();}return f(mo)+'~'+f(su);}
  var futWk='',_need=Math.max(0,4-weeks.length);for(var fo=1;fo<=_need;fo++){futWk+='<div style="flex:1;min-width:150px;border:1px dashed #e2ddd3;border-radius:12px;padding:11px 13px;background:#faf9f6;display:flex;flex-direction:column;"><div style="font-size:13.5px;font-weight:800;color:#a3a3a3;margin-bottom:8px;">'+wkAhead(fo)+' <span style="font-size:11px;font-weight:600;color:#c9c4ba;">주(예정)</span></div><div style="flex:1;display:flex;align-items:center;justify-content:center;color:#c9c4ba;font-size:12px;font-weight:600;text-align:center;line-height:1.6;">데이터<br>쌓이는 중</div></div>';}
  var panelPer=(state.buzzPanelPer&&['1주일','1개월','3개월'].indexOf(state.buzzPanelPer)>=0)?state.buzzPanelPer:'3개월';
  var panelPerBtns=['1주일','1개월','3개월'].map(function(p){var on=p===panelPer;return '<button data-act="buzzpanelper" data-pp="'+p+'" style="flex:1;cursor:pointer;font-size:10.5px;font-weight:700;padding:3px 0;border-radius:6px;'+(on?'border:1px solid '+col+';background:'+col+';color:#fff':OFF)+';">'+p+'</button>';}).join('');
  var dsel=daily.slice(Math.max(0,daily.length-PER[panelPer]));
  var pN=dsel.reduce(function(a,x){return a+(x.news||0);},0), pB=dsel.reduce(function(a,x){return a+(x.blog||0);},0), pC=dsel.reduce(function(a,x){return a+(x.cafe||0);},0);
  var cntPanel='<div style="flex:none;width:168px;border:1px solid #ececec;border-radius:12px;padding:12px 13px;background:#faf9f6;display:flex;flex-direction:column;gap:6px;"><div style="font-size:12px;font-weight:700;color:#8c8c8c;">최근 언급량</div><div style="display:flex;gap:4px;">'+panelPerBtns+'</div>'+[['뉴스',pN,'#5B86C8'],['블로그',pB,'#46C088'],['카페',pC,'#E0922C']].map(function(r){return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;padding:4px 0;border-top:1px solid #ececec;"><span style="font-size:12.5px;color:#57534b;font-weight:700;">'+r[0]+'</span><span style="font-size:16px;font-weight:800;color:'+r[2]+';">'+nf(r[1])+'</span></div>';}).join('')+'<div style="font-size:11px;font-weight:700;color:#a3a3a3;border-top:1px solid #e2ddd3;padding-top:7px;">전체 누적</div>'+[['블로그','blog'],['뉴스','news'],['네이버 카페','cafe']].map(function(r){return '<div style="display:flex;justify-content:space-between;gap:6px;padding:2px 0;"><span style="font-size:12px;color:#8c8c8c;font-weight:600;">'+r[0]+'</span><span style="font-size:13px;font-weight:700;color:#57534b;">'+nf(totals[r[1]])+'</span></div>';}).join('')+'</div>';
  var VIEWS=[['cnt','언급 추이'],['senti','긍·부정 연관어']];
  var viewBtns=VIEWS.map(function(x){var on=x[0]===view;return '<button data-act="buzzview" data-view="'+x[0]+'" style="flex:none;cursor:pointer;font-size:13px;font-weight:700;padding:6px 12px;border-radius:8px;'+(on?'border:1px solid #1a1a1a;background:#1a1a1a;color:#fff':OFF)+';">'+x[1]+'</button>';}).join('');
  var body=''
    +(view!=='all4'?('<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px;border-bottom:1px solid #ececec;padding-bottom:8px;">'+viewBtns+'</div>'):'')
    +(view==='all4'?('<div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:0 0 8px;"><h3 style="margin:0;font-size:14px;font-weight:800;color:#1a1a1a;">종합 <span style="font-size:12px;font-weight:600;color:#8c8c8c;">· 키워드별 언급 추이</span></h3><span style="flex:1;"></span>'+perBtns+'</div>'+sumChart):'')
    +(view==='cnt'?('<div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:0 0 8px;"><h3 style="margin:0;font-size:14px;font-weight:800;color:#1a1a1a;">'+(metric==='cnt'?'언급 추이':metric==='gidx'?'구글 검색 지수':'네이버 검색 지수')+'</h3><span style="flex:1;"></span>'+metBtns+'<span style="flex:none;width:6px;"></span>'+perBtns+'</div>'+chart):'')
    +(view==='senti'?('<div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:0 0 7px;"><h3 style="margin:0;font-size:14px;font-weight:800;color:#1a1a1a;">긍·부정 연관어</h3>'+schBtns+'</div>'
      +'<div style="display:flex;gap:18px;align-items:stretch;margin-bottom:12px;height:300px;"><div style="flex:none;display:flex;flex-direction:column;justify-content:center;gap:10px;font-size:13.5px;font-weight:800;line-height:1;"><span style="color:#8B5CF6;">긍정어 '+posN+'</span><span style="color:#E2403A;">부정어 '+negN+'</span><span style="color:#C99A22;">중립어 '+neuN+'</span></div><div style="position:relative;flex:1;min-width:0;overflow:hidden;border:1px solid #ececec;border-radius:12px;background:#faf9f6;">'+cloud+'</div></div>'
      +'<h3 style="margin:0 0 8px;font-size:14px;font-weight:800;color:#1a1a1a;">연관어 순위변화</h3>'
      +'<div style="display:flex;gap:14px;align-items:stretch;overflow-x:auto;">'+cntPanel+'<div style="flex:1;min-width:0;display:flex;gap:12px;">'+wcols+futWk+'</div></div>'):'');
  return '<div style="border:1px solid var(--line);border-radius:16px;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.05);overflow:hidden">'
    +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px;background:#faf8f4;border-bottom:1px solid #ececec;"><span style="flex:none;display:flex;flex-wrap:wrap;gap:6px;">'+allBtn+tabs+'</span><span style="flex:1;"></span><span style="font-size:12px;color:#8c8c8c;font-weight:600;white-space:nowrap;">'+esc(b.updated||'')+' 기준</span></div>'
    +'<div style="padding:14px 16px 18px;">'+body+'</div>'
  +'</div>';
}
function opinHTML(){return buzzPanel();}
function guideHTML(){
 var g=DATA.guide;var mode=g[state.gmode]?state.gmode:'clinician';var cat=g[mode];
 var modeChips=[['clinician','치료사용'],['patient','환자용']].map(function(m){return '<button class="chip'+(m[0]===mode?' active':'')+'" data-gmode="'+m[0]+'">'+m[1]+'</button>';}).join('');
 var imgCss='width:100%;height:auto;display:block;border:1px solid #ececec;border-radius:8px;background:#fff';
 var dlIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:15px;height:15px"><path d="M12 4v11M8 12l4 4 4-4"/><path d="M5 19h14"/></svg>';
 if(mode==='patient'){
  var items=cat.items||[];
  var cells=items.map(function(it){return '<div><img src="'+esc(it.img)+'" data-img="'+esc(it.img)+'" alt="" loading="lazy" style="cursor:zoom-in;'+imgCss+'"><div style="text-align:center;margin-top:9px"><a href="'+esc(it.img)+'" download style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--ink);border:1.5px solid #d9d4ca;border-radius:9px;padding:9px 16px;text-decoration:none">'+dlIcon+esc(it.label)+' 환자용 이미지 저장</a></div></div>';}).join('');
  return '<div style="display:flex;gap:7px;margin-bottom:12px;flex-wrap:wrap">'+modeChips+'</div>'
   +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start">'+cells+'</div>';
 }
 var subs=cat.subs||[];var si=Math.max(0,Math.min(subs.length-1,state.gsub||0));var sub=subs[si]||{pages:[]};
 var subChips=subs.map(function(sb,i){return '<button class="chip'+(i===si?' active':'')+'" data-gsub="'+i+'">'+esc(sb.label)+'</button>';}).join('');
 var pdfBtn=sub.pdf?'<a href="'+esc(sub.pdf)+'" download style="flex:none;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--ink);border:1.5px solid #d9d4ca;border-radius:9px;padding:8px 14px;text-decoration:none">'+dlIcon+'PDF 내려받기</a>':'';
 var imgs=(sub.pages||[]).map(function(p){return '<img src="'+esc(p)+'" data-img="'+esc(p)+'" alt="" loading="lazy" style="cursor:zoom-in;'+imgCss+'">';}).join('');
 if(!imgs)imgs='<div style="padding:36px;text-align:center;color:var(--sub);font-size:13px">준비 중입니다</div>';
 return '<div style="display:flex;gap:7px;margin-bottom:8px;flex-wrap:wrap">'+modeChips+'</div>'
  +'<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:10px">'+subChips+'<span style="flex:1"></span>'+pdfBtn+'</div>'
  +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start">'+imgs+'</div>';
}
function noticeHTML(){
 var so=(state.sort&&state.sort.notice)||'new';
 var arr=DATA.notices.map(function(n,i){return {n:n,i:i};}).sort(function(a,b){var av=ymd(a.n.date),bv=ymd(b.n.date);return so==='old'?av-bv:bv-av;});
 var cards=arr.map(function(o,pos){
  var n=o.n,i=o.i,open=!!state.nOpen[i];
  var head='<button type="button" data-nopen="'+i+'" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;padding:16px 20px;display:flex;align-items:flex-start;gap:10px">'
   +'<span style="flex:none;width:72px;box-sizing:border-box;text-align:center;white-space:nowrap;font-size:11px;font-weight:700;color:#fff;background:'+esc(n.color||'#555')+';border-radius:6px;padding:3px 4px;line-height:1.55">'+esc(n.badge)+'</span>'
   +'<span style="flex:none;width:34px;font-size:12px;color:var(--sub);line-height:1.85">'+esc(n.date)+'</span>'
   +'<span style="flex:1;min-width:0;font-family:\\'Noto Serif KR\\',serif;font-weight:700;font-size:15.5px;line-height:1.45;color:var(--ink)">'+esc(n.title)+'</span>'
   +'<span style="flex:none;color:var(--sub);font-size:11px">'+(open?'▲':'▼')+'</span></button>';
  var body='';
  if(open){
   var bodyText=esc(n.body||'').split('\\n\\n').map(function(para){return '<p style="margin:0 0 10px;font-size:13.5px;line-height:1.78;color:#4a463f">'+para.split('\\n').join('<br>')+'</p>';}).join('');
   var img=n.img?'<a href="'+esc(n.img)+'" target="_blank" rel="noopener" style="display:block;margin-top:8px"><img src="'+esc(n.img)+'" alt="" loading="lazy" style="max-width:420px;width:100%;height:auto;border-radius:10px;border:1px solid #ececec"></a>':'';
   body='<div style="padding:0 20px 18px;border-top:1px solid #f4f2ec">'+bodyText+img+'</div>';
  }
  return '<div style="background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden'+(pos<arr.length-1?';margin-bottom:10px':'')+'">'+head+body+'</div>';
 }).join('');
 return '<div style="display:flex;margin-bottom:10px">'+sortBtn('notice')+'</div>'+cards;
}
function renderCenter(){var s=state.sec,h;
 if(s==='home'||s==='news')h=newsHTML();else if(s==='notice')h=noticeHTML();else if(s==='pet')h=petHTML();else if(s==='docs')h=docsHTML();
 else if(s==='stmt')h=stmtHTML();else if(s==='opin')h=opinHTML();else if(s==='guide')h=guideHTML();else h=newsHTML();
 document.getElementById('center').innerHTML=h;if(state.sec==='opin'){try{if(window.__renderD3Cloud)window.__renderD3Cloud();}catch(_){}}
}
function renderRail(){
 var pets=DATA.petitions.map(function(p,i){var strong=i===0;
  return '<a href="'+esc(p.url)+'" target="_blank" rel="noopener" style="display:block;padding:10px 0'+(i<DATA.petitions.length-1?';border-bottom:1px solid #f1efe9':'')+';text-decoration:none;color:inherit">'
   +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><span style="font-size:10px;font-weight:700;border-radius:4px;padding:2px 6px;'+(strong?'color:#fff;background:var(--accent)':'color:#7a746c;background:#f0ece5')+'">D-'+p.dday+'</span><span style="font-size:11px;color:var(--sub)">'+esc(p.count)+'명 · '+p.pct+'%</span></div>'
   +'<p style="margin:0 0 7px;font-size:12px;line-height:1.45;font-weight:500">'+esc(p.title)+'</p>'
   +'<div style="height:4px;border-radius:3px;background:#ededed;overflow:hidden"><div style="width:'+p.pct+'%;height:100%;background:'+(strong?'var(--accent)':'#8a857c')+'"></div></div></a>';}).join('');
 var NN=(DATA.notices||[]).slice(0,5);
 var noticeRows=NN.length?NN.map(function(n,i){return '<a href="#" data-nav="notice" style="display:flex;align-items:flex-start;gap:9px;padding:9px 0'+(i<NN.length-1?';border-bottom:1px solid #f1efe9':'')+';text-decoration:none;color:inherit">'
   +'<span style="flex:none;width:54px;box-sizing:border-box;text-align:center;white-space:nowrap;font-size:10px;font-weight:700;color:#fff;background:'+esc(n.color||'#555')+';border-radius:4px;padding:2px 4px;line-height:1.5">'+esc(n.badge)+'</span>'
   +'<span style="flex:1;min-width:0;font-size:12px;line-height:1.5;color:#3a372f">'+esc(n.title)+'</span></a>';}).join(''):'';
 document.getElementById('rail').innerHTML=
  '<div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px"><div style="display:flex;align-items:center;gap:7px;margin-bottom:10px"><span style="width:6px;height:6px;border-radius:50%;background:var(--accent)"></span><h3 style="margin:0;font-weight:700;font-size:13px">진행 중 청원</h3></div>'+pets+'</div>'
  +'<div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px"><h3 style="margin:0'+(noticeRows?' 0 6px':'')+';font-weight:700;font-size:13px">공지사항</h3>'+noticeRows+'</div>';
}
function renderLB(){
 var el=document.getElementById('lb');
 if(state.imgLB){el.innerHTML='<div data-lbx="1" style="position:fixed;inset:0;z-index:200;background:rgba(20,18,15,.92);display:flex;flex-direction:column;overflow:auto;padding:0 0 40px"><div style="position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 18px;background:rgba(20,18,15,.55);backdrop-filter:blur(6px)"><span style="color:rgba(255,255,255,.85);font-size:12.5px;font-weight:600">클릭하면 원본 크기로 볼 수 있어요 · 바깥을 누르면 닫힘</span><button data-lbx="1" style="border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:8px;cursor:pointer">닫기 ✕</button></div><div style="display:flex;justify-content:center;padding:4px 12px"><img src="'+state.imgLB+'" alt="" style="max-width:min(1100px,97vw);width:100%;height:auto;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.4)" onclick="event.stopPropagation()"></div></div>';return;}
 if(state.lb==null||!DATA.stmts[state.lb]){el.innerHTML='';return;}
 var s=DATA.stmts[state.lb];
 var imgs=(s.pages||[]).map(function(p){return '<img src="'+p+'" alt="" style="max-width:min(840px,94vw);width:100%;height:auto;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.4);margin-bottom:14px" onclick="event.stopPropagation()">';}).join('');
 el.innerHTML='<div data-lbx="1" style="position:fixed;inset:0;z-index:200;background:rgba(20,18,15,.9);display:flex;flex-direction:column;overflow-y:auto;padding:0 0 40px">'
  +'<div style="position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:14px 20px;background:rgba(20,18,15,.7);backdrop-filter:blur(6px)"><span style="color:#fff;font-weight:700;font-size:15px">'+esc(s.org)+'</span><span style="flex:1"></span><button data-lbx="1" style="border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;font-size:13px;font-weight:700;padding:7px 15px;border-radius:8px;cursor:pointer">닫기 ✕</button></div>'
  +'<div style="display:flex;flex-direction:column;align-items:center;padding:22px 16px">'+imgs+'</div></div>';
}
function render(){renderNav();renderCenter();renderRail();renderLB();applyHero();var _g=document.getElementById('grid'),_r=document.getElementById('rail');if(_g&&_r){var _w=(state.sec==='guide');_g.style.gridTemplateColumns=_w?'minmax(0,1fr)':'minmax(0,1fr) 316px';_r.style.display=_w?'none':'';}}
document.addEventListener('click',function(e){
 var t=e.target.closest?e.target.closest('[data-nav],[data-chan],[data-gmode],[data-gsub],[data-gsec],[data-gcols],[data-nopen],[data-sort],[data-more],[data-img],[data-act],[data-lb],[data-lbx]'):null;
 if(!t)return;
 if(t.hasAttribute('data-lbx')){state.lb=null;state.imgLB=null;renderLB();return;}
 if(t.hasAttribute('data-lb')){e.preventDefault();state.lb=+t.getAttribute('data-lb');renderLB();return;}
 if(t.hasAttribute('data-img')){e.preventDefault();state.imgLB=t.getAttribute('data-img');renderLB();return;}
 if(t.hasAttribute('data-nav')){e.preventDefault();state.sec=t.getAttribute('data-nav');render();return;}
 if(t.hasAttribute('data-chan')){state.channel=t.getAttribute('data-chan');state.newsN=10;renderCenter();return;}
 if(t.hasAttribute('data-gmode')){state.gmode=t.getAttribute('data-gmode');state.gsub=0;state.gsec=0;renderCenter();return;}
 if(t.hasAttribute('data-gsub')){state.gsub=+t.getAttribute('data-gsub');state.gsec=0;renderCenter();return;}
 if(t.hasAttribute('data-gsec')){var k=+t.getAttribute('data-gsec');state.gsec=state.gsec===k?-1:k;renderCenter();return;}
 if(t.hasAttribute('data-gcols')){state.gcols=+t.getAttribute('data-gcols');renderCenter();return;}
 if(t.hasAttribute('data-nopen')){var ni=+t.getAttribute('data-nopen');state.nOpen[ni]=!state.nOpen[ni];renderCenter();return;}
 if(t.hasAttribute('data-more')){state.newsN=(state.newsN||10)+10;renderCenter();return;}
 if(t.hasAttribute('data-sort')){var sk=t.getAttribute('data-sort');if(state.sort)state.sort[sk]=(state.sort[sk]==='old'?'new':'old');if(sk==='news')state.newsN=10;renderCenter();return;}
 if(t.hasAttribute('data-act')){var a=t.getAttribute('data-act');
  if(a==='buzzkw'){state.buzzKw=t.getAttribute('data-kw');if(state.buzzView==='all4')state.buzzView='cnt';}
  else if(a==='buzzview'){state.buzzView=t.getAttribute('data-view');}
  else if(a==='buzzper'){state.buzzPeriod=t.getAttribute('data-per');}
  else if(a==='buzzmetric'){state.buzzMetric=t.getAttribute('data-met');}
  else if(a==='buzzsent'){state.buzzSentCh=t.getAttribute('data-sch');}
  else if(a==='buzzcntch'){state.buzzCntCh=t.getAttribute('data-cch');}
  else if(a==='buzzzoom'){state.buzzZoom=Math.max(1,Math.min(16,(+state.buzzZoom||1)*(t.getAttribute('data-z')==='in'?2:0.5)));}
  else if(a==='buzzpanelper'){state.buzzPanelPer=t.getAttribute('data-pp');}
  else return;
  renderCenter();return;}
});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&(state.lb!=null||state.imgLB)){state.lb=null;state.imgLB=null;renderLB();}});
render();
(function(){var hi=[].slice.call(document.querySelectorAll('#hero .hero-img'));if(hi.length<2)return;var dw=document.getElementById('heroDots'),pb=document.getElementById('heroPause');var idx=0,timer=null,playing=true;var PZ='<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';var PL='<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z"/></svg>';var dots=hi.map(function(_,i){var b=document.createElement('button');b.className='dot'+(i===0?' on':'');b.type='button';b.setAttribute('aria-label',(i+1)+'번 슬라이드');b.addEventListener('click',function(){go(i);if(playing)start();});return b;});if(dw)dots.forEach(function(d){dw.appendChild(d);});function go(n){hi[idx].classList.remove('on');dots[idx].classList.remove('on');idx=(n+hi.length)%hi.length;hi[idx].classList.add('on');dots[idx].classList.add('on');}function start(){stop();timer=setInterval(function(){go(idx+1);},5000);}function stop(){if(timer){clearInterval(timer);timer=null;}}if(pb){pb.innerHTML=PZ;pb.addEventListener('click',function(){if(playing){playing=false;stop();pb.innerHTML=PL;pb.setAttribute('aria-label','슬라이드 재생');}else{playing=true;start();pb.innerHTML=PZ;pb.setAttribute('aria-label','슬라이드 일시정지');}});}start();})();
(function(){var tipEl=document.createElement('div');tipEl.style.cssText='position:fixed;z-index:250;pointer-events:none;background:#0B0E16;color:#EDEFF5;font-size:11.5px;font-weight:700;padding:6px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.2);box-shadow:0 10px 26px rgba(0,0,0,.6);white-space:nowrap;opacity:0;transition:opacity .12s ease;display:none;left:0;top:0;';document.body.appendChild(tipEl);var curT=null;function show(t){var tip=t.getAttribute('data-tip');if(!tip)return;curT=t;tipEl.textContent=tip;tipEl.style.display='block';var r=t.getBoundingClientRect(),tw=tipEl.offsetWidth,th=tipEl.offsetHeight;var left=r.left+r.width/2-tw/2;left=Math.max(8,Math.min(left,window.innerWidth-tw-8));var top=r.bottom+8;if(top+th>window.innerHeight-8)top=r.top-th-8;if(top<8)top=8;tipEl.style.left=Math.round(left)+'px';tipEl.style.top=Math.round(top)+'px';requestAnimationFrame(function(){tipEl.style.opacity='1';});}function hide(){curT=null;tipEl.style.opacity='0';tipEl.style.display='none';}document.addEventListener('mouseover',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(t&&t!==curT)show(t);});document.addEventListener('mouseout',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(t)hide();});})();
})();`;

const HTML = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>PT뉴스 — 물리치료 관리급여 대응</title>'
  + '<meta property="og:type" content="website"><meta property="og:site_name" content="PT뉴스"><meta property="og:url" content="https://ptnews.vercel.app/">'
  + '<meta property="og:title" content="PT뉴스 · 물리치료 관리급여 대응 상황판"><meta property="og:description" content="도수치료 관리급여 정책 대응 상황판. 뉴스·공지·청원·성명문·여론·가이드를 한눈에.">'
  + '<meta property="og:image" content="https://ptnews.vercel.app/img/hero-1.jpg"><meta property="og:image:width" content="1600"><meta property="og:image:height" content="900">'
  + '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="PT뉴스 · 물리치료 관리급여 대응 상황판"><meta name="twitter:description" content="도수치료 관리급여 정책 대응 상황판."><meta name="twitter:image" content="https://ptnews.vercel.app/img/hero-1.jpg">'
  + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">'
  + '<script src="d3.layout.cloud.min.js"></script>'
  + '<style>' + CSS + '</style></head><body>' + BODY
  + '<script>var DATA=' + JSON.stringify(DATA) + ';\n' + CLIENT + '</script></body></html>';

const OUT = process.env.PV === '1' ? '웹/board/preview.html' : '웹/board/index.html';
fs.mkdirSync('웹/board/img', { recursive: true });
fs.writeFileSync(OUT, HTML, 'utf8');
console.log('생성:', OUT, (HTML.length / 1024).toFixed(0) + 'KB');
console.log('articles:', articles.length, '(ko', ko.length, 'press', press.length, 'insure', insure.length, ') stmts:', stmts.length);
