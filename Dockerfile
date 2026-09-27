# Multi-stage build for the Covenant services (indexer + api + keeper + bots + faucet).
# Small runtime image; SQLite lives on a mounted volume (DB_PATH).
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# --- deps (cached) ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/package.json services/
RUN pnpm install --frozen-lockfile

# --- build shared ---
FROM deps AS build
COPY packages ./packages
COPY services ./services
COPY abi ./abi
COPY deployments ./deployments
RUN pnpm --filter @covenant/shared build

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
# services run via tsx (TS at runtime); shared is prebuilt.
EXPOSE 8080
# DB_PATH should point at the mounted volume, e.g. /data/covenant.db
ENV DB_PATH=/data/covenant.db
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@covenant/services", "start"]
