"""Permanent, non-secret observations kept compact enough to commit every run.

Storage has no retention window. Instead of raw documents (text/tokens), it keeps:

* ``index/YYYY-MM-DD.json``: short ids of every document first seen that day, per
  channel. Membership alone decides "already seen", so first_seen is immutable.
* ``words/YYYY-MM-DD.json``: per keyword and basis, the word counts of the documents
  attributed to that date. ``first_seen`` rows use the KST discovery date;
  ``publication_date_backfill`` rows use the KST publication date of documents first
  found by a one-shot backfill. A document is counted in exactly one row.
* ``events-YYYY-MM.json``: small collection receipts (counts, requests, windows).
* ``legacy/``: byte-for-byte copies of pre-existing buzz*.json files.
"""
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urldefrag

import buzz_config as config

KST = timezone(timedelta(hours=9))
CHANNELS = ('news', 'blog', 'cafe')
FIRST_SEEN = 'first_seen'
BACKFILL = 'publication_date_backfill'
ID_LENGTH = 16


def observed_at(now):
    instant = datetime.fromtimestamp(now, timezone.utc)
    return {'utc': instant.isoformat(), 'kst': instant.astimezone(KST).isoformat()}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def document_id(keyword, url):
    return digest([keyword, urldefrag(url)[0]])[:ID_LENGTH]


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
    """Word summary of analyzed in-memory documents (a single search sample)."""
    counts = {channel: 0 for channel in CHANNELS}
    related = Counter()
    sentiment = {channel: Counter() for channel in CHANNELS}
    polarity = {}
    for document in documents:
        channel = document['channel']
        counts[channel] += 1
        related.update(document['related'])
        for word, item in document['sentiment'].items():
            sentiment[channel][word] += item['c']
            polarity[word] = item['p']
    return {
        'documents': counts,
        'related': word_rows(related),
        'sentiment': {
            'community': word_rows(sentiment['blog'] + sentiment['cafe'], polarity),
            'blog': word_rows(sentiment['blog'], polarity),
            'cafe': word_rows(sentiment['cafe'], polarity),
        },
    }


def save_compact(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            handle.write('\n')
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def empty_aggregate():
    return {'documents': {}, 'related': {}, 'sentiment': {}, 'coverage': [], 'observed_at': None}


class HistoryArchive:
    def __init__(self, output_dir):
        self.output_dir = Path(output_dir)
        self.root = self.output_dir / 'buzz_archive'
        self.seen = set()
        self.index = {}
        self.words = {}
        self.events = {}
        self.dirty_index = set()
        self.dirty_words = set()
        self.dirty_events = set()
        for path in sorted((self.root / 'index').glob('*.json')):
            day = config.load(str(path), {})
            self.index[path.stem] = day
            for ids in day.values():
                self.seen.update(ids)
        for path in sorted((self.root / 'words').glob('*.json')):
            self.words[path.stem] = config.load(str(path), {})
        for path in sorted(self.root.glob('events-*.json')):
            self.events[path.stem.removeprefix('events-')] = config.load(str(path), [])

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
            manifest['files'][path.name] = {'sha256': content_hash, 'path': target.name}
            changed = True
        if changed or not manifest_path.exists():
            config.save(str(manifest_path), manifest)

    def snapshot(self, kind, keyword, source, data, now):
        stamp = observed_at(now)
        event = {'kind': kind, 'keyword': keyword, 'source': source,
                 'observed_at': stamp, 'data': data, 'config_hash': config.CONFIG_HASH}
        month = stamp['kst'][:7]
        rows = self.events.setdefault(month, [])
        event['id'] = digest([event, len(rows)])
        rows.append(event)
        self.dirty_events.add(month)

    def has(self, keyword, url):
        return document_id(keyword, url) in self.seen

    def _aggregate(self, date, keyword, basis):
        self.dirty_words.add(date)
        return self.words.setdefault(date, {}).setdefault(keyword, {}).setdefault(basis, empty_aggregate())

    def cover(self, keyword, date, channel, now, basis=FIRST_SEEN, status=None, previously_observed=0):
        """Record that a channel was observed for a date even when no new document appeared."""
        aggregate = self._aggregate(date, keyword, basis)
        if channel not in aggregate['coverage']:
            aggregate['coverage'] = sorted(aggregate['coverage'] + [channel])
        aggregate['documents'].setdefault(channel, 0)
        stamp = observed_at(now)
        if aggregate['observed_at'] is None or aggregate['observed_at']['utc'] < stamp['utc']:
            aggregate['observed_at'] = stamp
        if status is not None:
            rank = {'partial': 1, 'complete': 2}
            status = 'partial' if previously_observed else status
            old = aggregate.setdefault('status', {}).get(channel)
            if old is None or rank[status] > rank[old]:
                aggregate['status'][channel] = status
                aggregate.setdefault('previously_observed', {})[channel] = previously_observed

    def observe(self, keyword, documents, now, discovery=None):
        """Index analyzed documents; words of new ones go to exactly one date row.

        Returns ``(identifiers, new_documents)``. Documents already indexed keep their
        original first-seen attribution and are never counted again.
        """
        stamp = observed_at(now)
        today = stamp['kst'][:10]
        identifiers, fresh = [], []
        for document in documents:
            identifier = document_id(keyword, document['url'])
            if identifier in identifiers:
                continue
            identifiers.append(identifier)
            if identifier in self.seen:
                continue
            date = today if discovery is None else kst_date(document.get('published_at'))
            if date is None:
                continue
            self.seen.add(identifier)
            self.index.setdefault(today, {}).setdefault(document['channel'], []).append(identifier)
            self.dirty_index.add(today)
            fresh.append(document)
            aggregate = self._aggregate(date, keyword, discovery or FIRST_SEEN)
            channel = document['channel']
            aggregate['documents'][channel] = aggregate['documents'].get(channel, 0) + 1
            if channel not in aggregate['coverage']:
                aggregate['coverage'] = sorted(aggregate['coverage'] + [channel])
            related = aggregate['related']
            for word, count in document['related'].items():
                related[word] = related.get(word, 0) + count
            bucket = aggregate['sentiment'].setdefault(channel, {})
            for word, item in document['sentiment'].items():
                old = bucket.get(word, [0, item['p']])
                bucket[word] = [old[0] + item['c'], item['p']]
            if aggregate['observed_at'] is None or aggregate['observed_at']['utc'] < stamp['utc']:
                aggregate['observed_at'] = stamp
        return identifiers, fresh

    def _rows(self, keyword, basis):
        rows = []
        for date in sorted(self.words):
            aggregate = self.words[date].get(keyword, {}).get(basis)
            if not aggregate:
                continue
            coverage = set(aggregate['coverage'])
            documents = {channel: aggregate['documents'].get(channel, 0) if channel in coverage else None
                         for channel in CHANNELS}
            polarity, sentiment = {}, {}
            for channel in CHANNELS:
                counts = Counter()
                for word, (count, value) in aggregate['sentiment'].get(channel, {}).items():
                    counts[word] = count
                    polarity[word] = value
                sentiment[channel] = counts
            row = {
                'date': date, 'basis': basis, 'documents': documents,
                'related': word_rows(Counter(aggregate['related'])),
                'sentiment': {
                    'community': (word_rows(sentiment['blog'] + sentiment['cafe'], polarity)
                                  if coverage.intersection({'blog', 'cafe'}) else None),
                    'blog': word_rows(sentiment['blog'], polarity) if 'blog' in coverage else None,
                    'cafe': word_rows(sentiment['cafe'], polarity) if 'cafe' in coverage else None,
                },
                'coverage': sorted(coverage), 'observed_at': aggregate['observed_at'],
            }
            if basis == BACKFILL:
                row['status'] = aggregate.get('status', {})
                row['previously_observed'] = aggregate.get('previously_observed', {})
            rows.append(row)
        return rows

    def word_daily(self, keyword):
        return self._rows(keyword, FIRST_SEEN)

    def word_daily_backfill(self, keyword):
        return self._rows(keyword, BACKFILL)

    def save(self):
        self.root.mkdir(parents=True, exist_ok=True)
        # Receipts first, then word aggregates, then the membership index.
        for month in sorted(self.dirty_events):
            save_compact(self.root / f'events-{month}.json', self.events[month])
        for date in sorted(self.dirty_words):
            save_compact(self.root / 'words' / f'{date}.json', self.words[date])
        for date in sorted(self.dirty_index):
            save_compact(self.root / 'index' / f'{date}.json', self.index[date])
        self.dirty_events.clear()
        self.dirty_words.clear()
        self.dirty_index.clear()
