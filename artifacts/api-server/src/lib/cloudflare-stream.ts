/* ── Cloudflare Stream client (live inputs) ────────────────────────────────
   Minimal wrapper over the Cloudflare Stream live-inputs API — just what
   Go Live needs: create an input when a creator goes live (the response
   carries the WHIP publish URL and the WHEP playback URL), delete it when
   the stream ends.

   Credentials come from env: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_STREAM_TOKEN.
   When they are unset the feature is simply OFF: isStreamConfigured() is
   false, routes answer an honest 503 ("live streaming isn't switched on
   yet"), and nothing here is called. The moment the env vars land on the
   server, the whole flow lights up with no code change.

   Recording is OFF on the provider side on purpose: the broadcaster's
   browser records the stream and uploads through the site's own storage
   path (mirror-on-save), so the site — not the provider — owns the VOD. */

const API_BASE = "https://api.cloudflare.com/client/v4";

export class StreamNotConfiguredError extends Error {
  code = "STREAM_NOT_CONFIGURED";
  constructor() {
    super("Live streaming isn't switched on yet.");
    this.name = "StreamNotConfiguredError";
  }
}

export class StreamProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "StreamProviderError";
    this.status = status;
  }
}

export function streamCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { accountId: string; token: string } | null {
  const accountId = env["CLOUDFLARE_ACCOUNT_ID"]?.trim();
  const token = env["CLOUDFLARE_STREAM_TOKEN"]?.trim();
  if (!accountId || !token) return null;
  return { accountId, token };
}

export function isStreamConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return streamCredentials(env) !== null;
}

export interface CreatedLiveInput {
  providerInputId: string;
  /* For Cloudflare live inputs the playback uid IS the input uid. */
  playbackId: string;
  whipUrl: string;
  whepUrl: string | null;
}

/**
 * Playback URLs from a WHIP publish URL. Cloudflare addresses every
 * rendition off the same host + uid:
 *   publish: https://customer-<code>.cloudflarestream.com/<uid>/webRTC/publish
 *   WHEP:    https://customer-<code>.cloudflarestream.com/<uid>/webRTC/play
 *   HLS:     https://customer-<code>.cloudflarestream.com/<uid>/manifest/video.m3u8
 * Returns nulls when the URL doesn't have the expected shape.
 */
export function playbackUrlsFromWhip(whipUrl: string | null | undefined): {
  whep_url: string | null;
  hls_url: string | null;
} {
  if (!whipUrl || !/\/webRTC\/publish\/?$/.test(whipUrl)) {
    return { whep_url: null, hls_url: null };
  }
  const base = whipUrl.replace(/\/webRTC\/publish\/?$/, "");
  return {
    whep_url: `${base}/webRTC/play`,
    hls_url: `${base}/manifest/video.m3u8`,
  };
}

type FetchImpl = typeof fetch;

export async function createLiveInput(
  name: string,
  fetchImpl: FetchImpl = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CreatedLiveInput> {
  const creds = streamCredentials(env);
  if (!creds) throw new StreamNotConfiguredError();

  const res = await fetchImpl(
    `${API_BASE}/accounts/${creds.accountId}/stream/live_inputs`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meta: { name: name.slice(0, 200) },
        recording: { mode: "off" },
      }),
    },
  );

  const payload = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: {
      uid?: string;
      webRTC?: { url?: string };
      webRTCPlayback?: { url?: string };
    };
    errors?: Array<{ message?: string }>;
  } | null;

  if (!res.ok || !payload?.success || !payload.result?.uid) {
    const detail = payload?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new StreamProviderError(
      `Cloudflare Stream could not create the live input: ${detail}`,
      res.status,
    );
  }

  const uid = payload.result.uid;
  const whipUrl = payload.result.webRTC?.url ?? "";
  if (!whipUrl) {
    throw new StreamProviderError(
      "Cloudflare Stream created the input but returned no publish URL.",
      res.status,
    );
  }
  return {
    providerInputId: uid,
    playbackId: uid,
    whipUrl,
    whepUrl: payload.result.webRTCPlayback?.url ?? playbackUrlsFromWhip(whipUrl).whep_url,
  };
}

/** Best-effort by design: ending a stream must not fail because the
 *  provider delete did. Callers log and move on. */
export async function deleteLiveInput(
  providerInputId: string,
  fetchImpl: FetchImpl = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const creds = streamCredentials(env);
  if (!creds) throw new StreamNotConfiguredError();
  const res = await fetchImpl(
    `${API_BASE}/accounts/${creds.accountId}/stream/live_inputs/${providerInputId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${creds.token}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new StreamProviderError(
      `Cloudflare Stream could not delete the live input (HTTP ${res.status}).`,
      res.status,
    );
  }
}
