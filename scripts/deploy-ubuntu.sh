#!/bash/bash
# GoHybridAI — Ubuntu Deployment Script
# Targets: Ubuntu 22.04 / 24.04 LTS

set -e

echo "🚀 Starting GoHybridAI Deployment..."

# 1. Install Node.js 20 LTS if missing
if ! command -v node &> /dev/null || [[ "$(node -v)" != v20* ]]; then
    echo "📦 Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# 2. Install PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
fi

# 3. Install Playwright System Dependencies
echo "🎭 Installing Playwright system dependencies..."
sudo npx playwright install-deps chromium

# 4. Backend Setup
echo "⚙️ Setting up Backend..."
cd backend
npm install
npm run init-db
# Install the specific browser distribution for MCP
npx @playwright/mcp install-browser chrome-for-testing

# 5. Frontend Build
echo "🏗️ Building Frontend..."
cd ../frontend
npm install
# Ensure VITE_API_URL is empty for relative proxying in production
VITE_API_URL="" npm run build

# 6. Start/Restart with PM2
echo "🔄 Starting services with PM2..."
cd ..
pm2 start ecosystem.config.js --env production
pm2 save

echo "✅ Deployment Complete!"
echo "📡 Check health: curl http://localhost:3001/api/health"
