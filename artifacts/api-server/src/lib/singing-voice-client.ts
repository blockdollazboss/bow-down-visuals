/**
 * singing-voice-client.ts — singing-voice conversion provider abstraction.
 *
 * Shaped for a Jammable-style singing conversion API: upload a vocal (or a
 * finished song), pick a singing voice model, get back the vocal converted
 * into that voice's singing timbre.
 *
 * No provider key is configured yet — every live call path is gated behind
 * singingVoiceConfigured() and throws SingingVoiceNotConfiguredError.
 *
 * Env:
 *   SINGING_VOICE_API_KEY — singing conversion provider API key
 *   SINGING_VOICE_API_URL — optional override for the provider base URL
 *
 * DO NOT make live provider calls until a key is provisioned and the user
 * has approved the provider + pricing.
 */

/** True only when a provider key is configured. The UI gates on this. */
export function singingVoiceConfigured(): boolean {
  return !!process.env["SINGING_VOICE_API_KEY"];
}

export class SingingVoiceNotConfiguredError extends Error {
  readonly code = "SINGING_VOICE_NOT_CONFIGURED";
  constructor() {
    super(
      "Singing-voice conversion is not connected yet — no SINGING_VOICE_API_KEY is configured on the server. " +
        "Add the provider key to enable AI singing voices.",
    );
    this.name = "SingingVoiceNotConfiguredError";
  }
}

function requireConfigured(): void {
  if (!singingVoiceConfigured()) throw new SingingVoiceNotConfiguredError();
}

export interface SingingVoice {
  id: string;
  name: string;
  /** e.g. "Soulful R&B", "Raspy rock", "Smooth Afrobeats". */
  style: string;
  /** Provider-side model id, filled in once the provider is wired. */
  providerVoiceId: string | null;
}

/**
 * Placeholder singing-voice catalog. UI samples so the voice picker has
 * real shape before a provider is connected — providerVoiceId is null
 * until the catalog is synced from the provider.
 */
export const SINGING_VOICE_PLACEHOLDER_CATALOG: SingingVoice[] = [
  { id: "sing-soul", name: "Velvet Soul", style: "Smooth R&B vocal", providerVoiceId: null },
  { id: "sing-rasp", name: "Gravel Road", style: "Raspy rock vocal", providerVoiceId: null },
  { id: "sing-afro", name: "Lagos Nights", style: "Afrobeats vocal", providerVoiceId: null },
  { id: "sing-pop", name: "Neon Pop", style: "Bright pop vocal", providerVoiceId: null },
  { id: "sing-gospel", name: "Sunday Choir", style: "Powerful gospel vocal", providerVoiceId: null },
];

export interface SingingConversionRequest {
  /** Catalog voice id (see SINGING_VOICE_PLACEHOLDER_CATALOG). */
  voiceId: string;
  /** Public URL of the source audio (song or isolated vocal). */
  sourceAudioUrl: string;
  /** 0-100: how strongly the target timbre replaces the source. */
  strength?: number;
  /** Keep the original backing track under the converted vocal. */
  keepInstrumental?: boolean;
  userId: string;
}

export interface SingingConversionResult {
  providerJobId: string;
  status: "queued" | "processing" | "done" | "failed";
  audioUrl?: string;
}

/**
 * Submits a singing-voice conversion to the configured provider.
 * NOT IMPLEMENTED — throws SingingVoiceNotConfiguredError until a key
 * exists, and throws "not implemented" once configured until the provider
 * call is written (requires user approval of provider + pricing first).
 */
export async function submitSingingConversion(_req: SingingConversionRequest): Promise<SingingConversionResult> {
  requireConfigured();
  // Provider call deliberately not implemented: no approved pricing yet.
  throw new Error(
    "Singing-voice provider is configured but the live conversion call is not implemented yet — " +
      "needs provider + pricing approval before any paid conversion runs.",
  );
}
