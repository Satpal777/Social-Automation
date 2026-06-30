# ── Build Stage ─────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json tsconfig.json ./
COPY prisma ./prisma

RUN npm ci

# Copy sources and build
COPY src ./src
RUN npx prisma generate
RUN npm run build

# ── Production Stage ────────────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# Install Chromium and required fonts for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configure Puppeteer to use system-installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci --omit=dev

# Copy compiled files and prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000

CMD ["npm", "start"]
