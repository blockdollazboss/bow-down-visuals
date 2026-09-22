# Bow Down Visuals — single-service production image.
# Builds the API server and the Vite frontend, then runs the API server
# which also serves the frontend's static files (same origin, so /api just works).
FROM node:20-slim

RUN corepack enable

WORKDIR /app

# Frontend build-time variables baked into the JS bundle.
# Koyeb passes service environment variables as Docker build args.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_LIP_SYNC_API_KEY=""

COPY . .

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_LIP_SYNC_API_KEY=$VITE_LIP_SYNC_API_KEY

# typecheck + build every workspace package (frontend + api-server)
RUN pnpm install --frozen-lockfile && pnpm run build

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
