const fs=require('fs');
const RDATA=(function(){try{return JSON.parse(fs.readFileSync('_routes.json','utf8'));}catch(e){return {dest:[37.5761,126.9794],stations:{}};}})();
const meta=JSON.parse(fs.readFileSync('_news/meta.json','utf8'));
const m=Object.fromEntries(meta.map(x=>[x.i,x]));
const iso=s=>(s||'').slice(0,10);
const md=s=>{const d=iso(s);return d?d.slice(5).replace('-','.'):'';};
const ymd=s=>{const d=iso(s);return d?d.replace(/-/g,'.').slice(2):'';};
// 고영준(서울일보) ROW1
const ko=JSON.parse(fs.readFileSync('_news/ko.json','utf8'));
// 언론 ROW2
const press=JSON.parse(fs.readFileSync('_news/press.json','utf8'));
// 중복뉴스(같은 사안 받아쓰기) 자동 묶음 → group 부여 ("+N개 매체" 배지용)
function autoGroupDup(list){
  const toks=t=>{const s=new Set();(String(t).match(/[0-9]{2,}/g)||[]).forEach(n=>s.add('#'+n));(String(t).match(/[가-힣]{2,}/g)||[]).forEach(w=>{for(let i=0;i<w.length-1;i++)s.add(w.slice(i,i+2));});return s;};
  const jac=(a,b)=>{if(!a.size||!b.size)return [0,0];let i=0;a.forEach(x=>{if(b.has(x))i++;});return [i/(a.size+b.size-i),i];};
  const T=list.map(x=>toks(x.title||'')), D=list.map(x=>toks(x.desc||'')), n=list.length;
  const SOLO_RE=/(총궐기|궐기대회|궐기|집회|거리로|규탄|결의대회|시위|집결|손피켓)/;
  // 시위·집회·현장사진(news1 /photos/ 등) 기사는 '같은 사안 받아쓰기'가 아니라 개별 현장 보도이므로 묶지 않고 목록에 개별 노출
  const isSolo=x=>!!x&&(x.solo===true||/\/photos\//.test(x.url||'')||SOLO_RE.test(x.title||''));
  // 제목 유사도로 후보를 잡고, 본문 요약(desc)으로 같은 사안인지 확정/구제. 같은 매체는 리드문 재사용(보일러플레이트) 위험이 있어 제목만 신뢰.
  const same=(i,j)=>{
    if(isSolo(list[i])||isSolo(list[j])) return false;
    const tr=jac(T[i],T[j]), tj=tr[0], ti=tr[1];
    const dr=jac(D[i],D[j]), dj=dr[0], di=dr[1];
    const noDesc=!(list[i].desc&&list[j].desc);
    if(noDesc) return tj>=0.55&&ti>=7;
    if(list[i].chip===list[j].chip) return tj>=0.58&&ti>=8;
    if(tj>=0.62&&ti>=8) return true;
    if(tj>=0.50&&ti>=7&&dj>=0.15) return true;
    if(tj>=0.40&&dj>=0.30&&di>=14) return true;
    if(tj>=0.22&&dj>=0.45&&di>=20) return true;
    return false;
  };
  const par=Array.from({length:n},(_,i)=>i);
  const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){if(same(i,j))par[find(i)]=find(j);}
  const cnt={};for(let i=0;i<n;i++){const r=find(i);cnt[r]=(cnt[r]||0)+1;}
  for(let i=0;i<n;i++){const r=find(i);if(cnt[r]>1)list[i].group='dup'+r;}
}
autoGroupDup(press);
const INSURE_ON=process.env.INSURE!=='0';  // 보험 탭 운영 반영(기본 노출). INSURE=0 으로 끌 수 있음
const insure=INSURE_ON?JSON.parse(fs.readFileSync('_news/insure.json','utf8')):[];
if(insure.length)autoGroupDup(insure);
const PERF_ON=process.env.PERF==='1';  // 로컬 시안용(보험 실적 vs 실손 적자 데이터 카드). 미설정 시 미노출
const PERFCARD=PERF_ON?('<div style="flex:none;border:1px solid rgba(70,192,136,.42);border-left:4px solid #46C088;border-radius:13px;background:linear-gradient(180deg,#16241E,#0F1A16);padding:12px 14px;box-shadow:0 8px 20px -6px rgba(0,0,0,.5);">'+
  '<div style="font-size:12.5px;font-weight:900;color:#5FE3A8;margin-bottom:9px;letter-spacing:-.01em;">데이터로 보는 진실 · 보험사 실적 vs 실손 적자</div>'+
  '<div style="display:flex;gap:9px;margin-bottom:9px;">'+
  '<div style="flex:1;min-width:0;background:rgba(255,255,255,.04);border-radius:9px;padding:8px 10px;"><div style="font-size:10px;color:#9AA8BE;font-weight:700;white-space:nowrap;">보험업계 순이익(2025)</div><div style="font-size:19px;font-weight:900;color:#5FE3A8;letter-spacing:-.02em;">12.2조원</div></div>'+
  '<div style="flex:1;min-width:0;background:rgba(255,255,255,.04);border-radius:9px;padding:8px 10px;"><div style="font-size:10px;color:#9AA8BE;font-weight:700;white-space:nowrap;">실손 영업적자(2024)</div><div style="font-size:19px;font-weight:900;color:#E2706B;letter-spacing:-.02em;">-1.6조원</div></div></div>'+
  '<div style="font-size:11px;line-height:1.55;color:#D6DEEA;font-weight:600;">연 12조원대 순이익을 내는 보험업계가, 실손 한 부문 적자(전체 순이익의 약 13%)를 명분으로 도수치료를 통제하고 적자 책임을 환자·물리치료사에게 전가합니다.</div>'+
  '<div style="margin-top:7px;font-size:9.5px;color:#7C8AA0;font-weight:600;">출처: 금융감독원 2025년 보험사 경영실적 · 실손보험 손익 공시</div>'+
  '</div>'):'';
const stmt=[
 {id:0,org:'대한골반건강물리치료학회',org2:'',date:'2026-06-16',disp:'6.16',thumb:'img/stmt/gb1.webp',pages:['img/stmt/gb1.webp','img/stmt/gb2.webp','img/stmt/gb3.webp','img/stmt/gb4.webp','img/stmt/gb5.webp','img/stmt/gb6.webp']},
 {id:1,org:'대한소아통합수기물리치료학회',org2:'(KPIMT)',date:'2026-06-16',disp:'6.16',thumb:'img/stmt/kpimt1.webp',pages:['img/stmt/kpimt1.webp','img/stmt/kpimt2.webp','img/stmt/kpimt3.webp']},
 {id:2,org:'대한정형도수물리치료학회',org2:'충남지부',date:'2026-06-20',disp:'6.20',thumb:'img/stmt/chungnam.webp',pages:['img/stmt/chungnam.webp']},
 {id:3,org:'대한정형도수물리치료학회',org2:'광주지부',date:'2026-06-19',disp:'6.19',thumb:'img/stmt/gwangju.webp',pages:['img/stmt/gwangju.webp']},
 {id:4,org:'대한정형도수물리치료학회',org2:'부산지부',date:'2026-06-17',disp:'6.17',thumb:'img/stmt/busan.webp',pages:['img/stmt/busan.webp']},
 {id:5,org:'대한기능도수물리치료학회',org2:'(FMT)',date:'2026-06-17',disp:'6.17',thumb:'img/stmt/fmt1.webp',pages:['img/stmt/fmt1.webp','img/stmt/fmt2.webp','img/stmt/fmt3.webp']},
 {id:6,org:'대한물리치료사협회',org2:'경근분과학회',date:'2026-06-16',disp:'6.16',thumb:'img/stmt/gyeong.webp',pages:['img/stmt/gyeong.webp']},
 {id:7,org:'대한림프도수치료학회',org2:'(KALMT)',date:'2026-06-15',disp:'6.15',pin:1,thumb:'img/stmt/lymph.webp',pages:['img/stmt/lymph.webp']},
 {id:8,org:'대한근골격발란스테이핑물리치료학회',org2:'서울시회',date:'2026-06-22',disp:'6.22',thumb:'img/stmt/balance1.webp',pages:['img/stmt/balance1.webp','img/stmt/balance2.webp']},
 {id:9,org:'대한연부조직도수물리치료학회',org2:'(KAS)',date:'2026-06-23',disp:'6.23',thumb:'img/stmt/yeonbu1.webp',pages:['img/stmt/yeonbu1.webp','img/stmt/yeonbu2.webp']},
 {id:10,org:'APPI',org2:'(Team APPI)',date:'2026-06-23',disp:'6.23',thumb:'img/stmt/appi1.jpg',pages:['img/stmt/appi1.jpg','img/stmt/appi2.jpg','img/stmt/appi3.jpg','img/stmt/appi4.jpg']},
 {id:11,org:'대한칼텐보른-에브엔스 정형도수물리치료학회',org2:'(KEOMT)',date:'2026-06-23',disp:'6.23',thumb:'img/stmt/keomt1.png',pages:['img/stmt/keomt1.png','img/stmt/keomt2.png']},
 {id:12,org:'대한근골격 ESWT 물리치료연구회',org2:'',date:'2026-06-23',disp:'6.23',thumb:'img/stmt/eswt1.webp',pages:['img/stmt/eswt1.webp','img/stmt/eswt2.webp']},
 {id:13,org:'대한자세운동과학회',org2:'',date:'2026-06-23',disp:'6.23',thumb:'img/stmt/jase1.webp',pages:['img/stmt/jase1.webp','img/stmt/jase2.webp','img/stmt/jase3.webp']},
 {id:14,org:'37대 전국물리치료(학)과학생학술연구회',org2:'',date:'2026-06-27',disp:'6.27',pin:2,badge:'전국학생회',thumb:'img/stuhak1.webp',pages:['img/stuhak1.webp','img/stuhak2b.webp']},
];
const petitions=[
 {count:'동의 3,165명 (6%)',pct:6,dl:'7월 17일 (금) 마감',title:'[국회 국민동의청원] 도수치료 관리급여화 고시 및 체외충격파 횟수 제한 정책 철회 및 시행 유예 촉구에 관한 청원',url:'https://petitions.assembly.go.kr/proceed/onGoingAll/527DFB9D4A5222D7E064ECE7A7064E8B',qr:'img/qr_assembly.png'},
 {count:'동의 908명 (1%)',pct:1,dl:'7월 20일 (월) 마감',title:'[국회 국민동의청원] 안면마비 재활 도수치료 분야에 대한 관리급여 기준 철회 및 산정 특례 적용 요청에 관한 청원',url:'https://petitions.assembly.go.kr/proceed/onGoingAll/52523590A2A26BDEE064B49691C6967B',qr:'img/qr_assembly2.png'},
];
// 공동대응 수치 자동 갱신본(_news/coaction.json 있으면 덮어씀)
let CO={};
try{CO=JSON.parse(fs.readFileSync('_news/coaction.json','utf8'));}catch(e){}
const nfmt=n=>Number(n).toLocaleString('en-US');
if(CO.petition) petitions[0].count='동의 '+nfmt(CO.petition)+'명 ('+(CO.petitionPct||0)+'%)';
if(CO.petitionPct!=null) petitions[0].pct=CO.petitionPct;
if(CO.petition2&&petitions[1]) petitions[1].count='동의 '+nfmt(CO.petition2)+'명 ('+(CO.petition2Pct||0)+'%)';
if(CO.petition2Pct!=null&&petitions[1]) petitions[1].pct=CO.petition2Pct;
const noticeBody=`안녕하세요. 대한물리치료사협회(이하 '대물협') 및 회원 대표 운영진에서 알려드립니다.

회원 여러분, 많이 기다리셨습니다. 조금 더 빨리 확정된 소식을 전해드리지 못해 죄송합니다. 협회장님과 긴밀히 논의한 끝에 1차 확정안을 먼저 공유드립니다.

[Plan A] 우리의 힘으로 진행한다 : 6월 28일(일) 14:00~16:00, 경복궁 동십자각, 수용 인원 1,000명

[Plan B] 대한의사협회(이하 '의협')와의 연대 : 6월 28일(일) 16:00~18:00, 대한문 일대, 수용 인원 미정

요약 : Plan A 또는 Plan B로 진행 예정

[협회장님 의견] "목소리를 더 크고 효과적으로 전달할 수 있다면, 수용 인원 등을 확인한 후 의협과 연대하는 방향도 고려해 보자"는 제안을 주셨습니다.

내일(6월 22일, 월) 대물협과 의협이 직접 만나 구체적인 논의를 진행합니다. 연대가 성사되면 시너지를 위해 시간이나 장소가 일부 조정될 수 있으며, 불가피할 경우 Plan A 장소에서 진행합니다.

회원님들께 드리는 약속 : 주말이라 오늘 의협의 최종 확답을 받기는 어렵습니다. 하지만 분명히 약속드립니다. 내일 의협과의 논의 끝에 동행이 안 된다면, Plan A(6월 28일 14시, 경복궁 동십자각)는 틀림없이 진행됩니다.

이번 집회는 우리의 정당한 권리를 찾기 위한 필수 과정입니다. 답답하셨을 텐데도 믿고 기다려 주신 회원 여러분께 진심으로 감사드립니다. 내일 최종 조율이 끝나는 대로 가장 먼저 공지 올리겠습니다.

우선 6월 28일(일) 일정 비워두시고 조금만 더 지켜봐 주시기 바랍니다. 감사합니다.

김동현 비대위원장 올림`;
function escH(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function emph(s){return escH(s).replace(/\[([^\]]+)\]/g,(m,t)=>{let c='#E9D38A';if(/^Plan A/i.test(t))c='#FF8A87';else if(/^Plan B/i.test(t))c='#7FB2F0';return '<b style="color:'+c+';font-weight:800;">['+t+']</b>';});}
const mqSep='<span style="display:inline-block;width:64px;"></span>';
const mqHtml=noticeBody.split(/\n{2,}/).map(p=>p.replace(/\s*\n\s*/g,' ').trim()).filter(Boolean).map(emph).join(mqSep);
const bodyHtml=emph(noticeBody);
const noticeBody2=`안녕하세요. 대한물리치료사협회(이하 '대물협') 및 회원 대표 운영진에서 알려드립니다.

대물협과 의협의 논의 끝에, 의협은 의협대로 대물협은 대물협대로 같은 날 각자의 장소에서 목소리를 내기로 최종 결정되었습니다.

이에 저희 집회는 6월 28일 경복궁 동십자각에서 이전에 공지드린 [Plan A]로 진행됩니다.

모두 많이 기다리셨을 텐데, 빠르게 다음 공지 올리겠습니다. 감사합니다.

[Plan A] 우리의 힘으로 진행한다
날짜 : 2026년 6월 28일(일)
장소 : 경복궁 동십자각
시간 : 14:00 ~ 16:00
수용 인원 : 1,000명`;
const bodyHtml2=emph(noticeBody2);
const mqHtml2=noticeBody2.split(/\n{2,}/).map(p=>p.replace(/\s*\n\s*/g,' ').trim()).filter(Boolean).map(emph).join(mqSep);
const noticeBody3=`각 지역에 계신 물리치료사 회원 여러분께 알려드립니다.

관리급여로 인한 치료사 생존권 위협이 턱 앞까지 다가왔습니다. 우리 생존권을 두고 각 시도 물리치료사회가 회원을 지켜주고 있는지, [도수치료 관리급여]에 대한 각 시도회의 활동 현황을 파악하고자 합니다.

회원님들께서 가입되어 계신 각 지역 밴드·인스타그램·페이스북 등 SNS에 올라온 협회의 활동 소식이나 공지가 있다면 적극적인 제보 부탁드립니다.

제보 내용 : 각 시도회 밴드·인스타 등 SNS의 도수치료 관리급여 관련 활동/공지 캡쳐본, 또는 내부 분위기·내부 관계자 제보 (철저한 익명 보장)

제보 방법 : '바보' 방장에게 개인 카톡

각 시도 물리치료사회가 우리 권익을 위해 어떤 도움을 주고 있는지 파악하려는 취지입니다. 감사합니다.`;
const bodyHtml3=emph(noticeBody3);
const mqHtml3=noticeBody3.split(/\n{2,}/).map(p=>p.replace(/\s*\n\s*/g,' ').trim()).filter(Boolean).map(emph).join(mqSep);
const notices=[
 {badge:'자유방',badgeColor:'#3E9E78',badgeText:'#fff',date:'6.22',bar:1,title:'각 시도회 도수치료 관리급여 대응 현황 제보 요청',body:noticeBody3,bodyHtml:bodyHtml3,mq:mqHtml3},
 {badge:'중앙협회',badgeColor:'#8C72D6',badgeText:'#fff',date:'6.22',bar:1,title:'대한물리치료사협회 고용위기대응센터 : 권고사직·고용피해 안내',img:'img/notice_kpta.jpg',bodyHtml:emph('대한물리치료사협회 고용위기대응센터 안내입니다. 권고사직·사직서(자진퇴사) 작성 주의, 도수치료 관리급여 고용피해 전문가(노무사) 상담 안내. 노무사 류시나 010-3704-8756.'),mq:''},
 {badge:'집회 확정',badgeColor:'#D8483A',badgeText:'#fff',date:'6.22',bar:1,committee:1,title:"6.28 집회 'Plan A' 최종 확정 (경복궁 동십자각 14:00)",body:noticeBody2,bodyHtml:bodyHtml2,mq:mqHtml2},
 {badge:'국회 일정',badgeColor:'#3A6EA5',badgeText:'#fff',date:'6.30',bar:1,title:'「지역사회통합돌봄, 성인지 관점에서의 대안모색」 토론회',img:'img/notice_assembly1.jpg',bodyHtml:'일시 : 2026년 6월 30일(화) 오전 10시<br>장소 : 국회 의원회관 제8간담회실<br>주최 : 국회부의장 남인순, 한국여성연구소, 한국여성단체연합<br>좌장 : 김희강(고려대 행정학과 교수)<br>발표 : 송다영(인천대), 최나리(젠더로 다시 여는 연구소), 백경흔(이화여대)<br>토론 : 장수정, 허민숙, 이정아<br>안건 : 의료·요양 등 지역 돌봄 통합지원에 관한 법률의 성인지 분석과 개선 방안',mq:''},
 {badge:'국회 일정',badgeColor:'#3A6EA5',badgeText:'#fff',date:'6.30',bar:1,title:'국회토론회 「중증질환자 피해사례로 본 실손보험·관리급여 제도의 문제점 및 개선방안」',img:'img/notice_assembly2.jpg',bodyHtml:'일시 : 2026년 6월 30일(화) 10:00~12:00<br>장소 : 국회의원회관 제1세미나실<br>주최 : 국회의원 이주영(개혁신당)<br>주관 : 대한의사협회, 한국중증질환연합회<br>좌장 : 이태연, 사회 : 안치현 (대한의사협회 보험이사)<br>발제1 : 관리급여 추진의 문제점과 바람직한 비급여 관리 대안 (이봉근)<br>발제2 : 중증질환자 피해사례로 본 실손보험 제도의 문제점 및 개선안 (최태형 변호사)<br>이후 환자 피해사례 발표, 지정토론(의료계·환자단체·보험업계·금융계·정부), 질의응답',mq:''},
 {badge:'집회 공지',badgeColor:'#D8483A',badgeText:'#fff',date:'6.21',committee:1,title:'6.28 총궐기 1차 확정안 (Plan A·B) 안내',body:noticeBody,bodyHtml:bodyHtml,mq:mqHtml}
];
const __barN=notices.filter(function(n){return n.bar&&n.badge==='국회 일정';});const __RH=24;const __K=__barN.length;let rollCSS='';
if(__K>1){let st=[];for(let i=0;i<__K;i++){const a=(i*100/__K),b=a+(100/__K)*0.82,y=-(i*__RH);st.push(a.toFixed(2)+'%{transform:translateY('+y+'px)}');st.push(b.toFixed(2)+'%{transform:translateY('+y+'px)}');}st.push('100%{transform:translateY('+(-__K*__RH)+'px)}');rollCSS='@keyframes notiroll{'+st.join('')+'}.notiroll{animation:notiroll '+(__K*4)+'s ease infinite}';}
const rallyBoard=[
 {n:'전남도회',r:1},{n:'부산시회',r:2},{n:'서울시회',r:3}
];
const subBoard=[
 {n:'대한자세운동과학물리치료분과학회',r:1},{n:'대한연부조직도수물리치료분과학회',r:2},{n:'대한기능도수물리치료분과학회',r:3}
];
const researchBoard=[
 {n:'대한KEMA물리치료연구회',done:1}
];
const busBoard=[
 {n:'대구시회',r:1},{n:'전북도회',r:2},{n:'부산시회',r:3}
];
const busInfo=[
 {name:'전북', accent:'#5A8AE0', rows:[
   ['출발일시','6월 28일(일) 09:30'],
   ['출발장소','전주 월드컵경기장'],
   ['문의','010-3534-2170']
 ], note:'학생도 참여 가능합니다'},
 {name:'대전', accent:'#E0922C', badge:'선착순 40명', rows:[
   ['출발일시','6월 28일(일) 오전 10시'],
   ['출발장소','대전시청역 1번 출구'],
   ['참가비','없음'],
   ['신청기한','6월 26일(금) 20시'],
   ['신청방법','문자로 성명 / 연락처'],
   ['연락자','정규희 010-3135-3826'],
   ['메시지','참여자 / 전화번호']
 ], note:'최소 20명 이상 되어야 출발합니다'},
 {name:'광주', accent:'#C678DD', badge:'추가모집', link:'https://naver.me/G2YPXqmU', rows:[
   ['일자','6월 28일(일)'],
   ['08:30','광주 롯데마트 월드컵점 출발'],
   ['09:00','광주 비아 정류장(상행) 출발'],
   ['13:00','서울 경복궁 동십자각 도착·집회장 이동'],
   ['14:00','집회 참석 (~16:00)'],
   ['16:00','광주 출발'],
   ['20:00','광주 도착 예정'],
   ['차량','31인승 우등버스 · 잔여석 있음']
 ], note:'광주↔서울 왕복·식사 광주지부 제공, 별도 경비는 미지급'},
 {name:'부산물리치료사회', accent:'#46C088', badge:'신청마감', closed:1, rows:[
   ['집결일시','6월 28일(일) 07:00'],
   ['집결장소','서면역'],
   ['신청마감','6월 25일(목) 24:00']
 ]}
];
const BUZZON=true; // 보드 정부공식자료 밑 진입 버튼 + 오버레이
let buzz={}; try{ buzz=JSON.parse(fs.readFileSync('_news/buzz.json','utf8')); }catch(e){ buzz={}; }
const DATA={ko,press:press.map(function(r){var c=Object.assign({},r);delete c.desc;return c;}),insure:insure.map(function(r){var c=Object.assign({},r);delete c.desc;return c;}),stmt,petitions,notices,rallyBoard,subBoard,researchBoard,busBoard,busInfo,buzz:(BUZZON?buzz:{}),perfcard:PERFCARD,rally:'2026-06-28',deadline:'2026-07-04',upd:(CO.updated||'6.22 11시 기준')};

const CSS=`*{box-sizing:border-box}html,body{margin:0}@media(max-width:859px){html,body{overflow-x:hidden}}
body{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#0E121B;color:#E9EBF1;-webkit-font-smoothing:antialiased}
@keyframes pulseDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}
@keyframes mq{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes signfk{0%,100%{opacity:1}50%{opacity:.08}}
.signfk{animation:signfk 3.6s ease-in-out infinite}
.mqwrap{flex:1;min-width:0;overflow:hidden}
.mq{display:inline-flex;white-space:nowrap;will-change:transform;animation-name:mq;animation-timing-function:linear;animation-iteration-count:infinite}
.mqwrap:hover .mq{animation-play-state:paused}
.sb::-webkit-scrollbar{width:0;height:0;display:none}.sb{scrollbar-width:none;-ms-overflow-style:none}
.hsb::-webkit-scrollbar{width:0;height:0;display:none}.hsb{scrollbar-width:none;-ms-overflow-style:none}
.fanrow::-webkit-scrollbar{width:0;height:0;display:none}.fanrow{scrollbar-width:none;-ms-overflow-style:none}
.wheelx::-webkit-scrollbar{width:0;height:0;display:none}.wheelx{scrollbar-width:none;-ms-overflow-style:none}
.clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer}
.card:hover{border-color:rgba(255,255,255,.24)!important}
.gcard{position:relative;background:#1E2840;border:1px solid rgba(255,255,255,.13);transition:transform .18s ease,box-shadow .18s ease}
.gcard:hover{transform:scale(1.04);z-index:5;overflow:visible!important;box-shadow:0 14px 34px -12px rgba(0,0,0,.6);border-color:rgba(255,255,255,.32)!important}
.gcard:hover .clamp2{-webkit-line-clamp:99;overflow:visible}
.fanrow .gcard:hover{overflow:hidden!important}
.fanrow .gcard:hover .clamp2{-webkit-line-clamp:2;overflow:hidden}
.stmtpull{clip-path:inset(0 0 67px 0 round 14px 14px 0 0);transition:transform .26s cubic-bezier(.22,.61,.36,1),box-shadow .26s ease,filter .2s ease,clip-path .26s ease}
.stmtpull:hover{clip-path:none;transform:translateY(-62px);z-index:30;box-shadow:0 26px 52px -10px rgba(0,0,0,.85);filter:brightness(1.05)}
.stmtsec{overflow:visible;clip-path:inset(0 round 16px);transition:clip-path .2s ease}
.stmtsec:has(.stmtpull:hover){clip-path:inset(-90px 0 0 0 round 16px);z-index:6}
[data-tip]{position:relative}
.mrk>div{font-size:12px!important}
.stmtsec:has([data-tip]:hover){clip-path:inset(-90px 0 0 0 round 16px);z-index:7}
.stmtlb{transition:transform .18s ease,box-shadow .18s ease}
.stmtlb:hover{transform:translateY(-5px);box-shadow:0 14px 26px -8px rgba(0,0,0,.6);filter:brightness(1.05)}
.pet:hover{background:#202940!important;border-color:rgba(255,255,255,.16)!important}
.btnh{-webkit-backdrop-filter:blur(5px) saturate(1.5) url(#lglass);backdrop-filter:blur(5px) saturate(1.5) url(#lglass);background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.06))!important;border-color:rgba(255,255,255,.3)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -2px 5px rgba(140,175,230,.16)}
.btnh:active{transform:translateY(1px);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 1px 2px rgba(0,0,0,.3)!important}
.btnh:hover{background:linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,.12))!important;border-color:rgba(255,255,255,.42)!important}
.btnh.nv{background:linear-gradient(180deg,rgba(56,84,148,.62),rgba(30,46,84,.42))!important;border-color:rgba(120,152,216,.5)!important}
.btnh.nv:hover{background:linear-gradient(180deg,rgba(74,108,176,.78),rgba(40,60,108,.52))!important;border-color:rgba(150,180,235,.62)!important}
.btnh.gn{background:linear-gradient(180deg,rgba(62,158,120,.62),rgba(38,104,78,.42))!important;border-color:rgba(110,205,162,.55)!important;color:#EAFBF3!important}
.btnh.gn:hover{background:linear-gradient(180deg,rgba(80,188,142,.78),rgba(48,128,96,.52))!important;border-color:rgba(140,225,185,.65)!important}
.ghdr{position:relative;height:43px;-webkit-backdrop-filter:blur(8px) saturate(1.5) url(#lglass);backdrop-filter:blur(8px) saturate(1.5) url(#lglass);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -1px 2px rgba(150,185,225,.22)}
.hsb:not(.wheelx){-webkit-backdrop-filter:blur(7px) saturate(1.5) url(#lglass);backdrop-filter:blur(7px) saturate(1.5) url(#lglass);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
.govbtn{transition:transform .14s ease,box-shadow .14s ease}
.govbtn:hover{transform:translateY(-2px);box-shadow:0 14px 30px -6px rgba(0,0,0,.62),0 3px 7px rgba(0,0,0,.42),inset 0 0 0 1px rgba(91,134,200,.35),inset 0 1px 0 rgba(120,160,225,.32),inset 0 -3px 8px rgba(0,0,0,.32)!important}
.govbtn:active{transform:translateY(0);box-shadow:0 4px 12px -4px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.1),inset 0 -2px 6px rgba(0,0,0,.4)!important}
@keyframes twinkle{0%,100%{transform:scale(0) rotate(0deg);opacity:0}45%{transform:scale(1.2) rotate(90deg);opacity:1}72%{transform:scale(0) rotate(150deg);opacity:0}}
.glow{position:relative;display:inline-block;color:#fff}
.spk{position:absolute;background:#fff;clip-path:polygon(50% 0,58% 42%,100% 50%,58% 58%,50% 100%,42% 58%,0 50%,42% 42%);filter:drop-shadow(0 0 5px rgba(255,255,255,.95));pointer-events:none;opacity:0;z-index:6;animation:twinkle 1.8s ease-in-out infinite}
.spk.a{width:15px;height:15px;top:-8px;left:-11px}
.spk.b{width:10px;height:10px;top:-6px;right:-13px;animation-delay:.45s}
.spk.c{width:13px;height:13px;bottom:-8px;left:34%;animation-delay:.95s}
.spk.d{width:8px;height:8px;bottom:-6px;right:-7px;animation-delay:1.35s}
.spk.e{width:12px;height:12px;top:-5px;left:48%;animation-delay:.7s}
.spk.f{width:8px;height:8px;top:40%;left:-15px;animation-delay:1.55s}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.popb{transition:transform .12s ease,filter .12s ease}.popb:hover{filter:brightness(1.08);transform:translateY(-1px)}.popb:active{transform:translateY(1px)}
.ktalk{position:relative;overflow:hidden}
.ktalk::after{content:'';position:absolute;top:0;left:-65%;width:30%;height:100%;background:linear-gradient(105deg,transparent 0%,rgba(255,255,255,.7) 50%,transparent 100%);transform:skewX(-18deg);pointer-events:none;animation:ktshine 3.4s ease-in-out infinite}
@keyframes ktshine{0%{left:-65%}50%{left:130%}100%{left:130%}}
.shine,.shine>span:last-child{position:relative}
@keyframes twk{0%,100%{opacity:0;transform:scale(.3)}45%{opacity:1;transform:scale(1.15)}}
.shine::before,.shine::after,.shine>span:last-child::before,.shine>span:last-child::after{content:'✦';position:absolute;line-height:1;color:currentColor;text-shadow:0 0 5px currentColor;pointer-events:none;opacity:0;animation:twk var(--sd,2.2s) ease-in-out infinite}
.shine::before{top:var(--t1,0);right:var(--r1,-3px);font-size:var(--fz1,8px);animation-delay:var(--a1,0s)}
.shine::after{bottom:var(--b2,0);right:var(--r2,7px);font-size:var(--fz2,6.5px);animation-delay:var(--a2,1s)}
.shine>span:last-child::before{top:var(--t3,-2px);left:var(--l3,-7px);font-size:var(--fz3,7px);animation-delay:var(--a3,.6s)}
.shine>span:last-child::after{bottom:var(--b4,-2px);left:var(--l4,-3px);font-size:var(--fz4,8px);animation-delay:var(--a4,1.5s)}
.shx{position:absolute;line-height:1;color:currentColor;text-shadow:0 0 5px currentColor;pointer-events:none;opacity:0;animation:twk var(--sd,2.2s) ease-in-out infinite;z-index:1}
.fanrow>.fancard{transition:transform .3s cubic-bezier(.22,.61,.36,1),opacity .3s ease,box-shadow .3s ease;transform-origin:center center;will-change:transform;box-shadow:0 12px 30px -12px rgba(0,0,0,.75)}
.fanrow>.fancard:hover{filter:brightness(1.06)}
.carnav:active{transform:translateY(-50%) scale(.92)!important}
.stk{position:absolute;inset:0;border-radius:16px;border:1px solid rgba(255,255,255,.1);box-shadow:0 8px 20px -10px rgba(0,0,0,.6);transition:transform .28s cubic-bezier(.22,.61,.36,1);will-change:transform}
.stk1{background:#18213a;transform:translate(11px,-10px);z-index:1}
.stk2{background:#141d30;transform:translate(22px,-20px);z-index:0}
.stk3{background:#11172a;transform:translate(33px,-30px);z-index:0}
.fancard:hover .stk1{transform:translate(16px,-15px)}
.fancard:hover .stk2{transform:translate(32px,-30px)}
.fancard:hover .stk3{transform:translate(48px,-45px)}
.envlink{flex:none;display:inline-flex;flex-direction:column;align-items:center;gap:5px;text-decoration:none;cursor:pointer}
.env{position:relative;width:52px;height:36px;perspective:420px;flex:none}
.env__paper{position:absolute;left:6px;right:6px;top:5px;height:30px;background:#FFFDF7;border-radius:2px 2px 3px 3px;z-index:1;transform:translateY(0);transition:transform .42s cubic-bezier(.22,.61,.36,1);box-shadow:0 2px 6px rgba(0,0,0,.3)}
.env__paper i{position:absolute;left:7px;height:2px;border-radius:2px;background:#A98E5E;opacity:.55}
.env__paper i:nth-child(1){top:7px;right:9px}
.env__paper i:nth-child(2){top:13px;right:16px}
.env__paper i:nth-child(3){top:19px;right:24px}
.env__front{position:absolute;inset:0;z-index:2;background:#E9D9B5;border-radius:5px;box-shadow:0 4px 12px -3px rgba(0,0,0,.5)}
.env__flap{position:absolute;top:0;left:0;width:100%;height:60%;background:#DAC796;border-radius:5px 5px 0 0;clip-path:polygon(0 0,100% 0,50% 100%);transform-origin:50% 0;transform:rotateX(0);transition:transform .42s ease,z-index 0s .21s;z-index:3}
.envlink:hover .env__flap,.envlink:focus-visible .env__flap{transform:rotateX(180deg);z-index:0;transition:transform .42s ease,z-index 0s 0s}
.envlink:hover .env__paper,.envlink:focus-visible .env__paper{transform:translateY(-17px)}
.env__label{font-size:11px;font-weight:800;color:#C2CAD8;letter-spacing:-.01em;white-space:nowrap;transition:color .2s}
.envlink:hover .env__label,.envlink:focus-visible .env__label{color:#E2BE72}
.envlink:active .env{transform:translateY(1px)}
`;

const html=`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-GP4BW3V4TS"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-GP4BW3V4TS');</script>
<title>도수치료 관련 뉴스·청원 상황판</title>
<meta property="og:type" content="website">
<meta property="og:url" content="https://ptnews.vercel.app">
<meta property="og:title" content="도수치료 관련 뉴스·청원 상황판">
<meta property="og:description" content="보도·공지·청원을 한눈에. 6.28 결사 저지, 함께 행동해 주세요.">
<meta property="og:image" content="https://ptnews.vercel.app/img/og.png?v=9">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="도수치료 관련 뉴스·청원 상황판">
<meta name="twitter:description" content="보도·공지·청원을 한눈에. 6.28 결사 저지, 함께 행동해 주세요.">
<meta name="twitter:image" content="https://ptnews.vercel.app/img/og.png?v=9">
<link rel="preconnect" href="https://fastly.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://fastly.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>${CSS}${rollCSS}</style><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script src="d3.layout.cloud.min.js"></script></head>
<body>
<div id="app"></div>
<svg width="0" height="0" style="position:absolute;pointer-events:none" aria-hidden="true"><filter id="lglass" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.010" numOctaves="1" seed="11" result="noise"></feTurbulence><feGaussianBlur in="noise" stdDeviation="1.2" result="sn"></feGaussianBlur><feDisplacementMap in="SourceGraphic" in2="sn" scale="16" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter></svg>
<script>
const DATA=${JSON.stringify(DATA)};
const RDATA=${JSON.stringify(RDATA)};
const E=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ST={w:window.innerWidth,expanded:null,sort:{ko:'new',press:'new',stmt:'old',insure:'new'},noticesOpen:false,noticesSort:'new',ncard:0,lb:null,pop:true,feed:'ko',grp:null,actHidden:false,boardPop:null,route:false,routeFrom:'경복궁역',routeFull:false,acc:null,busPop:true,buzz:false,buzzKw:'',buzzPeriod:'3개월',buzzMetric:'cnt',buzzSentCh:'community',buzzCntCh:'all',buzzView:'all4',buzzZoom:1,buzzPanelPer:'3개월'};
const days=d=>Math.max(0,Math.ceil((new Date(d)-new Date())/86400000));
const sortBy=(a,m)=>[...a].sort((x,y)=>{var kx=String(x.dt||x.date||''),ky=String(y.dt||y.date||'');return m==='new'?ky.localeCompare(kx):kx.localeCompare(ky);});
function relTime(dt){if(!dt)return '';var t=new Date(dt);if(isNaN(t))return '';var s=(Date.now()-t.getTime())/1000;if(s<0)s=0;var h=s/3600,d=h/24;if(h<1)return Math.max(1,Math.floor(s/60))+'분 전';if(h<24)return Math.floor(h)+'시간 전';if(d<2)return '어제';if(d<8)return Math.floor(d)+'일 전';return '';}
function isNew(dt){if(!dt)return false;var t=new Date(dt);if(isNaN(t))return false;var df=Date.now()-t.getTime();if(df<0)df=0;return df<86400000;}
function newBadge(c){return isNew(c&&c.dt)?'<span style="position:absolute;top:9px;right:9px;z-index:4;white-space:nowrap;font-size:9.5px;font-weight:900;color:#fff;background:#E2403A;padding:3px 7px;border-radius:5px;box-shadow:0 2px 6px -1px rgba(216,72,58,.6);letter-spacing:.04em;">NEW</span>':'';}
function rlink(k,label,c){var on=ST.routeFrom===k;var isBus=!!(RDATA.buses&&RDATA.buses[k]);var rf=ST.routeFull;var grad=isBus?'linear-gradient(180deg,#46C088,#2C8159)':'linear-gradient(180deg,#5A8AE0,#3559A6)';var bd=isBus?'rgba(120,224,170,.55)':'rgba(150,184,244,.6)';var sh=isBus?'rgba(60,180,120,.55)':'rgba(70,120,220,.55)';return '<button data-act="rfrom" data-st="'+k+'" style="cursor:pointer;display:inline-flex;align-items:center;vertical-align:middle;margin:2px 3px;padding:'+(rf?'5px 14px':'3px 12px')+';border-radius:8px;border:1px solid '+(on?'#FFFFFF':bd)+';background:'+grad+';color:#fff;font:inherit;font-weight:900;font-size:'+(rf?15:12)+'px;letter-spacing:-.01em;white-space:nowrap;line-height:1.55;box-shadow:0 2px 8px -2px '+sh+(on?',0 0 0 2.5px rgba(255,255,255,.7)':'')+';">'+label+'</button>';}
function thumb(c,h){
  const _rt=relTime(c.dt);const lab=(c.chip?(c.chip+' · '+c.disp):c.disp)+(_rt?' · '+_rt:'');
  const inner=c.img?('<img src="'+E(c.img)+'" loading="lazy" alt="" onerror="this.remove()">'):'<span style="font-size:11px;font-weight:700;color:rgba(255,255,255,.32);letter-spacing:.04em;">기사 썸네일</span>';
  return '<div class="thumb" style="'+h+';position:relative;background:linear-gradient(135deg,#1E2840,#0F1420);display:flex;align-items:center;justify-content:center;overflow:hidden;">'+inner+'<span style="position:absolute;top:9px;left:9px;white-space:nowrap;font-size:10.5px;font-weight:700;color:#C2CAD8;background:rgba(13,18,28,.82);padding:4px 9px;border-radius:5px;z-index:2;">'+E(lab)+'</span>'+newBadge(c)+'</div>';
}
function card(c,mode,key){
  const wide=mode==='carousel';
  const big=(key==='feedbig');
  if(big){
    var _rt=relTime(c.dt);var lab=(c.chip?(c.chip+' · '+c.disp):c.disp)+(_rt?' · '+_rt:'');
    var more=c._more||0;
    var W='clamp(300px, 44vw, 560px)';
    var nlay=Math.min(3,more);
    var stack='';
    for(var _l=nlay;_l>=1;_l--){ stack+='<div class="stk stk'+_l+'"></div>'; }
    var badge=more>0?('<span style="position:absolute;bottom:11px;right:11px;z-index:3;display:inline-flex;align-items:center;white-space:nowrap;font-size:12.5px;font-weight:800;color:#1A1A1A;background:#E9D38A;padding:5px 11px;border-radius:7px;box-shadow:0 3px 9px -2px rgba(0,0,0,.5);">+'+more+'개 매체</span>'):'';
    var sub='';
    var open=more>0
      ? '<div class="card gcard" data-act="grp" data-feed="'+E(c._feed||'')+'" data-grp="'+E(c.group||'')+'" style="cursor:pointer;position:relative;z-index:2;height:100%;color:inherit;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;background:#1E2840;border:1px solid rgba(255,255,255,.13);">'
      : '<a class="card gcard" href="'+E(c.url||'#')+'" target="_blank" rel="noopener" title="'+E(c.title)+'" style="position:relative;z-index:2;height:100%;color:inherit;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;background:#1E2840;border:1px solid rgba(255,255,255,.13);">';
    var closeT=more>0?'</div>':'</a>';
    return '<div class="fancard" style="flex:none;width:'+W+';height:100%;position:relative;border-radius:16px;">'+stack+open+
        '<div style="position:relative;flex:1;min-height:0;width:100%;background:#0F1420;display:flex;align-items:center;justify-content:center;overflow:hidden;">'+
          (c.img?'<img src="'+E(c.img)+'" loading="lazy" alt="" onerror="this.remove()" style="width:100%;height:100%;object-fit:cover;display:block;">':'<span style="font-size:13px;font-weight:700;color:rgba(255,255,255,.32);">기사 썸네일</span>')+
          '<span style="position:absolute;top:11px;left:11px;white-space:nowrap;font-size:11px;font-weight:700;color:#C2CAD8;background:rgba(13,18,28,.82);padding:5px 11px;border-radius:6px;z-index:2;">'+E(lab)+'</span>'+
          badge+newBadge(c)+
        '</div>'+
        '<div style="flex:none;padding:12px 16px 14px;"><h4 class="clamp2" style="margin:0;font-size:15px;line-height:1.38;font-weight:700;color:#EDEFF5;letter-spacing:-.01em;">'+E(c.title)+'</h4>'+sub+'</div>'+
      closeT+'</div>';
  }
  const hero=(key==='ko');
  const box=wide?('flex:none;width:'+(hero?'300px':'200px')+';height:100%;'):'';
  const th=wide?thumb(c,'flex:1;min-height:64px'):thumb(c,'flex:none;height:118px');
  const oneLine=wide&&!hero;
  const tCls=oneLine?'':'clamp2';
  const tStyle=oneLine
    ?'margin:0;font-size:12.5px;line-height:1.4;font-weight:700;color:#EDEFF5;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    :'margin:0;font-size:'+(hero?'14.5px':'13px')+';line-height:1.42;font-weight:700;color:#EDEFF5;letter-spacing:-.01em;';
  return '<a class="card gcard" href="'+E(c.url||'#')+'" target="_blank" rel="noopener" style="color:inherit;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;'+box+'">'+th+
    '<div style="flex:none;padding:'+(hero?'13px 15px 14px':'10px 12px 11px')+';"><h4 class="'+tCls+'" style="'+tStyle+'">'+E(c.title)+'</h4></div></a>';
}
function stmtCard(s,mode){
  const col='hsl(221, 44%, '+(10+((s.id||0)%8)*1.0).toFixed(1)+'%)';
  const wide=mode==='carousel';
  const box=wide?'flex:none;width:116px;height:130px;':'min-height:150px;';
  const cls=wide?'stmtpull':'stmtlb';
  return '<div class="'+cls+'" data-act="lb" data-i="'+s.id+'" style="cursor:pointer;position:relative;display:flex;flex-direction:column;padding:9px 11px;background:'+col+';border-radius:14px;overflow:hidden;'+(s.pin?'box-shadow:0 0 0 2px rgba(62,123,255,.6);':'')+box+'">'+
    '<div style="display:flex;align-items:center;gap:5px;margin-bottom:7px;"><span style="white-space:nowrap;background:rgba(13,18,28,.5);color:#fff;font-size:9.5px;font-weight:700;padding:3px 7px;border-radius:5px;">'+E(s.disp)+'</span>'+(s.pin?'<span style="white-space:nowrap;background:#3E7BFF;color:#fff;font-size:9px;font-weight:800;padding:3px 7px;border-radius:5px;">'+E(s.badge||'최초')+'</span>':'')+'</div>'+
    '<div style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11.5px;line-height:1.32;font-weight:800;color:#fff;letter-spacing:-.02em;text-shadow:0 1px 3px rgba(0,0,0,.3);">'+E(s.org)+(s.org2?' <span style="font-weight:700;opacity:.9;">'+E(s.org2)+'</span>':'')+'</div>'+
  '</div>';
}
function row(key,title,accent,accentBg,list,links,raw,upd){
  const ex=ST.expanded===key, expanded=ex;
  const wide=ST.w>=860, collapsed=wide&&ST.expanded!=null&&!ex;
  const cards=sortBy(list,ST.sort[key]);if(key==='stmt')cards.sort((a,b)=>((a.pin||99)-(b.pin||99)));
  const sortLbl=ST.sort[key]==='new'?'최신순':'오래된순';
  const openLbl=ex?'접기 ✕':'전체보기';
  let body;
  const cf=key==='stmt'?stmtCard:card;
  const stmtHidden=key==='stmt'&&ST.stmtHidden;
  if(stmtHidden){ body=''; }
  else if(!cards.length){ body='<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#5C677D;font-size:13px;font-weight:600;padding:24px;">성명문 링크 준비 중 — 추가해 주세요</div>'; }
  else if(collapsed){ body=''; }
  else if(expanded){ const arh=key==='stmt'?198:178; body='<div class="sb" style="flex:1;min-height:0;overflow-y:auto;padding:12px 18px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:13px;align-content:start;grid-auto-rows:'+arh+'px;">'+cards.map(c=>cf(c,'list',key)).join('')+'</div>'; }
  else { body='<div class="hsb wheelx" style="flex:1;min-height:'+(ST.w>=860?'0':'232px')+';'+(wide?'overflow:visible;':'overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-x;')+'display:flex;align-items:flex-start;gap:13px;padding:10px 18px 0;scroll-behavior:smooth;">'+cards.map(c=>cf(c,'carousel',key)).join('')+'</div>'; }
  const hideBtn=key==='stmt'?'<button data-act="stmthide" data-tip="'+(ST.stmtHidden?'성명문 펼치기':'성명문 숨기기')+'" aria-label="성명문 숨김 토글" class="btnh gn" style="flex:none;display:inline-flex;align-items:center;justify-content:center;padding:5px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#C2CAD8;"><svg width="14" height="14" viewBox="0 0 16 16" fill="none">'+(ST.stmtHidden?'<path d="M3 10l5-5 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>':'<path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>')+'</svg></button>':'';
  return '<section class="stmtsec" style="background:#131826;border:1px solid rgba(255,255,255,.07);border-radius:16px;display:flex;flex-direction:column;min-height:0;">'+
    '<div class="hsb" style="flex:none;height:43px;padding:0 18px;display:flex;align-items:center;gap:10px;overflow-x:auto;overflow-y:hidden;background:rgba(22,28,43,.38);border-bottom:1px solid rgba(255,255,255,.08);">'+
      hideBtn+
      '<h2 style="margin:0;flex:none;white-space:nowrap;font-size:16px;font-weight:900;letter-spacing:-.02em;color:#F4F6FB;">'+(raw?title:E(title))+'</h2>'+
      (stmtHidden?'':('<button class="btnh nv" data-act="sort" data-row="'+key+'" style="flex:none;white-space:nowrap;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;font-size:12px;font-weight:700;padding:5px 11px;border-radius:8px;">⇅ '+sortLbl+'</button>'+
      '<button class="btnh nv" data-act="expand" data-row="'+key+'" style="flex:none;white-space:nowrap;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;font-size:12px;font-weight:700;padding:5px 11px;border-radius:8px;">'+openLbl+'</button>'+
      (links?links.map(l=>'<a class="btnh" href="'+E(l.u)+'"'+(/^mailto:/.test(l.u)?'':' target="_blank" rel="noopener"')+' style="flex:none;white-space:nowrap;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.09);color:#fff;font-size:12px;font-weight:700;padding:5px 11px;border-radius:8px;text-decoration:none;">'+E(l.t)+'</a>').join(''):'')))+
      '<div style="flex:1;"></div>'+(stmtHidden?'':(upd?'<span style="flex:none;white-space:nowrap;font-size:11px;color:rgba(255,255,255,.6);font-weight:700;">'+E(upd)+'</span>':''))+'</div>'+body+'</section>';
}
function petCard(p,cmp,noCount,btn){
  return '<a class="pet" href="'+E(p.url||'#')+'" target="_blank" rel="noopener" style="display:flex;flex-direction:column;flex:none;background:#1E2840;'+(cmp?'border:none;border-radius:0;':'border:1px solid rgba(255,255,255,.1);border-left:4px solid #D8483A;border-radius:12px;')+'padding:7px 11px;">'+
   '<h3 style="margin:0 0 4px;font-size:12.5px;line-height:1.35;font-weight:700;letter-spacing:-.015em;color:#F4F6FB;">'+E(p.title)+'</h3>'+
   '<div style="display:flex;gap:12px;align-items:flex-start;">'+
     (p.qr?'<img src="'+E(p.qr)+'" alt="QR" width="52" height="52" loading="lazy" style="flex:none;background:#fff;border-radius:7px;padding:4px;box-sizing:border-box;">':'')+
     '<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-start;gap:4px;">'+
       (cmp?'':'<span style="font-size:16px;font-weight:800;color:#E0726E;letter-spacing:-.02em;white-space:nowrap;">'+E(p.dl||'6월 24일 (수) 18시 마감')+'</span>')+
       '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'+(p.count&&!noCount?'<span style="font-size:13px;color:#8C95A8;font-weight:600;white-space:nowrap;">'+E(p.count)+'</span>':'<span></span>')+
       '<span style="flex:none;display:inline-flex;align-items:center;gap:4px;background:#D8483A;color:#fff;font-size:13.5px;font-weight:800;padding:8px 18px;border-radius:9px;">'+(btn||'참여')+'</span></div>'+
     '</div>'+
   '</div>'+
  '</a>';
}
function noticeCard(n,i){
  const open=ST.ncard===i;
  const prev=open?'white-space:pre-wrap;':'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
  return '<div data-act="ncard" data-i="'+i+'" style="cursor:pointer;background:#1A2132;border:1px solid rgba(255,255,255,.08);border-left:4px solid '+n.badgeColor+';border-radius:11px;padding:13px 14px;margin-bottom:9px;">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'+(n.committee?'<span style="white-space:nowrap;font-size:10px;font-weight:800;color:#fff;background:#141414;padding:3px 8px;border-radius:4px;">비대위</span>':'')+'<span style="white-space:nowrap;font-size:10px;font-weight:800;color:'+n.badgeText+';background:'+n.badgeColor+';padding:3px 8px;border-radius:4px;">'+E(n.badge)+'</span><span style="font-size:11px;color:#8C95A8;font-weight:600;">'+E(n.date)+'</span><span style="flex:1;"></span><span style="font-size:11px;color:#9AA3B5;font-weight:700;white-space:nowrap;">'+(open?'접기 ▲':'전문 ▼')+'</span></div>'+
    '<h4 style="margin:0;font-size:14px;line-height:1.45;font-weight:800;color:#F4F6FB;">'+E(n.title)+'</h4>'+
    (open?'<div style="height:1px;background:rgba(255,255,255,.12);margin:11px 0 0;"></div>':'')+
    (open&&n.img?'<img src="'+E(n.img)+'" alt="" loading="lazy" style="display:block;width:100%;height:auto;border-radius:8px;margin-top:11px;">':'')+
    (n.bodyHtml?'<div style="margin-top:9px;font-size:12.5px;line-height:1.75;color:#C8D0DE;'+prev+'">'+n.bodyHtml+'</div>':'')+
  '</div>';
}
function shineStyle(){var R=function(a,b,d){return (a+Math.random()*(b-a)).toFixed(d===undefined?2:d);};return '--sd:'+R(1.7,3.1)+'s;--a1:'+R(0,2.8)+'s;--a2:'+R(0,2.8)+'s;--a3:'+R(0,2.8)+'s;--a4:'+R(0,2.8)+'s;--fz1:'+R(6.5,9.5,1)+'px;--fz2:'+R(5.5,8,1)+'px;--fz3:'+R(6,8.5,1)+'px;--fz4:'+R(6.5,9.5,1)+'px;--t1:'+R(-3,3,0)+'px;--r1:'+R(-6,1,0)+'px;--b2:'+R(-2,3,0)+'px;--r2:'+R(3,10,0)+'px;--t3:'+R(-4,1,0)+'px;--l3:'+R(-10,-3,0)+'px;--b4:'+R(-4,1,0)+'px;--l4:'+R(-6,1,0)+'px;';}
function shineStars(t){var R=function(a,b,d){return (a+Math.random()*(b-a)).toFixed(d===undefined?2:d);};var L=(t||'').length;var c=Math.max(3,Math.min(7,Math.round(L/2.6)));var s='';for(var i=0;i<c;i++){s+='<i class="shx" style="left:'+R(1,96,1)+'%;top:'+R(-7,14,0)+'px;font-size:'+R(5,9,1)+'px;--sd:'+R(1.6,3.1)+'s;animation-delay:'+R(0,2.8)+'s;">✦</i>';}return s;}
function rbPanel(mob){
  var rb0=(DATA.rallyBoard||[]).slice();
  var rb=rb0.filter(function(x){return x.r;}).sort(function(a,b){return a.r-b.r;}).concat(rb0.filter(function(x){return !x.r&&x.on;}).sort(function(a,b){return a.on-b.on;})).concat(rb0.filter(function(x){return !x.r&&!x.on;}));
  var rows=Math.ceil(rb.length/6)||1;
  function cell(x){
    var mc=x.r===1?'#FFCB39':x.r===2?'#86CDEC':x.r===3?'#D08A4E':'#C9D2E1';
    if(x.blank) return '<div style="font-size:11px;line-height:1.5;white-space:nowrap;">&nbsp;</div>';
    if(x.r) return '<div'+(x.r&&x.r<=3?' class="shine"':'')+' style="'+(x.r<=3?shineStyle():'')+'display:flex;align-items:center;gap:5px;font-size:11px;line-height:1.5;white-space:nowrap;font-weight:800;color:'+mc+';"><span style="font-weight:900;">'+x.r+'등</span><span>'+E(x.n)+'</span></div>';
    if(x.on) return '<div style="font-size:11px;line-height:1.5;white-space:nowrap;font-weight:700;color:#C9D2E1;">'+E(x.n)+'</div>';
    if(x.bg) return '<div style="display:inline-flex;align-items:center;font-size:11px;line-height:1.5;white-space:nowrap;font-weight:700;color:#F1DEC6;background:linear-gradient(180deg,#5E3A12,#2E1906);border:1px solid rgba(150,100,52,.5);padding:0 8px;border-radius:7px;box-shadow:0 1px 5px -1px rgba(70,40,10,.6);">'+E(x.n)+'</div>';
    return '<div style="font-size:11px;line-height:1.5;white-space:nowrap;font-weight:600;color:#C9D2E1;opacity:.42;">'+E(x.n)+'</div>';
  }
  var __bus=(DATA.busBoard||[]);
  var __busRows=Math.ceil(__bus.length/6)||1;
  function buscell(x){
    var mc=x.r===1?'#FFCB39':x.r===2?'#86CDEC':x.r===3?'#D08A4E':'#C9D2E1';
    if(x.r) return '<div'+(x.r<=3?' class="shine"':'')+' style="'+(x.r<=3?shineStyle():'')+'display:flex;align-items:center;gap:5px;font-size:11px;line-height:1.5;white-space:nowrap;font-weight:800;color:'+mc+';"><span style="font-weight:900;">'+x.r+'등</span><span>'+E(x.n)+'</span></div>';
    if(x.on) return '<div style="font-size:11px;line-height:1.5;white-space:nowrap;font-weight:700;color:#C9D2E1;">'+E(x.n)+'</div>';
    return '<div style="font-size:11px;line-height:1.5;white-space:nowrap;font-weight:600;color:#C9D2E1;opacity:.42;">'+E(x.n)+'</div>';
  }
  var __busBlock='<div style="flex:none;">'
    +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;"><span style="display:inline-block;font-size:13px;line-height:1.5;font-weight:900;color:#fff;background:linear-gradient(180deg,#E0922C,#B86A18);border:1px solid rgba(245,205,150,.5);padding:3px 12px;border-radius:8px;letter-spacing:-.02em;white-space:nowrap;box-shadow:0 2px 8px -2px rgba(200,130,40,.55);">버스대절</span></div>'
    +'<div style="display:grid;grid-auto-flow:row;row-gap:3px;justify-items:start;">'+__bus.map(buscell).join('')+'</div>'
  +'</div>';
  if(mob){
    function mlabel(txt,grad,bd){return '<span style="flex:none;display:inline-block;width:62px;text-align:center;box-sizing:border-box;font-size:12px;line-height:1.4;font-weight:900;color:#fff;background:'+grad+';border:1px solid '+bd+';padding:2px 0;border-radius:8px;letter-spacing:-.03em;white-space:nowrap;box-shadow:0 2px 8px -2px rgba(0,0,0,.4);">'+txt+'</span>';}
    var subBtn='<button data-board="sub" style="flex:none;width:62px;box-sizing:border-box;text-align:center;cursor:pointer;font-size:12px;line-height:1.4;font-weight:900;color:#fff;background:linear-gradient(180deg,#5A8AE0,#3559A6);border:1px solid rgba(150,184,244,.6);padding:2px 0;border-radius:8px;letter-spacing:-.03em;white-space:nowrap;">분과학회</button>';
    var resBtn='<button data-board="research" style="flex:none;width:62px;box-sizing:border-box;text-align:center;cursor:pointer;font-size:12px;line-height:1.4;font-weight:900;color:#fff;background:linear-gradient(180deg,#46C088,#2C8159);border:1px solid rgba(120,224,170,.55);padding:2px 0;border-radius:8px;letter-spacing:-.03em;white-space:nowrap;">연구회</button>';
    var mact='<div style="flex:1;min-width:0;display:flex;align-items:center;">'
      +'<a href="https://open.kakao.com/o/pCuo1Fzi" target="_blank" rel="noopener" class="ktalk" style="flex:1;justify-content:center;display:inline-flex;align-items:center;gap:5px;background:#FEE500;color:#1A1A1A;font-size:12px;font-weight:800;letter-spacing:-.01em;padding:8px 13px;border-radius:9px;white-space:nowrap;box-shadow:0 3px 12px -3px rgba(254,229,0,.5),inset 0 1px 0 rgba(255,255,255,.5);"><span style="font-size:13px;">💬</span>도수치료 관리급여 저지 단톡방</a>'
    +'</div>';
    return '<div style="width:100%;display:flex;align-items:stretch;gap:9px;">'
      +'<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;">'
        +'<div class="mrk" style="display:flex;align-items:center;gap:11px;flex-wrap:wrap;">'+mlabel('집회공지','linear-gradient(180deg,#DC5048,#A82E27)','rgba(245,165,156,.5)')+rb.map(cell).join('')+'</div>'
        +'<div class="mrk" style="display:flex;align-items:center;gap:11px;flex-wrap:wrap;">'+mlabel('버스대절','linear-gradient(180deg,#E0922C,#B86A18)','rgba(245,205,150,.5)')+__bus.map(buscell).join('')+'</div>'
        +'<div style="display:flex;align-items:center;gap:10px;"><div style="flex:none;display:flex;flex-direction:column;gap:4px;">'+subBtn+resBtn+'</div>'+mact+'</div>'
      +'</div>'
    +'</div>';
  }
  return '<div style="display:flex;align-items:flex-start;gap:6px;"><div style="flex:none;">'
    +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;"><span style="display:inline-block;font-size:13px;line-height:1.5;font-weight:900;color:#fff;background:linear-gradient(180deg,#DC5048,#A82E27);border:1px solid rgba(245,165,156,.5);padding:3px 12px;border-radius:8px;letter-spacing:-.02em;white-space:nowrap;box-shadow:0 2px 8px -2px rgba(190,60,50,.55);">협회 집회공지</span></div>'
    +'<div style="display:grid;grid-auto-flow:row;row-gap:3px;justify-items:start;">'+rb.map(cell).join('')+'</div>'
  +'</div>'
  +'<div style="flex:none;align-self:stretch;width:1px;background:rgba(255,255,255,.16);margin:0 2px;"></div>'
  +__busBlock
  +'<div style="flex:none;align-self:stretch;width:1px;background:rgba(255,255,255,.16);margin:0 2px;"></div>'
  +'<div style="flex:none;align-self:flex-start;display:flex;flex-direction:column;align-items:stretch;gap:5px;"><button data-board="sub" style="flex:none;cursor:pointer;font-size:13px;line-height:1.5;font-weight:900;color:#fff;background:linear-gradient(180deg,#5A8AE0,#3559A6);border:1px solid rgba(150,184,244,.6);padding:3px 12px;border-radius:8px;letter-spacing:-.02em;white-space:nowrap;box-shadow:0 2px 8px -2px rgba(70,120,220,.6);">분과학회</button><button data-board="research" style="flex:none;cursor:pointer;font-size:13px;line-height:1.5;font-weight:900;color:#fff;background:linear-gradient(180deg,#46C088,#2C8159);border:1px solid rgba(120,224,170,.55);padding:3px 12px;border-radius:8px;letter-spacing:-.02em;white-space:nowrap;box-shadow:0 2px 8px -2px rgba(60,180,120,.6);">연구회</button></div>'
  +'</div>';
}
function boardPopup(){
  if(!ST.boardPop) return '';
  var isSub=ST.boardPop==='sub';
  var list=(isSub?DATA.subBoard:DATA.researchBoard)||[];
  var ttl=isSub?'분과학회 집회공지 현황':'연구회 집회공지 현황';
  var done=list.filter(function(x){return x.r||x.done;}).length;
  var sorted=list.filter(function(x){return x.r;}).sort(function(a,b){return a.r-b.r;}).concat(list.filter(function(x){return !x.r&&x.done;})).concat(list.filter(function(x){return !x.r&&!x.done;}));
  var rows=sorted.map(function(x){
    var mc=x.r===1?'#FFCB39':x.r===2?'#86CDEC':x.r===3?'#D08A4E':'#C9D2E1';
    if(x.r) return '<div class="shine" style="'+shineStyle()+'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:'+mc+';padding:9px 4px;border-bottom:1px solid rgba(255,255,255,.07);"><span style="font-weight:900;flex:none;">'+x.r+'등</span><span style="position:relative;">'+E(x.n)+shineStars(x.n)+'</span></div>';
    if(x.done) return '<div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#7FE0B0;padding:9px 4px;border-bottom:1px solid rgba(255,255,255,.07);"><span style="flex:none;color:#46D08A;font-weight:900;">✓</span><span style="position:relative;">'+E(x.n)+'</span></div>';
    return '<div style="font-size:14px;font-weight:600;color:#C9D2E1;opacity:.5;padding:9px 4px;border-bottom:1px solid rgba(255,255,255,.07);">'+E(x.n)+'</div>';
  }).join('');
  return '<div data-act="boardpopbd" style="position:fixed;inset:0;z-index:210;">'
    +'<div id="boardDD" class="sb" style="position:fixed;top:0;left:-9999px;width:min(400px,94vw);max-height:70vh;overflow-y:auto;background:#161B28;border:1px solid rgba(255,255,255,.14);border-radius:13px;box-shadow:0 20px 50px rgba(0,0,0,.55);padding:11px 14px 12px;">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;"><span style="font-size:14.5px;font-weight:900;color:'+(isSub?'#9FC2F2':'#7FE0B0')+';letter-spacing:-.02em;">'+ttl+'</span><span style="font-size:11px;font-weight:800;color:#46D08A;background:rgba(70,208,138,.15);padding:2px 7px;border-radius:6px;">'+done+'/'+list.length+'</span><span style="flex:1;"></span><button data-act="boardpopx" style="flex:none;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:12px;font-weight:800;padding:5px 11px;border-radius:7px;cursor:pointer;">닫기 ✕</button></div>'
    +rows
    +'</div></div>';
}
function clusterFeed(list){
  var byKey={}, out=[];
  list.forEach(function(c){
    if(c.group && byKey[c.group]){ byKey[c.group]._items.push(c); return; }
    var rep=Object.assign({},c); rep._items=[c]; out.push(rep);
    if(c.group){ byKey[c.group]=rep; }
  });
  out.forEach(function(r){
    r._items.sort(function(a,b){ return String(a.dt||a.date||'').localeCompare(String(b.dt||b.date||'')); });
    var f=r._items[0];
    r.chip=f.chip; r.title=f.title; r.url=f.url; r.img=f.img; r.dt=f.dt; r.date=f.date; r.disp=f.disp;
    r._more=r._items.length-1;
    var L=r._items[r._items.length-1]; r._last=L.dt||L.date||''; r._freshN=r._items.filter(function(x){return isNew(x.dt);}).length;
  });
  return out;
}
function feedHybrid(list,feed){
  var wide=ST.w>=860;
  if(!list.length) return '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#5C677D;font-size:13px;font-weight:600;padding:24px;">준비 중</div>';
  var _sk=ST.sort[feed];
  // 히어로 = 핀(pin) 지정 기사 우선, 없으면 가장 최신 기사 1건(단독, 묶음 아님)
  var _pin=list.filter(function(x){return x.pin;});
  var _ha=(_pin.length?_pin:list.slice()).sort(function(a,b){return String(b.dt||b.date||'').localeCompare(String(a.dt||a.date||''));})[0];
  var hero=Object.assign({},_ha); hero._items=[_ha]; hero._more=0; hero._last=_ha.dt||_ha.date||''; hero._freshN=isNew(_ha.dt)?1:0; hero._feed=feed;
  // 목록 = 나머지를 묶음 처리(히어로 기사 제외), 최근활동순
  var cl=clusterFeed(list.filter(function(x){return x!==_ha;})); cl.forEach(function(r){r._feed=feed;});
  cl.sort(function(a,b){var ka=String(a._last||a.dt||a.date||''),kb=String(b._last||b.dt||b.date||'');return _sk==='new'?kb.localeCompare(ka):ka.localeCompare(kb);});
  var rest=cl;
  function meta(c){var rt=relTime(c.dt);return (c.chip?E(c.chip)+' · ':'')+E(c.disp)+(rt?' · '+rt:'');}
  function accSub(c){var subs=(c._items||[]).slice(1);if(!subs.length)return '';return subs.map(function(s,k){var rt=relTime(s.dt);return '<a href="'+E(s.url||'#')+'" target="_blank" rel="noopener" style="display:block;color:inherit;text-decoration:none;padding:6px 0;'+(k>0?'border-top:1px solid rgba(255,255,255,.13);':'')+'"><div style="font-size:11px;font-weight:800;color:#9FC2F2;">'+E(s.chip||'매체')+' <span style="color:#8A93A6;font-weight:700;">· '+E(s.disp)+(rt?' · '+rt:'')+'</span>'+(isNew(s.dt)?' <span style="color:#FF6B6E;font-weight:900;font-size:10px;">NEW</span>':'')+'</div><div style="font-size:12px;color:#C2CAD8;line-height:1.32;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;">'+E(s.title)+'</div></a>';}).join('');}
  function pill(c){var more=c._more||0;if(!more)return '';var op=ST.acc===c.group;return '<span data-act="acc" data-grp="'+E(c.group||'')+'" data-tip="'+(op?'닫기':'같은 사안 다른 매체 펼치기')+'" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;background:rgba(233,211,138,'+(op?'.3':'.18')+');border:1px solid rgba(233,211,138,.55);color:#E9D38A;padding:2px 9px;border-radius:7px;font-weight:800;font-size:11.5px;">+'+more+'개 매체 '+(op?'▾':'▸')+'</span>';}
  function rowItem(c){
    var grp=(c._more||0)>0;
    var op=grp&&ST.acc===c.group;
    var row='<a class="card"'+(grp?' data-act="grpcard" data-grp="'+E(c.group||'')+'"':'')+' href="'+E(c.url||'#')+'" target="_blank" rel="noopener" title="'+E(c.title)+'" style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:11px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);color:inherit;text-decoration:none;">'
      +'<span style="flex:none;width:7px;height:7px;border-radius:50%;margin-top:6px;background:'+(isNew(c.dt)?'#FF6B6E':((c._freshN||0)>0?'#7FB0F0':'#5B86C8'))+';box-shadow:0 0 0 3px '+(isNew(c.dt)?'rgba(255,107,110,.18)':((c._freshN||0)>0?'rgba(127,176,240,.18)':'rgba(91,134,200,.16)'))+';"></span>'
      +'<div style="flex:1;min-width:0;"><div style="font-size:14px;line-height:1.36;font-weight:700;color:#EDEFF5;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">'+E(c.title)+'</div>'
      +'<div style="margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;font-weight:700;color:#9AA8BE;"><span>'+meta(c)+'</span>'+(isNew(c.dt)?'<span style="color:#FF6B6E;font-weight:900;">NEW</span>':((c._freshN||0)>0?'<span style="color:#7FB0F0;font-weight:800;">↻ 새 보도 '+c._freshN+'</span>':''))+pill(c)+'</div></div>'
    +'</a>';
    return '<div style="flex:none;">'+row+(op?'<div style="margin:2px 0 2px 24px;border-left:2px solid rgba(233,211,138,.5);padding-left:11px;">'+accSub(c)+'</div>':'')+'</div>';
  }
  var heroImg=hero.img?'<img src="'+E(hero.img)+'" loading="lazy" alt="" onerror="this.remove()" style="width:100%;height:100%;object-fit:cover;display:block;">':'<span style="font-size:13px;color:rgba(255,255,255,.3);">기사 썸네일</span>';
  var heroBadge=hero._more>0?'<span data-act="acc" data-grp="'+E(hero.group||'')+'" data-tip="'+(ST.acc===hero.group?'닫기':'같은 사안 다른 매체 펼치기')+'" style="cursor:pointer;position:absolute;top:11px;left:11px;z-index:4;font-size:11px;font-weight:800;color:#1A1A1A;background:#E9D38A;padding:4px 9px;border-radius:6px;">+'+hero._more+'개 매체 '+(ST.acc===hero.group?'▾':'▸')+'</span>':'';
  var heroNew=isNew(hero.dt)?'<span style="position:absolute;top:11px;right:11px;z-index:3;font-size:'+(wide?'13px':'10px')+';font-weight:900;color:#fff;background:#E2403A;padding:'+(wide?'4px 11px':'3px 8px')+';border-radius:6px;box-shadow:0 2px 7px -1px rgba(216,72,58,.6);letter-spacing:.05em;">NEW</span>':((hero._freshN||0)>0?'<span style="position:absolute;top:11px;right:11px;z-index:3;font-size:'+(wide?'12px':'10px')+';font-weight:800;color:#fff;background:#3559A6;padding:'+(wide?'4px 10px':'3px 8px')+';border-radius:6px;box-shadow:0 2px 7px -1px rgba(53,89,166,.55);">↻ 새 보도</span>':'');
  var heroBox=wide?'flex:none;width:54%;height:100%;':'flex:none;width:100%;height:210px;';
  var heroGrp=hero._more>0?' data-act="grpcard" data-grp="'+E(hero.group||'')+'"':'';
  var heroEl='<a class="card"'+heroGrp+' href="'+E(hero.url||'#')+'" target="_blank" rel="noopener" title="'+E(hero.title)+'" style="position:relative;'+heroBox+'border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0F1420;color:inherit;border:1px solid rgba(255,255,255,.1);">'
    +heroImg
    +'<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,18,28,0) 24%,rgba(13,18,28,.5) 46%,rgba(13,18,28,.9) 64%,rgba(13,18,28,1) 74%,rgba(13,18,28,1) 100%);"></div>'
    +heroNew+heroBadge
    +'<div style="position:absolute;left:0;right:0;bottom:0;padding:'+(wide?'18px 20px 18px':'15px 16px 16px')+';"><div style="font-size:'+(wide?'14px':'11px')+';font-weight:800;color:#FFB4AE;margin-bottom:7px;">'+meta(hero)+'</div><h3 style="margin:0;font-size:'+(wide?'25px':'16.5px')+';line-height:1.3;font-weight:800;color:#fff;letter-spacing:-.015em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 1px 8px rgba(0,0,0,.6);">'+E(hero.title)+'</h3></div>'
  +'</a>';
  var heroAcc=(hero._more>0&&ST.acc===hero.group)?'<div style="flex:none;background:rgba(233,211,138,.08);border:1px solid rgba(233,211,138,.3);border-radius:11px;padding:9px 12px 6px;"><div style="font-size:11px;font-weight:800;color:#E9D38A;margin-bottom:2px;">대표 기사 · 같은 사안 다른 매체 '+hero._more+'곳</div>'+accSub(hero)+'</div>':'';
  var mob=!wide; var shown=mob?rest.slice(0,5):rest; var moreN=rest.length-shown.length;
  var moreBtn=moreN>0?'<button data-act="expand" data-row="feed" style="flex:none;margin-top:3px;width:100%;cursor:pointer;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#C2CAD8;font-size:13px;font-weight:800;padding:11px;border-radius:11px;">기사 더보기 (+'+moreN+'건)</button>':'';
  var listEl='<div class="sb" id="feedList" style="flex:1;min-width:0;'+(wide?'height:100%;':'')+'overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:2px 4px 2px 0;">'+heroAcc+shown.map(rowItem).join('')+moreBtn+'</div>';
  return '<div style="flex:1;min-height:0;display:flex;'+(wide?'flex-direction:row;':'flex-direction:column;')+'gap:14px;padding:14px 18px;">'+heroEl+listEl+'</div>';
}
function bigFeed(){
  var wide=ST.w>=860;
  var feed=ST.feed||'ko';
  var both=feed==='both';
  var isKo=feed==='ko';
  var isIns=feed==='insure';
  var ex=ST.expanded, expanded=ex==='feed', collapsed=wide&&ex!=null&&!expanded;
  var accent=both?'#7E8AC0':(isKo?'#D8483A':isIns?'#46C088':'#5B86C8');
  var tint=both?'rgba(126,138,192,.32)':(isKo?'rgba(216,72,58,.32)':isIns?'rgba(70,192,136,.32)':'rgba(91,134,200,.32)');
  function fanRow(srcKey){
    var l=sortBy(DATA[srcKey],ST.sort[srcKey]);
    if(!l.length) return '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#5C677D;font-size:13px;font-weight:600;">준비 중</div>';
    var cl=clusterFeed(l); cl.forEach(function(r){r._feed=srcKey;}); var triple=cl.concat(cl).concat(cl);
    return '<div class="fanrow" data-loop="1" style="flex:1;min-height:0;overflow-x:auto;overflow-y:hidden;display:flex;align-items:center;gap:12px;padding:8px 24px;">'+triple.map(function(c){return card(c,'carousel','feedbig');}).join('')+'</div>';
  }
  function miniLab(label,col){return '<div style="flex:none;display:flex;align-items:center;gap:7px;padding:6px 18px 2px;"><span style="width:8px;height:8px;border-radius:2px;background:'+col+';"></span><span style="font-size:13.5px;font-weight:800;color:#D7DEEC;letter-spacing:-.01em;">'+label+'</span></div>';}
  var list=both?DATA.ko:sortBy(isKo?DATA.ko:isIns?(DATA.insure||[]):DATA.press,ST.sort[feed]);
  var sortLbl=ST.sort[feed]==='new'?'최신순':'오래된순';
  var openLbl=expanded?'접기 ✕':'전체보기';
  function tab(k,label,col){var on=feed===k;return '<button data-act="feed" data-feed="'+k+'" class="btnh" style="flex:none;white-space:nowrap;border:1px solid '+(on?col:'rgba(255,255,255,.1)')+';background:'+(on?col:'rgba(255,255,255,.03)')+';color:'+(on?'#fff':'rgba(255,255,255,.4)')+';font-size:13px;font-weight:800;padding:7px 13px;border-radius:9px;box-shadow:'+(on?'0 4px 12px -4px '+col:'none')+';opacity:'+(on?'1':'.72')+';filter:'+(on?'none':'grayscale(.3)')+';">'+label+'</button>';}
  var bothBtn='<button data-act="feed" data-feed="both" class="btnh" data-tip="고영준·언론 기사 2행 같이 보기" aria-label="같이 보기" style="flex:none;display:inline-flex;align-items:center;justify-content:center;border:1px solid '+(both?'#7E8AC0':'rgba(255,255,255,.1)')+';background:'+(both?'#7E8AC0':'rgba(255,255,255,.03)')+';color:'+(both?'#fff':'rgba(255,255,255,.5)')+';padding:7px 10px;border-radius:9px;box-shadow:'+(both?'0 4px 12px -4px #7E8AC0':'none')+';"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.6" width="12" height="4.6" rx="1.4" fill="currentColor"/><rect x="2" y="8.8" width="12" height="4.6" rx="1.4" fill="currentColor"/></svg></button>';
  var tabs=bothBtn+tab('ko','<span class="glow">고영준<i class="spk a"></i><i class="spk b"></i><i class="spk c"></i><i class="spk d"></i><i class="spk e"></i><i class="spk f"></i></span> 기자 · 서울일보','#D8483A')+tab('press','언론 보도 모아보기','#5B86C8')+((DATA.insure&&DATA.insure.length)?tab('insure','보험사 문제','#46C088'):'');
  var links=isKo?[{t:'인스타',u:'http://instagram.com/kyjseoulilbo'},{t:'페북',u:'http://facebook.com/kyjseoulilbo'},{t:'제보',u:'mailto:kyjseoulilbo@kakao.com'}]:null;
  var body;
  if(both){
    body='<div style="flex:1;min-height:0;display:flex;flex-direction:column;">'+
      '<div style="flex:1;min-height:0;display:flex;flex-direction:column;">'+miniLab('고영준 기자 · 서울일보','#D8483A')+fanRow('ko')+'</div>'+'<div style="flex:none;height:4px;margin:2px 14px;border-radius:3px;background:rgba(216,223,236,.5);"></div>'+
      '<div style="flex:1;min-height:0;display:flex;flex-direction:column;">'+miniLab('언론 보도 모아보기','#5B86C8')+fanRow('press')+'</div>'+
    '</div>';
  }
  else if(!list.length){body='<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#5C677D;font-size:13px;font-weight:600;padding:24px;">준비 중</div>';}
  else if(collapsed){body='';}
  else if(expanded){body='<div class="sb" style="flex:1;min-height:0;overflow-y:auto;padding:12px 18px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:13px;align-content:start;grid-auto-rows:200px;">'+list.map(function(c){return card(c,'list','feed');}).join('')+'</div>';}
  else{body=feedHybrid(list,feed);}
  var btn='border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;font-size:12px;font-weight:700;padding:6px 11px;border-radius:8px;';
  return '<section style="background:#131826;border:1px solid rgba(255,255,255,.07);border-left:4px solid '+accent+';border-radius:16px;display:flex;flex-direction:column;min-height:0;overflow:hidden;">'+
    '<div class="hsb" style="flex:none;height:43px;padding:0 16px;display:flex;align-items:center;gap:8px;overflow-x:auto;overflow-y:hidden;background:linear-gradient(90deg,'+tint+' 0%,'+tint+' 36%,rgba(22,28,43,.38) 68%);border-bottom:1px solid rgba(255,255,255,.08);">'+
      tabs+
      '<span style="flex:none;width:1px;height:22px;background:rgba(255,255,255,.12);margin:0 2px;"></span>'+
      (both?'':('<button class="btnh" data-act="sort" data-row="'+feed+'" style="flex:none;white-space:nowrap;'+btn+'">⇅ '+sortLbl+'</button>'+
      '<button class="btnh" data-act="expand" data-row="feed" style="flex:none;white-space:nowrap;'+btn+'">'+openLbl+'</button>'+
      (links?links.map(function(l){return '<a class="btnh" href="'+E(l.u)+'"'+(/^mailto:/.test(l.u)?'':' target="_blank" rel="noopener"')+' style="flex:none;white-space:nowrap;'+btn+'">'+E(l.t)+'</a>';}).join(''):'')))+
      '<div style="flex:1;"></div><span style="flex:none;white-space:nowrap;font-size:12px;color:#AEB6C6;font-weight:800;">기사 '+(both?(DATA.ko.length+DATA.press.length):list.length)+'건</span><span style="flex:none;white-space:nowrap;font-size:11px;color:rgba(255,255,255,.55);font-weight:700;">'+E(DATA.upd)+'</span>'+
    '</div>'+body+'</section>';
}
function grpOverlay(){
  if(!ST.grp) return '';
  var feed=ST.grp.feed, key=ST.grp.key;
  var items=sortBy((DATA[feed]||[]).filter(function(x){return x.group===key;}),'new');
  if(!items.length) return '';
  return '<div data-act="grpx" style="position:fixed;inset:0;z-index:210;background:rgba(8,10,16,.92);display:flex;align-items:center;justify-content:center;padding:24px;">'+
    '<div onclick="event.stopPropagation()" style="width:min(680px,100%);max-height:86vh;display:flex;flex-direction:column;background:#161B28;border:1px solid rgba(255,255,255,.12);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden;">'+
      '<div style="flex:none;display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.08);">'+
        '<span style="font-size:11px;font-weight:800;color:#1A1A1A;background:#E9D38A;padding:4px 10px;border-radius:6px;">같은 사안</span>'+
        '<span style="font-size:15px;font-weight:800;color:#F4F6FB;">'+items.length+'개 매체 보도</span>'+
        '<span style="flex:1;"></span>'+
        '<button data-act="grpx" style="border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;font-size:13px;font-weight:800;padding:7px 15px;border-radius:8px;">닫기 ✕</button>'+
      '</div>'+
      '<div class="sb" style="flex:1;min-height:0;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;">'+
        items.map(function(x){return '<a href="'+E(x.url||'#')+'" target="_blank" rel="noopener" class="pet" style="display:flex;align-items:center;gap:14px;padding:11px 13px;border-radius:12px;background:#1A2132;border:1px solid rgba(255,255,255,.08);text-decoration:none;">'+
          (x.img?'<img src="'+E(x.img)+'" alt="" style="flex:none;width:84px;height:54px;object-fit:cover;border-radius:8px;background:#0F1420;">':'')+
          '<div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="font-size:11.5px;font-weight:800;color:#9FC1F0;">'+E(x.chip||'')+'</span><span style="font-size:11px;color:#8C95A8;font-weight:600;">'+E(x.disp||'')+'</span></div>'+
          '<div style="font-size:13.5px;line-height:1.4;font-weight:700;color:#EDEFF5;">'+E(x.title)+'</div></div>'+
          '<span style="flex:none;color:#8C95A8;font-size:16px;">→</span>'+
        '</a>';}).join('')+
      '</div>'+
    '</div></div>';
}
function busCardsHtml(){return (DATA.busInfo||[]).map(function(b,i,arr){var mb=(i===arr.length-1?'0':'7px');var head='<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;"><span style="font-size:14.5px;font-weight:900;color:'+b.accent+';">'+E(b.name)+'</span>'+(b.badge&&!b.closed?'<span style="font-size:10.5px;font-weight:800;color:#1A1A1A;background:'+b.accent+';padding:1px 7px;border-radius:5px;">'+E(b.badge)+'</span>':'')+'</div>';var rows=b.rows.map(function(f){return '<div style="display:flex;gap:7px;font-size:12px;line-height:1.46;"><span style="flex:none;min-width:58px;color:#9AA8BE;font-weight:700;">'+E(f[0])+'</span><span style="flex:1;min-width:0;color:#E9EBF1;font-weight:600;word-break:break-all;">'+E(f[1])+'</span></div>';}).join('');var note=b.note?'<div style="margin-top:5px;font-size:11.5px;font-weight:800;color:#9FE6C2;background:rgba(70,192,136,.12);border:1px solid rgba(70,192,136,.4);padding:4px 9px;border-radius:7px;">'+E(b.note)+'</div>':'';var link=(b.link&&!b.closed)?'<a href="'+E(b.link)+'" target="_blank" rel="noopener" style="display:block;margin-top:6px;text-align:center;background:linear-gradient(180deg,#5A8AE0,#3559A6);color:#fff;font-weight:800;font-size:13px;padding:7px;border-radius:8px;text-decoration:none;">신청 폼 열기</a>':'';var inner;if(b.closed){inner='<div style="display:flex;align-items:stretch;gap:11px;"><div style="flex:1;min-width:0;">'+head+rows+'</div><div style="flex:none;width:98px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-left:1px dashed rgba(255,255,255,.2);padding-left:8px;"><span style="font-size:29px;font-weight:900;color:#B7C0D0;letter-spacing:.14em;line-height:1;">마감</span><span style="margin-top:9px;font-size:11px;font-weight:800;color:#9FE6C2;text-align:center;line-height:1.45;">버스대절<br>감사합니다</span></div></div>'+note;}else{inner=head+rows+note+link;}return '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-left:3px solid '+b.accent+';border-radius:11px;padding:8px 11px;margin-bottom:'+mb+';">'+inner+'</div>';}).join('');}
function buzzChartSVG(dates, values, color, unit, zoom){
  if(!dates.length||!values.length) return '<div style="color:#8A93A6;font-size:14px;padding:30px;text-align:center;">데이터 없음</div>';
  var n=dates.length, W=900, H=270, pl=46, pr=18, pt=14, pb=28;
  var mx=Math.max.apply(null, values); if(!(mx>0)) mx=1; var ymax=(Math.ceil(mx/10)*10||10)/(zoom||1); if(ymax<1)ymax=1;
  function X(i){return pl+(n<=1?0:i/(n-1)*(W-pl-pr));}
  function Y(v){return H-pb-(v/ymax)*(H-pt-pb);}
  function fmt(v){v=Math.round(v);return v>=1000?(v/1000).toFixed(v>=10000?0:1)+'k':(''+v);}
  var grid='';
  [0,0.5,1].forEach(function(f){var val=ymax*f;var y=Y(val);grid+='<line x1="'+pl+'" y1="'+y.toFixed(1)+'" x2="'+(W-pr)+'" y2="'+y.toFixed(1)+'" stroke="rgba(255,255,255,.08)"/><text x="'+(pl-6)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" font-size="13" fill="#8A93A6">'+fmt(val)+'</text>';});
  var dpath=values.map(function(v,i){return (i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1);}).join(' ');
  var area='M'+X(0).toFixed(1)+' '+(H-pb)+' '+values.map(function(v,i){return 'L'+X(i).toFixed(1)+' '+Y(v).toFixed(1);}).join(' ')+' L'+X(n-1).toFixed(1)+' '+(H-pb)+' Z';
  var dots='', hov='', sw=(n>1?(W-pl-pr)/(n-1):W);
  values.forEach(function(v,i){var x=X(i),y=Y(v);if(i%9===0||i===n-1)dots+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="2.6" fill="'+color+'"/>';var dt=(dates[i]||'').slice(5).replace('-','.');var lbl=(unit==='지수')?('지수 '+v):(v.toLocaleString('ko-KR')+'건');hov+='<rect x="'+(x-sw/2).toFixed(1)+'" y="'+pt+'" width="'+sw.toFixed(1)+'" height="'+(H-pt-pb)+'" fill="transparent" data-tip="'+dt+' · '+lbl+'"/>';});
  var xlab='';
  [0,Math.floor(n/4),Math.floor(n/2),Math.floor(n*3/4),n-1].forEach(function(i){var dt=(dates[i]||'').slice(5).replace('-','.');xlab+='<text x="'+X(i).toFixed(1)+'" y="'+(H-9)+'" text-anchor="'+(i===0?'start':i===n-1?'end':'middle')+'" font-size="13" fill="#8A93A6">'+dt+'</text>';});
  return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;overflow:hidden;"><defs><linearGradient id="bzg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+color+'" stop-opacity="0.28"/><stop offset="1" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>'+grid+'<path d="'+area+'" fill="url(#bzg)" stroke="none"/><path d="'+dpath+'" fill="none" stroke="'+color+'" stroke-width="2.2" stroke-linejoin="round"/>'+dots+xlab+hov+'</svg>';
}
function buzzMultiSVG(dates, series, unit, hourly, zoom){
  if(!dates.length||!series.length) return '<div style="color:#8A93A6;font-size:14px;padding:30px;text-align:center;">데이터 없음</div>';
  var n=dates.length, W=900,H=270,pl=46,pr=18,pt=14,pb=28;
  var mx=0; series.forEach(function(s){(s.values||[]).forEach(function(v){if(v>mx)mx=v;});}); if(!(mx>0))mx=1; var ymax=(Math.ceil(mx/10)*10||10)/(zoom||1); if(ymax<1)ymax=1;
  function X(i){return pl+(n<=1?0:i/(n-1)*(W-pl-pr));}
  function Y(v){return H-pb-(v/ymax)*(H-pt-pb);}
  function fmt(v){v=Math.round(v);return v>=1000?(v/1000).toFixed(v>=10000?0:1)+'k':(''+v);}
  var grid='';
  [0,0.5,1].forEach(function(f){var val=ymax*f;var y=Y(val);grid+='<line x1="'+pl+'" y1="'+y.toFixed(1)+'" x2="'+(W-pr)+'" y2="'+y.toFixed(1)+'" stroke="rgba(255,255,255,.08)"/><text x="'+(pl-6)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" font-size="13" fill="#8A93A6">'+fmt(val)+'</text>';});
  var lines='';
  series.forEach(function(s){var vals=s.values||[];var d=vals.map(function(v,i){return (i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1);}).join(' ');lines+='<path d="'+d+'" fill="none" stroke="'+s.color+'" stroke-width="2.2" stroke-linejoin="round"/>';vals.forEach(function(v,i){if(n<=31||i===n-1){lines+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="'+(n<=2?3.6:2.6)+'" fill="'+s.color+'"/>';}});});
  var hov='', sw=(n>1?(W-pl-pr)/(n-1):W);
  for(var i=0;i<n;i++){var dt=hourly?(dates[i]||'').slice(5):(dates[i]||'').slice(5).replace('-','.');var parts=series.map(function(s){return s.name+' '+((s.values||[])[i]||0);}).join(' · ');hov+='<rect x="'+(X(i)-sw/2).toFixed(1)+'" y="'+pt+'" width="'+sw.toFixed(1)+'" height="'+(H-pt-pb)+'" fill="transparent" data-tip="'+dt+' · '+parts+'"/>';}
  var xlab='';
  [0,Math.floor(n/4),Math.floor(n/2),Math.floor(n*3/4),n-1].forEach(function(i){var dt=hourly?((dates[i]||'').split(' ')[1]||''):(dates[i]||'').slice(5).replace('-','.');xlab+='<text x="'+X(i).toFixed(1)+'" y="'+(H-9)+'" text-anchor="'+(i===0?'start':i===n-1?'end':'middle')+'" font-size="13" fill="#8A93A6">'+dt+'</text>';});
  return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;overflow:hidden;">'+grid+lines+xlab+hov+'</svg>';
}
function buzzOverlay(inline){
  if(!ST.buzz) return '';
  var b=DATA.buzz||{};
  var COL={'도수치료':'#E2403A','관리급여':'#5B86C8','실손보험':'#46C088','체외충격파':'#E0922C','물리치료사':'#2BB8C4'};
  var keys=(b.keywords)||['도수치료'];
  var kw=(ST.buzzKw&&keys.indexOf(ST.buzzKw)>=0)?ST.buzzKw:keys[0];
  var view=(['cnt','senti'].indexOf(ST.buzzView)>=0)?ST.buzzView:'all4';
  var col=COL[kw]||'#7E8AC0';
  var nv=b.naver||{};
  var dl=(nv.datalab&&nv.datalab.dates&&nv.datalab.dates.length)?nv.datalab:{dates:(b.trend&&b.trend.dates)||[],series:(b.trend&&b.trend.series)||{}};
  var totals=(nv.totals&&nv.totals[kw])||{};
  var rel=(nv.related&&nv.related[kw])||[];
  var ac=(b.related_naver&&b.related_naver[kw])||[];
  var gq=(b.related_google&&b.related_google[kw]&&b.related_google[kw].top)||[];
  function nf(n){return (n||0).toLocaleString('ko-KR');}
  var tabs=keys.map(function(k){var on=(view!=='all4')&&(k===kw);var c=COL[k]||'#7E8AC0';return '<button data-act="buzzkw" data-kw="'+E(k)+'" style="flex:none;cursor:pointer;font-size:13.5px;font-weight:800;padding:6px 12px;border-radius:8px;white-space:nowrap;border:1px solid '+(on?c:'rgba(255,255,255,.12)')+';background:'+(on?c:'rgba(255,255,255,.04)')+';color:'+(on?'#fff':'rgba(255,255,255,.5)')+';box-shadow:'+(on?'0 4px 12px -4px '+c:'none')+';">'+E(k)+'</button>';}).join('');
  var allBtn='<button data-act="buzzview" data-view="all4" style="flex:none;cursor:pointer;font-size:13.5px;font-weight:800;padding:6px 12px;border-radius:8px;white-space:nowrap;border:1px solid '+(view==='all4'?'#7E8AC0':'rgba(255,255,255,.12)')+';background:'+(view==='all4'?'#7E8AC0':'rgba(255,255,255,.04)')+';color:'+(view==='all4'?'#fff':'rgba(255,255,255,.5)')+';box-shadow:'+(view==='all4'?'0 4px 12px -4px #7E8AC0':'none')+';">종합</button>';
  var PER={'1일':1,'1주일':7,'1개월':30,'3개월':90,'6개월':180,'1년':365};
  var PORDER=['1일','1주일','1개월','3개월'];
  var metric=(['cnt','nidx','gidx'].indexOf(ST.buzzMetric)>=0)?ST.buzzMetric:'cnt';
  var zoom=+ST.buzzZoom||1;if(zoom<1)zoom=1;
  var zoomCtl='<div style="position:absolute;top:8px;right:10px;display:flex;align-items:center;gap:5px;z-index:3;"><button data-act="buzzzoom" data-z="out" title="축소" style="cursor:pointer;width:27px;height:27px;border-radius:7px;border:1px solid rgba(255,255,255,.18);background:rgba(15,20,32,.9);color:#C2CAD8;font-size:17px;font-weight:900;line-height:1;padding:0;">−</button>'+(zoom>1?'<span style="font-size:11px;font-weight:800;color:#9AA8BE;background:rgba(15,20,32,.9);padding:4px 7px;border-radius:6px;">×'+zoom+'</span>':'')+'<button data-act="buzzzoom" data-z="in" title="확대" style="cursor:pointer;width:27px;height:27px;border-radius:7px;border:1px solid rgba(255,255,255,.18);background:rgba(15,20,32,.9);color:#C2CAD8;font-size:17px;font-weight:900;line-height:1;padding:0;">+</button></div>';
  var daily=(nv.channel_daily&&nv.channel_daily[kw])||[];
  var gtr=(b.trend)||{dates:[],series:{}};
  if(metric==='gidx'&&!(gtr.dates&&gtr.dates.length))metric='cnt';
  function spanOf(ds){if(!ds||!ds.length)return 0;return Math.round((Date.parse(ds[ds.length-1])-Date.parse(ds[0]))/86400000)+1;}
  var spanDays=(metric==='cnt')?spanOf(daily.map(function(x){return x.date;})):(metric==='gidx')?spanOf(gtr.dates||[]):spanOf((dl.dates)||[]);
  var availPers=PORDER.filter(function(p){return PER[p]<=Math.max(1,spanDays)+2;});
  if(!availPers.length)availPers=['1일'];
  var per=(ST.buzzPeriod&&availPers.indexOf(ST.buzzPeriod)>=0)?ST.buzzPeriod:(availPers.indexOf('3개월')>=0?'3개월':availPers[availPers.length-1]);
  var chartInner='', legend='', unit='건';
  if(metric==='cnt'){
    var isHr=(per==='1일');
    var rows;
    if(isHr){var hsrc=(nv.hourly&&nv.hourly[kw])||[];rows=hsrc.map(function(pc,hi){var pa=hi>0?hsrc[hi-1]:null;var sd=pa&&(pa.t||'').slice(0,10)===(pc.t||'').slice(0,10);return {t:pc.t,news:sd?Math.max(0,(pc.news||0)-(pa.news||0)):(pc.news||0),blog:sd?Math.max(0,(pc.blog||0)-(pa.blog||0)):(pc.blog||0),cafe:sd?Math.max(0,(pc.cafe||0)-(pa.cafe||0)):(pc.cafe||0)};});}else{rows=daily.slice(Math.max(0,daily.length-PER[per]));}
    var cdates=rows.map(function(x){return isHr?x.t:x.date;});
    var CCH=[['all','전체'],['news','뉴스'],['blog','블로그'],['cafe','카페']];
    var cch=(ST.buzzCntCh&&CCH.some(function(x){return x[0]===ST.buzzCntCh;}))?ST.buzzCntCh:'all';
    var allser=[{name:'뉴스',color:'#5B86C8',key:'news',values:rows.map(function(x){return x.news||0;})},{name:'블로그',color:'#46C088',key:'blog',values:rows.map(function(x){return x.blog||0;})},{name:'카페',color:'#E0922C',key:'cafe',values:rows.map(function(x){return x.cafe||0;})}];
    var cser=(cch==='all')?allser:allser.filter(function(s){return s.key===cch;});
    var cchBtns=CCH.map(function(x){var on=x[0]===cch;var cc=x[0]==='news'?'#5B86C8':x[0]==='blog'?'#46C088':x[0]==='cafe'?'#E0922C':col;var sf=x[0]==='news'?'91,134,200':x[0]==='blog'?'70,192,136':x[0]==='cafe'?'224,146,44':'';var bd=on?cc:(sf?'rgba('+sf+',.55)':'rgba(255,255,255,.14)');var bg=on?cc:(sf?'rgba('+sf+',.14)':'transparent');var tx=on?'#fff':(sf?cc:'rgba(255,255,255,.55)');return '<button data-act="buzzcntch" data-cch="'+x[0]+'" style="flex:none;cursor:pointer;font-size:12px;font-weight:800;padding:3px 11px;border-radius:7px;border:1px solid '+bd+';background:'+bg+';color:'+tx+';">'+x[1]+'</button>';}).join('');
    legend='<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:4px 2px 7px;">'+cchBtns+'</div>';
    chartInner=buzzMultiSVG(cdates, cser, '건', isHr, zoom);
  } else {
    var srcD,srcV;
    if(metric==='gidx'){ srcD=gtr.dates||[]; srcV=(gtr.series&&gtr.series[kw])||[]; unit='지수'; }
    else { srcD=dl.dates||[]; srcV=(dl.series&&dl.series[kw])||[]; unit='지수'; }
    var ss=Math.max(0, srcD.length-PER[per]);
    chartInner=buzzChartSVG(srcD.slice(ss), srcV.slice(ss), col, unit, zoom);
  }
  var perBtns=availPers.map(function(p){var on=p===per;return '<button data-act="buzzper" data-per="'+p+'" style="flex:none;cursor:pointer;font-size:12px;font-weight:800;padding:4px 10px;border-radius:7px;border:1px solid '+(on?col:'rgba(255,255,255,.14)')+';background:'+(on?'rgba(255,255,255,.07)':'transparent')+';color:'+(on?'#fff':'rgba(255,255,255,.5)')+';">'+p+'</button>';}).join('');
  var metBtns=[['cnt','언급 건수',true],['nidx','네이버 지수',!!(dl.dates&&dl.dates.length)],['gidx','구글 지수',!!(gtr.dates&&gtr.dates.length)]].filter(function(m){return m[2];}).map(function(m){var on=metric===m[0];return '<button data-act="buzzmetric" data-met="'+m[0]+'" style="flex:none;cursor:pointer;font-size:12.5px;font-weight:800;padding:5px 11px;border-radius:7px;border:1px solid '+(on?col:'rgba(255,255,255,.14)')+';background:'+(on?col:'transparent')+';color:'+(on?'#fff':'rgba(255,255,255,.55)')+';">'+m[1]+'</button>';}).join('');
  var chartNote=(metric==='cnt')?'':(metric==='gidx')?'<div style="font-size:11.5px;color:#8A93A6;margin:0 0 20px;line-height:1.5;">※ 구글 검색량 상대지수(표시 기간 내 최다일=100, 한국 기준). 실제 검색 횟수가 아니라 관심도 추이예요.</div>':'<div style="font-size:11.5px;color:#8A93A6;margin:0 0 20px;line-height:1.5;">※ 네이버 검색량 상대지수(표시 기간 내 최다일=100). 실제 검색 횟수가 아니라 관심도 추이예요.</div>';
  var chart='<div style="position:relative;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:6px 8px 2px;background:#0F1420;margin-bottom:8px;">'+zoomCtl+legend+chartInner+'</div>'+chartNote;
  var panelPer=(ST.buzzPanelPer&&['1주일','1개월','3개월'].indexOf(ST.buzzPanelPer)>=0)?ST.buzzPanelPer:'3개월';
  var panelPerBtns=['1주일','1개월','3개월'].map(function(p){var on=p===panelPer;return '<button data-act="buzzpanelper" data-pp="'+p+'" style="flex:1;cursor:pointer;font-size:10.5px;font-weight:800;padding:3px 0;border-radius:6px;border:1px solid '+(on?col:'rgba(255,255,255,.16)')+';background:'+(on?'rgba(255,255,255,.08)':'transparent')+';color:'+(on?'#fff':'rgba(255,255,255,.5)')+';">'+p+'</button>';}).join('');
  var dsel=daily.slice(Math.max(0,daily.length-PER[panelPer]));
  var pN=dsel.reduce(function(a,x){return a+(x.news||0);},0), pB=dsel.reduce(function(a,x){return a+(x.blog||0);},0), pC=dsel.reduce(function(a,x){return a+(x.cafe||0);},0);
  var cntPanel='<div style="flex:none;width:168px;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 13px;background:#161B28;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;"><div style="font-size:12px;font-weight:700;color:#9AA8BE;">최근 언급량</div><div style="display:flex;gap:4px;">'+panelPerBtns+'</div>'+[['뉴스',pN,'#5B86C8'],['블로그',pB,'#46C088'],['카페',pC,'#E0922C']].map(function(r){return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;padding:4px 0;border-top:1px solid rgba(255,255,255,.06);"><span style="font-size:12.5px;color:#9AA8BE;font-weight:700;">'+r[0]+'</span><span style="font-size:16px;font-weight:900;color:'+r[2]+';">'+nf(r[1])+'</span></div>';}).join('')+'<div style="font-size:11px;font-weight:700;color:#6B7689;border-top:1px solid rgba(255,255,255,.12);padding-top:7px;">전체 누적</div>'+[['블로그','blog'],['뉴스','news'],['네이버 카페','cafe'],['다음 카페','daumcafe']].map(function(r){return '<div style="display:flex;justify-content:space-between;gap:6px;padding:2px 0;"><span style="font-size:12px;color:#9AA8BE;font-weight:600;">'+r[0]+'</span><span style="font-size:13px;font-weight:800;color:#C2CAD8;">'+nf(totals[r[1]])+'</span></div>';}).join('')+'</div>';
  var sentiRaw=(nv.sentiment&&nv.sentiment[kw])||[];
  var sentiCh=Array.isArray(sentiRaw)?{community:sentiRaw}:(sentiRaw||{});
  if(!sentiCh.community&&sentiCh.all)sentiCh.community=sentiCh.all;
  var SCH=[['community','전체'],['blog','블로그'],['cafe','커뮤니티']];
  var sch=(ST.buzzSentCh&&SCH.some(function(x){return x[0]===ST.buzzSentCh;}))?ST.buzzSentCh:'community';
  var senti=sentiCh[sch]||sentiCh.community||[];
  var schBtns=SCH.map(function(x){var avail=!!(sentiCh[x[0]]&&sentiCh[x[0]].length);var on=x[0]===sch;return '<button data-act="buzzsent" data-sch="'+x[0]+'"'+(avail?'':' disabled')+' style="flex:none;cursor:'+(avail?'pointer':'default')+';font-size:12px;font-weight:800;padding:4px 11px;border-radius:7px;border:1px solid '+(on?col:'rgba(255,255,255,.14)')+';background:'+(on?col:'transparent')+';color:'+(on?'#fff':(avail?'rgba(255,255,255,.55)':'rgba(255,255,255,.25)'))+';">'+x[1]+'</button>';}).join('');
  var smax=senti.length?Math.max.apply(null,senti.map(function(x){return x.c;})):1;
  function scol(p){return p>0?'#8B5CF6':(p<0?'#E2403A':'#E0C04A');}
  var cloud='<div id="d3cloud" data-w="'+encodeURIComponent(JSON.stringify(senti.map(function(x){return [x.w,x.c,x.p];})))+'" style="position:absolute;inset:0;"></div>';
  var posN=senti.filter(function(x){return x.p>0;}).length, negN=senti.filter(function(x){return x.p<0;}).length, neuN=senti.filter(function(x){return x.p===0;}).length;
  var weeks=(nv.related_weeks&&nv.related_weeks[kw])||[];
  function rankMap(items){var m={};(items||[]).forEach(function(it,i){m[it.w]=i;});return m;}
  var wcols=weeks.map(function(wk,wi){var prev=wi>0?rankMap(weeks[wi-1].items):null;var rows=(wk.items||[]).slice(0,15).map(function(it,i){var delta='';if(prev){if(!(it.w in prev))delta='<span style="color:#E2403A;font-weight:800;font-size:9px;">NEW</span>';else{var d=prev[it.w]-i;delta=d>0?'<span style="color:#E2403A;">▲'+d+'</span>':(d<0?'<span style="color:#5B86C8;">▼'+(-d)+'</span>':'<span style="color:#6B7689;">-</span>');}}return '<div style="display:flex;align-items:center;gap:5px;font-size:13px;padding:2px 0;"><span style="flex:none;width:14px;color:#8A93A6;font-weight:800;">'+(i+1)+'</span><span style="flex:1;color:#E9EBF1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+E(it.w)+'</span><span style="flex:none;width:36px;text-align:right;color:#9AA8BE;">'+it.c+'</span><span style="flex:none;width:32px;text-align:right;font-weight:800;">'+delta+'</span></div>';}).join('');return '<div style="flex:1;min-width:148px;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:11px 13px;background:#161B28;overflow:hidden;"><div style="font-size:13.5px;font-weight:900;color:'+col+';margin-bottom:8px;">'+E(wk.label)+' <span style="font-size:11px;font-weight:600;color:#6B7689;">주</span></div>'+rows+'</div>';}).join('')||'<div style="color:#6B7689;font-size:13px;">데이터 없음</div>';
  function wkAhead(o){var d=new Date();d.setDate(d.getDate()+o*7);var dow=(d.getDay()+6)%7;var mo=new Date(d);mo.setDate(d.getDate()-dow);var su=new Date(mo);su.setDate(mo.getDate()+6);function f(x){return (x.getMonth()+1)+'.'+x.getDate();}return f(mo)+'~'+f(su);}
  var futWk='';for(var fo=1;fo<=3;fo++){futWk+='<div style="flex:1;min-width:148px;border:1px dashed rgba(255,255,255,.14);border-radius:12px;padding:11px 13px;background:rgba(22,27,40,.45);display:flex;flex-direction:column;"><div style="font-size:13.5px;font-weight:900;color:#6B7689;margin-bottom:8px;">'+wkAhead(fo)+' <span style="font-size:11px;font-weight:600;color:#5A6377;">주(예정)</span></div><div style="flex:1;display:flex;align-items:center;justify-content:center;color:#5A6377;font-size:12px;font-weight:600;text-align:center;line-height:1.6;">데이터<br>쌓이는 중</div></div>';}
  var VIEWS=[['cnt','언급 추이'],['senti','긍·부정 연관어']];
  var viewBtns=VIEWS.map(function(x){var on=x[0]===view;return '<button data-act="buzzview" data-view="'+x[0]+'" style="flex:none;cursor:pointer;font-size:13px;font-weight:800;padding:6px 12px;border-radius:8px;border:1px solid '+(on?'#7E8AC0':'rgba(255,255,255,.12)')+';background:'+(on?'#7E8AC0':'rgba(255,255,255,.04)')+';color:'+(on?'#fff':'rgba(255,255,255,.5)')+';box-shadow:'+(on?'0 4px 12px -4px #7E8AC0':'none')+';">'+x[1]+'</button>';}).join('');
  var cdAll=nv.channel_daily||{}, hrAll=nv.hourly||{};
  var sumIsHr=(per==='1일'); var sumDates, sumSer;
  if(sumIsHr){
    var h0=hrAll[keys[0]]||[];
    sumDates=h0.map(function(x){return x.t;});
    sumSer=keys.map(function(k){var hh=hrAll[k]||[];return {name:k,color:COL[k]||'#7E8AC0',values:hh.map(function(c,i){var ct=(c.news||0)+(c.blog||0)+(c.cafe||0);if(i===0)return ct;var a=hh[i-1];var at=(a.news||0)+(a.blog||0)+(a.cafe||0);return ((a.t||'').slice(0,10)===(c.t||'').slice(0,10))?Math.max(0,ct-at):ct;})};});
  } else {
    var sliceN=PER[per]||90;
    var sumRef=(cdAll[keys[0]]||[]); sumRef=sumRef.slice(Math.max(0,sumRef.length-sliceN));
    sumDates=sumRef.map(function(x){return x.date;});
    sumSer=keys.map(function(k){var rs=(cdAll[k]||[]); rs=rs.slice(Math.max(0,rs.length-sliceN)); return {name:k,color:COL[k]||'#7E8AC0',values:rs.map(function(x){return x.total||0;})};});
  }
  var sumLegend='<div style="display:flex;flex-wrap:wrap;gap:14px;margin:4px 2px 7px;font-size:12.5px;font-weight:700;">'+keys.map(function(k){return '<span style="color:'+(COL[k]||'#7E8AC0')+';">● '+E(k)+'</span>';}).join('')+'</div>';
  var sumChart='<div style="position:relative;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:6px 8px 2px;background:#0F1420;margin-bottom:8px;">'+zoomCtl+sumLegend+buzzMultiSVG(sumDates,sumSer,'건',sumIsHr,zoom)+'</div>';
  return (inline?'<div class="sb" style="flex:1;min-width:0;min-height:0;overflow-y:auto;display:flex;flex-direction:column;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:radial-gradient(125% 80% at 50% 0%,#1B2438,#0D1118);box-shadow:0 10px 28px rgba(0,0,0,.3);">':'<div data-act="buzzbd" style="position:fixed;inset:0;z-index:213;background:rgba(8,11,18,.82);display:flex;align-items:flex-start;justify-content:center;padding:30px 12px 12px;overflow-y:auto;"><div class="sb" style="position:relative;width:min(1000px,97vw);border-radius:18px;border:1px solid rgba(255,255,255,.14);background:radial-gradient(125% 80% at 50% 0%,#1B2438,#0D1118);box-shadow:0 30px 80px rgba(0,0,0,.7);">')
    +'<div style="position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 16px 8px;background:#1B2438;border-bottom:1px solid rgba(255,255,255,.08);border-radius:16px 16px 0 0;"><span style="flex:none;display:flex;flex-wrap:wrap;gap:6px;">'+allBtn+tabs+'</span><span style="flex:1;"></span><span style="font-size:12px;color:rgba(255,255,255,.6);font-weight:700;white-space:nowrap;margin-right:14px;">'+E(b.updated||'')+'</span><button data-act="buzzx" style="flex:none;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;font-weight:800;padding:7px 13px;border-radius:8px;cursor:pointer;">닫기 ✕</button></div>'
    +'<div style="padding:9px 16px 12px;display:flex;flex-direction:column;flex:1;min-height:0;box-sizing:border-box;">'
      +(view!=='all4'?('<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:8px;">'+viewBtns+'</div>'):'')
      +(view==='all4'?('<div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:0 0 8px;"><h3 style="margin:0;font-size:14px;font-weight:900;color:#EDEFF5;">종합 <span style="font-size:12px;font-weight:600;color:#8A93A6;">· 키워드별 언급 추이</span></h3><span style="flex:1;"></span>'+perBtns+'</div>'+sumChart):'')
      +(view==='cnt'?('<div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:0 0 8px;"><h3 style="margin:0;font-size:14px;font-weight:900;color:#EDEFF5;">'+(metric==='cnt'?'언급 추이':metric==='gidx'?'구글 검색 지수':'네이버 검색 지수')+'</h3><span style="flex:1;"></span>'+metBtns+'<span style="flex:none;width:6px;"></span>'+perBtns+'</div>'+chart):'')
      +(view==='senti'?('<div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:0 0 7px;"><h3 style="margin:0;font-size:14px;font-weight:900;color:#EDEFF5;">긍·부정 연관어</h3>'+schBtns+'<span style="flex:1;"></span></div>'
      +'<div style="display:flex;gap:18px;align-items:stretch;margin-bottom:8px;flex:1;min-height:0;"><div style="flex:none;display:flex;flex-direction:column;justify-content:center;gap:10px;font-size:13.5px;font-weight:800;line-height:1;"><span style="color:#8B5CF6;">긍정어 '+posN+'</span><span style="color:#E2403A;">부정어 '+negN+'</span><span style="color:#E0C04A;">중립어 '+neuN+'</span></div><div style="position:relative;flex:1;min-width:0;overflow:hidden;">'+cloud+'</div></div>'
      +'<h3 style="margin:0 0 8px;font-size:14px;font-weight:900;color:#EDEFF5;">연관어 순위변화</h3>'
      +'<div style="display:flex;gap:14px;align-items:stretch;flex:none;">'+cntPanel+'<div style="flex:1;min-width:0;display:flex;gap:12px;align-items:stretch;overflow-x:auto;">'+wcols+futWk+'</div></div>'):'')
      +''
    +(inline?'</div></div>':'</div></div></div>');
}
function __renderD3Cloud(){var el=document.getElementById('d3cloud');if(!el)return;var CL=(window.d3&&window.d3.layout&&window.d3.layout.cloud)||(window.layout&&window.layout.cloud);if(!CL)return;var W=el.clientWidth||el.offsetWidth,H=el.clientHeight||el.offsetHeight;if(!W||!H)return;var raw;try{raw=JSON.parse(decodeURIComponent(el.dataset.w||'[]'));}catch(e){return;}if(!raw.length){el.innerHTML='';return;}var key='fg:'+W+'x'+H+':'+raw.length+':'+(el.dataset.w||'').length;if(window.__cloudCache&&window.__cloudCache.key===key){el.innerHTML=window.__cloudCache.svg;return;}var vals=raw.map(function(r){return r[1];}),mx=Math.max.apply(null,vals),mn=Math.min.apply(null,vals);var maxF;function fz(v){var t=(mx===mn)?1:(Math.sqrt(v)-Math.sqrt(mn))/(Math.sqrt(mx)-Math.sqrt(mn));return Math.round(13+t*(maxF-13));}function col(p){return p>0?'#8B5CF6':(p<0?'#E2403A':'#E0C04A');}function bbox(out){var a=1e9,b=-1e9;out.forEach(function(d){var hw=(''+d.text).length*d.size*0.5;if(d.x-hw<a)a=d.x-hw;if(d.x+hw>b)b=d.x+hw;});return {a:a,b:b};}var defs=[['pos',raw.filter(function(r){return r[2]>0;}),W*0.46],['neu',raw.filter(function(r){return r[2]===0;}),W*0.30],['neg',raw.filter(function(r){return r[2]<0;}),W*0.46]];var gMaxF=Math.min(46,Math.round(H*0.44)),fitc=defs.filter(function(d){return d[1].length;}).map(function(d){var bw=Math.max(40,d[2]);return Math.sqrt(0.58*bw*H/(0.75*d[1].length));});maxF=Math.max(18,Math.min.apply(null,[gMaxF].concat(fitc)));var R={},pending=0;defs.forEach(function(d){if(d[1].length)pending++;});if(!pending){el.innerHTML='';return;}function finish(){var cx=W/2,gap=14,parts=[];function emit(res,off){if(!res)return;res.out.forEach(function(d){var ax=(off+d.x).toFixed(1),ay=(H/2+d.y).toFixed(1);parts.push('<text text-anchor="middle" dy="0.32em" transform="translate('+ax+','+ay+')" font-family="Pretendard, sans-serif" font-weight="'+(d.value/mx>0.5?900:700)+'" font-size="'+d.size+'" fill="'+col(d.p)+'">'+E(d.text)+'</text>');});}var offN=cx;var posRT=R.neu?(offN+R.neu.bb.a-gap):(cx-gap/2);var offP=R.pos?(posRT-R.pos.bb.b):0;var negLT=R.neu?(offN+R.neu.bb.b+gap):(cx+gap/2);var offNg=R.neg?(negLT-R.neg.bb.a):0;if(R.pos&&offP+R.pos.bb.a<4)offP=4-R.pos.bb.a;if(R.neg&&offNg+R.neg.bb.b>W-4)offNg=W-4-R.neg.bb.b;emit(R.pos,offP);emit(R.neu,offN);emit(R.neg,offNg);var svg='<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="display:block;">'+parts.join('')+'</svg>';window.__cloudCache={key:key,svg:svg};var e2=document.getElementById('d3cloud');if(e2)e2.innerHTML=svg;}defs.forEach(function(d){if(!d[1].length)return;var words=d[1].map(function(r){return {text:r[0],value:r[1],p:r[2],size:fz(r[1])};});CL().size([Math.max(40,d[2]),H]).words(words).padding(1).spiral('archimedean').rotate(0).font('Pretendard, sans-serif').fontSize(function(w){return w.size;}).on('end',function(out){R[d[0]]={out:out,bb:bbox(out)};if(--pending===0)finish();}).start();});}
window.__renderD3Cloud=__renderD3Cloud;
function render(){
  const wide=ST.w>=860, ex=ST.expanded, mbuzz=ST.buzz&&!wide;
  const boxw=334;
  const actHidden=ST.actHidden;
  const mainCols=wide?(actHidden?'minmax(0,1fr)':(boxw+'px minmax(0,1fr)')):'minmax(0,1fr)';
  let rowRows;
  if(!wide) rowRows='auto auto';
  else if(ex==='feed') rowRows='minmax(0,1fr) auto';
  else if(ex==='stmt') rowRows='auto minmax(0,1fr)';
  else if(ST.stmtHidden) rowRows='minmax(0,1fr) auto';
  else rowRows='minmax(0,1fr) 116px';
  const statHide='flex';
  const rallyD=days(DATA.rally);
  const N=DATA.notices;
  let barInner;
  if(N.length){
    barInner=(function(){var bn=N.filter(function(n){return n.bar&&n.badge==='국회 일정';});if(!bn.length)bn=N.slice(0,1);var RH=24;function row(n){return '<div style="flex:none;height:'+RH+'px;display:flex;align-items:center;gap:9px;">'+(n.committee?'<span style="flex:none;white-space:nowrap;font-size:10px;font-weight:800;color:#fff;background:#141414;padding:3px 8px;border-radius:5px;">비대위</span>':'')+'<span style="flex:none;white-space:nowrap;font-size:10px;font-weight:800;color:'+n.badgeText+';background:'+n.badgeColor+';padding:3px 8px;border-radius:5px;">'+E(n.badge)+'</span><span style="flex:1;min-width:0;font-size:14px;font-weight:700;color:#EDEFF5;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+E(n.title)+'</span></div>';}var rows=bn.map(row).join('')+(bn.length>1?row(bn[0]):'');return '<button data-act="notices" style="flex:1;min-width:0;height:'+RH+'px;overflow:hidden;background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer;display:block;"><div'+(bn.length>1?' class="notiroll"':'')+' style="display:flex;flex-direction:column;">'+rows+'</div></button>';})();
  } else {
    barInner='<span style="flex:1;min-width:0;font-size:14px;font-weight:600;color:#6B748A;">현재 등록된 공지가 없습니다</span>';
  }
  const noticeBtn=('<button class="btnh" data-act="notices" style="flex:none;white-space:nowrap;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#F4F6FB;font-size:12.5px;font-weight:700;padding:6px 13px;border-radius:8px;display:inline-flex;align-items:center;gap:7px;">공지 전체보기 ('+N.length+') <span style="font-size:10px;">'+(ST.noticesOpen?'▲':'▼')+'</span></button>');
  const noticesDD=ST.noticesOpen?(function(){var nd=function(s){var p=String(s).split('.');return (+p[0]||0)*100+(+p[1]||0);};var order=N.map(function(n,i){return {n:n,i:i};}).sort(function(a,b){return ST.noticesSort==='old'?nd(a.n.date)-nd(b.n.date):nd(b.n.date)-nd(a.n.date);});var sb=function(v,lab){var on=v==='old'?ST.noticesSort==='old':ST.noticesSort!=='old';return '<button data-act="nsort" data-v="'+v+'" style="cursor:pointer;font-size:11px;font-weight:800;padding:4px 11px;border-radius:7px;border:1px solid '+(on?'#3E7BFF':'rgba(255,255,255,.16)')+';background:'+(on?'rgba(62,123,255,.18)':'rgba(255,255,255,.04)')+';color:'+(on?'#9FC2F2':'#AEB6C6')+';">'+lab+'</button>';};var head='<div style="display:flex;align-items:center;gap:6px;margin-bottom:9px;"><span style="font-size:11.5px;font-weight:800;color:#9AA3B5;">공지 '+N.length+'건</span><span style="flex:1;"></span>'+sb('new','최신순')+sb('old','오래된순')+'</div>';return '<div class="sb" style="position:absolute;left:'+(wide?'191px':'12px')+';top:calc(100% + 8px);width:460px;max-width:calc(100vw - 44px);max-height:74vh;overflow-y:auto;background:#161B28;border:1px solid rgba(255,255,255,.12);border-radius:13px;box-shadow:0 20px 50px rgba(0,0,0,.5);padding:10px;z-index:40;">'+(N.length?(head+order.map(function(o){return noticeCard(o.n,o.i);}).join('')):'<div style="padding:14px;color:#8C95A8;font-size:13px;font-weight:600;">현재 등록된 공지가 없습니다</div>')+'</div>';})():'';
  const lb=(ST.lb!=null&&DATA.stmt[ST.lb])?(function(){var s=DATA.stmt[ST.lb];return '<div data-act="lbx" style="position:fixed;inset:0;z-index:200;background:rgba(8,10,16,.93);display:flex;flex-direction:column;">'+
    '<div style="flex:none;display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(255,255,255,.1);background:#111722;"><span style="font-size:15px;font-weight:800;color:#fff;">'+E(s.org)+(s.org2?' '+E(s.org2):'')+'</span><span style="font-size:11.5px;color:#9AA3B5;font-weight:600;">'+E(s.disp)+' · '+s.pages.length+'장</span><span style="flex:1;"></span><button data-act="lbx" style="flex:none;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;font-size:13px;font-weight:800;padding:7px 15px;border-radius:8px;">닫기 ✕</button></div>'+
    '<div class="sb" data-act="lbx" style="flex:1;min-height:0;overflow-y:auto;padding:20px 16px 44px;display:flex;flex-direction:column;align-items:center;gap:16px;">'+
    s.pages.map(function(p){return '<img src="'+E(p)+'" alt="" onclick="event.stopPropagation()" style="max-width:min(840px,96vw);width:100%;height:auto;border-radius:10px;box-shadow:0 12px 44px rgba(0,0,0,.55);">';}).join('')+
    '</div></div>';})():'';
  const pop=ST.pop?('<div style="position:fixed;inset:0;z-index:300;background:rgba(9,11,17,.78);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);overflow-y:auto;pointer-events:auto;-webkit-overflow-scrolling:touch;">'+
        '<div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:12px 12px 24px;">'+
          '<img src="img/stuhak1.webp" alt="관리급여 개정안 재검토를 촉구하는 공동성명서" style="display:block;width:auto;height:auto;max-width:96vw;max-height:94vh;max-height:94dvh;border-radius:8px;box-shadow:0 14px 50px rgba(0,0,0,.7);">'+
          '<img src="img/stuhak2b.webp" alt="동참한 학생회 명단" style="display:block;width:auto;height:auto;max-width:96vw;max-height:94vh;max-height:94dvh;border-radius:8px;box-shadow:0 14px 50px rgba(0,0,0,.7);">'+
          '<div style="display:flex;align-items:center;gap:8px;">'+
            '<button data-act="pophide" style="border:none;background:rgba(12,16,24,.85);color:#AEB6C6;font-size:13px;font-weight:700;text-decoration:underline;text-underline-offset:2px;cursor:pointer;padding:9px 12px;border-radius:9px;white-space:nowrap;">오늘 하루 보지 않기</button>'+
            '<button data-act="popx" style="border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.12);color:#fff;font-size:14px;font-weight:800;padding:9px 20px;border-radius:9px;cursor:pointer;white-space:nowrap;">닫기</button>'+
          '</div>'+
      '</div>'):'';
  const buspop='';
  const popOverlay=pop;
  const grp=grpOverlay();
  var rf=ST.routeFull;
  var rMap=rf?'min(62vh,620px)':'300px';
  var rTxt=rf?16:13, rLab=rf?14.5:12, rSub=rf?13.5:12, rDate=rf?15:13, rTitle=rf?20:16.5;
  const route='';
  var __cLeft=ST.w>=1550, __cNarrow=ST.w>=1500&&ST.w<1550;
  const app=
  '<div style="background:#0E121B;color:#E9EBF1;height:'+(wide?'100vh':'auto')+';overflow:'+(wide?'hidden':'visible')+';display:flex;flex-direction:column;">'+
   '<header style="flex:none;background:#131826;border-bottom:1px solid rgba(255,255,255,.07);"><div style="padding:'+(wide?'11px 14px':'10px 6px')+';'+(wide?'display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;':'display:flex;flex-direction:column;align-items:center;gap:10px;')+'">'+
    '<div style="display:flex;align-items:center;flex-wrap:wrap;'+(wide?'justify-content:flex-start;gap:8px;':'width:100%;justify-content:center;gap:14px;')+'">'+
      (wide?rbPanel(false):'<div style="width:100%;">'+rbPanel(true)+'</div>')+
      (__cLeft?'<img src="img/crowd4.webp" alt="" style="flex:none;margin-left:auto;height:74px;width:auto;display:block;border-radius:6px;">':'')+
    '</div>'+
    (wide?'':'<div style="width:100%;height:1px;background:rgba(255,255,255,.16);"></div>')+
    (wide?'<div style="min-width:0;max-width:100%;display:flex;flex-direction:column;align-items:center;gap:5px;line-height:1.12;"><span style="font-size:31px;font-weight:900;color:#F22C2C;letter-spacing:-.025em;white-space:nowrap;text-shadow:0 1px 14px rgba(242,44,44,.25);">도수치료 관리급여 결사 저지</span></div>':'<div style="width:100%;display:flex;align-items:center;gap:5px;line-height:1.12;"><img src="img/crowd4.webp" alt="" style="flex:none;height:48px;width:auto;display:block;border-radius:5px;"><div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;"><span style="font-size:17px;font-weight:900;color:#F22C2C;letter-spacing:-.03em;word-break:keep-all;text-shadow:0 1px 14px rgba(242,44,44,.25);">도수치료 관리급여 결사 저지</span></div><a class="envlink" href="https://ptsite-nine.vercel.app" target="_blank" rel="noopener" aria-label="물리치료학과 학생들에게 안내 사이트 열기" style="flex:none;"><span class="env" style="width:62px;height:44px;"><span class="env__paper"><i></i><i></i><i></i></span><span class="env__front"></span><span class="env__flap"></span><span style="position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:4px;font-size:8.5px;font-weight:800;line-height:1.18;color:#4A3A1E;letter-spacing:-.04em;text-shadow:0 1px 0 rgba(255,255,255,.45);">물리치료학과<br>학생들에게</span></span></a></div>')+
    (wide?('<div style="'+(wide?'justify-content:flex-end;':'flex-wrap:wrap;justify-content:center;')+'display:flex;align-items:center;gap:'+(wide?'14px':'9px')+';min-width:0;"><a class="envlink" href="https://ptsite-nine.vercel.app" target="_blank" rel="noopener" aria-label="물리치료학과 학생들에게 안내 사이트 열기"'+(wide?' style="margin-right:auto;"':'')+'><span class="env"><span class="env__paper"><i></i><i></i><i></i></span><span class="env__front"></span><span class="env__flap"></span></span><span class="env__label">물리치료학과 학생들에게</span></a>'+
     (__cNarrow?'<img src="img/crowd4.webp" alt="" style="flex:none;height:74px;width:auto;display:block;border-radius:6px;">':'')+
     '<a href="https://open.kakao.com/o/pCuo1Fzi" target="_blank" rel="noopener" class="ktalk" style="flex:none;display:inline-flex;align-items:center;gap:7px;background:#FEE500;color:#1A1A1A;font-size:15px;font-weight:800;letter-spacing:-.01em;padding:9px 16px;border-radius:11px;white-space:nowrap;box-shadow:0 3px 12px -3px rgba(254,229,0,.5),inset 0 1px 0 rgba(255,255,255,.5);"><span style="font-size:16px;">💬</span>도수치료 관리급여 저지 단톡방</a>'+
    '</div>'):'')+
   '</div></header>'+
   '<div style="flex:none;position:relative;z-index:30;background:#1A2335;border-bottom:1px solid rgba(255,255,255,.07);"><div style="padding:6px 22px;display:flex;align-items:center;gap:14px;"><button data-act="acttog" data-tip="'+(actHidden?'긴급 공동 행동 박스 펼치기':'긴급 공동 행동 박스 숨기기')+'" aria-label="긴급 공동행동 토글" style="flex:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid '+(actHidden?'rgba(255,255,255,.16)':'rgba(216,72,58,.55)')+';background:'+(actHidden?'rgba(255,255,255,.05)':'rgba(216,72,58,.18)')+';color:'+(actHidden?'#AEB6C6':'#E8857F')+';"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" style="display:block;"><rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" stroke="currentColor" stroke-width="1.5"/><rect x="1.6" y="2.6" width="5" height="10.8" rx="2" fill="currentColor"'+(actHidden?' fill-opacity="0.35"':'')+'/></svg></button><button data-act="notices" style="flex:none;align-self:stretch;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;font-size:12px;font-weight:800;color:#C2CAD8;background:#2A374F;border:1px solid rgba(255,255,255,.12);padding:0 13px;border-radius:7px;cursor:pointer;">📌 공지 <span style="font-size:11px;font-weight:700;color:#9FB0CC;">('+N.length+')</span><span style="font-size:9px;color:#9FB0CC;margin-left:1px;">'+(ST.noticesOpen?'▲':'▼')+'</span></button>'+barInner+'</div>'+noticesDD+'</div>'+
   '<main style="flex:1;min-height:0;display:grid;grid-template-columns:'+mainCols+';gap:14px;padding:14px;">'+
    (actHidden?'':'<div style="display:flex;flex-direction:column;gap:12px;min-height:0;"><button data-board="gov" class="govbtn" style="flex:none;display:flex;align-items:center;gap:11px;width:100%;text-align:left;cursor:pointer;border:1px solid rgba(91,134,200,.5);border-left:5px solid #5B86C8;border-radius:14px;-webkit-backdrop-filter:blur(6px) saturate(1.4) url(#lglass);backdrop-filter:blur(6px) saturate(1.4) url(#lglass);box-shadow:0 8px 20px -5px rgba(0,0,0,.5),0 2px 5px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.14),inset 0 -3px 8px rgba(0,0,0,.3);background:linear-gradient(180deg,#1A2440,#0F1524);padding:11px 14px;"><span style="flex:none;width:42px;height:42px;display:flex;align-items:center;justify-content:center;font-size:20px;background:rgba(255,255,255,.2);border-radius:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.4);">🏛️</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;"><span style="font-size:15px;font-weight:900;color:#FFFFFF;letter-spacing:-.02em;">정부 공식 자료</span><span style="font-size:11.5px;font-weight:600;color:rgba(255,255,255,.86);">관리급여 고시·보도자료 원문</span></span><span style="flex:none;color:rgba(255,255,255,.92);font-weight:900;font-size:15px;">▸</span></button>${BUZZON?'<button data-act="buzz" style="flex:none;display:flex;align-items:center;gap:11px;width:100%;text-align:left;cursor:pointer;border:1px solid rgba(126,138,192,.5);border-left:5px solid #7E8AC0;border-radius:14px;box-shadow:0 8px 20px -5px rgba(0,0,0,.5),0 2px 5px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.12);background:linear-gradient(180deg,#241F3A,#150F24);padding:11px 14px;"><span style="flex:none;width:42px;height:42px;display:flex;align-items:center;justify-content:center;font-size:20px;background:rgba(126,138,192,.22);border-radius:10px;">📊</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;"><span style="font-size:15px;font-weight:900;color:#FFFFFF;letter-spacing:-.02em;">여론 분석</span></span><span style="flex:none;color:rgba(255,255,255,.92);font-weight:900;font-size:15px;">▸</span></button>':''}'+(mbuzz?'':('<aside style="background:#15192A;border:1px solid rgba(255,255,255,.07);border-radius:14px;box-shadow:0 10px 28px rgba(0,0,0,.3);display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden;">'+
     '<div class="ghdr" style="flex:none;padding:11px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,0) 55%),rgba(34,48,75,.5);"><span style="display:inline-flex;align-items:center;gap:8px;white-space:nowrap;color:#FF6B6E;font-weight:900;font-size:13px;letter-spacing:-.01em;"><span style="width:7px;height:7px;border-radius:50%;background:#FF6B6E;display:inline-block;animation:pulseDot 1.4s ease-in-out infinite;"></span>긴급 공동 행동</span><span style="white-space:nowrap;font-size:11px;color:rgba(255,255,255,.7);font-weight:600;">'+DATA.upd+'</span></div>'+
     '<div class="sb" style="flex:1;min-height:0;overflow-y:auto;padding:9px 0 10px;display:flex;flex-direction:column;gap:9px;">'+(function(){var pg=DATA.petitions.filter(function(p){return p.platform==='국민신문고 공청회';});var po=DATA.petitions.filter(function(p){return p.platform!=='국민신문고 공청회';});var dv='<div style="height:1px;background:rgba(255,255,255,.1);"></div>';var qrBlock='';function hdr(dl,c){return '<div style="padding:6px 14px;font-size:13px;font-weight:800;color:'+c+';letter-spacing:-.02em;white-space:nowrap;background:rgba(255,255,255,.03);">'+dl+'</div>';}function box(bd,ld,inner){return '<div style="flex:none;border:1px solid '+bd+';border-left:4px solid '+ld+';border-radius:12px;overflow:hidden;background:#1E2840;">'+inner+'</div>';}var g=pg.length?box('rgba(216,72,58,.4)','#D8483A',hdr('6월 24일 (수) 18시 마감','#F2B84B')+dv+pg.map(function(p){return petCard(p,true);}).join(dv)):'';var o=po.map(function(p){var pct=Math.max(0,Math.min(100,+(p.pct||0)));var gauge='<div style="position:relative;padding:6px 14px;overflow:hidden;background:rgba(255,255,255,.03);"><div style="position:absolute;left:0;top:0;bottom:0;width:'+pct+'%;background:linear-gradient(90deg,rgba(91,134,200,.55),rgba(91,134,200,.3));border-right:2px solid rgba(143,182,232,.75);"></div><div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;"><span style="font-size:13px;font-weight:800;color:#8FB6E8;letter-spacing:-.02em;white-space:nowrap;">'+E(p.dl||'마감')+'</span><span style="font-size:12px;font-weight:800;color:#DCE8FA;white-space:nowrap;">'+E(p.count||'')+'</span></div></div>';return box('rgba(91,134,200,.45)','#5B86C8',gauge+dv+petCard(p,true,true));}).join('');return g+o;})()+'</div>'+
    '</aside>'+(DATA.perfcard||'')))+'</div>')+
    (ST.buzz?('<div style="min-height:0;display:flex;flex-direction:column;">'+buzzOverlay(true)+'</div>'):('<div style="min-height:0;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:'+rowRows+';gap:14px;">'+
     bigFeed()+
     row('stmt','각 학회·단체 성명문','#3E9E78','rgba(62,158,120,.16)',DATA.stmt,null,false,DATA.upd)+
    '</div>'))+
   '</main>'+lb+grp+route+popOverlay+boardPopup()+'</div>';
  var __feedScroll=(document.getElementById('feedList')||{}).scrollTop||0;
  document.getElementById('app').innerHTML=app;try{if(window.__renderD3Cloud)window.__renderD3Cloud();}catch(_){}
  if(__feedScroll){var __fl=document.getElementById('feedList');if(__fl)__fl.scrollTop=__feedScroll;}
  (function(){
    if(window.__rmap){try{window.__rmap.remove();}catch(_){}window.__rmap=null;}
    if(!ST.route||!window.L)return;
    if(!document.getElementById('rmap'))return;
    var dest=RDATA.dest;
    var map=L.map('rmap',{zoomControl:true,scrollWheelZoom:true}).setView(dest,16);
    window.__rmap=map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
    var __dpin='<svg width="40" height="50" viewBox="0 0 40 50" style="filter:drop-shadow(0 3px 5px rgba(0,0,0,.55));display:block;"><path d="M20 49S35 31 35 18A15 15 0 1 0 5 18C5 31 20 49 20 49Z" fill="#E2403A" stroke="#fff" stroke-width="2.5"/><circle cx="20" cy="18" r="7.5" fill="#fff"/><circle cx="20" cy="18" r="3.6" fill="#E2403A"/></svg>';
    L.marker(dest,{icon:L.divIcon({html:__dpin,className:'',iconSize:[40,50],iconAnchor:[20,48]}),zIndexOffset:1000}).addTo(map).bindTooltip('동십자각 (집결지)',{permanent:true,direction:'top',offset:[0,-46]});
    Object.keys(RDATA.buses||{}).forEach(function(k){if(k===ST.routeFrom)return;var b=RDATA.buses[k];L.circleMarker([b.lat,b.lon],{radius:5,color:'#fff',weight:1.5,fillColor:'#22C55E',fillOpacity:0.95}).addTo(map).bindTooltip(k+' · 버스정류장',{direction:'top'});});
    var isBus=!!(RDATA.buses&&RDATA.buses[ST.routeFrom]);
    var sel=RDATA.stations[ST.routeFrom]||(RDATA.buses&&RDATA.buses[ST.routeFrom]);
    if(sel&&sel.line&&sel.line.length){
      var col=isBus?'#16A34A':'#1D4FD7';
      var wgt=function(z){return Math.max(3,Math.min(9,Math.round((z-13)*1.3+4)));};
      var poly=L.polyline(sel.line,{color:col,weight:wgt(map.getZoom()),opacity:0.6,lineJoin:'round',lineCap:'round'}).addTo(map);
      map.on('zoomend',function(){poly.setStyle({weight:wgt(map.getZoom())});});
      L.circleMarker([sel.lat,sel.lon],{radius:8,color:'#fff',weight:2,fillColor:col,fillOpacity:1}).addTo(map).bindTooltip(ST.routeFrom+(sel.exit?(' '+sel.exit+' 출구'):''),{permanent:true,direction:'top',offset:[0,-7]});
      try{map.fitBounds(L.latLngBounds(sel.line).pad(0.3));}catch(_){}
    }
    setTimeout(function(){try{map.invalidateSize();}catch(_){}},150);
  })();
  if(ST.boardPop){var _dd=document.getElementById('boardDD'),_bt=document.querySelector('button[data-board="'+ST.boardPop+'"]');if(_dd&&_bt){var _r=_bt.getBoundingClientRect(),_w=_dd.offsetWidth||380;var _l=Math.max(8,Math.min(_r.left,window.innerWidth-_w-8));_dd.style.left=Math.round(_l)+'px';_dd.style.top=Math.round(_r.bottom+6)+'px';}}
  document.querySelectorAll('.wheelx').forEach(el=>{el.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)<=Math.abs(e.deltaX))return;const max=el.scrollWidth-el.clientWidth;if(max<=0)return;e.preventDefault();el.scrollLeft+=e.deltaY;},{passive:false});});
  document.querySelectorAll('.fanrow').forEach(function(row){
    var cards=[].slice.call(row.children);
    if(!cards.length)return;
    cards.forEach(function(c){c.style.transition='none';});
    var loop=row.dataset.loop==='1';
    var N=loop?Math.round(cards.length/3):cards.length;
    var base=loop?N:0;
    var cur=base;
    function apply(){
      var rc=row.getBoundingClientRect(), cx=rc.left+rc.width/2;
      cards.forEach(function(card){
        var b=card.getBoundingClientRect(), c=b.left+b.width/2; var ow=card.offsetWidth||b.width;
        var d=(c-cx)/(ow+6); var ad=Math.abs(d);
        var sc=Math.max(0.52,1.0-ad*0.26);
        card.style.transform='scale('+sc.toFixed(3)+')';
        card.style.zIndex=String(Math.max(1,14-Math.round(ad*3)));
        card.style.opacity=String(Math.max(0.38,1-ad*0.26));
      });
    }
    function centerOn(i,smooth){ var c=cards[i]; if(!c)return; var b=c.getBoundingClientRect(), rr=row.getBoundingClientRect(); row.scrollBy({left:(b.left+b.width/2)-(rr.left+rr.width/2),behavior:smooth?'smooth':'auto'}); }
    function rebase(){ if(!loop)return; if(cur>=base+N){cur-=N;centerOn(cur,false);} else if(cur<base){cur+=N;centerOn(cur,false);} }
    function nearestIdx(){ var rr=row.getBoundingClientRect(),cx=rr.left+rr.width/2; var bi=0,bd=1e9; cards.forEach(function(c,i){var b=c.getBoundingClientRect(),m=b.left+b.width/2;var d=Math.abs(m-cx);if(d<bd){bd=d;bi=i;}}); return bi; }
    var lock=false, rebT, snapT;
    function go(dir){ if(lock)return; lock=true; cur+=dir; if(!loop)cur=Math.max(0,Math.min(cards.length-1,cur)); centerOn(cur,true); clearTimeout(rebT); rebT=setTimeout(function(){rebase();apply();lock=false;},440); }
    row.addEventListener('wheel',function(e){ if(Math.abs(e.deltaY)<=Math.abs(e.deltaX))return; e.preventDefault(); go(e.deltaY>0?1:-1); },{passive:false});
    row.addEventListener('scroll',function(){ window.requestAnimationFrame(apply); if(lock)return; clearTimeout(snapT); snapT=setTimeout(function(){ if(lock)return; cur=nearestIdx(); centerOn(cur,true); clearTimeout(rebT); rebT=setTimeout(function(){rebase();apply();lock=false;},420); },150); },{passive:true});
    cards.forEach(function(card,i){ card.addEventListener('click',function(e){ var rr=row.getBoundingClientRect(),cx=rr.left+rr.width/2; var b=card.getBoundingClientRect(),c=b.left+b.width/2; if(Math.abs(c-cx)>b.width*0.3){ e.preventDefault(); if(lock)return; lock=true; cur=i; centerOn(cur,true); clearTimeout(rebT); rebT=setTimeout(function(){rebase();apply();lock=false;},440);} }); });
    var ctr=function(){ cur=base; centerOn(base,false); apply(); };
    window.requestAnimationFrame(ctr); setTimeout(ctr,120); setTimeout(ctr,360); setTimeout(ctr,800);
    if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){window.requestAnimationFrame(ctr);});}
    apply();
    setTimeout(function(){cards.forEach(function(c){c.style.transition='';});},900);
  });
}
document.addEventListener('click',e=>{const t=e.target.closest('[data-act]');if(!t)return;const a=t.dataset.act;if(a==='grpcard')return;if(a==='stopwatch'){if(window.__sw)window.__sw.open();return;}if(a==='carL'||a==='carR'){const sec=t.closest('section');const row=sec&&sec.querySelector('.wheelx');if(row){row.scrollBy({left:Math.round(row.clientWidth*0.8)*(a==='carR'?1:-1),behavior:'smooth'});}return;}if(a==='popbd'){if(t!==e.target)return;ST.pop=false;}else if(a==='notices')ST.noticesOpen=!ST.noticesOpen;else if(a==='route')ST.route=true;else if(a==='routex')ST.route=false;else if(a==='routebd'){if(t!==e.target)return;ST.route=false;}else if(a==='ncard'){const i=+t.dataset.i;ST.ncard=ST.ncard===i?-1:i;}else if(a==='lb'){ST.lb=+t.dataset.i;}else if(a==='lbx'){ST.lb=null;}else if(a==='boardpop'){ST.boardPop=ST.boardPop===t.dataset.board?null:t.dataset.board;}else if(a==='boardpopx'){ST.boardPop=null;}else if(a==='boardpopbd'){if(t!==e.target)return;ST.boardPop=null;}else if(a==='popx'){ST.pop=false;}else if(a==='pophide'){try{localStorage.setItem('ptnews_stupop_0627',new Date().toISOString().slice(0,10));}catch(_){}ST.pop=false;}else if(a==='buspopx'){ST.busPop=false;}else if(a==='buspopbd'){if(t!==e.target)return;ST.busPop=false;}else if(a==='buspophide'){try{localStorage.setItem('ptnews_buspop_0628',new Date().toISOString().slice(0,10));}catch(_){}ST.busPop=false;}else if(a==='popallbd'){if(t!==e.target)return;ST.pop=false;ST.busPop=false;}else if(a==='buzz'){ST.buzz=!ST.buzz;}else if(a==='buzzkw'){ST.buzzKw=t.dataset.kw;if(ST.buzzView==='all4')ST.buzzView='cnt';}else if(a==='buzzper'){ST.buzzPeriod=t.dataset.per;}else if(a==='buzzmetric'){ST.buzzMetric=t.dataset.met;}else if(a==='buzzsent'){ST.buzzSentCh=t.dataset.sch;}else if(a==='buzzcntch'){ST.buzzCntCh=t.dataset.cch;}else if(a==='buzzview'){ST.buzzView=t.dataset.view;}else if(a==='buzzzoom'){ST.buzzZoom=Math.max(1,Math.min(16,(+ST.buzzZoom||1)*(t.dataset.z==='in'?2:0.5)));}else if(a==='buzzpanelper'){ST.buzzPanelPer=t.dataset.pp;}else if(a==='buzzx'){ST.buzz=false;}else if(a==='buzzbd'){if(t!==e.target)return;ST.buzz=false;}else if(a==='acttog'){e.preventDefault();ST.actHidden=!ST.actHidden;}else if(a==='grp'){ST.grp={feed:t.dataset.feed,key:t.dataset.grp};}else if(a==='grpx'){ST.grp=null;}else if(a==='sort'){const r=t.dataset.row;ST.sort[r]=ST.sort[r]==='new'?'old':'new';}else if(a==='feed'){ST.feed=t.dataset.feed;}else if(a==='expand'){const r=t.dataset.row;ST.expanded=ST.expanded===r?null:r;}else if(a==='stmthide'){ST.stmtHidden=!ST.stmtHidden;}else if(a==='nsort'){ST.noticesSort=t.dataset.v;}render();});
document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-act=\"rfrom\"]');if(!t)return;if(ST.routeFrom!==t.dataset.st){ST.routeFrom=t.dataset.st;render();}});
document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-act=\"acc\"]');if(!t)return;e.preventDefault();ST.acc=ST.acc===t.dataset.grp?null:t.dataset.grp;render();});
document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('[data-act="acc"]'))return;var t=e.target.closest&&e.target.closest('[data-act="grpcard"]');if(!t)return;if(ST.acc===t.dataset.grp)return;e.preventDefault();ST.acc=t.dataset.grp;render();});
document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-act]');if(!t)return;var a=t.dataset.act;if(a==='routefull'){ST.routeFull=!ST.routeFull;render();}else if(a==='routex'){ST.routeFull=false;}else if(a==='routebd'&&t===e.target){ST.routeFull=false;}});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(ST.buzz){ST.buzz=false;render();return;}if(ST.route){ST.route=false;ST.routeFull=false;render();return;}if(ST.boardPop){ST.boardPop=null;render();return;}if(ST.grp){ST.grp=null;render();}else if(ST.lb!=null){ST.lb=null;render();}else if(ST.pop){ST.pop=false;render();}else if(ST.busPop){ST.busPop=false;render();}});
let rt;window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>{ST.w=window.innerWidth;render();},120);});
try{if(localStorage.getItem('ptnews_stupop_0627')===new Date().toISOString().slice(0,10))ST.pop=false;}catch(_){}
try{if(localStorage.getItem('ptnews_buspop_0628')===new Date().toISOString().slice(0,10))ST.busPop=false;}catch(_){}
render();
(function(){var tipEl=document.createElement('div');tipEl.style.cssText='position:fixed;z-index:250;pointer-events:none;background:#0B0E16;color:#EDEFF5;font-size:11.5px;font-weight:700;letter-spacing:-.01em;padding:6px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.2);box-shadow:0 10px 26px rgba(0,0,0,.6);white-space:nowrap;opacity:0;transition:opacity .12s ease;display:none;left:0;top:0;';document.body.appendChild(tipEl);var curT=null;function show(t){var tip=t.getAttribute('data-tip');if(!tip)return;curT=t;tipEl.textContent=tip;tipEl.style.display='block';tipEl.style.opacity='0';var r=t.getBoundingClientRect(),tw=tipEl.offsetWidth,th=tipEl.offsetHeight;var left=r.left+r.width/2-tw/2;left=Math.max(8,Math.min(left,window.innerWidth-tw-8));var top=r.bottom+8;if(top+th>window.innerHeight-8){top=r.top-th-8;}if(top<8)top=8;tipEl.style.left=Math.round(left)+'px';tipEl.style.top=Math.round(top)+'px';requestAnimationFrame(function(){tipEl.style.opacity='1';});}function hide(){curT=null;tipEl.style.opacity='0';tipEl.style.display='none';}document.addEventListener('mouseover',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(t&&t!==curT)show(t);});document.addEventListener('mouseout',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(t)hide();});document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('[data-tip]'))hide();});})();
(function(){var m=document.createElement('div');m.id='swModal';m.style.cssText='position:fixed;inset:0;z-index:280;background:transparent;display:none;';m.innerHTML='<div id="swCard" style="position:absolute;top:60px;right:16px;width:310px;background:radial-gradient(120% 80% at 50% 0%,#1B2438,#0D1118);border:1px solid rgba(255,255,255,.18);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.6);padding:18px;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;"><span style="font-size:15px;font-weight:900;color:#F4F6FB;">스톱워치</span><span style="flex:1;"></span><button id="swClose" style="border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:13px;font-weight:800;padding:6px 13px;border-radius:8px;cursor:pointer;">닫기</button></div><div id="swTime" style="font-variant-numeric:tabular-nums;text-align:center;font-size:40px;font-weight:800;color:#fff;margin:6px 0 16px;">00:00.00</div><div style="display:flex;gap:8px;"><button id="swStart" style="flex:2;background:#3E9E78;color:#fff;border:0;font-size:15px;font-weight:800;padding:13px 6px;border-radius:11px;cursor:pointer;white-space:nowrap;">시작</button><button id="swLap" style="flex:1;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);font-size:14px;font-weight:800;padding:13px 6px;border-radius:11px;cursor:pointer;white-space:nowrap;">랩</button><button id="swReset" style="flex:1;background:rgba(255,255,255,.06);color:#C2CAD8;border:1px solid rgba(255,255,255,.16);font-size:14px;font-weight:800;padding:13px 6px;border-radius:11px;cursor:pointer;white-space:nowrap;">초기화</button></div><div id="swLaps" style="margin-top:14px;max-height:190px;overflow-y:auto;display:flex;flex-direction:column;"></div></div>';document.body.appendChild(m);var card=m.querySelector('#swCard'),elTime=m.querySelector('#swTime'),bStart=m.querySelector('#swStart'),bLap=m.querySelector('#swLap'),bReset=m.querySelector('#swReset'),bClose=m.querySelector('#swClose'),elLaps=m.querySelector('#swLaps');var running=false,t0=0,acc=0,raf=null,laps=[];function p2(n){return String(n).padStart(2,'0');}function fmt(ms){var cs=Math.floor(ms/10)%100,sc=Math.floor(ms/1000)%60,mi=Math.floor(ms/60000)%60,h=Math.floor(ms/3600000);return (h>0?p2(h)+':':'')+p2(mi)+':'+p2(sc)+'.'+p2(cs);}function val(){return acc+(running?(performance.now()-t0):0);}function tick(){if(!running)return;elTime.textContent=fmt(val());raf=requestAnimationFrame(tick);}function toggle(){if(running){acc+=performance.now()-t0;running=false;cancelAnimationFrame(raf);bStart.textContent='시작';bStart.style.background='#3E9E78';elTime.textContent=fmt(acc);}else{t0=performance.now();running=true;bStart.textContent='정지';bStart.style.background='#D8483A';raf=requestAnimationFrame(tick);}}function reset(){running=false;cancelAnimationFrame(raf);acc=0;laps=[];bStart.textContent='시작';bStart.style.background='#3E9E78';elTime.textContent='00:00.00';draw();}function lap(){laps.unshift(val());draw();}function draw(){elLaps.innerHTML=laps.map(function(t,i){return '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:#C2CAD8;padding:7px 4px;border-top:1px solid rgba(255,255,255,.08);"><span>랩 '+(laps.length-i)+'</span><span style="font-variant-numeric:tabular-nums;color:#EDEFF5;">'+fmt(t)+'</span></div>';}).join('');}bStart.onclick=toggle;bLap.onclick=lap;bReset.onclick=reset;bClose.onclick=function(){m.style.display='none';};m.addEventListener('click',function(e){if(e.target===m)m.style.display='none';});card.addEventListener('click',function(e){e.stopPropagation();});window.__sw={open:function(){if(m.style.display!=='none'){m.style.display='none';return;}m.style.display='block';var b=document.querySelector('[data-act=stopwatch]');if(b){var r=b.getBoundingClientRect();var cw=card.offsetWidth||310;var left=Math.max(8,Math.min(r.right-cw,window.innerWidth-cw-8));card.style.left=Math.round(left)+'px';card.style.right='auto';card.style.top=Math.round(r.bottom+8)+'px';}}};})();
(function(){var P=document.createElement('div');P.id='boardPanel';P.style.cssText='position:fixed;z-index:215;display:none;width:min(400px,94vw);max-height:70vh;overflow-y:auto;background:#161B28;border:1px solid rgba(255,255,255,.16);border-radius:13px;box-shadow:0 20px 50px rgba(0,0,0,.6);padding:11px 14px 12px;left:-9999px;top:0;';document.body.appendChild(P);var pinned=false,cur=null,hideT=null,govSort='new';function rowsHtml(list){var s=list.filter(function(x){return x.r;}).sort(function(a,b){return a.r-b.r;}).concat(list.filter(function(x){return !x.r&&x.done;})).concat(list.filter(function(x){return !x.r&&!x.done;}));return s.map(function(x){var mc=x.r===1?'#FFCB39':x.r===2?'#86CDEC':x.r===3?'#D08A4E':'#C9D2E1';if(x.r)return '<div style="display:flex;align-items:center;font-size:14px;font-weight:800;color:'+mc+';padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.07);"><span'+(x.r<=3?' class="shine"':'')+' style="'+(x.r<=3?shineStyle():'')+'display:inline-flex;align-items:center;gap:8px;color:'+mc+';"><span style="font-weight:900;flex:none;">'+x.r+'등</span><span style="position:relative;">'+E(x.n)+shineStars(x.n)+'</span></span></div>';if(x.done)return '<div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#7FE0B0;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.07);"><span style="flex:none;color:#46D08A;font-weight:900;">✓</span><span style="position:relative;">'+E(x.n)+'</span></div>';return '<div style="font-size:14px;font-weight:600;color:#C9D2E1;opacity:.5;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.07);">'+E(x.n)+'</div>';}).join('');}function build(board){if(board==='gov'){P.style.maxHeight='none';P.style.overflowY='visible';P.style.width='min(440px,94vw)';var GI=[{d:'2026-06-29',dl:'2026.6.29',t:'「건강보험 행위 급여·비급여 목록표 및 급여 상대가치점수」 일부개정 (확정고시)',s:'보건복지부 고시 · 원문',u:'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&act=view&list_no=1491036&tag=&nPage=1'},{d:'2026-06-29',dl:'2026.6.29',t:'「선별급여 지정 및 실시 등에 관한 기준」 일부개정고시 (확정)',s:'보건복지부 고시 · 원문',u:'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&act=view&list_no=1491037&tag=&nPage=1'},{d:'2026-06-29',dl:'2026.6.29',t:'「요양급여의 적용기준 및 방법에 관한 세부사항」 일부개정고시 (확정)',s:'보건복지부 고시 · 원문',u:'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&act=view&list_no=1491038&tag=&nPage=1'},{d:'2026-06-29',dl:'2026.6.29',t:'「요양급여비용 청구방법, 심사청구서·명세서서식 및 작성요령」 일부개정고시 (확정)',s:'보건복지부 고시 · 원문',u:'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&act=view&list_no=1491039&tag=&nPage=1'},{d:'2025-12-09',dl:'2025.12.9',t:'도수치료 등 관리급여 항목 선정',s:'보건복지부 보도자료',u:'https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&act=view&list_no=1488167'},{d:'2026-06-04',dl:'2026.6.4',t:'도수치료 관리급여 수가·급여기준 (건정심 의결)',s:'보건복지부 보도자료',u:'https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&act=view&list_no=1490729'},{d:'2026-06-17',dl:'2026.6.17',t:'체외충격파 의료기관 자율 가이드라인 (부위당 6회·연 12회)',s:'보건복지부 보도자료',u:'https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1490900&mid=a10503010100'},{d:'2026-06-19',dl:'2026.6.19',t:'3종 고시 개정안 행정예고 — 고시 원문·질의응답 PDF 첨부',s:'보건복지부 보도자료 · 원문 다운로드',u:'https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1490937&mid=a10503010100'},{d:'2026-06-08',dl:'2026.6.8',t:'도수치료 관리시스템 개발 설명회 자료·질의응답·사용자 매뉴얼',s:'건강보험심사평가원 공지',u:'https://www.hira.or.kr/bbsDummy.do?pgmid=HIRAA020002000100&brdScnBltNo=4&brdBltNo=12102'},{d:'2026-06-24',dl:'2026.6.24',t:'도수치료 관리시스템 API 개발가이드',s:'심평원 요양기관 업무포털(ef.hira) 홈에서 확인',u:'https://ef.hira.or.kr/efweb/index.do?sso=ok'}];GI.sort(function(a,b){return govSort==='old'?a.d.localeCompare(b.d):b.d.localeCompare(a.d);});var gsb='<button data-govsort="1" style="flex:none;cursor:pointer;font-size:11px;font-weight:800;padding:4px 10px;border-radius:7px;border:1px solid rgba(120,184,255,.45);background:rgba(70,120,220,.18);color:#9FC2F2;white-space:nowrap;">'+(govSort==='old'?'오래된순':'최신순')+' ⇅</button>';P.innerHTML='<div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;"><span style="font-size:12.5px;font-weight:900;color:#fff;background:linear-gradient(180deg,#5B86C8,#3559A6);padding:3px 11px;border-radius:7px;white-space:nowrap;">🏛️ 정부 공식 자료</span><span style="flex:1;"></span>'+gsb+(pinned?'<button data-bclose="1" style="flex:none;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:12px;font-weight:800;padding:4px 10px;border-radius:7px;cursor:pointer;">닫기 ✕</button>':'')+'</div>'+GI.map(function(l){return '<a href="'+l.u+'" target="_blank" rel="noopener" style="display:flex;flex-direction:column;gap:3px;border:1px solid rgba(91,134,200,.4);border-left:4px solid #5B86C8;border-radius:11px;background:#1E2840;padding:10px 13px;margin-bottom:8px;text-decoration:none;"><span style="font-size:13.5px;font-weight:800;color:#EAF0F8;letter-spacing:-.01em;line-height:1.4;">'+l.t+'</span><span style="font-size:11.5px;font-weight:700;"><span style="color:#8FB6E8;">'+l.dl+'</span><span style="color:#7A8499;font-weight:600;"> · '+l.s+'</span></span></a>';}).join('');return;}if(board==='bus'){P.style.maxHeight='none';P.style.overflowY='visible';P.style.width='min(420px,94vw)';P.innerHTML='<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;"><span style="font-size:12.5px;font-weight:900;color:#fff;background:linear-gradient(180deg,#E0922C,#B86A18);padding:3px 11px;border-radius:7px;">버스대절</span><span style="font-size:15px;font-weight:900;color:#F4F6FB;">지역별 버스 안내</span><span style="flex:1;"></span>'+(pinned?'':'<span style="font-size:10px;color:#8C95A8;font-weight:600;white-space:nowrap;">클릭하면 고정</span>')+'</div>'+busCardsHtml();return;}P.style.maxHeight='70vh';P.style.overflowY='auto';P.style.width='min(400px,94vw)';var isSub=board==='sub';var list=(isSub?DATA.subBoard:DATA.researchBoard)||[];var ttl=isSub?'분과학회 집회공지 현황':'연구회 집회공지 현황';var done=list.filter(function(x){return x.r||x.done;}).length;var head='<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;"><span style="font-size:14.5px;font-weight:900;color:'+(isSub?'#9FC2F2':'#7FE0B0')+';letter-spacing:-.02em;">'+ttl+'</span><span style="font-size:11px;font-weight:800;color:#46D08A;background:rgba(70,208,138,.15);padding:2px 7px;border-radius:6px;">'+done+'/'+list.length+'</span><span style="flex:1;"></span>'+(pinned?'<button data-bclose="1" style="flex:none;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:12px;font-weight:800;padding:5px 11px;border-radius:7px;cursor:pointer;">닫기 ✕</button>':'<span style="font-size:10px;color:#8C95A8;font-weight:600;white-space:nowrap;">클릭하면 고정</span>')+'</div>';P.innerHTML=head+rowsHtml(list);}function pos(btn){var r=btn.getBoundingClientRect(),w=P.offsetWidth||380,h=P.offsetHeight||300;if((cur==='bus'||cur==='gov')&&window.innerWidth>=860){var left=r.right+8;if(left+w>window.innerWidth-8)left=Math.max(8,r.left-w-8);var top=Math.max(8,Math.min(r.top,window.innerHeight-h-8));P.style.left=Math.round(left)+'px';P.style.top=Math.round(top)+'px';}else{var l=Math.max(8,Math.min(r.left,window.innerWidth-w-8));P.style.left=Math.round(l)+'px';var ptop=Math.min(r.bottom+6,window.innerHeight-h-8);if(ptop<8)ptop=8;P.style.top=Math.round(ptop)+'px';}}function open(board,btn){cur=board;build(board);P.style.display='block';pos(btn);}function close(){pinned=false;cur=null;P.style.display='none';}var __hoverCap=!(window.matchMedia&&window.matchMedia('(hover: none)').matches);if(__hoverCap){document.addEventListener('mouseover',function(e){var b=e.target.closest&&e.target.closest('button[data-board]');if(!b)return;clearTimeout(hideT);if(pinned)return;open(b.dataset.board,b);});document.addEventListener('mouseout',function(e){var b=e.target.closest&&e.target.closest('button[data-board]');if(!b||pinned)return;hideT=setTimeout(function(){if(!P.matches(':hover')&&!pinned)P.style.display='none';},160);});}P.addEventListener('mouseenter',function(){clearTimeout(hideT);});P.addEventListener('mouseleave',function(){if(!pinned)P.style.display='none';});document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button[data-board]');if(b){e.preventDefault();if(pinned&&cur===b.dataset.board){close();}else{pinned=true;open(b.dataset.board,b);}return;}if(e.target.closest&&e.target.closest('[data-bclose]')){close();return;}if(pinned&&!P.contains(e.target)){close();}});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&P.style.display!=='none')close();});document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-govsort]');if(!b)return;e.preventDefault();e.stopPropagation();pinned=true;cur='gov';govSort=(govSort==='old'?'new':'old');build('gov');var gb=document.querySelector('button[data-board="gov"]');if(gb)pos(gb);});window.addEventListener('resize',function(){if(P.style.display!=='none'&&cur){var b=document.querySelector('button[data-board="'+cur+'"]');if(b)pos(b);}});})();
</script>
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};</script>\n<script defer src="/_vercel/insights/script.js"></script>\n</body></html>`;
const OUT=process.env.PV==='1'?'웹/board/preview.html':'웹/board/index.html';
fs.writeFileSync(OUT,html);
console.log('생성:',OUT,(html.length/1024).toFixed(0)+'KB');
console.log('ko:',ko.length,'press:',press.length,'stmt:',stmt.length,'petitions:',petitions.length);
