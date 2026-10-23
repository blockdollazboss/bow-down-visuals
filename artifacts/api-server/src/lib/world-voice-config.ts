/**
 * world-voice-config.ts — the server half of the World voice ICE
 * config seam (Open World item 100).
 *
 * The World's proximity voice mesh is STUN-only by default, so peers
 * behind symmetric NAT / strict firewalls silently never connect.
 * A TURN relay fixes that, but standing one up (a coturn instance
 * or a metered TURN service) is the owner's infra/money call — this
 * module is only the sanctioned place its coordinates enter the
 * system:
 *
 *   WORLD_TURN_URLS        comma-separated turn:/turns: URLs
 *   WORLD_TURN_USERNAME    the relay username
 *   WORLD_TURN_CREDENTIAL  the relay credential
 *
 * All three live ONLY in server env. The route serves the built
 * config to signed-in members (voice is members-only; guests never
 * see it), and the client consumes it via lib/world/voice-ice.
 * Fail-closed and all-or-nothing: URLs without BOTH credential
 * halves (or credentials without a valid turn: URL) serve NO relay
 * at all — a half-configured relay would fail silently per-pair,
 * which is the exact failure mode item 100 exists to end.
 *
 * Pure (env is passed in), so the whole contract is unit-tested.
 */

export interface WorldVoiceConfigDto {
  /** TURN relay servers for the mesh; empty until the owner stands
   *  a relay up and sets the env above. STUN is the client's own
   *  built-in default and is deliberately not served from here. */
  turnServers: Array<{ urls: string | string[]; username: string; credential: string }>;
}

type EnvLike = Record<string, string | undefined>;

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
 *  → an honest empty relay list, never a partial one. */
export function buildWorldVoiceConfig(env: EnvLike): WorldVoiceConfigDto {
  const urls = cleanTurnUrls(env["WORLD_TURN_URLS"]);
  const username = (env["WORLD_TURN_USERNAME"] ?? "").trim();
  const credential = env["WORLD_TURN_CREDENTIAL"] ?? "";
  if (urls.length === 0 || !username || !credential) {
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
