# -*- coding: utf-8 -*-
"""Daily Google/automatic suggestions, with permanent immutable observations.

Google receives one comparison item per canonical keyword: all its quoted terms
joined by '+' (OR). Independently normalized alias curves are NEVER averaged.
Current curves use only their latest successful request window; older windows
remain in buzz_archive, never stitched onto a new 0..100 scale.
"""
import argparse
import hashlib
import json
import math
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import requests
import buzz_config as config

ROOT = Path(__file__).resolve().parent
TIMEFRAME = 'today 3-m'
GEO = 'KR'
DEFAULT_MAX_REQUESTS = 240
H = {'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR,ko;q=0.9'}
NORMALIZATION = {
    'scale': 'relative_0_100', 'scope': 'request_batch_and_window',
    'comparable_across_batches': False, 'comparable_across_snapshots': False,
    'alias_method': 'quoted terms joined by + (OR) in one item; no alias averaging',
    'display': 'latest successful window per keyword; null outside that window',
}


class RequestLimit(RuntimeError):
    pass


class MissingDependency(RuntimeError):
    pass


class RequestBudget:
    def __init__(self, maximum):
        if not isinstance(maximum, int) or not 0 <= maximum <= 500:
            raise ValueError('max_requests must be between 0 and 500')
        self.maximum, self.used = maximum, 0
        self.providers = {'google': 0, 'autocomplete': 0}

    def take(self, provider):
        if self.used >= self.maximum:
            raise RequestLimit('per-run HTTP request limit reached')
        self.used += 1
        self.providers[provider] += 1


class ProviderAPI:
    """collect(api_class=LocalAPI) supports entirely offline tests."""
    def __init__(self, budget):
        self.budget, self.trend = budget, None

    def google_payload(self, expressions):
        if self.trend is None:
            try:
                from pytrends.request import TrendReq
            except ImportError as exc:
                raise MissingDependency('pytrends unavailable: ' + str(exc)) from exc
            budget = self.budget

            class BoundedTrendReq(TrendReq):
                # Count actual HTTP calls, including constructor cookies and each
                # related-query widget. No redirects, retries or proxy rotation.
                def GetGoogleCookie(self):
                    budget.take('google')
                    response = requests.get(
                        'https://trends.google.com/trends/explore?geo=KR',
                        timeout=(10, 25), allow_redirects=False)
                    response.raise_for_status()
                    if response.status_code != 200:
                        raise RuntimeError('Google cookie status: %s' % response.status_code)
                    return {k: v for k, v in response.cookies.items() if k == 'NID'}

                def _get_data(self, *args, **kwargs):
                    budget.take('google')
                    return super()._get_data(*args, **kwargs)

            self.trend = BoundedTrendReq(
                hl='ko-KR', tz=540, timeout=(10, 25), retries=0,
                backoff_factor=0, requests_args={'allow_redirects': False})
        self.trend.build_payload(expressions, timeframe=TIMEFRAME, geo=GEO)

    def google_series(self):
        return self.trend.interest_over_time()

    def google_related(self, expression):
        # pytrends otherwise loops across widgets internally, losing successful
        # earlier responses if a later request fails. Expose one HTTP observation.
        widgets = self.trend.related_queries_widget_list
        selected = [widget for widget in widgets
                    if widget['request']['restriction']['complexKeywordsRestriction']
                    ['keyword'][0]['value'] == expression]
        if len(selected) != 1:
            raise ValueError('Missing or duplicate Google related-query widget')
        self.trend.related_queries_widget_list = selected
        try:
            return self.trend.related_queries()
        finally:
            self.trend.related_queries_widget_list = widgets

    def autocomplete(self, query):
        self.budget.take('autocomplete')
        response = requests.get(
            'https://ac.search.naver.com/nx/ac',
            params={'q': query, 'con': 1, 'frm': 'nv', 'ans': 2,
                    'r_format': 'json', 'st': 100},
            headers={**H, 'Referer': 'https://www.naver.com/'},
            timeout=10, allow_redirects=False)
        response.raise_for_status()
        if response.status_code != 200:
            raise RuntimeError('Autocomplete status: %s' % response.status_code)
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get('items'), list):
            raise ValueError('Malformed autocomplete response')
        suggestions = []
        for group in payload['items']:
            if not isinstance(group, list):
                raise ValueError('Malformed autocomplete group')
            for item in group:
                term = item[0] if isinstance(item, list) and item else item
                if isinstance(term, str) and term.strip() and term.strip() != query:
                    suggestions.append(term.strip())
        return list(dict.fromkeys(suggestions))


def iso_time(now):
    return datetime.fromtimestamp(now, timezone.utc).isoformat().replace('+00:00', 'Z')


def terms_for(spec):
    return list(dict.fromkeys([spec['keyword'], *spec['terms']]))


def google_expression(spec):
    terms = terms_for(spec)
    if any('"' in term or '\\' in term for term in terms):
        raise ValueError('Google terms must not contain quotes or backslashes')
    return ' + '.join('"' + term + '"' for term in terms)


def batch_key(batch):
    payload = [(spec['keyword'], google_expression(spec)) for spec in batch]
    return 'google:' + hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode()).hexdigest()[:16]


def immutable_bytes(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('xb') as stream:
            stream.write(content)
    except FileExistsError:
        if path.read_bytes() != content:
            raise ValueError('Immutable archive collision: ' + str(path))


def archive_legacy(path):
    """Archive exact original bytes BEFORE writing any collection output."""
    if not path.exists():
        return None
    content = path.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    target = path.parent / 'buzz_archive' / 'legacy' / (digest + '.json')
    immutable_bytes(target, content)
    origin = {'original_filename': path.name, 'source': 'pre-collection ' + path.name,
              'sha256': digest, 'byte_length': len(content)}
    immutable_bytes(target.with_suffix('.source.json'),
                    json.dumps(origin, ensure_ascii=False, sort_keys=True).encode())
    return target.relative_to(path.parent).as_posix()


def archive_snapshot(root, provider, identifier, snapshot, now):
    content = json.dumps(snapshot, ensure_ascii=False, sort_keys=True,
                         allow_nan=False).encode('utf-8')
    digest = hashlib.sha256(content).hexdigest()[:16]
    stamp = datetime.fromtimestamp(now, timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target = root / 'buzz_archive' / provider / (stamp + '-' + identifier + '-' + digest + '.json')
    immutable_bytes(target, content)
    return target.relative_to(root).as_posix()


def read_series(frame, batch):
    if frame is None or not len(frame):
        raise ValueError('Google returned no time series')
    dates = [value.strftime('%Y-%m-%d') for value in frame.index]
    if len(dates) != len(set(dates)):
        raise ValueError('Google returned duplicate dates')
    series = {}
    for spec in batch:
        expression = google_expression(spec)
        if expression not in frame.columns:
            raise ValueError('Missing Google series: ' + spec['keyword'])
        values = []
        for value in frame[expression].tolist():
            number = float(value) if value is not None else math.nan
            if math.isfinite(number) and not 0 <= number <= 100:
                raise ValueError('Google index outside 0..100')
            values.append(int(number) if math.isfinite(number) else None)
        if len(values) != len(dates):
            raise ValueError('Google series/date length mismatch')
        series[spec['keyword']] = values
    return {'dates': dates, 'series': series}


def read_related(payload, batch):
    result = {}
    for spec in batch:
        expression = google_expression(spec)
        if expression not in payload:
            raise ValueError('Missing Google related queries: ' + spec['keyword'])
        result[spec['keyword']] = {}
        for kind in ('top', 'rising'):
            frame = (payload[expression] or {}).get(kind)
            result[spec['keyword']][kind] = [
                {'q': row['query'], 'v': int(row['value']) if kind == 'top' else str(row['value'])}
                for _, row in frame.iterrows()] if frame is not None else []
    return result


def merge_mapping(previous, updates):
    result = deepcopy(previous) if isinstance(previous, dict) else {}
    for key, value in updates.items():
        result[key] = merge_mapping(result.get(key), value) if isinstance(value, dict) else deepcopy(value)
    return result


def merge_windows(previous, updates, windows):
    """Replace whole rolling windows, align by actual dates, never interpolate."""
    result = deepcopy(previous)
    old_dates = previous.get('dates', [])
    points = {key: dict(zip(old_dates, values))
              for key, values in previous.get('series', {}).items()}
    for key, (dates, values) in updates.items():
        points[key] = dict(zip(dates, values))
    dates = sorted({date for values in points.values() for date in values})
    result['dates'] = dates
    result['series'] = {key: [values.get(date) for date in dates] for key, values in points.items()}
    existing = (previous.get('normalization') or {}).get('keyword_windows', {})
    legacy = {key: {'batch_id': None, 'observed_at': None, 'source': 'legacy; request window unknown'}
              for key in points if key not in existing and key not in windows}
    result['normalization'] = merge_mapping(previous.get('normalization'), NORMALIZATION)
    result['normalization']['keyword_windows'] = {**legacy, **existing, **windows}
    return result


def http_status(exc):
    response = getattr(exc, 'response', None)
    return getattr(response, 'status_code', None) or (429 if type(exc).__name__ == 'TooManyRequestsError' else None)


def blocked_provider(statuses, provider, now):
    for key, status in statuses.items():
        if key.startswith(provider + ':') and not config.due(status, config.DAY, now):
            if status.get('http_status') == 429 or status.get('error_kind') == 'missing_dependency':
                return key
    return None


def failed_status(old, exc, now):
    result = config.record(old, False, type(exc).__name__ + ': ' + str(exc)[:240], now)
    result['http_status'] = http_status(exc)
    result['error_kind'] = 'missing_dependency' if isinstance(exc, MissingDependency) else type(exc).__name__
    result.pop('deferred_reason', None)
    return result


def deferred_status(old, reason, now):
    # Non-attempts must not invent attempted_at or postpone future work.
    return {**old, 'status': 'deferred', 'checked_at': now, 'deferred_reason': reason}


def success_status(old, now):
    result = config.record(old, True, now=now)
    for key in ('http_status', 'error_kind', 'deferred_reason'):
        result.pop(key, None)
    return result


def collect(output_dir=ROOT, *, keywords=None, max_requests=DEFAULT_MAX_REQUESTS,
            api_class=ProviderAPI, now=None):
    now = datetime.now(timezone.utc).timestamp() if now is None else now
    root = Path(output_dir).resolve()
    path = root / 'buzz.json'
    requested = set(config.KEYWORDS if keywords is None else keywords)
    unknown = requested.difference(config.KEYWORDS)
    if unknown:
        raise ValueError('Unknown keywords: ' + ', '.join(sorted(unknown)))
    specs = [spec for spec in config.SPECS if spec['keyword'] in requested]
    budget = RequestBudget(max_requests)
    old = config.load(path)
    if not isinstance(old, dict):
        raise ValueError('buzz.json must be an object')
    legacy = archive_legacy(path)
    statuses = deepcopy(old.get('collection', {}))
    changes, series_updates, related_updates, ac_updates, windows = {}, {}, {}, {}, {}
    archives = {'legacy': [legacy] if legacy else [], 'google': [], 'autocomplete': []}
    api = api_class(budget)
    stopped = blocked_provider(statuses, 'google', now)
    for batch in config.batches(specs):
        key = batch_key(batch)
        status = {**statuses.get(key, {}),
                  'keywords': [spec['keyword'] for spec in batch],
                  'query_map': {google_expression(spec): spec['keyword'] for spec in batch}}
        if not config.due(status, config.DAY, now):
            continue
        if stopped or budget.used >= budget.maximum:
            reason = 'provider blocked by ' + stopped if stopped else 'request budget exhausted'
            changes[key] = deferred_status(status, reason, now)
            continue
        snapshot = {'schema': 'buzz.google.snapshot.v1', 'provider': 'google',
                    'observed_at': iso_time(now), 'config_hash': config.CONFIG_HASH,
                    'batch_id': key, 'timeframe': TIMEFRAME, 'geo': GEO,
                    'keywords': [spec['keyword'] for spec in batch],
                    'query_map': {google_expression(spec): spec['keyword'] for spec in batch},
                    'terms': {spec['keyword']: terms_for(spec) for spec in batch},
                    'normalization': NORMALIZATION}
        references, error = [], None
        try:
            api.google_payload(list(snapshot['query_map']))
            trend = read_series(api.google_series(), batch)
        except Exception as exc:
            error = exc
        if error is None:
            # Storage errors deliberately escape: no data can replace unarchived data.
            references.append(archive_snapshot(root, 'google', key.split(':')[1],
                              {**snapshot, 'component': 'interest_over_time', 'trend': trend}, now))
            related = {}
            for spec in batch:
                expression = google_expression(spec)
                try:
                    queries = read_related(api.google_related(expression), [spec])
                except Exception as exc:
                    error = exc
                    break
                related.update(queries)
                references.append(archive_snapshot(root, 'google', key.split(':')[1],
                                  {**snapshot, 'component': 'related_queries',
                                   'query': expression, 'related_google': queries}, now))
        archives['google'].extend(references)
        if error is not None:
            changes[key] = failed_status(status, error, now)
            changes[key]['snapshots'] = list(dict.fromkeys(status.get('snapshots', []) + references))
            if http_status(error) == 429 or isinstance(error, MissingDependency):
                stopped = key
            continue
        changes[key] = {**success_status(status, now), 'keywords': snapshot['keywords'],
                        'query_map': snapshot['query_map'], 'snapshots': references}
        related_updates.update(related)
        for keyword, values in trend['series'].items():
            series_updates[keyword] = (trend['dates'], values)
            windows[keyword] = {'batch_id': key, 'observed_at': iso_time(now),
                               'config_hash': config.CONFIG_HASH, 'snapshots': references,
                               'dates': list(trend['dates'])}

    stopped = blocked_provider(statuses, 'autocomplete', now)
    cache = {}
    for spec in specs:
        keyword = spec['keyword']
        key = 'autocomplete:' + keyword
        status = {**statuses.get(key, {}), 'queries': terms_for(spec)}
        if not config.due(status, config.DAY, now):
            continue
        errors, suggestions, references = [], [], []
        attempted = False
        for term in terms_for(spec):
            if term not in cache:
                if stopped or budget.used >= budget.maximum:
                    errors.append(RequestLimit('provider blocked by ' + stopped if stopped else 'request budget exhausted'))
                    continue
                attempted = True
                try:
                    result = api.autocomplete(term)
                except Exception as exc:
                    cache[term] = ([], None, exc)
                    if http_status(exc) == 429:
                        stopped = key
                else:
                    reference = archive_snapshot(root, 'autocomplete', hashlib.sha256(term.encode()).hexdigest()[:16],
                        {'schema': 'buzz.autocomplete.snapshot.v1', 'provider': 'naver_autocomplete',
                         'observed_at': iso_time(now), 'config_hash': config.CONFIG_HASH,
                         'query': term, 'suggestions': result}, now)
                    archives['autocomplete'].append(reference)
                    cache[term] = (result, reference, None)
            if term in cache:
                result, reference, error = cache[term]
                attempted = True
                if error:
                    errors.append(error)
                else:
                    suggestions.extend(result)
                    references.append(reference)
        if errors:
            if attempted:
                error = next((exc for exc in errors if http_status(exc) == 429), errors[0])
                changes[key] = failed_status(status, error, now)
                changes[key]['snapshots'] = list(dict.fromkeys(status.get('snapshots', []) + references))
            else:
                changes[key] = deferred_status(status, str(errors[0]), now)
            continue
        ac_updates[keyword] = [term for term in dict.fromkeys(suggestions) if term not in terms_for(spec)]
        changes[key] = {**success_status(status, now), 'queries': terms_for(spec), 'snapshots': references}

    # Re-read shared data; never replace Naver fields or another worker's statuses.
    data = config.load(path)
    legacy = archive_legacy(path)
    if legacy:
        archives['legacy'].append(legacy)
    data['collection'] = {**data.get('collection', {}), **changes}
    data['keywords'] = list(dict.fromkeys(data.get('keywords', []) + config.KEYWORDS))
    subjects = {item['id']: item for item in data.get('subjects', [])}
    for item in config.SUBJECTS:
        prior = subjects.get(item['id'], {})
        subjects[item['id']] = {**prior, **item, 'keywords': list(dict.fromkeys(prior.get('keywords', []) + item['keywords']))}
    data['subjects'] = list(subjects.values())
    data['keyword_config'] = merge_mapping(data.get('keyword_config'), config.metadata())
    if series_updates:
        data['trend'] = merge_windows(data.get('trend', {}), series_updates, windows)
        data['related_google'] = merge_mapping(data.get('related_google'), related_updates)
        data['google_updated'] = iso_time(now)
    else:
        trend = data.setdefault('trend', {})
        trend['normalization'] = merge_mapping(trend.get('normalization'), NORMALIZATION)
    if ac_updates:
        data['related_naver'] = {**data.get('related_naver', {}), **ac_updates}
        data['autocomplete_updated'] = iso_time(now)
    if series_updates or ac_updates:
        data['updated'] = iso_time(now)
    data.setdefault('timeframe', TIMEFRAME)
    data.setdefault('geo', GEO)
    data.setdefault('source', 'Google Trends + 네이버 자동완성')
    data['google_collection'] = {
        **data.get('google_collection', {}), 'checked_at': iso_time(now),
        'config_hash': config.CONFIG_HASH, 'cadence_seconds': config.DAY,
        'requests': {'used': budget.used, 'limit': budget.maximum, **budget.providers},
        'selected_keywords': [spec['keyword'] for spec in specs],
    }
    archive = data.setdefault('google_archive', {})
    archive['retention'] = 'permanent; no age or count deletion'
    archive['normalization'] = NORMALIZATION
    for provider, references in archives.items():
        archive[provider] = list(dict.fromkeys(archive.get(provider, []) + references))
    config.save(path, data)
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT)
    parser.add_argument('--keywords', nargs='+', choices=config.KEYWORDS,
                        help='canonical keywords; quote keywords containing spaces')
    parser.add_argument('--max-requests', type=int, default=DEFAULT_MAX_REQUESTS,
                        help='hard HTTP cap across providers (0..500, no retries)')
    args = parser.parse_args(argv)
    if not 0 <= args.max_requests <= 500:
        parser.error('--max-requests must be between 0 and 500')
    data = collect(args.output_dir, keywords=args.keywords, max_requests=args.max_requests)
    print('buzz.json: %d HTTP requests; %d configured keywords' %
          (data['google_collection']['requests']['used'], len(config.KEYWORDS)))
    return data


if __name__ == '__main__':
    main()
