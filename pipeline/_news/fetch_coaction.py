# -*- coding: utf-8 -*-
"""공동대응 수치 자동 수집 → _news/coaction.json
- 국민신문고 온라인공청회 3건: 찬성+반대+기타 합계(=의견수)
- 국회 국민동의청원: agreCo(동의자수) / mtzNmpr(목표) → 퍼센트
브라우저 불필요. requests만 사용.
"""
import requests, re, json, os, sys
from datetime import datetime
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

H = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9',
}
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'coaction.json')
HISTORY = os.path.join(HERE, 'coaction_history.json')

# 국민신문고 공청회 3건(요양급여·선별급여·상대가치)은 6.24 18시 마감 종료 → 자동수집 중단.
# 마지막 집계값은 coaction.json / coaction_history.json 에 그대로 보존됨.
EPEOPLE = {}
PETIT_ID = '527DFB9D4A5222D7E064ECE7A7064E8B'
PETIT_ID2 = '52523590A2A26BDEE064B49691C6967B'  # 안면마비 재활 도수치료 관리급여 기준 철회 청원(2026.7.20 마감)


def epeople_sum(reg):
    s = requests.Session(); s.headers.update(H)
    t = s.get('https://www.epeople.go.kr/cmmn/idea/redirectGo.do?ideaRegNo=' + reg, timeout=20).text
    csrf = re.search(r'name="_csrf" value="([^"]+)"', t).group(1)
    sctn = re.search(r'id="epDutySctnCd"[^>]*value="([^"]+)"', t).group(1)
    h = s.post('https://www.epeople.go.kr/nep/thk/elecPbl/elecPblntcDetail.npaid',
               data={'ideaRegNo': reg, 'epDutySctnCd': sctn, '_csrf': csrf, 'ideaTyCd': '', 'ideaStepCd': ''},
               timeout=20).text
    def g(lab):
        m = re.search(lab + r'\s*:\s*<b>([0-9,]+)</b>', h)
        return int(m.group(1).replace(',', '')) if m else 0
    c, b, e = g('찬성'), g('반대'), g('기타')
    total = c + b + e
    if total == 0:
        raise RuntimeError('epeople parse failed for ' + reg)
    return {'total': total, 'fa': c, 'op': b, 'et': e}


def petition(pid=PETIT_ID):
    r = requests.get('https://petitions.assembly.go.kr/api/petits/%s?petitId=%s&view=&sttusCode=' % (pid, pid),
                     headers={**H, 'Referer': 'https://petitions.assembly.go.kr/'}, timeout=20)
    d = r.json()
    agree = int(d.get('agreCo') or 0)
    target = int(d.get('mtzNmpr') or 50000)
    pct = int(agree * 100 / target) if target else 0
    if agree == 0:
        raise RuntimeError('petition parse failed')
    return agree, pct


def append_history(out):
    try:
        hist = json.load(open(HISTORY, encoding='utf-8')) if os.path.exists(HISTORY) else []
    except Exception:
        hist = []
    row = {k: out.get(k) for k in ['updatedAt','updated','yoyang','yoyang_fa','yoyang_op','yoyang_et','seonbyeol','seonbyeol_fa','seonbyeol_op','seonbyeol_et','sangdae','sangdae_fa','sangdae_op','sangdae_et','petition','petitionPct','petition2','petition2Pct']}
    if row.get('updatedAt') and not any(x.get('updatedAt') == row.get('updatedAt') for x in hist):
        hist.append(row)
        hist.sort(key=lambda x: x.get('updatedAt') or '')
        json.dump(hist, open(HISTORY, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

def main():
    # 기존 값 로드(실패 시 폴백)
    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            prev = {}

    out = dict(prev)
    errs = []
    for k, reg in EPEOPLE.items():
        try:
            r = epeople_sum(reg)
            out[k] = r['total']
            out[k + '_op'] = r['op']   # 반대
            out[k + '_fa'] = r['fa']   # 찬성
            out[k + '_et'] = r['et']   # 기타
        except Exception as ex:
            errs.append('%s: %s' % (k, ex))
    try:
        agree, pct = petition()
        out['petition'] = agree
        out['petitionPct'] = pct
    except Exception as ex:
        errs.append('petition: %s' % ex)
    try:
        agree2, pct2 = petition(PETIT_ID2)
        out['petition2'] = agree2
        out['petition2Pct'] = pct2
    except Exception as ex:
        errs.append('petition2: %s' % ex)

    now = datetime.now()
    out['updated'] = '%d.%d %d시 기준' % (now.month, now.day, now.hour)
    out['updatedAt'] = now.strftime('%Y-%m-%d %H:%M')

    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    append_history(out)
    print('coaction:', json.dumps(out, ensure_ascii=False))
    if errs:
        print('WARN errors:', '; '.join(errs), file=sys.stderr)
        # 일부 실패해도 나머지는 갱신(이전 값 유지). 전부 실패면 비정상 종료.
        if len(errs) >= 4:
            sys.exit(1)


if __name__ == '__main__':
    main()
