# ─────────────────────────────────────────────────────────────────────────────
# GoHybridAI backend — production image
# Base: Microsoft's official Playwright image with Chromium + system deps
# ─────────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# Run as non-root for security. The playwright base image already has a
# `pwuser` account with the Chromium sandbox bits configured.
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn \
    PORT=3000

WORKDIR /app

# Install dependencies first — this layer caches independently of source
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Copy source (respecting .dockerignore)
COPY . .

# Ensure runtime directories exist with correct ownership
RUN mkdir -p /app/local_storage /app/test-results /app/tests/generated /app/logs /app/reports \
    && chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 3000

# Health probe for orchestrators (Docker / K8s / ECS)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Entry: use npm start (package.json "start" script). Avoid ts-node in prod
# once a proper build step is added; for now this matches existing behaviour.
CMD ["npm", "run", "start"]
