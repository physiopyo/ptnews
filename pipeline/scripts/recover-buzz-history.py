"""Archive local Git opinion blobs losslessly; never change the source repository.

Usage: python pipeline/scripts/recover-buzz-history.py --repository REPO --output-dir DIR
Only the seven explicitly allowed public opinion data paths are read. No network.
The pack preserves all blob revisions; the separate JSON is a display projection.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

NAMES = ('buzz.json', 'buzz_naver_history.json', 'buzz_channel_daily.json',
         'buzz_news_daily.json', 'buzz_related_weeks.json', 'buzz_hourly.json', 'buzz_daum_daily.json')
PATHS = tuple('pipeline/_news/' + name for name in NAMES)


def timestamp(value):
    return datetime.fromisoformat(value).timestamp()


def git(repo, *args, **kwargs):
    return subprocess.run(['git', '-c', 'safe.directory=' + str(repo), '-C', str(repo), *args],
                          check=True, **kwargs)


def write_json(path, value):
    raw = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_bytes(raw)
    os.replace(tmp, path)


def backup_current(repo, output):
    entries = []
    folder = output / 'working-tree'
    folder.mkdir(parents=True, exist_ok=True)
    for relative in PATHS:
        source = repo / relative
        if not source.is_file():
            continue
        raw = source.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        target = folder / (source.stem + '-' + sha + '.json')
        if target.exists():
            if target.read_bytes() != raw:
                raise ValueError('Existing archival copy is corrupt: ' + target.name)
        else:
            with target.open('xb') as f:
                f.write(raw)
                f.flush()
                os.fsync(f.fileno())
        entries.append({'source':relative,'sha256':sha,'bytes':len(raw),'copy':str(target.relative_to(output))})
    identity = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()[:16]
    write_json(output / ('working-tree-' + identity + '.json'), {'entries':entries})
    return entries


def inventory(repo):
    log = git(repo, 'log', '--all', '--full-history', '--root', '-m', '--raw', '--no-abbrev',
              '--no-renames', '--format=@@%H%x09%cI', '--', *PATHS,
              stdout=subprocess.PIPE, text=True).stdout
    objects, commit, recorded = {}, '', ''
    for line in log.splitlines():
        if line.startswith('@@'):
            commit, recorded = line[2:].split('\t', 1)
        elif line.startswith(':'):
            fields, path = line.split('\t', 1)
            parts = fields.split()
            oid = parts[3]
            if path not in PATHS or not re.fullmatch('[0-9a-f]{40,64}', oid) or set(oid) == {'0'}:
                continue
            key = path + ':' + oid
            entry = objects.setdefault(key, {'path':path,'blob':oid,'observations':[]})
            observation = {'commit':commit,'committed_at':recorded}
            if observation not in entry['observations']:
                entry['observations'].append(observation)
    for row in objects.values():
        row['observations'].sort(key=lambda r:(timestamp(r['committed_at']),r['commit']))
    return sorted(objects.values(), key=lambda r:(r['path'],r['blob']))


def read_blobs(repo, entries):
    proc = subprocess.Popen(['git','-c','safe.directory='+str(repo),'-C',str(repo),'cat-file','--batch'],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for entry in entries:
            proc.stdin.write((entry['blob'] + '\n').encode()); proc.stdin.flush()
            header = proc.stdout.readline().decode().split()
            if len(header) != 3 or header[1] != 'blob':
                raise ValueError('Unavailable archived blob ' + entry['blob'])
            size = int(header[2])
            raw = proc.stdout.read(size)
            if len(raw) != size or proc.stdout.read(1) != b'\n':
                raise ValueError('Truncated git blob')
            yield entry, raw
    finally:
        proc.stdin.close()
        proc.stdout.close()
        if proc.wait() != 0:
            raise RuntimeError('git cat-file failed')


def projection(repo, entries):
    daily, hourly, weeks, snapshots = {}, {}, {}, {}
    selected = [e for e in entries if e['path'].endswith('/buzz.json')]
    selected.sort(key=lambda e:max(timestamp(o['committed_at']) for o in e['observations']))
    for entry, raw in read_blobs(repo, selected):
        value = json.loads(raw)
        nv = value.get('naver') or {}
        for name, target, key in [('channel_daily',daily,'date'),('hourly',hourly,'t'),('related_weeks',weeks,'key')]:
            for kw, rows in nv.get(name, {}).items():
                for row in rows:
                    if row.get(key):
                        target.setdefault(kw,{})[row[key]] = row
        for kw in set(nv.get('sentiment',{})) | set(nv.get('related',{})):
            payload = {'sentiment':nv.get('sentiment',{}).get(kw,{}),'related':nv.get('related',{}).get(kw,[])}
            rows = snapshots.setdefault(kw,{})
            for observation in entry['observations']:
                recorded_at = datetime.fromisoformat(observation['committed_at']).astimezone(timezone(timedelta(hours=9))).isoformat()
                date = recorded_at[:10]
                if rows.get(date, {}).get('recorded_at', '') > recorded_at:
                    continue
                rows[date] = {**payload,'recorded_at':recorded_at,
                              'reported_updated':value.get('updated'),
                              'source_blob':entry['blob'],'source_commit':observation['commit'],
                              'basis':'git_saved_snapshot_not_publication_date'}
    return {'schema':1,'note':'화면용 일별 마지막 저장 표본. 같은 날의 모든 원본 버전은 검증된 pack에 보존. 게시일 통계가 아니며 반복 스냅샷을 합산하지 않음.',
            'naver':{'channel_daily':{k:[r[d] for d in sorted(r)] for k,r in daily.items()},
                     'hourly':{k:[r[d] for d in sorted(r)] for k,r in hourly.items()},
                     'related_weeks':{k:[r[d] for d in sorted(r)] for k,r in weeks.items()},
                     'legacy_snapshots':{k:[r[d] for d in sorted(r)] for k,r in snapshots.items()}}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repository', required=True, type=Path)
    p.add_argument('--output-dir', required=True, type=Path)
    args = p.parse_args()
    repo, output = args.repository.resolve(), args.output_dir.resolve()
    if output == repo or repo in output.parents:
        raise SystemExit('Use a separate output directory; the source worktree must remain untouched')
    output.mkdir(parents=True, exist_ok=True)
    backup_current(repo, output)
    entries = inventory(repo)
    if not entries:
        raise SystemExit('No opinion history found')
    digest = hashlib.sha256(json.dumps(entries,sort_keys=True).encode()).hexdigest()
    archive = output / ('local-history-' + digest[:16])
    pack = archive.with_suffix('.pack')
    idx = archive.with_suffix('.idx')
    ids = sorted({e['blob'] for e in entries})
    print('Preserving %d unique opinion blobs; source is read-only' % len(ids), flush=True)
    if not pack.exists():
        temp = pack.with_suffix('.pack.tmp')
        with temp.open('wb') as f:
            git(repo, 'pack-objects','--stdout','--window=20','--depth=50','--window-memory=128m','--threads=2',
                input=('\n'.join(ids)+'\n').encode(), stdout=f)
        os.replace(temp,pack)
    if not idx.exists():
        subprocess.run(['git','index-pack','--index-version=2','-o',str(idx),str(pack)],check=True,stdout=subprocess.PIPE)
    verification = subprocess.run(['git','verify-pack','-v',str(idx)],check=True,stdout=subprocess.PIPE,text=True).stdout
    verified = {line.split()[0] for line in verification.splitlines() if len(line.split())>=3 and line.split()[1]=='blob'}
    if verified != set(ids):
        raise ValueError('Pack membership verification failed')
    with pack.open('rb') as f:
        checksum = hashlib.file_digest(f, 'sha256').hexdigest()
    write_json(archive.with_suffix('.json'),{'schema':1,'entries':entries,'pack':pack.name,
               'pack_sha256':checksum,'blob_count':len(ids)})
    print('Pack verified; recovering dated display data', flush=True)
    projected = projection(repo,entries)
    projected['archive_manifest'] = archive.with_suffix('.json').name
    write_json(output/'buzz_recovered.json',projected)
    print(json.dumps({'blobs':len(ids),'pack_bytes':pack.stat().st_size,'verified':True,
                      'projection_bytes':(output/'buzz_recovered.json').stat().st_size},ensure_ascii=False))


if __name__ == '__main__':
    main()
