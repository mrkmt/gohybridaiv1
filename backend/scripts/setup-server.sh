#!/usr/bin/env bash
# ============================================================================
# GoHybridAI — Ubuntu 22.04 Server Setup & Deployment Script
# ============================================================================
# Usage:
#   chmod +x setup-server.sh
#   sudo ./setup-server.sh [--full|--deps-only|--app-only|--nginx]
#
# Modes:
#   --full        Install everything: system deps, PostgreSQL, app, PM2, nginx
#   --deps-only   Install system packages + Playwright browsers only
#   --app-only    Install Node deps, build frontend, configure PM2 (no system)
#   --nginx       Install & configure Nginx reverse proxy only
#   (none)        Default = --full
# ============================================================================

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================
APP_USER="${GOHYBRID_USER:-$(whoami)}"
APP_GROUP="${APP_USER}"
INSTALL_DIR="${GOHYBRID_INSTALL_DIR:-/opt/gohybridai}"
NODE_VERSION="22"
PG_USER="${PG_USER:-postgres}"
PG_PASSWORD="${PG_PASSWORD:-}"
PG_DATABASE="${PG_DATABASE:-ai_testing_platform}"
DOMAIN="${DOMAIN:-localhost}"
SSL_ENABLED="${SSL_ENABLED:-false}"
PM2_NAME="gohybridai"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================================================
# Utility Functions
# ============================================================================
log() { echo -e "${BLUE}[GoHybridAI]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

check_root() {
    if [[ "$1" != "--app-only" ]] && [[ "$(id -u)" -ne 0 ]]; then
        error "This script requires sudo/root privileges for system installation."
        error "Run with: sudo ./setup-server.sh"
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        warn "Cannot detect OS. Proceeding anyway..."
        return
    fi
    local os_name
    os_name=$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
    if [[ "$os_name" != "ubuntu" && "$os_name" != "debian" ]]; then
        warn "Detected OS: $os_name. This script is tested on Ubuntu 22.04."
        warn "Some package names may differ on your distribution."
    fi
    log "Detected OS: $os_name"
}

require_cmd() {
    if ! command -v "$1" &>/dev/null; then
        error "'$1' is required but not installed."
        return 1
    fi
}

# ============================================================================
# 1. System Dependencies
# ============================================================================
install_system_deps() {
    log "Updating package lists..."
    apt-get update -y

    log "Installing system dependencies..."
    apt-get install -y \
        curl \
        wget \
        gnupg \
        ca-certificates \
        build-essential \
        python3 \
        python3-dev \
        git \
        openssl \
        jq \
        unzip \
        htop \
        ufw

    log "Installing FFmpeg (for video compression)..."
    apt-get install -y ffmpeg

    log "Installing Nginx..."
    apt-get install -y nginx

    success "System dependencies installed."
}

# ============================================================================
# 2. Node.js 22.x (via NodeSource)
# ============================================================================
install_nodejs() {
    if command -v node &>/dev/null; then
        local current_version
        current_version=$(node -v | cut -d'.' -f1 | sed 's/v//')
        if [[ "$current_version" -ge 22 ]]; then
            success "Node.js $(node -v) already installed (>= 22.x)."
            return
        fi
        warn "Node.js $(node -v) found but < 22.x. Installing Node.js 22..."
    fi

    log "Installing Node.js ${NODE_VERSION}.x via NodeSource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs

    # Verify
    node -v
    npm -v
    success "Node.js $(node -v) and npm $(npm -v) installed."
}

# ============================================================================
# 3. PostgreSQL
# ============================================================================
install_postgresql() {
    if command -v psql &>/dev/null; then
        success "PostgreSQL already installed: $(psql --version)."
    else
        log "Installing PostgreSQL..."
        apt-get install -y postgresql postgresql-contrib
        success "PostgreSQL installed."
    fi

    # Configure database
    log "Configuring PostgreSQL..."
    systemctl enable postgresql
    systemctl start postgresql

    # Create database and user
    if [[ -n "$PG_PASSWORD" ]]; then
        log "Creating database '$PG_DATABASE' and user..."
        su - postgres -c "psql <<EOSQL
DO \\\$\\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${PG_USER}') THEN
        CREATE ROLE ${PG_USER} WITH LOGIN SUPERUSER PASSWORD '${PG_PASSWORD}';
    END IF;
END
\\\$\$;
SELECT 'CREATE DATABASE ${PG_DATABASE}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PG_DATABASE}')\\gexec
EOSQL"
    fi

    success "PostgreSQL configured."
}

# ============================================================================
# 4. PM2 Process Manager
# ============================================================================
install_pm2() {
    if command -v pm2 &>/dev/null; then
        success "PM2 already installed: $(pm2 -v)."
        return
    fi

    log "Installing PM2..."
    npm install -g pm2
    success "PM2 installed."
}

# ============================================================================
# 5. Playwright Browsers + System Dependencies
# ============================================================================
install_playwright() {
    local backend_dir="$1"

    log "Installing Playwright Chromium browser..."
    cd "$backend_dir"
    npx playwright install chromium

    log "Installing Playwright system dependencies..."
    npx playwright install-deps chromium 2>/dev/null || {
        warn "playwright install-deps failed. Installing common deps manually..."
        apt-get install -y \
            libnss3 \
            libatk-bridge2.0-0 \
            libdrm2 \
            libxkbcommon0 \
            libxcomposite1 \
            libxdamage1 \
            libxrandr2 \
            libgbm1 \
            libpango-1.0-0 \
            libcairo2 \
            libasound2 \
            libxshmfence1 \
            libx11-xcb1 \
            fonts-noto-cjk 2>/dev/null || true
    }

    success "Playwright Chromium installed."
}

# ============================================================================
# 6. Application Setup
# ============================================================================
setup_app() {
    local backend_dir="$1"
    local frontend_dir="$2"

    # --- Backend ---
    log "Installing backend dependencies..."
    cd "$backend_dir"
    npm install --production
    success "Backend dependencies installed."

    # --- Frontend ---
    if [[ -d "$frontend_dir" ]]; then
        log "Installing frontend dependencies & building..."
        cd "$frontend_dir"
        npm install
        npm run build
        success "Frontend built (output: $frontend_dir/dist)."
    else
        warn "Frontend directory not found at $frontend_dir. Skipping frontend build."
    fi

    # --- Environment file ---
    if [[ ! -f "$backend_dir/.env" ]]; then
        log "Creating .env from .env.example..."
        if [[ -f "$backend_dir/.env.example" ]]; then
            cp "$backend_dir/.env.example" "$backend_dir/.env"
            # Generate JWT_SECRET if not already set
            sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" "$backend_dir/.env"
            # Set default production values
            sed -i "s/NODE_ENV=.*/NODE_ENV=production/" "$backend_dir/.env"
            # Fix CLI tool paths for Linux
            sed -i "s|GEMINI_PATH=.*|GEMINI_PATH=gemini|" "$backend_dir/.env"
            sed -i "s|QWEN_PATH=.*|QWEN_PATH=qwen|" "$backend_dir/.env"
            sed -i "s|CODEX_PATH=.*|CODEX_PATH=codex|" "$backend_dir/.env"
            success ".env created with production defaults."
            warn "IMPORTANT: Edit .env to set PG_PASSWORD, BASE_URL, API keys, and Jira credentials."
        else
            error ".env.example not found. Create .env manually."
        fi
    else
        success ".env already exists."
    fi

    # --- Required directories ---
    log "Creating runtime directories..."
    mkdir -p "$backend_dir/local_storage"
    mkdir -p "$backend_dir/test-results"
    mkdir -p "$backend_dir/tests/generated"
    mkdir -p "$backend_dir/reports/weekly"
    mkdir -p "$backend_dir/skills/GlobalHR/forms"
    success "Runtime directories created."
}

# ============================================================================
# 7. PM2 Ecosystem Configuration
# ============================================================================
create_pm2_ecosystem() {
    local backend_dir="$1"
    local ecosystem_file="$backend_dir/ecosystem.config.js"

    log "Creating PM2 ecosystem configuration..."
    cat > "$ecosystem_file" << 'ECOSYSTEM'
module.exports = {
  apps: [
    {
      name: 'gohybridai',
      script: 'api/server.ts',
      interpreter: 'node',
      interpreter_args: '--loader ts-node/esm --no-warnings --experimental-specifier-resolution=node',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '2G',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 8000,
      wait_ready: true,
    }
  ]
};
ECOSYSTEM

    # Also create a simpler startup config that uses ts-node directly
    cat > "$ecosystem_file" << ECOSYSTEM
module.exports = {
  apps: [
    {
      name: '${PM2_NAME}',
      script: 'npx',
      args: 'ts-node --project tsconfig.json api/server.ts',
      cwd: '${backend_dir}',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '2G',
      error_file: '${backend_dir}/logs/pm2-error.log',
      out_file: '${backend_dir}/logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000,
      listen_timeout: 8000,
    }
  ]
};
ECOSYSTEM

    success "PM2 ecosystem file created at $ecosystem_file."
}

# ============================================================================
# 8. Systemd Service (Alternative to PM2)
# ============================================================================
create_systemd_service() {
    local backend_dir="$1"

    log "Creating systemd service..."
    local service_file="/etc/systemd/system/gohybridai.service"

    cat > "$service_file" << SERVICE
[Unit]
Description=GoHybridAI Backend Server
After=network.target postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${backend_dir}
ExecStart=$(command -v npx) ts-node --project tsconfig.json api/server.ts
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${backend_dir}/local_storage ${backend_dir}/test-results ${backend_dir}/tests/generated ${backend_dir}/logs ${backend_dir}/reports

[Install]
WantedBy=multi-user.target
SERVICE

    systemctl daemon-reload
    systemctl enable gohybridai.service

    success "Systemd service created. Start with: sudo systemctl start gohybridai"
    success "View logs with: sudo journalctl -u gohybridai -f"
}

# ============================================================================
# 9. Nginx Reverse Proxy
# ============================================================================
setup_nginx() {
    log "Configuring Nginx reverse proxy..."

    if ! command -v nginx &>/dev/null; then
        error "Nginx is not installed. Run with --full or install nginx first."
        return 1
    fi

    local nginx_conf="/etc/nginx/sites-available/gohybridai"
    local nginx_enabled="/etc/nginx/sites-enabled/gohybridai"

    # Remove default site if it exists
    rm -f "$nginx_enabled"

    if [[ "$SSL_ENABLED" == "true" ]]; then
        # SSL configuration
        cat > "$nginx_conf" << NGINX_SSL
server {
    listen 80;
    server_name ${DOMAIN};
    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/ssl/certs/${DOMAIN}.crt;
    ssl_certificate_key /etc/ssl/private/${DOMAIN}.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Frontend static files
    root ${INSTALL_DIR}/frontend/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
    }

    # Storage proxy (serve uploaded files)
    location /storage/ {
        proxy_pass http://127.0.0.1:3000/storage/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }

    # Health check (internal only)
    location /api/health {
        proxy_pass http://127.0.0.1:3000/api/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
NGINX_SSL

        warn "SSL certificates expected at /etc/ssl/certs/${DOMAIN}.crt"
        warn "Run: sudo certbot --nginx -d ${DOMAIN} to get free Let's Encrypt certs."
    else
        # HTTP-only configuration
        cat > "$nginx_conf" << NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    # Frontend static files
    root ${INSTALL_DIR}/frontend/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
    }

    # Storage proxy
    location /storage/ {
        proxy_pass http://127.0.0.1:3000/storage/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
NGINX
    fi

    # Enable site
    ln -sf "$nginx_conf" "$nginx_enabled"
    nginx -t
    systemctl reload nginx

    success "Nginx configured and enabled."
}

# ============================================================================
# 10. Firewall (UFW)
# ============================================================================
setup_firewall() {
    log "Configuring firewall..."
    if command -v ufw &>/dev/null; then
        ufw allow ssh 2>/dev/null || true
        ufw allow http 2>/dev/null || true
        ufw allow https 2>/dev/null || true
        ufw --force enable 2>/dev/null || true
        success "Firewall configured (SSH, HTTP, HTTPS allowed)."
    else
        warn "UFW not installed. Configure firewall manually."
    fi
}

# ============================================================================
# 11. Post-Install Verification
# ============================================================================
verify_installation() {
    local backend_dir="$1"
    log "Running post-install verification..."

    local issues=0

    # Node.js
    if command -v node &>/dev/null; then
        local ver
        ver=$(node -v)
        local major
        major=$(echo "$ver" | cut -d'.' -f1 | sed 's/v//')
        if [[ "$major" -ge 22 ]]; then
            success "Node.js: $ver (>= 22.x)"
        else
            error "Node.js: $ver (requires >= 22.x)"
            ((issues++))
        fi
    else
        error "Node.js: NOT FOUND"
        ((issues++))
    fi

    # PostgreSQL
    if command -v psql &>/dev/null; then
        success "PostgreSQL: $(psql --version)"
    else
        warn "PostgreSQL: NOT FOUND (required for production)"
    fi

    # FFmpeg
    if command -v ffmpeg &>/dev/null; then
        success "FFmpeg: $(ffmpeg -version | head -1)"
    else
        warn "FFmpeg: NOT FOUND (optional, for video compression)"
    fi

    # Nginx
    if command -v nginx &>/dev/null; then
        success "Nginx: $(nginx -v 2>&1)"
    else
        warn "Nginx: NOT FOUND (optional, for reverse proxy)"
    fi

    # PM2
    if command -v pm2 &>/dev/null; then
        success "PM2: $(pm2 -v)"
    else
        warn "PM2: NOT FOUND (optional, process manager)"
    fi

    # Playwright
    if [[ -d "$backend_dir/node_modules/@playwright/test" ]]; then
        success "Playwright: installed"
    else
        error "Playwright: NOT FOUND"
        ((issues++))
    fi

    # .env file
    if [[ -f "$backend_dir/.env" ]]; then
        if grep -q "JWT_SECRET=.*[a-f0-9]\{32,\}" "$backend_dir/.env" 2>/dev/null; then
            success ".env: JWT_SECRET configured"
        else
            warn ".env: JWT_SECRET is empty or default"
        fi
        if grep -q "PG_PASSWORD=.*[^ ]" "$backend_dir/.env" 2>/dev/null && ! grep -q "PG_PASSWORD=$" "$backend_dir/.env" 2>/dev/null; then
            success ".env: PG_PASSWORD configured"
        else
            warn ".env: PG_PASSWORD not set"
        fi
        if grep -q "BASE_URL=.*[^ ]" "$backend_dir/.env" 2>/dev/null; then
            success ".env: BASE_URL configured"
        else
            warn ".env: BASE_URL not set (required for test execution)"
        fi
    else
        error ".env: NOT FOUND"
        ((issues++))
    fi

    # Runtime directories
    for dir in "local_storage" "test-results" "tests/generated"; do
        if [[ -d "$backend_dir/$dir" ]]; then
            success "Directory: $dir exists"
        else
            warn "Directory: $dir missing"
        fi
    done

    if [[ $issues -gt 0 ]]; then
        echo ""
        error "Verification completed with $issues critical issue(s). Please fix before starting the server."
        return 1
    fi

    echo ""
    success "All critical checks passed!"
}

# ============================================================================
# 12. Print Next Steps
# ============================================================================
print_next_steps() {
    local backend_dir="$1"

    cat << EOF

============================================================
  GoHybridAI Server Setup Complete!
============================================================

  Next steps:

  1. Edit the environment file:
     nano ${backend_dir}/.env

     Set these required values:
     - PG_PASSWORD
     - BASE_URL (e.g., http://your-server-ip or https://your-domain.com)
     - API_KEY
     - JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN
     - OPENROUTER_API_KEY (or other AI provider keys)
     - TEST_USERNAME, TEST_PASSWORD

  2. Initialize the database (first time only):
     cd ${backend_dir}
     npm run init-db

  3. Start the server:

     Option A — PM2:
       cd ${backend_dir}
       pm2 start ecosystem.config.js
       pm2 save
       pm2 startup   # Auto-start on boot

     Option B — systemd:
       sudo systemctl start gohybridai
       sudo journalctl -u gohybridai -f

  4. Verify the server is running:
     curl http://localhost:3000/api/health

  5. Set up SSL (recommended):
     sudo apt install certbot python3-certbot-nginx
     sudo certbot --nginx -d ${DOMAIN}

  6. Run the seed admin user (optional):
     cd ${backend_dir}
     npm run seed:admin

============================================================
EOF
}

# ============================================================================
# Main — Parse Arguments & Execute
# ============================================================================
MODE="full"
for arg in "$@"; do
    case "$arg" in
        --full)        MODE="full" ;;
        --deps-only)   MODE="deps-only" ;;
        --app-only)    MODE="app-only" ;;
        --nginx)       MODE="nginx" ;;
        --no-nginx)    MODE="full-no-nginx" ;;
        --help|-h)
            echo "Usage: sudo ./setup-server.sh [--full|--deps-only|--app-only|--nginx|--no-nginx]"
            echo ""
            echo "  --full        Install everything (default)"
            echo "  --deps-only   Install system packages + Playwright browsers only"
            echo "  --app-only    Install Node deps + build + configure (no sudo needed)"
            echo "  --nginx       Install & configure Nginx reverse proxy only"
            echo "  --no-nginx    Install everything except Nginx"
            exit 0
            ;;
        *)
            error "Unknown argument: $arg"
            exit 1
            ;;
    esac
done

check_root "$MODE"

# Determine project directories
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT"
FRONTEND_DIR="$PROJECT_ROOT/../frontend"

# If running from outside the project, check /opt/gohybridai
if [[ ! -d "$BACKEND_DIR/src" && -d "$INSTALL_DIR/backend" ]]; then
    BACKEND_DIR="$INSTALL_DIR/backend"
    FRONTEND_DIR="$INSTALL_DIR/frontend"
fi

log "Project root: $BACKEND_DIR"
log "Frontend: $FRONTEND_DIR"

case "$MODE" in
    full)
        check_os
        install_system_deps
        install_nodejs
        install_postgresql
        install_pm2
        install_playwright "$BACKEND_DIR"
        setup_app "$BACKEND_DIR" "$FRONTEND_DIR"
        create_pm2_ecosystem "$BACKEND_DIR"
        create_systemd_service "$BACKEND_DIR"
        setup_nginx
        setup_firewall
        verify_installation "$BACKEND_DIR"
        print_next_steps "$BACKEND_DIR"
        ;;

    full-no-nginx)
        check_os
        install_system_deps
        install_nodejs
        install_postgresql
        install_pm2
        install_playwright "$BACKEND_DIR"
        setup_app "$BACKEND_DIR" "$FRONTEND_DIR"
        create_pm2_ecosystem "$BACKEND_DIR"
        create_systemd_service "$BACKEND_DIR"
        setup_firewall
        verify_installation "$BACKEND_DIR"
        print_next_steps "$BACKEND_DIR"
        ;;

    deps-only)
        check_os
        install_system_deps
        install_nodejs
        install_postgresql
        install_pm2
        install_playwright "$BACKEND_DIR"
        ;;

    app-only)
        setup_app "$BACKEND_DIR" "$FRONTEND_DIR"
        create_pm2_ecosystem "$BACKEND_DIR"
        verify_installation "$BACKEND_DIR"
        print_next_steps "$BACKEND_DIR"
        ;;

    nginx)
        setup_nginx
        ;;
esac

exit 0
