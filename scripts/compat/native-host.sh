#!/bin/sh
# Run from dot's native Terminal. Only starts the official local Host; it does
# not launch a browser, change security settings, or reuse a user's profile.
set -eu
: "${FIND_ALL_REUSE_RUN:?Set this to the owned shared-workspace acceptance directory containing runtime/}"
: "${FIND_ALL_NODE_BIN:?Set this to the verified Node bin directory on this desktop}"
: "${FIND_ALL_PACKAGE_BIN:?Set this to the verified package-manager bin directory on this desktop}"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ARTIFACT=${1:?Pass the reviewed candidate tgz path}
OUTPUT=${2:?Pass a private evidence output directory}
export PATH="$FIND_ALL_PACKAGE_BIN:$FIND_ALL_NODE_BIN:$PATH"
export FIND_ALL_SERVER_ONLY=1 FIND_ALL_FULL_ACCEPTANCE=1
cd "$ROOT"
exec node scripts/compat/web-smoke.mjs 0.2.1-rc.3 "$ARTIFACT" "$OUTPUT"
