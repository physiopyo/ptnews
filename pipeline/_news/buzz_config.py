"""One opinion vocabulary for collectors and board; no credentials or network calls."""
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

_CONFIG = json.loads(Path(__file__).with_name('buzz_keywords.json').read_text(encoding='utf-8'))
SUBJECTS = []
SPECS = []
for group in _CONFIG['subjects']:
    SUBJECTS.append({'id': group['id'], 'label': group['label'],
                     'keywords': [item['keyword'] for item in group['keywords']]})
    for item in group['keywords']:
        terms = list(dict.fromkeys(item['terms']))
        if not terms or terms[0] != item['keyword'] or len(terms) > 20:
            raise ValueError('Invalid keyword group: ' + item['keyword'])
        SPECS.append({**item, 'terms': terms, 'category': group['label'], 'subject': group['id'],
                      'search_query': item['keyword'], 'google_query': item['keyword'],
                      'autocomplete_query': item['keyword']})
KEYWORDS = [s['keyword'] for s in SPECS]
if len(KEYWORDS) != len(set(KEYWORDS)):
    raise ValueError('Duplicate canonical keywords')
CONFIG_HASH = hashlib.sha256(json.dumps(SPECS, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
SIX_HOURS = 6 * 3600
DAY = 24 * 3600


def batches(values, size=5):
    if not 1 <= size <= 5:
        raise ValueError('Trend requests allow at most five groups')
    return [values[i:i + size] for i in range(0, len(values), size)]


def metadata():
    return {
        'config_hash': CONFIG_HASH,
        'keywords': SPECS,
        'subjects': SUBJECTS,
        'matching': '검색·자동완성은 별칭별 요청 후 중복 제거. 트렌드·RSS는 별칭 묶음 질의. 대표어 간 결과 중복 가능; 총합 금지.',
        'normalization': 'Google/데이터랩은 요청 묶음과 조회 기간별 0~100 상대지수. 다른 묶음·조회 시점의 지수를 절대량으로 비교하지 않음.',
        'cadence_hours': {'mentions_sentiment_related': 6, 'trends_autocomplete': 24},
        'history': '검색 표본·RSS 관측값이며 전수 아님. 저장 이력은 만료하지 않고 화면 조회 기간만 제한. 단어는 글의 최초 관측일 기준이며 원문 작성일과 다를 수 있음.',
        'sentiment': '제목·요약의 감성사전 단어 빈도. 정책 찬반·직역 지지율 아님.',
        'auxiliary': '전국민 마음건강은 보조 검색어이며 공식 사업명으로 표시하지 않음.',
    }


def load(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {} if default is None else default
    # Invalid stored JSON must not be silently treated as empty and overwritten.


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=1)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def due(status, seconds, now=None):
    now = datetime.now(timezone.utc).timestamp() if now is None else now
    # Also throttle failed attempts. A new vocabulary invalidates old success.
    return status.get('config_hash') != CONFIG_HASH or now - status.get('attempted_at', 0) >= seconds


def record(status, success, error=None, now=None):
    now = datetime.now(timezone.utc).timestamp() if now is None else now
    result = {**status, 'config_hash': CONFIG_HASH, 'attempted_at': now,
              'status': 'ok' if success else 'error'}
    if success:
        result['success_at'] = now
        result.pop('error', None)
    else:
        result['error'] = error or 'request failed; prior successful data retained'
    return result
