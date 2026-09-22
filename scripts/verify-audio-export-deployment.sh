#!/usr/bin/env bash
set -Eeuo pipefail

# Deployment builds do not have a running API workflow. Start an isolated
# instance so the check exercises the same HTTP route as the application.
api_port="${AUDIO_EXPORT_API_PORT:-18080}"
api_origin="http://127.0.0.1:${api_port}"
log_file="$(mktemp "${TMPDIR:-/tmp}/audio-export-api.XXXXXX.log")"
api_pid=""

cleanup() {
  if [[ -n "${api_pid}" ]] && kill -0 "${api_pid}" 2>/dev/null; then
    kill "${api_pid}" 2>/dev/null || true
    wait "${api_pid}" 2>/dev/null || true
  fi
  rm -f "${log_file}"
}
trap cleanup EXIT INT TERM

echo "Building the API server for the audio export deployment check..."
pnpm --filter @workspace/api-server run build

echo "Starting the API server on ${api_origin}..."
PORT="${api_port}" NODE_ENV=production \
  pnpm --filter @workspace/api-server run start >"${log_file}" 2>&1 &
api_pid=$!

for attempt in {1..60}; do
  if curl --silent --show-error --fail --max-time 2 "${api_origin}/api/healthz" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${api_pid}" 2>/dev/null; then
    echo "The API server exited before becoming healthy:" >&2
    cat "${log_file}" >&2
    exit 1
  fi
  if [[ "${attempt}" == "60" ]]; then
    echo "The API server did not become healthy within 60 seconds:" >&2
    cat "${log_file}" >&2
    exit 1
  fi
  sleep 1
done

echo "Running the end-to-end audio export verification..."
API_ORIGIN="${api_origin}" pnpm --filter @workspace/scripts run verify:audio-export