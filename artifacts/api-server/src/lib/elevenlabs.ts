/**
 * elevenlabs.ts — shared ElevenLabs account helpers.
 *
 * Used to gate expensive work (e.g. Demucs stem isolation) behind the
 * account's actual capabilities, so a request that can never succeed fails
 * fast instead of burning server resources.
 */
const ELEVENLABS_API = "https://api.elevenlabs.io";
const SUBSCRIPTION_TIMEOUT_MS = 10_000;

interface SubscriptionResponse {
  can_use_instant_voice_cloning?: unknown;
  [key: string]: unknown;
}

/**
 * Returns true unless the ElevenLabs account explicitly lacks instant voice
 * cloning (`can_use_instant_voice_cloning === false` on
 * GET /v1/user/subscription).
 *
 * Fail-open by design: any check failure (network error, timeout, non-200,
 * unexpected shape) returns true, so a flaky account check never blocks
 * legitimate users. Callers that get `false` back have a definitive answer
 * and should reject the request before doing expensive work.
 */
export async function canUseInstantVoiceCloning(apiKey: string): Promise<boolean> {
  try {
    const r = await fetch(`${ELEVENLABS_API}/v1/user/subscription`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(SUBSCRIPTION_TIMEOUT_MS),
    });
    if (!r.ok) return true;
    const data = (await r.json()) as SubscriptionResponse;
    return data.can_use_instant_voice_cloning !== false;
  } catch {
    return true;
  }
}
