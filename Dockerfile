# syntax=docker/dockerfile:1
# OmniAgent · imagen de producción (Next.js "standalone": solo el servidor y las dependencias que usa).
# Guía completa: docs/DEPLOY.md.
#
#   docker build -t omniagent \
#     --build-arg NEXT_PUBLIC_APP_URL=https://TU-DOMINIO \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx .
#   docker run --env-file .env -p 3000:3000 omniagent
#
# Las migraciones no corren al arrancar: se aplican antes, con `npm run db:deploy` (o el workflow de GitHub).

ARG NODE_VERSION=24

# ── 1. Dependencias (con las de desarrollo: hacen falta para compilar) ──
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
# El postinstall genera el cliente de Prisma: necesita el esquema y prisma.config.ts.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# ── 2. Compilación ──
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js incrusta las variables NEXT_PUBLIC_* en el JavaScript del navegador y fija las cabeceras de seguridad
# (la CSP con el origen de Supabase, y CSP_MODE) al compilar: por eso llegan como build args y no en tiempo de ejecución.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG CSP_MODE=enforce
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    CSP_MODE=$CSP_MODE \
    BUILD_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 3. Imagen final: sin código fuente, sin dependencias de desarrollo y con un usuario sin privilegios ──
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    LOG_FORMAT=json \
    APP_VERSION=$APP_VERSION
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
# /api/health responde 503 si la base de datos no contesta: el contenedor queda "unhealthy" y el orquestador lo nota.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
