#!/usr/bin/env bash
set -euo pipefail
TASK_COURSE_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TASK_RENDER_LOG_DIR=${CI_LOG_DIR:-$(mktemp -d -t java-render-XXXXXXXX)}
mkdir -p -- "$TASK_RENDER_LOG_DIR"
cd -- "$TASK_COURSE_ROOT"
quarto --version
TASK_RENDER_PROFILES=("$@")
if [ "${#TASK_RENDER_PROFILES[@]}" -eq 0 ]; then
  TASK_RENDER_PROFILES=(student)
fi
for TASK_RENDER_STEP in "${TASK_RENDER_PROFILES[@]}"; do
  case "$TASK_RENDER_STEP" in student | full) ;; *)
    echo "Unsupported view: $TASK_RENDER_STEP" >&2
    exit 2
    ;;
  esac
  TASK_RENDER_COUNT=${TASK_RENDER_COUNT:-0}
  TASK_RENDER_COUNT=$((TASK_RENDER_COUNT + 1))
  TASK_ACTIVE_PROFILE="$TASK_RENDER_STEP"
  if [ "${COURSE_PREVIEW_PROFILE:-0}" = 1 ]; then
    test -f _quarto-preview.yml
    TASK_ACTIVE_PROFILE="$TASK_RENDER_STEP,preview"
  fi
  timeout --signal=TERM --kill-after=5s 7200s quarto render . --profile "$TASK_ACTIVE_PROFILE" --fail-if-warnings 2>&1 |
    tee "$TASK_RENDER_LOG_DIR/render-${TASK_RENDER_COUNT}-${TASK_RENDER_STEP}.log"
done
