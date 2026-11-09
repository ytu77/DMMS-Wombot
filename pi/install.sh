#!/usr/bin/env bash

# ============================================================
# Wombot Raspberry Pi - Complete Automated Installer
#
# Phase 1 & 2 Combined:
#   - Checks OS & system dependencies
#   - Sets up Python virtual environment & packages
#   - Configures Wi-Fi Access Point ("Wombot") via NetworkManager
#   - Installs MediaMTX & writes video streaming configuration
#   - Creates and enables Systemd services for Uvicorn & MediaMTX
#
# Run from repository root or pi dir:
#   sudo ./pi/install.sh
# ============================================================

set -Eeuo pipefail

# Must be run as root/sudo for network & systemd configurations
if [[ $EUID -ne 0 ]]; then
   echo "[ERROR] This script must be run with sudo privileges." >&2
   exit 1
fi

# ----------------------------
# Paths & Variables
# ----------------------------

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PI_DIR="${SCRIPT_DIR}"
BACKEND_DIR="${PI_DIR}/backend"
REQUIREMENTS_FILE="${PI_DIR}/requirements.txt"
VENV_DIR="${PI_DIR}/.venv"

# Find the actual non-root user (e.g., 'pi') for systemd file ownership
REAL_USER="${SUDO_USER:-$(whoami)}"
REAL_HOME="$(eval echo ~${REAL_USER})"

# ----------------------------
# Output helpers
# ----------------------------

info() { echo -e "\n[INFO] $1"; }
success() { echo -e "\n[OK] $1"; }
error() { echo -e "\n[ERROR] $1" >&2; exit 1; }

trap 'echo -e "\n[ERROR] Installation failed on line ${LINENO}." >&2' ERR

# ----------------------------
# 1. Operating System Check
# ----------------------------
info "Checking operating system..."
[[ -f /etc/os-release ]] || error "Cannot identify operating system."
source /etc/os-release
[[ "${ID:-}" == "raspbian" || "${ID:-}" == "debian" ]] || error "Intended for Raspberry Pi OS / Debian."
success "Detected ${PRETTY_NAME:-Debian-based operating system}"

# ----------------------------
# 2. System Dependencies & FFmpeg
# ----------------------------
info "Installing system packages and FFmpeg..."
apt-get update
apt-get install -y \
    python3 \
    python3-venv \
    python3-pip \
    python3-dev \
    build-essential \
    ffmpeg \
    network-manager \
    curl \
    wget

success "System dependencies and FFmpeg installed."

# ----------------------------
# 3. Python Virtual Environment
# ----------------------------
info "Setting up Python virtual environment..."
if [[ ! -d "${VENV_DIR}" ]]; then
    python3 -m venv "${VENV_DIR}"
    chown -R "${REAL_USER}:${REAL_USER}" "${VENV_DIR}"
else
    info "Existing virtual environment found; reusing it."
fi

info "Installing Python packages..."
su - "${REAL_USER}" -c "${VENV_DIR}/bin/python -m pip install --upgrade pip"
su - "${REAL_USER}" -c "${VENV_DIR}/bin/python -m pip install -r ${REQUIREMENTS_FILE}"
success "Python dependencies installed."

# ----------------------------
# 4. Configure Wi-Fi Access Point ("Wombot")
# ----------------------------
info "Configuring Wi-Fi Access Point (Wombot)..."

# Check if NetworkManager is controlling wifi
systemctl enable --now NetworkManager

# Delete existing Wombot AP profile if it exists to avoid duplication
nmcli con delete Wombot-AP >/dev/null 2>&1 || true

# Create Wi-Fi AP connection profile (Password: wombot123)
nmcli con add type wifi ifname wlan0 con-name Wombot-AP autoconnect yes ssid Wombot
nmcli con modify Wombot-AP 802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared
nmcli con modify Wombot-AP wifi-sec.key-mgmt wpa-psk wifi-sec.psk "wombot123"

success "Wi-Fi Access Point 'Wombot' configured (Password: wombot123)."

# ----------------------------
# 5. Install & Configure MediaMTX
# ----------------------------
info "Installing MediaMTX..."

ARCH=$(uname -m)
if [[ "${ARCH}" == "aarch64" ]]; then
    MEDIAMTX_ARCH="arm64"
elif [[ "${ARCH}" == "armv7l" ]]; then
    MEDIAMTX_ARCH="armv7"
else
    MEDIAMTX_ARCH="amd64"
fi

# Fetch the latest release tag dynamically from GitHub API
MEDIAMTX_VERSION=$(curl -s https://api.github.com/repos/bluenviron/mediamtx/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
if [[ -z "${MEDIAMTX_VERSION}" ]]; then
    MEDIAMTX_VERSION="v1.21.3" # Safe fallback version if API limit is hit
fi

MEDIAMTX_TAR="mediamtx_${MEDIAMTX_VERSION}_linux_${MEDIAMTX_ARCH}.tar.gz"
MEDIAMTX_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${MEDIAMTX_TAR}"

info "Downloading MediaMTX ${MEDIAMTX_VERSION} for ${MEDIAMTX_ARCH}..."
wget -qO /tmp/mediamtx.tar.gz "${MEDIAMTX_URL}" || error "Failed to download MediaMTX from ${MEDIAMTX_URL}"
tar -xzf /tmp/mediamtx.tar.gz -C /usr/local/bin mediamtx
rm /tmp/mediamtx.tar.gz

info "Writing MediaMTX configuration file..."
cat << 'EOF' > /etc/mediamtx.yml
paths:
  camera:
    runOnInit: ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -framerate 30 -i /dev/video0 -vf format=yuv420p -c:v h264_v4l2m2m -f rtsp rtsp://127.0.0.1:$RTSP_PORT/$MTX_PATH
    runOnInitRestart: yes

  all_others:
EOF

success "MediaMTX installed and configured."

# ----------------------------
# 6. Create Systemd Services
# ----------------------------
info "Creating systemd background services..."

# A. MediaMTX Service
cat << EOF > /etc/systemd/system/mediamtx.service
[Unit]
Description=MediaMTX RTSP Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/mediamtx /etc/mediamtx.yml
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# B. Wombot Backend Uvicorn Service
cat << EOF > /etc/systemd/system/wombot.service
[Unit]
Description=Wombot FastAPI Backend
After=network.target mediamtx.service

[Service]
Type=simple
User=${REAL_USER}
WorkingDirectory=${PI_DIR}
ExecStart=${VENV_DIR}/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable services
systemctl daemon-reload
systemctl enable mediamtx.service
systemctl enable wombot.service

success "Systemd services enabled for automatic startup on boot."

# ----------------------------
# Finish
# ----------------------------
echo
echo "============================================================"
echo " Wombot full system installation complete!"
echo "============================================================"
echo
echo "• Wi-Fi AP Name: Wombot (Password: wombot123)"
echo "• MediaMTX RTSP Stream: rtsp://<pi-ip>:8554/camera"
echo "• FastAPI Backend: http://<pi-ip>:8000"
echo
echo "Reboot your Raspberry Pi to activate the Access Point and services."
echo "============================================================"