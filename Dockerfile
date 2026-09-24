# Bow Down Visuals — single-service production image.
# Builds the API server and the Vite frontend, then runs the API server
# which also serves the frontend's static files (same origin, so /api just works).
FROM node:22-slim

# ffmpeg + ffprobe: the export pipeline shells out to both (prepare step
# probes clip duration/resolution/codec; the render step runs ffmpeg).
# fontconfig + curl: caption burn-in uses libass, which resolves ASS
# Fontname through fontconfig. The caption font library (see
# artifacts/api-server/src/lib/fonts.ts) is downloaded here so the
# exported video uses the exact same faces as the web preview.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /usr/share/fonts/bdv \
  && cd /usr/share/fonts/bdv \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/alfaslabone/AlfaSlabOne-Regular.ttf \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf \
  && curl -fsSL -O "https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-Bold.ttf" \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/bungee/Bungee-Regular.ttf \
  && curl -fsSL -O "https://github.com/google/fonts/raw/main/ofl/cinzel/Cinzel%5Bwght%5D.ttf" \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/luckiestguy/LuckiestGuy-Regular.ttf \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/permanentmarker/PermanentMarker-Regular.ttf \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/righteous/Righteous-Regular.ttf \
  && curl -fsSL -O https://github.com/google/fonts/raw/main/ofl/titanone/TitanOne-Regular.ttf \
  && fc-cache -f /usr/share/fonts/bdv \
  && echo "caption fonts installed: $(fc-list /usr/share/fonts/bdv file 2>/dev/null | wc -l)"

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
# Cap the V8 heap: on a 512MB instance an uncapped Node heap grows until it
# starves the FFmpeg child (1080x1920 x264) and Render OOM-kills the service.
# 160MB heap keeps Node's RSS ~220MB, leaving ~280MB for FFmpeg.
CMD ["sh", "-c", "pnpm --filter @workspace/db push-force; exec node --enable-source-maps --max-old-space-size=160 artifacts/api-server/dist/index.mjs"]
