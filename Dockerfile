# Bow Down Visuals — single-service production image.
# Builds the API server and the Vite frontend, then runs the API server
# which also serves the frontend's static files (same origin, so /api just works).
FROM node:22-slim

RUN corepack enable

WORKDIR /app

# Frontend build-time variables baked into the JS bundle.
# Render passes service environment variables as Docker build args.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_LIP_SYNC_API_KEY=""
ARG PORT="8080"
ARG BASE_PATH="/"

COPY . .

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_LIP_SYNC_API_KEY=$VITE_LIP_SYNC_API_KEY \
    PORT=$PORT \
    BASE_PATH=$BASE_PATH

# typecheck + build every workspace package (frontend + api-server)
RUN pnpm install --frozen-lockfile && pnpm run build

ENV NODE_ENV=production

EXPOSE 8080

# Sync the Postgres schema on every boot before starting the server.
# drizzle-kit push is idempotent (only applies diffs); --force skips the
# interactive confirmation so the container never hangs waiting for input.
# The `;` (not `&&`) guarantees the server still starts if the push hits a
# transient DB hiccup — the failure will be visible in the logs.
CMD ["sh", "-c", "pnpm --filter @workspace/db push-force; exec node --enable-source-maps artifacts/api-server/dist/index.mjs"]
