#!/bin/bash
# GoHybridAI — Sync to Server Script

SERVER_IP="your_server_ip"
REMOTE_DIR="/home/gwtuser/go-hybridai/V1"

echo "📤 Syncing V1 to ${SERVER_IP}..."

rsync -avz --exclude 'node_modules' \
          --exclude '.git' \
          --exclude '.env' \
          --exclude 'local_storage' \
          --exclude 'test-results' \
          --exclude 'playwright-report' \
          ./ ${SERVER_IP}:${REMOTE_DIR}

echo "✅ Sync complete. Now run ./scripts/deploy-ubuntu.sh on the server."
