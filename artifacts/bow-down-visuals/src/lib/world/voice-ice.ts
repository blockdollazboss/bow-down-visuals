/**
 * voice-ice.ts — where the World's voice mesh gets its ICE servers
 * (Open World item 100).
 *
 * Today the mesh is STUN-only: a public STUN server helps peers find
 * each other, but there is no TURN relay — on networks with symmetric
 * NAT or strict firewalls a pair silently never connects. This module
 * is the consumption seam for a relay: the client asks the server's
 * sanctioned config endpoint (GET /api/world/voice-config, members
 * only) what ICE servers to use, and builds the RTCPeerConnection
 * config from the answer. When the endpoint is unreachable, errors,
 * or simply has no TURN configured, the answer is exactly today's
 * behaviour — the STUN default and nothing else.
 *
 * Credentials NEVER live here: a TURN username/credential only ever
 * arrives at runtime from that endpoint (which reads them from
 * server env), is used for this voice session, and is never stored,
 * logged, or committed. Validation is strict and fail-closed: a
 * malformed TURN entry is dropped, never half-used — a relay with a
 * bad URL or a missing credential half would fail silently, which is
 * the exact failure mode this item exists to end.
 *
 * The served pair may be a short-lived per-session credential
 * (Stack-100 #2 item 100: when WORLD_TURN_SECRET is set server-side,
 * the rail signs coturn-REST-style ephemeral credentials) — this
 * seam neither knows nor cares: it consumes what it is served,
 * exactly as the turn-evaluation upgrade path promised.
 *
 * SIBLING-MESH NOTE (Stack-100 #2 item 67 — note only): the go-live
 * guest mesh (lib/go-live/guest-mesh.ts) and the stage-room mesh
 * (components/trust/StageRooms.tsx) share this STUN-only shape and
 * may reuse this rail + this builder the same way; their surfaces
 * are the site stack's to wire, not this module's.
 *
 * Pure except the one fetch helper (fetch is injected), so the whole
 * seam is unit-tested in node.
 */

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** The STUN default the mesh has always used — unchanged. */
export const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";

/** At most this many TURN entries are honoured — a config typo must
 *  not turn candidate gathering into a relay shopping list. */
export const MAX_TURN_SERVERS = 4;

function isTurnUrl(url: string): boolean {
  return url.startsWith("turn:") || url.startsWith("turns:");
}

function cleanUrls(raw: unknown): string[] {
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const url = entry.trim();
    if (url && isTurnUrl(url) && !out.includes(url)) out.push(url);
  }
  return out;
}

/** One raw config entry → a usable TURN server, or null when the
 *  entry is not honestly usable (no turn:/turns: URL, or a username
 *  without its credential / vice versa). */
export function sanitizeTurnServer(raw: unknown): IceServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const urls = cleanUrls(rec["urls"]);
  if (urls.length === 0) return null;
  const username = typeof rec["username"] === "string" ? rec["username"].trim() : "";
  const credential = typeof rec["credential"] === "string" ? rec["credential"] : "";
  const server: IceServerConfig = { urls: urls.length === 1 ? urls[0]! : urls };
  // A credential pair is all-or-nothing.
  if (username && credential) {
    server.username = username;
    server.credential = credential;
  } else if (username || credential) {
    return null;
  }
  return server;
}

/** The shape the config endpoint serves (and tests feed directly):
 *  `{ turnServers?: unknown[] }` — everything else is ignored. */
export interface VoiceIceConfig {
  turnServers?: unknown;
}

/** Build the RTCPeerConnection iceServers list from a config answer.
 *  STUN is always first and always present — TURN is a relay ADDED
 *  to today's behaviour, never a replacement that could strand the
 *  networks that already work. Garbage in → STUN-only out. */
export function buildIceServers(config?: VoiceIceConfig | null): IceServerConfig[] {
  const servers: IceServerConfig[] = [{ urls: DEFAULT_STUN_URL }];
  const rawList = Array.isArray(config?.turnServers) ? config.turnServers : [];
  for (const raw of rawList) {
    if (servers.length - 1 >= MAX_TURN_SERVERS) break;
    const turn = sanitizeTurnServer(raw);
    if (turn) servers.push(turn);
  }
  return servers;
}

/** True when a built list carries a relay (the UI/evaluation can say
 *  so honestly instead of guessing from the config shape). */
export function hasTurnRelay(iceServers: readonly IceServerConfig[]): boolean {
  return iceServers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => isTurnUrl(u));
  });
}

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Ask the sanctioned endpoint for this session's ICE servers.
 *  Fail-open to the STUN default on ANY problem (offline, 401, bad
 *  JSON) — a config hiccup must never cost a member the voice that
 *  works today. The access token rides the same Authorization header
 *  the rest of the World page uses; guests never call this (guests
 *  have no voice). */
export async function fetchVoiceIceServers(
  fetchFn: FetchLike,
  accessToken: string | null,
): Promise<IceServerConfig[]> {
  try {
    const res = await fetchFn("/api/world/voice-config", {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (!res.ok) return buildIceServers(null);
    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== "object") return buildIceServers(null);
    return buildIceServers(body as VoiceIceConfig);
  } catch {
    return buildIceServers(null);
  }
}
