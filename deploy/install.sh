#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/opt/mqtt-to-http"
SERVICE_NAME="mqtt-to-http"
NODE_VERSION="20"

echo "==> Installing MQTT-to-HTTP Gateway on Raspberry Pi"

# Install Node.js if missing
if ! command -v node &>/dev/null; then
  echo "==> Installing Node.js ${NODE_VERSION}..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Node.js version: $(node --version)"

# Create install directory
sudo mkdir -p "$INSTALL_DIR"
sudo chown "${USER}:${USER}" "$INSTALL_DIR"

# Copy application files
echo "==> Copying application files to ${INSTALL_DIR}"
cp -r src package*.json config "$INSTALL_DIR/"

# Copy .env (create from example if not present)
if [ -f .env ]; then
  cp .env "$INSTALL_DIR/.env"
else
  cp .env.example "$INSTALL_DIR/.env"
  echo ""
  echo "  [!] No .env found — copied .env.example to ${INSTALL_DIR}/.env"
  echo "  [!] Edit ${INSTALL_DIR}/.env before starting the service!"
  echo ""
fi

# Install production dependencies
echo "==> Installing Node.js dependencies"
cd "$INSTALL_DIR"
npm ci --omit=dev

# Install and enable systemd service
echo "==> Installing systemd service"
sudo cp "${SCRIPT_DIR}/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo ""
echo "==> Done! Service status:"
sudo systemctl status "$SERVICE_NAME" --no-pager

echo ""
echo "Useful commands:"
echo "  sudo systemctl status ${SERVICE_NAME}   — check status"
echo "  sudo journalctl -fu ${SERVICE_NAME}     — follow logs"
echo "  sudo systemctl restart ${SERVICE_NAME}  — restart"
