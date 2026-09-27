#!/usr/bin/env bash
# This runs only in the Actions-owned checkout, after explicit credential cleanup.
# Failed builds/conflicts are preserved on a unique recovery branch, never deployed.
set -euo pipefail
: "${GITHUB_RUN_ID:?required}"
: "${GITHUB_RUN_ATTEMPT:?required}"
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
recovery="collection-recovery/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
for credential in pipeline/_news/naver_key.json pipeline/_news/kakao_key.json; do
  if [[ -e "$credential" ]]; then
    echo "::error::임시 인증파일 정리 실패 — 저장 중단"
    exit 1
  fi
done

preserve_recovery() {
  git push origin "HEAD:refs/heads/$recovery"
  echo "::error::수집 결과 보존: $recovery (자동 삭제·배포 없음)"
}

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then
  echo "변경 없음 — 커밋 생략"
  exit 0
fi
git commit -m "auto(ci): 보드·수집 이력 갱신 ${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
if [[ "${BUILD_OK:-0}" != 1 ]]; then
  preserve_recovery
  exit 1
fi
if ! git fetch origin master; then
  preserve_recovery
  exit 1
fi
if ! git rebase origin/master; then
  git rebase --abort
  preserve_recovery
  exit 1
fi
if ! git push origin HEAD:master; then
  preserve_recovery
  exit 1
fi
