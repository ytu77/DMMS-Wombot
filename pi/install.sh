#!/usr/bin/env bash
# Wombot installer for the agreed monorepo layout.
# Run from the normal project account: sudo ./pi/install.sh
# Optional: sudo env AP_PASSWORD='strong-password' ./pi/install.sh
# Optional: sudo env MEDIAMTX_VERSION=v1.20.1 ./pi/install.sh

set -Eeuo pipefail
IFS=$'\n\t'
log(){ printf '\n[INFO] %s\n' "$*"; }
ok(){ printf '[ OK ] %s\n' "$*"; }
warn(){ printf '[WARN] %s\n' "$*" >&2; }
die(){ printf '[FAIL] %s\n' "$*" >&2; exit 1; }
trap 'rc=$?; echo "[FAIL] stopped at line $LINENO (exit $rc)" >&2; exit "$rc"' ERR

[[ $EUID -eq 0 ]] || die "Run with sudo: sudo ./pi/install.sh"
REAL_USER="${SUDO_USER:-}"
[[ -n "$REAL_USER" && "$REAL_USER" != root ]] || die "Run via sudo from your normal project account."
id "$REAL_USER" >/dev/null 2>&1 || die "Unknown user: $REAL_USER"
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
REAL_GROUP="$(id -gn "$REAL_USER")"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PI_DIR="$SCRIPT_DIR"
REPO_DIR="$(cd -- "$PI_DIR/.." && pwd)"
BACKEND_DIR="$PI_DIR/backend"
VENV_DIR="$PI_DIR/.venv"
REQ="$PI_DIR/requirements.txt"

AP_PROFILE="${AP_PROFILE:-Wombot}"
AP_SSID="${AP_SSID:-Wombot}"
AP_ADDRESS="${AP_ADDRESS:-10.42.0.1/24}"
MEDIAMTX_VERSION="${MEDIAMTX_VERSION:-v1.20.1}"
MTX_BIN=/usr/local/bin/mediamtx
MTX_CONFIG=/etc/mediamtx.yml

log "Preflight checks"
[[ -r /etc/os-release ]] || die "Missing /etc/os-release"
. /etc/os-release
[[ "${ID:-}" == debian || "${ID:-}" == raspbian ]] || die "Expected Debian/Raspberry Pi OS; got ${ID:-unknown}"
[[ -f "$BACKEND_DIR/main.py" ]] || die "Expected pi/backend/main.py. Move your FastAPI app there first."
[[ -f "$REQ" ]] || die "Missing pi/requirements.txt"
case "$(uname -m)" in aarch64|armv7l|x86_64) ;; *) die "Unsupported architecture: $(uname -m)";; esac
ok "${PRETTY_NAME:-Debian}; repository layout found"

log "Install OS dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl tar python3 python3-venv python3-pip \
  python3-dev build-essential ffmpeg v4l-utils network-manager
systemctl enable --now NetworkManager

log "Create/update Python environment"
if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  install -d -o "$REAL_USER" -g "$REAL_GROUP" "$VENV_DIR"
  runuser -u "$REAL_USER" -- python3 -m venv "$VENV_DIR"
fi
chown -R "$REAL_USER:$REAL_GROUP" "$VENV_DIR"
runuser -u "$REAL_USER" -- "$VENV_DIR/bin/python" -m pip install --upgrade pip
runuser -u "$REAL_USER" -- "$VENV_DIR/bin/python" -m pip install -r "$REQ"
runuser -u "$REAL_USER" -- "$VENV_DIR/bin/python" -m compileall -q "$BACKEND_DIR"
for g in video dialout; do getent group "$g" >/dev/null && usermod -aG "$g" "$REAL_USER" || true; done
ok "Python environment ready: $VENV_DIR"

log "Configure Wi-Fi access point"
nmcli radio wifi on || true
if nmcli -t -f NAME connection show | grep -Fxq "$AP_PROFILE"; then
  log "Reusing existing NetworkManager profile: $AP_PROFILE"
  nmcli connection modify "$AP_PROFILE" connection.interface-name wlan0 \
    connection.autoconnect yes 802-11-wireless.ssid "$AP_SSID" \
    802-11-wireless.mode ap 802-11-wireless.band bg \
    ipv4.method shared ipv4.addresses "$AP_ADDRESS" ipv6.method disabled
else
  nmcli connection add type wifi ifname wlan0 con-name "$AP_PROFILE" ssid "$AP_SSID"
  nmcli connection modify "$AP_PROFILE" connection.autoconnect yes \
    802-11-wireless.mode ap 802-11-wireless.band bg \
    ipv4.method shared ipv4.addresses "$AP_ADDRESS" ipv6.method disabled
fi

if [[ -n "${AP_PASSWORD:-}" ]]; then
  [[ ${#AP_PASSWORD} -ge 8 ]] || die "AP_PASSWORD must be at least 8 characters"
  nmcli connection modify "$AP_PROFILE" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$AP_PASSWORD"
elif ! nmcli -g 802-11-wireless-security.key-mgmt connection show "$AP_PROFILE" 2>/dev/null | grep -q .; then
  if [[ -t 0 ]]; then
    read -r -s -p "Set Wi-Fi password for $AP_SSID (8+ characters): " AP_PASSWORD
    echo
    [[ ${#AP_PASSWORD} -ge 8 ]] || die "Password must be at least 8 characters"
    nmcli connection modify "$AP_PROFILE" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$AP_PASSWORD"
  else
    die "New AP has no password. Rerun with: sudo env AP_PASSWORD='...' ./pi/install.sh"
  fi
fi
ok "AP profile configured. Existing saved password is preserved unless AP_PASSWORD is supplied."
warn "Installer will not force AP reconnection because that could disconnect your SSH session."

log "Install MediaMTX"
case "$(uname -m)" in aarch64) MTX_ARCH=arm64;; armv7l) MTX_ARCH=armv7;; x86_64) MTX_ARCH=amd64;; esac
if [[ ! -x "$MTX_BIN" || "${FORCE_MEDIAMTX_INSTALL:-0}" == 1 ]]; then
  archive="mediamtx_${MEDIAMTX_VERSION}_linux_${MTX_ARCH}.tar.gz"
  url="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${archive}"
  tmp="$(mktemp -d)"
  curl -fL --retry 3 "$url" -o "$tmp/mediamtx.tar.gz"
  tar -xzf "$tmp/mediamtx.tar.gz" -C "$tmp" mediamtx
  install -m 0755 "$tmp/mediamtx" "$MTX_BIN"
  rm -rf "$tmp"
else
  log "Keeping existing $MTX_BIN (set FORCE_MEDIAMTX_INSTALL=1 to replace)"
fi

# Keep an existing config intact. On a new device, create a minimal config.
# FFmpeg is launched by the backend on Camera ON, not by MediaMTX at boot.
if [[ ! -e "$MTX_CONFIG" && -f "$REAL_HOME/mediamtx.yml" ]]; then
  # The previously working Wombot setup kept its config in the user's home.
  # Migrate that config instead of replacing it with generic defaults.
  install -m 0644 "$REAL_HOME/mediamtx.yml" "$MTX_CONFIG"
  log "Migrated existing MediaMTX config from $REAL_HOME/mediamtx.yml"
fi

if [[ ! -e "$MTX_CONFIG" ]]; then
  cat > "$MTX_CONFIG" <<'YAML'
logLevel: info
rtsp: yes
rtspAddress: :8554
hls: yes
hlsAddress: :8888
webrtc: yes
webrtcAddress: :8889
webrtcLocalUDPAddress: :8189
webrtcAdditionalHosts:
  - 10.42.0.1
paths:
  all_others:
YAML
  chmod 0644 "$MTX_CONFIG"
else
  warn "Preserving existing $MTX_CONFIG. Verify webrtcAdditionalHosts contains 10.42.0.1."
fi

log "Install systemd units"
cat > /etc/systemd/system/mediamtx.service <<EOF
[Unit]
Description=MediaMTX streaming server
Wants=network-online.target
After=network-online.target
[Service]
Type=simple
ExecStart=$MTX_BIN $MTX_CONFIG
Restart=on-failure
RestartSec=3
User=root
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/wombot.service <<EOF
[Unit]
Description=Wombot FastAPI backend
Wants=network-online.target mediamtx.service
After=network-online.target mediamtx.service
[Service]
Type=simple
User=$REAL_USER
Group=$REAL_GROUP
SupplementaryGroups=video dialout
WorkingDirectory=$PI_DIR
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=$PI_DIR
ExecStart=$VENV_DIR/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=3
TimeoutStartSec=30
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mediamtx.service wombot.service
systemctl restart mediamtx.service
systemctl restart wombot.service
sleep 2

log "Verification"
systemctl --no-pager --full status mediamtx.service || true
systemctl --no-pager --full status wombot.service || true
ss -lntup | grep -E ':(8000|8554|8888|8889)\b' || true

cat <<EOF

Wombot installation/configuration complete.
Repository:      $REPO_DIR
Pi application:  $PI_DIR
Wi-Fi:           $AP_SSID
AP address:      $AP_ADDRESS
Control page:    http://10.42.0.1:8000/control
WebRTC player:   http://10.42.0.1:8889/camera
RTSP publisher:  rtsp://127.0.0.1:8554/camera

Reboot to apply group membership and test AP autoconnect:
  sudo reboot

Diagnostics:
  sudo systemctl status wombot mediamtx
  sudo journalctl -u wombot -n 80 --no-pager
  sudo journalctl -u mediamtx -n 80 --no-pager

The backend must launch FFmpeg on Camera ON and publish to rtsp://127.0.0.1:8554/camera.
EOF
