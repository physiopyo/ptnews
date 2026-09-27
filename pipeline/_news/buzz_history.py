"""Permanent, non-secret observations. Storage has no retention window.

Documents are unique per canonical keyword and URL, with immutable first_seen.
Word periods use first_seen (KST), never inferred publication or legacy dates.
"""
from collections import Counter
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from urllib.parse import urldefrag

import buzz_config as config

KST = timezone(timedelta(hours=9))


def observed_at(now):
    instant = datetime.fromtimestamp(now, timezone.utc)
    return {'utc': instant.isoformat(), 'kst': instant.astimezone(KST).isoformat()}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def kst_date(value):
    """KST calendar date of a stored published_at (date-only values are already KST)."""
    if not isinstance(value, str) or len(value) < 10:
        return None
    if len(value) == 10:
        return value
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        return value[:10]
    return stamp.astimezone(KST).date().isoformat()


def word_rows(counts, polarities=None):
    rows = [{'w': word, 'c': count} for word, count in
            sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
    if polarities is not None:
        for row in rows:
            row['p'] = polarities[row['w']]
    return rows


def summarize(documents):
    counts = {'news': 0, 'blog': 0, 'cafe': 0}
    related = {channel: Counter() for channel in counts}
    sentiment = {channel: Counter() for channel in counts}
    polarity = {}
    for document in documents:
        channel = document['channel']
        counts[channel] += 1
        related[channel].update(document['related'])
        for word, item in document['sentiment'].items():
            sentiment[channel][word] += item['c']
            polarity[word] = item['p']
    all_related = sum(related.values(), Counter())
    community = sentiment['blog'] + sentiment['cafe']
    return {
        'documents': counts,
        'related': word_rows(all_related),
        'sentiment': {
            'community': word_rows(community, polarity),
            'blog': word_rows(sentiment['blog'], polarity),
            'cafe': word_rows(sentiment['cafe'], polarity),
        },
        'channels': {
            channel: {'documents': counts[channel], 'related': dict(related[channel]),
                      'sentiment': {word: {'c': count, 'p': polarity[word]}
                                    for word, count in sentiment[channel].items()}}
            for channel in counts
        },
    }


class HistoryArchive:
    def __init__(self, output_dir):
        self.output_dir = Path(output_dir)
        self.root = self.output_dir / 'buzz_archive'
        self.documents = {}
        self.months = {}
        self.events = {}
        self.dirty_documents = set()
        self.dirty_events = set()
        for path in sorted(self.root.glob('documents-*.json')):
            month = path.stem.removeprefix('documents-')
            records = config.load(str(path), {})
            self.months[month] = records
            self.documents.update(records)
        for path in sorted(self.root.glob('events-*.json')):
            month = path.stem.removeprefix('events-')
            self.events[month] = config.load(str(path), [])

    def preserve_legacy(self):
        """Copy each pre-existing buzz*.json byte-for-byte before any mutation."""
        directory = self.root / 'legacy'
        directory.mkdir(parents=True, exist_ok=True)
        manifest_path = directory / 'manifest.json'
        manifest = config.load(str(manifest_path), {'files': {}})
        changed = False
        for path in sorted(self.output_dir.glob('buzz*.json')):
            if path.name in manifest['files']:
                continue
            raw = path.read_bytes()
            content_hash = hashlib.sha256(raw).hexdigest()
            target = directory / (content_hash + '.json')
            if not target.exists():
                target.write_bytes(raw)
            manifest['files'][path.name] = {'sha256': content_hash,
                                           'path': target.name}
            changed = True
        if changed or not manifest_path.exists():
            config.save(str(manifest_path), manifest)

    def snapshot(self, kind, keyword, source, data, now):
        stamp = observed_at(now)
        event = {'kind': kind, 'keyword': keyword, 'source': source,
                 'observed_at': stamp, 'data': deepcopy(data),
                 'config_hash': config.CONFIG_HASH}
        month = stamp['kst'][:7]
        rows = self.events.setdefault(month, [])
        event['id'] = digest([event, len(rows)])
        rows.append(event)
        self.dirty_events.add(month)

    def observe(self, keyword, documents, now, discovery=None):
        """discovery='publication_date_backfill' marks documents first found by a backfill.

        They join the permanent index (so later runs never re-count them as newly
        first-seen) but their words belong to publication-date rows, not first_seen.
        """
        stamp = observed_at(now)
        identifiers = []
        for value in documents:
            document = deepcopy(value)
            url = urldefrag(document['url'])[0]
            identifier = digest([keyword, url])
            if identifier in identifiers:
                continue
            identifiers.append(identifier)
            old = self.documents.get(identifier)
            document.update({'id': identifier, 'keyword': keyword, 'url': url,
                             'first_seen': old['first_seen'] if old else stamp,
                             'last_seen': stamp})
            if old:
                document['channel'] = old['channel']
                document['published_at'] = document.get('published_at') or old.get('published_at')
                if old.get('discovery'):
                    document['discovery'] = old['discovery']
            elif discovery:
                document['discovery'] = discovery
            if old is None or any(document.get(key) != old.get(key) for key in
                                  ('content_hash', 'tokens', 'related', 'sentiment', 'published_at')):
                self.snapshot('document_revision' if old else 'document', keyword,
                              document['provider'], {'document': document, 'previous': old}, now)
            month = document['first_seen']['kst'][:7]
            self.documents[identifier] = document
            self.months.setdefault(month, {})[identifier] = document
            self.dirty_documents.add(month)
        return identifiers

    def sample(self, identifiers):
        return summarize([self.documents[key] for key in dict.fromkeys(identifiers)
                          if key in self.documents])

    def word_daily(self, keyword):
        by_date, coverage, stamps = {}, {}, {}
        originals = {}
        for events in self.events.values():
            for event in events:
                if event['keyword'] == keyword and event['kind'] == 'document':
                    document = event['data']['document']
                    originals.setdefault(document['id'], document)
        originals = {key: document for key, document in originals.items() if not document.get('discovery')}
        # Only the immutable initial analysis belongs to a first-seen period.
        # Revisions are current samples, not newly published words in the past.
        for document in originals.values():
            date = document['first_seen']['kst'][:10]
            by_date.setdefault(date, []).append(document)
            coverage.setdefault(date, set()).add(document['channel'])
            current = stamps.get(date)
            if current is None or current['utc'] < document['first_seen']['utc']:
                stamps[date] = document['first_seen']
        for events in self.events.values():
            for event in events:
                if event['keyword'] != keyword or event['kind'] != 'mentions':
                    continue
                date = event['observed_at']['kst'][:10]
                channel = event['data']['channel']
                coverage.setdefault(date, set()).add(channel)
                by_date.setdefault(date, [])
                current = stamps.get(date)
                if current is None or current['utc'] < event['observed_at']['utc']:
                    stamps[date] = event['observed_at']
        rows = []
        for date in sorted(by_date):
            summary = summarize(by_date[date])
            for channel in summary['documents']:
                if channel not in coverage[date]:
                    summary['documents'][channel] = None
                    summary['channels'][channel] = None
                    if channel in summary['sentiment']:
                        summary['sentiment'][channel] = None
            if not coverage[date].intersection({'blog', 'cafe'}):
                summary['sentiment']['community'] = None
            rows.append({'date': date, 'basis': 'first_seen', **summary,
                         'coverage': sorted(coverage[date]), 'observed_at': stamps[date]})
        return rows

    def word_daily_backfill(self, keyword):
        """Words of backfill-discovered documents by publication date (KST).

        Coverage/status come from the permanent 'mentions_backfill' events. Documents
        already observed by regular runs stay in their first_seen rows and are only
        reported as previously_observed (the row is then partial for that channel).
        """
        rank = {'complete': 2, 'partial': 1}
        coverage, stamps, known = {}, {}, {}
        for events in self.events.values():
            for event in events:
                if event['keyword'] != keyword or event['kind'] != 'mentions_backfill':
                    continue
                channel = event['data']['channel']
                for date, info in event['data']['dates'].items():
                    state = coverage.setdefault(date, {})
                    status = info['status']
                    if info.get('previously_observed'):
                        status = 'partial'
                    previous = state.get(channel)
                    if previous is None or rank[status] > rank[previous]:
                        state[channel] = status
                        known.setdefault(date, {})[channel] = info.get('previously_observed', 0)
                    current = stamps.get(date)
                    if current is None or current['utc'] < event['observed_at']['utc']:
                        stamps[date] = event['observed_at']
        by_date = {}
        for events in self.events.values():
            for event in events:
                if event['keyword'] != keyword or event['kind'] != 'document':
                    continue
                document = event['data']['document']
                if document.get('discovery') != 'publication_date_backfill':
                    continue
                date = kst_date(document.get('published_at'))
                if date in coverage and document['channel'] in coverage[date]:
                    by_date.setdefault(date, {})[document['id']] = document
        rows = []
        for date in sorted(coverage):
            summary = summarize(list(by_date.get(date, {}).values()))
            for channel in summary['documents']:
                if channel not in coverage[date]:
                    summary['documents'][channel] = None
                    summary['channels'][channel] = None
                    if channel in summary['sentiment']:
                        summary['sentiment'][channel] = None
            if not set(coverage[date]).intersection({'blog', 'cafe'}):
                summary['sentiment']['community'] = None
            rows.append({'date': date, 'basis': 'publication_date_backfill', **summary,
                         'coverage': sorted(coverage[date]), 'status': coverage[date],
                         'previously_observed': known.get(date, {}), 'observed_at': stamps[date]})
        return rows

    def save(self):
        self.root.mkdir(parents=True, exist_ok=True)
        # Persist immutable observations before their mutable document index.
        for month in sorted(self.dirty_events):
            config.save(str(self.root / f'events-{month}.json'), self.events[month])
        for month in sorted(self.dirty_documents):
            config.save(str(self.root / f'documents-{month}.json'), self.months[month])
        self.dirty_documents.clear()
        self.dirty_events.clear()
