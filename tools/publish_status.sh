#!/usr/bin/env bash
# publish_status.sh - collect the status feed on the LAN and push ONLY data/status.json
# to the GitHub Pages repo.
#
# Steps
#   1. Run tools/collect_status.py (writes <site>/data/status.json atomically).
#   2. Sanity-check the result (valid JSON with "updated" and "services").
#   3. Copy it into the local clone of the Pages repo ($PAGES_REPO_DIR/data/status.json).
#   4. Commit only if the file changed, then git push.
#
# Fail safe: if the collector fails (exit != 0) or its output is invalid, NOTHING is
# copied, committed or pushed. The published file simply ages, and the website shows
# "unknown" once it is older than staleMinutes (8 h) instead of a wrong "up".
#
# Environment (set in cron / systemd EnvironmentFile; no secrets live in this file)
#   PAGES_REPO_DIR  REQUIRED. Path to a local clone of the GitHub Pages repo.
#   PAGES_BRANCH    optional, branch to push (default: main)
#   PAGES_REMOTE    optional, git remote (default: origin)
#   SITE_DIR        optional, site folder holding tools/ and data/ (default: parent of this script)
#   MAPPING_FILE    optional (default: $SITE_DIR/tools/mapping.json)
#   PYTHON          optional (default: python3)
#   PROM_URL / PVE_URL / PVE_TOKEN ...  read by collect_status.py (see its header)
#
# Git credentials: the machine must already be able to `git push` non-interactively
# (an SSH deploy key with write access, or a credential helper with a fine-grained
# token). This script never handles credentials.
#
# Exit codes: 0 ok (pushed, or nothing to push), 1 collector/validation failure,
#             2 configuration error, 3 git failure.
set -euo pipefail

log() { printf 'publish_status: %s\n' "$*" >&2; }
die() { local c=$1; shift; log "ERROR: $*"; exit "$c"; }

SITE_DIR=${SITE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
PYTHON=${PYTHON:-python3}
MAPPING_FILE=${MAPPING_FILE:-$SITE_DIR/tools/mapping.json}
PAGES_BRANCH=${PAGES_BRANCH:-main}
PAGES_REMOTE=${PAGES_REMOTE:-origin}
SRC=$SITE_DIR/data/status.json

[[ -n "${PAGES_REPO_DIR:-}" ]] || die 2 "PAGES_REPO_DIR is not set (path to your local clone of the Pages repo)"
[[ -d "$PAGES_REPO_DIR/.git" ]] || die 2 "PAGES_REPO_DIR ($PAGES_REPO_DIR) is not a git clone"
[[ -f "$MAPPING_FILE" ]] || die 2 "mapping file not found: $MAPPING_FILE (copy tools/mapping.example.json)"

# Don't let two runs overlap (a slow run vs. the next timer tick).
exec 9>"${TMPDIR:-/tmp}/homelab-publish-status.lock"
flock -n 9 || die 1 "another run is in progress"

# 1. Collect. The collector leaves the old file untouched on failure; we also stop here.
log "collecting status"
if ! "$PYTHON" "$SITE_DIR/tools/collect_status.py" --mapping "$MAPPING_FILE" \
      --services "$SITE_DIR/data/services.json" --out "$SRC"; then
  die 1 "collector failed; not pushing (the site will go stale instead of showing wrong data)"
fi

# 2. Validate before publishing.
"$PYTHON" - "$SRC" <<'PY' || die 1 "status.json failed validation; not pushing"
import json, sys
d = json.load(open(sys.argv[1]))
assert isinstance(d.get("updated"), str) and d["updated"], "missing updated"
assert isinstance(d.get("services"), list) and d["services"], "no services"
PY

# 3. Update the clone and copy the single file.
cd "$PAGES_REPO_DIR"
git pull --ff-only -q "$PAGES_REMOTE" "$PAGES_BRANCH" || die 3 "git pull failed (diverged or unreachable?)"
mkdir -p data
[[ "$SRC" -ef data/status.json ]] || cp "$SRC" data/status.json   # same file when SITE_DIR is the clone

# 4. Commit only if changed, then push.
if [[ -z "$(git status --porcelain -- data/status.json)" ]]; then
  log "status.json unchanged; nothing to push"
  exit 0
fi
git add data/status.json
git commit -q -m "status $(date -u +%Y-%m-%dT%H:%M:%SZ)" -- data/status.json || die 3 "git commit failed"
git push -q "$PAGES_REMOTE" "HEAD:$PAGES_BRANCH" || die 3 "git push failed"
log "pushed $(date -u +%Y-%m-%dT%H:%M:%SZ)"
