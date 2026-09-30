#!/usr/bin/env bash
# Bounded flagship burst that ALWAYS tears down the whole process TREE on exit.
#
# Why this exists: `timeout <sec> pnpm ... start` only signals the `pnpm` parent; the `tsx`
# child it spawns gets ORPHANED and keeps running (reparented to init). That happened once and
# a burst ran ~18h unattended, draining service wallets. Here we start the services in their own
# process GROUP via `setsid`, and a trap kills the entire group (`kill -- -PGID`) on normal
# timeout, Ctrl-C, or SIGTERM from a supervisor. No orphans, ever.
#
# Usage:
#   BURST_SECONDS=1500 FLAGSHIP_BOTS=on RUN_HOUSE_MM=true RUN_KEEPER=true \
#   RUN_TAKER_BOT=true RUN_SEEDER=true RUN_INDEXER=true RUN_API=false \
#   TAKER_INTERVAL_MS=120000 MM_REQUOTE_MS=45000 DB_PATH=/tmp/burst.db \
#   bash services/scripts/burst.sh
set -uo pipefail
DUR="${BURST_SECONDS:-1500}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # services/

setsid pnpm --dir "$here" start &
PG=$!   # with setsid, the child is a session/group leader so its PID == the PGID
echo "[burst] started pgid=$PG for ${DUR}s (kills the whole group on exit)"

cleanup() {
  echo "[burst] tearing down process group -$PG"
  kill -TERM -- "-$PG" 2>/dev/null || true
  sleep 5
  kill -KILL -- "-$PG" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep "$DUR"
echo "[burst] duration reached"
