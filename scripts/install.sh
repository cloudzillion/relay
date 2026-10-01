#!/usr/bin/env bash
set -e

GITHUB_REPO="cloudzillion/relay"
REQUESTED_VERSION="latest"
PRINTER_PORT="9100"
PRINTER_IP="192.168.4.200"
SERVER_URL=""
STATION_ID=""
STATION_KEY=""

for arg in "$@"; do
  case $arg in
    --station-id=*) STATION_ID="${arg#*=}" ;;
    --key=*) STATION_KEY="${arg#*=}" ;;
    --server-url=*) SERVER_URL="${arg#*=}" ;;
    --printer-ip=*) PRINTER_IP="${arg#*=}" ;;
    --printer-port=*) PRINTER_PORT="${arg#*=}" ;;
    --version=*) REQUESTED_VERSION="${arg#*=}" ;;
    *) ;;
  esac
done

if [ -z "$STATION_ID" ] || [ -z "$STATION_KEY" ] || [ -z "$SERVER_URL" ]; then
    echo "================================================================="
    echo " Cloudzillion Relay Installer (cz-relay)"
    echo "================================================================="
    echo " Error: Missing required arguments."
    echo " Usage:"
    echo "   curl -sSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.sh | bash -s -- \\"
    echo "     --server-url=https://cloudzillion.com \\"
    echo "     --station-id=YOUR_STATION_ID \\"
    echo "     --key=YOUR_STATION_KEY \\"
    echo "     [--printer-ip=192.168.4.200] \\"
    echo "     [--printer-port=9100] \\"
    echo "     [--version=latest]"
    echo "================================================================="
    exit 1
fi

OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"

case "$OS_NAME" in
  Linux*) PLATFORM="linux" ;;
  Darwin*) PLATFORM="darwin" ;;
  *) echo "Unsupported OS: $OS_NAME"; exit 1 ;;
esac

case "$ARCH_NAME" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported Architecture: $ARCH_NAME"; exit 1 ;;
esac

TARGET_TUPLE="${PLATFORM}-${ARCH}"
echo "==> Detected environment: ${TARGET_TUPLE} (${OS_NAME})"

# Resolve GitHub release asset URL
if [ "$REQUESTED_VERSION" = "latest" ]; then
  BINARY_URL="https://github.com/${GITHUB_REPO}/releases/latest/download/cz-relay-${TARGET_TUPLE}"
else
  BINARY_URL="https://github.com/${GITHUB_REPO}/releases/download/${REQUESTED_VERSION}/cz-relay-${TARGET_TUPLE}"
fi

INSTALL_DIR="/usr/local/bin"
BINARY_PATH="${INSTALL_DIR}/cz-relay"

echo "==> Downloading cz-relay [${REQUESTED_VERSION}] from ${BINARY_URL}..."
sudo mkdir -p "${INSTALL_DIR}"
sudo curl -fsSL "${BINARY_URL}" -o "${BINARY_PATH}"
sudo chmod +x "${BINARY_PATH}"

if [ "$PLATFORM" = "linux" ]; then
    echo "==> Configuring Linux systemd service (/etc/systemd/system/cz-relay.service)..."
    sudo bash -c "cat > /etc/systemd/system/cz-relay.service" <<EOF
[Unit]
Description=Cloudzillion Relay Hardware Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${USER}
Environment=CZ_SERVER_URL=${SERVER_URL}
Environment=CZ_STATION_ID=${STATION_ID}
Environment=CZ_STATION_KEY=${STATION_KEY}
Environment=PRINTER_IP=${PRINTER_IP}
Environment=PRINTER_PORT=${PRINTER_PORT}
ExecStart=${BINARY_PATH}
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable cz-relay
    sudo systemctl restart cz-relay

    echo "================================================================="
    echo " ✓ cz-relay is running as a systemd service (Ubuntu/Debian)."
    echo " Check status: sudo systemctl status cz-relay"
    echo " View logs:    sudo journalctl -u cz-relay -f"
    echo "================================================================="

elif [ "$PLATFORM" = "darwin" ]; then
    echo "==> Configuring macOS launchd LaunchAgent..."
    PLIST_DIR="${HOME}/Library/LaunchAgents"
    PLIST_PATH="${PLIST_DIR}/com.cloudzillion.cz-relay.plist"
    mkdir -p "${PLIST_DIR}"
    launchctl unload "${PLIST_PATH}" 2>/dev/null || true

    cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudzillion.cz-relay</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BINARY_PATH}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CZ_SERVER_URL</key>
        <string>${SERVER_URL}</string>
        <key>CZ_STATION_ID</key>
        <string>${STATION_ID}</string>
        <key>CZ_STATION_KEY</key>
        <string>${STATION_KEY}</string>
        <key>PRINTER_IP</key>
        <string>${PRINTER_IP}</string>
        <key>PRINTER_PORT</key>
        <string>${PRINTER_PORT}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/cz-relay.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/cz-relay.stderr.log</string>
</dict>
</plist>
EOF

    launchctl load -w "${PLIST_PATH}"

    echo "================================================================="
    echo " ✓ cz-relay is running as a launchd daemon (macOS)."
    echo " View logs: tail -f /tmp/cz-relay.stdout.log"
    echo "================================================================="
fi