#!/usr/bin/env bash
# coturn setup for the Bow Down Visuals video-call relay — runs ON
# the owner's Oracle VM (Ubuntu 24.04) as root / via sudo.
#
#   sudo bash setup.sh [public-ip]
#
# Idempotent: re-running keeps the existing static-auth-secret (so
# Render's copy never goes stale), re-renders the config, re-asserts
# the firewall rules, and restarts the service.
#
# What it does:
#   1. installs coturn from Ubuntu apt ($0 — no paid provider)
#   2. generates the static-auth-secret ON THE VM into a root-only
#      file (/etc/bowdown-turn-secret) — it is never printed, never
#      leaves the box except when the OWNER copies it into Render
#   3. renders /etc/turnserver.conf from turnserver.conf.template
#   4. enables + starts the coturn service
#   5. opens the HOST iptables (3478 udp+tcp, 49152-65535 udp) ahead
#      of the final REJECT, and persists via iptables-save when the
#      netfilter-persistent layout is present
#   6. self-tests: service active, 3478 listening, a STUN binding
#      request against 127.0.0.1 gets an answer
#
# What it does NOT do (owner steps — see README.md):
#   - OCI console: the VCN security list / NSG ingress rules are
#     cloud-side; no in-VM script can add them.
#   - Render env: VIDEO_CALL_TURN_URLS / VIDEO_CALL_TURN_SECRET.
#
# It never touches WireGuard (wg0 / UDP 51820 rules are left alone).
set -euo pipefail

PUBLIC_IP="${1:-141.148.45.254}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRET_FILE=/etc/bowdown-turn-secret
CONF=/etc/turnserver.conf

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash setup.sh" >&2
  exit 1
fi

echo "== 1/6 install coturn =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn >/dev/null
echo "   coturn $(turnserver --help 2>&1 | head -1 || echo installed)"

echo "== 2/6 static-auth-secret (generated once, kept on the box) =="
if [ ! -s "$SECRET_FILE" ]; then
  openssl rand -base64 32 > "$SECRET_FILE"
  echo "   created $SECRET_FILE"
else
  echo "   exists — keeping the current secret"
fi
chown root:root "$SECRET_FILE"
chmod 600 "$SECRET_FILE"
TURN_SECRET="$(cat "$SECRET_FILE")"

echo "== 3/6 render config =="
sed -e "s/__EXTERNAL_IP__/${PUBLIC_IP}/g" \
    -e "s/__TURN_SECRET__/${TURN_SECRET}/g" \
    "$HERE/turnserver.conf.template" > "$CONF"
chown root:turnserver "$CONF" 2>/dev/null || chown root:root "$CONF"
chmod 640 "$CONF"
# Ubuntu's coturn ships disabled; turn it on.
if [ -f /etc/default/coturn ]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  grep -q TURNSERVER_ENABLED /etc/default/coturn || echo "TURNSERVER_ENABLED=1" >> /etc/default/coturn
fi

echo "== 4/6 service =="
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
systemctl is-active --quiet coturn && echo "   coturn active"

echo "== 5/6 host firewall (iptables — inserted before the final REJECT) =="
add_rule() {
  # $* = rule spec after -A INPUT
  if ! iptables -C INPUT "$@" 2>/dev/null; then
    # position: just before the trailing REJECT rule, if there is one
    local reject_line
    reject_line="$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')"
    if [ -n "${reject_line:-}" ]; then
      iptables -I INPUT "$reject_line" "$@"
    else
      iptables -A INPUT "$@"
    fi
    echo "   added: $*"
  else
    echo "   present: $*"
  fi
}
add_rule -p udp -m udp --dport 3478 -j ACCEPT
add_rule -p tcp -m tcp --dport 3478 -j ACCEPT
add_rule -p udp -m udp --dport 49152:65535 -j ACCEPT
if [ -d /etc/iptables ]; then
  iptables-save > /etc/iptables/rules.v4
  echo "   persisted to /etc/iptables/rules.v4"
fi

echo "== 6/6 self-test =="
ss -lntu | grep -q ':3478' && echo "   listening on 3478 (udp+tcp expected)"
python3 - <<'PY'
import socket, struct, os, sys
# Minimal STUN binding request to the local relay.
magic = 0x2112A442
tid = os.urandom(12)
req = struct.pack(">HHI", 0x0001, 0, magic) + tid
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(3)
try:
    s.sendto(req, ("127.0.0.1", 3478))
    data, _ = s.recvfrom(2048)
    rtype, rlen = struct.unpack(">HH", data[:4])
    assert data[4:8] == struct.pack(">I", magic), "bad magic cookie"
    print(f"   STUN binding response OK (type=0x{rtype:04x}, {rlen} bytes of attrs)")
except Exception as e:
    print(f"   STUN self-test FAILED: {e}", file=sys.stderr)
    sys.exit(1)
PY

cat <<EOF

Done on the VM. Remaining OWNER steps (README.md has the click-paths):
  1. OCI console — add ingress rules to the instance's security list:
       UDP 3478, TCP 3478, UDP 49152-65535  (source 0.0.0.0/0)
  2. Render (bow-down-visuals web service -> Environment):
       VIDEO_CALL_TURN_URLS=turn:${PUBLIC_IP}:3478?transport=udp,turn:${PUBLIC_IP}:3478?transport=tcp
       VIDEO_CALL_TURN_SECRET=<the contents of ${SECRET_FILE} on this VM>
     (read it with: sudo cat ${SECRET_FILE} — do not paste it anywhere else)
  3. Verify at https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
     with the URL above + an ephemeral pair, or simply place a call
     between two networks (home wifi <-> phone on cellular).
EOF
