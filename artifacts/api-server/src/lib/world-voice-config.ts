/**
 * world-voice-config.ts — the server half of the World voice ICE
 * config seam (Open World item 100; ephemeral credentials added by
 * Stack-100 #2 item 100).
 *
 * The World's proximity voice mesh is STUN-only by default, so peers
 * behind symmetric NAT / strict firewalls silently never connect.
 * A TURN relay fixes that, but standing one up (a coturn instance
 * or a metered TURN service) is the owner's infra/money call — this
 * module is only the sanctioned place its coordinates enter the
 * system. Two credential modes, both env-only:
 *
 *   Static (the original seam):
 *     WORLD_TURN_URLS        comma-separated turn:/turns: URLs
 *     WORLD_TURN_USERNAME    the relay username
 *     WORLD_TURN_CREDENTIAL  the relay credential
 *
 *   Ephemeral (coturn REST / `--use-auth-secret` style): when
 *     WORLD_TURN_SECRET      the relay's shared static-auth-secret
 *   is set (with WORLD_TURN_URLS), the rail stops serving one shared
 *   credential and instead SIGNS a short-lived per-session pair:
 *   username = "<expiry-unix>:<member id>", credential =
 *   base64(HMAC-SHA1(secret, username)) — exactly what a coturn
 *   running with use-auth-secret expects. The secret itself never
 *   leaves the server; a leaked served credential dies at its
 *   expiry (TURN_CREDENTIAL_TTL_SECONDS) instead of living until
 *   someone rotates a shared password. Ephemeral mode wins when
 *   both are configured. When WORLD_TURN_SECRET is unset, behaviour
 *   is exactly the static seam above.
 *
 * The route serves the built config to signed-in members (voice is
 * members-only; guests never see it), and the client consumes it
 * via lib/world/voice-ice. Fail-closed and all-or-nothing: URLs
 * without a complete credential story (or credentials without a
 * valid turn: URL) serve NO relay at all — a half-configured relay
 * would fail silently per-pair, which is the exact failure mode
 * item 100 exists to end.
 *
 * SIBLING-MESH NOTE (Stack-100 #2 item 67 — note only, those
 * surfaces belong to the site stack, not this lane): the go-live
 * guest mesh (artifacts/bow-down-visuals/src/lib/go-live/guest-mesh.ts)
 * and the stage-room mesh (components/trust/StageRooms.tsx) share
 * this STUN-only shape — each builds its RTCPeerConnection with the
 * same single hardcoded `stun:stun.l.google.com:19302` and no TURN.
 * They may reuse THIS rail (GET /api/world/voice-config's DTO is
 * mesh-agnostic: validated turn: entries + a credential pair) if
 * their owners wire a fetch at join time the way voice-ice does;
 * until then their STUN-only behaviour is unchanged and this note
 * is the whole change.
 *
 * Pure (env is passed in), so the whole contract is unit-tested.
 */

import { createHmac } from "crypto";

export interface WorldVoiceConfigDto {
  /** TURN relay servers for the mesh; empty until the owner stands
   *  a relay up and sets the env above. STUN is the client's own
   *  built-in default and is deliberately not served from here. */
  turnServers: Array<{ urls: string | string[]; username: string; credential: string }>;
}

type EnvLike = Record<string, string | undefined>;

/** Lifetime of a signed ephemeral TURN credential: long enough for
 *  a voice session's joins, short enough that a leaked pair is
 *  worthless within the hour. */
export const TURN_CREDENTIAL_TTL_SECONDS = 3600;

export interface WorldVoiceConfigOptions {
  /** The signed-in member the credentials are minted for (the route
   *  passes the session's user id). Rides inside the signed
   *  username so a relay log can attribute usage; never trusted by
   *  the relay beyond the HMAC. Absent (health checks, tests) → a
   *  generic session label. */
  userId?: string | null;
  /** Clock override for tests; defaults to Date.now(). */
  nowMs?: number;
}

/** The coturn REST credential for one session: the username carries
 *  its own expiry ("<expiry-unix>:<user>") and the credential is
 *  base64(HMAC-SHA1(secret, username)) — coturn's use-auth-secret
 *  verification recomputes exactly this. Pure. */
export function signTurnCredentials(
  secret: string,
  userId: string | null | undefined,
  nowMs: number,
): { username: string; credential: string } {
  const expiry = Math.floor(nowMs / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
  const user = (userId ?? "").trim() || "world-voice";
  const username = `${expiry}:${user}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential };
}

function cleanTurnUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const url = part.trim();
    if ((url.startsWith("turn:") || url.startsWith("turns:")) && !out.includes(url)) {
      out.push(url);
    }
  }
  return out;
}

/** Build the voice-config DTO from env. No env (or a half-set env)
 *  → an honest empty relay list, never a partial one. With
 *  WORLD_TURN_SECRET set (and valid URLs), the served pair is a
 *  signed ephemeral credential; with it unset, the static pair is
 *  served exactly as before. */
export function buildWorldVoiceConfig(
  env: EnvLike,
  opts: WorldVoiceConfigOptions = {},
): WorldVoiceConfigDto {
  const urls = cleanTurnUrls(env["WORLD_TURN_URLS"]);
  if (urls.length === 0) return { turnServers: [] };
  const secret = env["WORLD_TURN_SECRET"] ?? "";
  if (secret) {
    const { username, credential } = signTurnCredentials(
      secret,
      opts.userId,
      opts.nowMs ?? Date.now(),
    );
    return {
      turnServers: [
        {
          urls: urls.length === 1 ? urls[0]! : urls,
          username,
          credential,
        },
      ],
    };
  }
  const username = (env["WORLD_TURN_USERNAME"] ?? "").trim();
  const credential = env["WORLD_TURN_CREDENTIAL"] ?? "";
  if (!username || !credential) {
    return { turnServers: [] };
  }
  return {
    turnServers: [
      {
        urls: urls.length === 1 ? urls[0]! : urls,
        username,
        credential,
      },
    ],
  };
}

/** Whether a relay is configured — for logs/health lines that must
 *  say "relay on/off" without ever printing the credential. */
export function voiceRelayConfigured(env: EnvLike): boolean {
  return buildWorldVoiceConfig(env).turnServers.length > 0;
}
