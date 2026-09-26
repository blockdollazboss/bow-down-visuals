# Bow Down Visuals — single-service production image.
# Builds the API server and the Vite frontend, then runs the API server
# which also serves the frontend's static files (same origin, so /api just works).
FROM node:22-slim

# ffmpeg + ffprobe: the export pipeline shells out to both (prepare step
# probes clip duration/resolution/codec; the render step runs ffmpeg).
# fontconfig: caption burn-in uses libass, which resolves ASS
# Fontname through fontconfig. The caption font library (see
# artifacts/api-server/src/lib/fonts.ts) is vendored in docker/fonts/
# (all OFL-licensed) and copied here so the exported video uses the
# exact same faces as the web preview. Vendored instead of downloaded:
# upstream google/fonts removed the luckiestguy and permanentmarker
# directories, and their 404s broke production Docker builds on 2026-09-25.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg fontconfig python3 python3-venv python3-pip gcc python3-dev \
  && rm -rf /var/lib/apt/lists/*
COPY docker/fonts/*.ttf /usr/share/fonts/bdv/
RUN fc-cache -f /usr/share/fonts/bdv \
  && echo "caption fonts installed: $(fc-list /usr/share/fonts/bdv file 2>/dev/null | wc -l)"

# Demucs (Meta vocal separation) in an isolated venv, CPU-only torch.
# DEMUCS_PYTHON points the server at this interpreter; DEMUCS_MODEL can
# override the model (default mdx_extra_q).
# yt-dlp: the Media Importer shells out to it for platform downloads
# (YouTube, SoundCloud, TikTok, Instagram, X, Vimeo). Pinned to the
# system python3 so `python3 -m yt_dlp` works as a fallback.
RUN python3 -m venv /opt/demucs-venv \
  && /opt/demucs-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/demucs-venv/bin/pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
  && /opt/demucs-venv/bin/pip install --no-cache-dir demucs numpy diffq \
  && python3 -m pip install --no-cache-dir --upgrade yt-dlp --break-system-packages
ENV DEMUCS_PYTHON=/opt/demucs-venv/bin/python

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
