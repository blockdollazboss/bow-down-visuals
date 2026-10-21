/**
 * guest-api.ts — the REST surface for Go Live guest invites +
 * backstage (routes/live-guests.ts), typed for the two callers: the
 * host's GuestPanel (session-token auth) and the guest page
 * (invite token → guest session token in the x-guest-token header).
 * Errors carry the server's honest message verbatim.
 */
export interface GuestInviteDto {
  id: string;
  stream_id: string;
  label: string | null;
  token_hint: string;
  expires_at: string | null;
  max_joins: number | null;
  join_count: number;
  revoked_at: string | null;
  created_at: string | null;
}

export interface GuestSessionDto {
  id: string;
  stream_id: string;
  invite_id: string;
  display_name: string;
  kind: "guest";
  guest: true;
  state: string;
  joined_at: string | null;
  last_seen_at: string | null;
  ended_at: string | null;
}

export interface BackstageMessageDto {
  id: string;
  stream_id: string;
  author_kind: string;
  guest: boolean;
  guest_session_id: string | null;
  author_name: string;
  body: string;
  created_at: string | null;
}

export interface HostCardDto {
  display_name: string;
  slug: string | null;
  avatar_url: string | null;
}

export class GuestApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(
  path: string,
  opts: { method?: string; body?: unknown; authToken?: string | null; guestToken?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.authToken) headers["Authorization"] = `Bearer ${opts.authToken}`;
  if (opts.guestToken) headers["x-guest-token"] = opts.guestToken;
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new GuestApiError(res.status, json?.error ?? "Something went wrong. Try again.");
  }
  return json as T;
}

/* ── Host doors (session token) ──────────────────────────────────── */

export async function mintGuestInvite(
  streamId: string,
  authToken: string,
  body: { label?: string; expires_in_minutes?: number; max_joins?: number },
): Promise<{ invite: GuestInviteDto; token: string; invite_path: string }> {
  return call(`/api/live-streams/${streamId}/guest-invites`, { method: "POST", authToken, body });
}

export async function listGuestInvites(
  streamId: string,
  authToken: string,
): Promise<{ invites: GuestInviteDto[]; guests: GuestSessionDto[] }> {
  return call(`/api/live-streams/${streamId}/guest-invites`, { authToken });
}

export async function revokeGuestInvite(
  streamId: string,
  inviteId: string,
  authToken: string,
): Promise<{ ok: true; sessions_ended: number }> {
  return call(`/api/live-streams/${streamId}/guest-invites/${inviteId}`, { method: "DELETE", authToken });
}

export async function promoteGuest(streamId: string, sessionId: string, authToken: string): Promise<{ guest: GuestSessionDto }> {
  return call(`/api/live-streams/${streamId}/guests/${sessionId}/promote`, { method: "POST", authToken });
}

export async function demoteGuest(streamId: string, sessionId: string, authToken: string): Promise<{ guest: GuestSessionDto }> {
  return call(`/api/live-streams/${streamId}/guests/${sessionId}/demote`, { method: "POST", authToken });
}

export async function removeGuest(streamId: string, sessionId: string, authToken: string): Promise<{ ok: true }> {
  return call(`/api/live-streams/${streamId}/guests/${sessionId}/remove`, { method: "POST", authToken });
}

export async function hostBackstageHistory(streamId: string, authToken: string): Promise<{ messages: BackstageMessageDto[] }> {
  return call(`/api/live-streams/${streamId}/backstage/messages`, { authToken });
}

export async function hostBackstagePost(
  streamId: string,
  authToken: string,
  body: string,
): Promise<{ message: BackstageMessageDto }> {
  return call(`/api/live-streams/${streamId}/backstage/messages`, { method: "POST", authToken, body: { body } });
}

/* ── Public door ─────────────────────────────────────────────────── */

export async function publicOnStageGuests(
  streamId: string,
): Promise<{ on_stage: Array<{ display_name: string; kind: "guest"; guest: true }> }> {
  return call(`/api/live-streams/${streamId}/guests`);
}

/* ── Guest doors (invite token, then guest session token) ────────── */

export interface InviteInfoDto {
  invite: { label: string | null; expires_at: string | null };
  stream: { id: string; title: string; status: string; watch_path: string };
  host: HostCardDto;
}

export async function readInvite(token: string): Promise<InviteInfoDto> {
  return call(`/api/live-guest-invites/${encodeURIComponent(token)}`);
}

export async function joinAsGuest(
  token: string,
  displayName: string,
): Promise<{
  session_token: string;
  session: GuestSessionDto;
  stream: { id: string; title: string; status: string; watch_path: string };
  host: HostCardDto;
}> {
  return call(`/api/live-guest-invites/${encodeURIComponent(token)}/join`, {
    method: "POST",
    body: { display_name: displayName },
  });
}

export async function guestSession(guestToken: string): Promise<{
  session: GuestSessionDto;
  stream: { id: string; title: string; status: string; watch_path: string };
  host: HostCardDto;
  peers: unknown[];
}> {
  return call(`/api/live-guest/session`, { guestToken });
}

export async function guestHeartbeat(guestToken: string): Promise<{ ok: true; state: string; stream_status: string }> {
  return call(`/api/live-guest/session/heartbeat`, { method: "POST", guestToken });
}

export async function guestLeave(guestToken: string): Promise<{ ok: true }> {
  return call(`/api/live-guest/session/leave`, { method: "POST", guestToken });
}

export async function guestBackstageHistory(guestToken: string): Promise<{ messages: BackstageMessageDto[] }> {
  return call(`/api/live-guest/session/backstage/messages`, { guestToken });
}

export async function guestBackstagePost(guestToken: string, body: string): Promise<{ message: BackstageMessageDto }> {
  return call(`/api/live-guest/session/backstage/messages`, { method: "POST", guestToken, body: { body } });
}
