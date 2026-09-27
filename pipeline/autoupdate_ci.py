# -*- coding: utf-8 -*-
"""GitHub Actions 자동갱신 오케스트레이터 (PC 독립 실행).

흐름: _news/fetch_*.py 수집 -> _buildboard.cjs 빌드(_news/*.json -> 웹/board/index.html)
      -> 레포 루트 index.html + img/ 동기화.
키: 환경변수(GitHub Secrets)에서 받아 _news/*key*.json 으로 런타임 생성하고, 끝나면 삭제한다.
    (.gitignore 가 *key*.json 을 차단하므로 커밋되지 않는다.)
수집 단계는 실패해도 계속 진행(이전 데이터 보존), 빌드 실패만 중단한다.
"""
import os, sys, json, subprocess, shutil, re
from datetime import datetime, timezone

PIPE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(PIPE)
NEWS = os.path.join(PIPE, '_news')
PY = sys.executable
NODE = os.environ.get('NODE_BIN', 'node')


def log(m):
    print('[%s] %s' % (datetime.now(timezone.utc).strftime('%H:%M:%S'), m), flush=True)


def run(args, label='', must=False):
    log('> %s' % label)
    rc = subprocess.run(args, cwd=PIPE).returncode
    if rc != 0:
        log('  ! %s 실패 rc=%d%s' % (label, rc, ' (빌드 중단)' if must else ' (계속)'))
        if must:
            sys.exit(1)
    return rc


def write_keys():
    nid, nsec = os.environ.get('NAVER_ID', ''), os.environ.get('NAVER_SECRET', '')
    if nid and nsec:
        with open(os.path.join(NEWS, 'naver_key.json'), 'w', encoding='utf-8') as f:
            json.dump({'id': nid, 'secret': nsec}, f)
        log('naver_key.json 생성(env)')
    else:
        log('NAVER 시크릿 없음 -> 네이버 검색 API·데이터랩 생략(공개 RSS·자동완성은 계속)')
    kk = os.environ.get('KAKAO_KEY', '')
    if kk:
        with open(os.path.join(NEWS, 'kakao_key.json'), 'w', encoding='utf-8') as f:
            json.dump({'rest_api_key': kk}, f)
        log('kakao_key.json 생성(env)')


def remove_keys():
    for k in ('naver_key.json', 'kakao_key.json'):
        f = os.path.join(NEWS, k)
        if os.path.exists(f):
            os.remove(f)


def sync_output():
    src_html = os.path.join(PIPE, '웹', 'board', 'index.html')
    if not os.path.isfile(src_html):
        log('index.html 미생성 -> 동기화 중단')
        sys.exit(1)
    shutil.copy(src_html, os.path.join(REPO, 'index.html'))
    html = open(src_html, encoding='utf-8').read()
    refs = set(re.findall(r'img/([\w\-./]+\.(?:jpg|jpeg|png|webp|gif|svg))', html))
    src_img = os.path.join(PIPE, '웹', 'board', 'img')
    dst_img = os.path.join(REPO, 'img')
    os.makedirs(dst_img, exist_ok=True)
    copied = 0
    for rel in refs:
        s = os.path.join(src_img, rel.replace('/', os.sep))
        if os.path.isfile(s):
            d = os.path.join(dst_img, rel.replace('/', os.sep))
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy(s, d)
            copied += 1
    removed = 0
    for root, _, files in os.walk(dst_img):
        for fn in files:
            rel = os.path.relpath(os.path.join(root, fn), dst_img).replace(os.sep, '/')
            if rel not in refs:
                os.remove(os.path.join(root, fn))
                removed += 1
    log('sync | index.html + img (신규 %d, 정리 %d, 참조 %d)' % (copied, removed, len(refs)))


MAX_BACKFILL_DAYS = 31


def backfill_days():
    """BACKFILL_DAYS from workflow_dispatch: integer 0..31; anything else aborts before collection."""
    raw = (os.environ.get('BACKFILL_DAYS') or '0').strip()
    if not re.fullmatch(r'\d{1,2}', raw) or int(raw) > MAX_BACKFILL_DAYS:
        log('BACKFILL_DAYS=%r 거부: 0~%d 정수만 허용 (수집·빌드 중단)' % (raw[:20], MAX_BACKFILL_DAYS))
        sys.exit(2)
    return int(raw)


def allied_workers():
    """Optional trial override 'decode,pages' (each 1..16); anything else keeps the defaults."""
    raw = (os.environ.get('ALLIED_WORKERS') or '').strip()
    m = re.fullmatch(r'(\d{1,2}),(\d{1,2})', raw)
    if not m or not all(1 <= int(v) <= 16 for v in m.groups()):
        if raw:
            log('ALLIED_WORKERS=%r 무시(형식: 구글,기사 각 1~16)' % raw[:20])
        return
    os.environ['ALLIED_DECODE_WORKERS'], os.environ['ALLIED_PAGE_WORKERS'] = m.groups()
    log('ALLIED_WORKERS → 구글 링크 %s개, 기사 페이지 %s개 동시 처리' % m.groups())


def main():
    log('===== CI auto-update start =====')
    os.makedirs(os.path.join(PIPE, '웹', 'board', 'img'), exist_ok=True)
    skip = bool(os.environ.get('SKIP_FETCH'))
    days = backfill_days()
    allied_workers()
    if days and skip:
        log('SKIP_FETCH=1 이므로 BACKFILL_DAYS=%d 무시' % days)
    elif days:
        log('BACKFILL_DAYS=%d → 동맹 뉴스·네이버/카카오 언급 1회성 게시일 기준 소급 수집(한도 있음)' % days)
    allied_args = ['--days', str(days)] if days else []
    naver_args = ['--backfill-days', str(days)] if days else []
    if skip:
        log('SKIP_FETCH=1 → 뉴스·버즈 수집 생략, 빌드만 수행(코드/문구 변경 즉시 반영)')
    try:
        write_keys()
        if not skip:
            run([PY, os.path.join(NEWS, 'fetch_press.py')], 'press')
            run([PY, os.path.join(NEWS, 'fetch_ko.py')], 'ko')
            run([PY, os.path.join(NEWS, 'fetch_insure.py')], 'insure')
            run([PY, os.path.join(NEWS, 'fetch_allied.py')] + allied_args, 'allied-news')
            run([PY, os.path.join(NEWS, 'fetch_buzz.py')], 'buzz-google')
            run([PY, os.path.join(NEWS, 'fetch_buzz_naver.py')] + naver_args, 'buzz-naver')
        run([NODE, os.path.join(PIPE, '_buildboard.cjs')], 'build', must=True)
        sync_output()
    finally:
        remove_keys()  # 키 파일 즉시 삭제(커밋 방지 이중 안전장치)
    log('===== done =====')


if __name__ == '__main__':
    main()
