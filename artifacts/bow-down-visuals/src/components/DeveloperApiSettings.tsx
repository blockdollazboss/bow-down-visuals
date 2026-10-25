import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, Copy, Check, Trash2, AlertTriangle, BookOpen, Webhook, Pause, Play, History } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* Developer door (Stack-100 #3, feature #9 — Public Creator API).
   Docked in Settings, never a standalone page. A signed-in creator can
   create scoped API keys, see the plaintext EXACTLY ONCE, and revoke a
   key instantly. The server stores only a hash of each key — this UI
   never receives a key back after creation, by design.

   v1 surface (honest subset, mirrored in the docs section below):
     GET  /api/v1/me, GET /api/v1/content, GET /api/v1/balance,
     POST /api/v1/generate/bio (charged — same 50 Visual Bucs the
     website's Bio Generator charges, from the same price constant).
   Everything else is NOT exposed yet, and says so below. */

interface ApiKeyPublic {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const SCOPE_LABELS: Record<string, string> = {
  "profile:read": "Read my profile",
  "content:read": "Read my content list",
  "earnings:read": "Read my balance & earnings",
  "generate:bio": "Generate bios (charged, 100 VB each)",
};

export function DeveloperApiSettings() {
  const isLight = useIsLightTheme();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyPublic[] | null>(null);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
  /* 503 api_keys_not_ready (the api_keys table isn't on this database
     in the shape the code reads yet — migration 0241) is an honest
     "isn't switched on yet" state, rendered plainly instead of the
     error line. */
  const [unavailable, setUnavailable] = useState(false);
  const loadedRef = useRef(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(["profile:read"]);
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function load() {
    try {
      const res = await fetch("/api/api-keys", { headers: await authHeaders() });
      if (res.status === 503) {
        setUnavailable(true);
        setLoadError(false);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { keys: ApiKeyPublic[]; availableScopes: string[] };
      setKeys(data.keys);
      setAvailableScopes(data.availableScopes);
      loadedRef.current = true;
      setLoadError(false);
      setUnavailable(false);
    } catch {
      if (!loadedRef.current) setLoadError(true);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createKey() {
    if (!name.trim() || picked.length === 0 || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ name: name.trim(), scopes: picked }),
      });
      if (!res.ok) throw new Error("create failed");
      const data = (await res.json()) as { plaintext: string };
      setFreshKey(data.plaintext);
      setCopied(false);
      setName("");
      await load();
    } catch {
      toast({ title: "Couldn't create the key", description: "Please try again.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error("revoke failed");
      toast({ title: "Key revoked", description: "It stops working immediately." });
      await load();
    } catch {
      toast({ title: "Couldn't revoke that key", description: "Please try again.", variant: "destructive" });
    } finally {
      setRevoking(null);
    }
  }

  const sub = isLight ? "text-[#6B5B36]" : "text-white/50";
  const card = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";

  return (
    <section className={`rounded-2xl border p-5 md:p-6 ${card}`} data-testid="developer-api-settings">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
          <KeyRound className="h-4 w-4 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-bold">Developer — API Keys</h2>
          <p className={`text-xs ${sub}`}>
            Build on Bow Down with your own tools and agents. Keys act as you, only with the scopes you pick.
          </p>
        </div>
      </div>

      {unavailable ? (
        <p className="mt-5 flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          API keys aren't switched on for this site yet — check back soon.
        </p>
      ) : loadError ? (
        <div className="mt-5 flex items-center gap-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <span>Couldn't load your API keys.</span>
          <button type="button" onClick={() => { void load(); }} className="font-semibold text-primary underline">Retry</button>
        </div>
      ) : keys === null ? (
        <div className="mt-5 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-5 space-y-6">
          {freshKey && (
            <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-4">
              <p className="text-sm font-bold text-amber-300">Copy this key now — it is shown only once.</p>
              <p className={`mt-1 text-xs ${sub}`}>We store only a scrambled hash of it, so nobody — including us — can show it to you again. Lose it and you'll need to make a new one.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="break-all rounded-lg bg-black/60 px-3 py-2 text-xs text-amber-200">{freshKey}</code>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(freshKey).then(() => setCopied(true)); }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400/10"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button type="button" onClick={() => setFreshKey(null)} className="text-xs font-semibold underline">Done, hide it</button>
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-bold">Create a key</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Key name — e.g. My agent"
                maxLength={60}
                className="w-64 rounded-xl bg-black/50 border border-white/15 px-3 py-2 text-sm text-white outline-none focus:border-primary placeholder:text-white/25"
              />
              <button
                type="button"
                onClick={() => { void createKey(); }}
                disabled={!name.trim() || picked.length === 0 || creating}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Create key
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {availableScopes.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.includes(s)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s] : p.filter((x) => x !== s)))}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span>{SCOPE_LABELS[s] ?? s}</span>
                  <code className={`text-[11px] ${sub}`}>{s}</code>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-bold">Your keys</p>
            {keys.length === 0 ? (
              <p className={`mt-1 text-xs ${sub}`}>No keys yet. Create one above to start building.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{k.name} <code className={`ml-1 text-[11px] ${sub}`}>{k.keyPrefix}…</code></p>
                      <p className={`text-[11px] ${sub}`}>
                        {k.scopes.join(", ")} · created {new Date(k.createdAt).toLocaleDateString()}
                        {k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : " · never used"}
                        {k.revokedAt ? " · REVOKED" : ""}
                      </p>
                    </div>
                    {!k.revokedAt && (
                      <button
                        type="button"
                        onClick={() => { void revoke(k.id); }}
                        disabled={revoking === k.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                      >
                        {revoking === k.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <p className="text-sm font-bold">Quick docs — API v1</p>
            </div>
            <div className={`mt-2 space-y-2 text-xs leading-relaxed ${isLight ? "text-[#55471f]" : "text-white/65"}`}>
              <p>Base path: <code>/api/v1</code> · Auth header on every call: <code>Authorization: Bearer bdv_live_…</code></p>
              <p><code>GET /api/v1/me</code> (profile:read) — your profile.<br />
                 <code>GET /api/v1/content</code> (content:read) — your recent generations.<br />
                 <code>GET /api/v1/balance</code> (earnings:read) — your Visual Bucs balance, earnings summary, lifetime spend.<br />
                 <code>POST /api/v1/generate/bio</code> (generate:bio) — body: {"{ niche, personality[], achievements?[], cta?, handle? }"}. Costs <strong>50 Visual Bucs</strong> — the same price as the website's Bio Generator — charged only when the generation succeeds; failures are refunded. Send an <code>Idempotency-Key</code> header to make retries safe.</p>
              <p>Errors come back as <code>{"{ error, message }"}</code>: 401 invalid_api_key (missing, unknown, or revoked key), 403 insufficient_scope, 402 out_of_credits, 429 rate_limited, 400 invalid_request.</p>
              <p><strong>Not in v1:</strong> songs, music videos, video generation/editing, lip-sync, image generation, publishing/social posting, the store, payouts, and anything admin. Keys can only ever act as you — never as anyone else.</p>
            </div>
          </div>

          <WebhooksSettings getAccessToken={getAccessToken} sub={sub} isLight={isLight} />
        </div>
      )}
    </section>
  );
}

/* ─── Webhooks (Stack-100 #3 wave 3, lane 20) ────────────────────────────
   Docked INSIDE the Developer door — never a standalone page. Register an
   https endpoint for new-sale / new-follower / new-member, get a signing
   secret shown exactly once (we store only its hash), pause/resume,
   delete, and read the per-attempt delivery history. This section loads
   independently: if webhooks aren't available yet it says so plainly
   instead of taking the keys UI down with it. */

interface WebhookPublic {
  id: string;
  url: string;
  events: string[];
  secretPrefix: string;
  status: string;
  consecutiveFailures: number;
  createdAt: string;
  disabledAt: string | null;
}

interface WebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  attempt: number;
  status: string;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  "new-sale": "New sale — a store order completes",
  "new-follower": "New follower — someone follows your profile",
  "new-member": "New member — a fan joins one of your membership tiers",
};

function WebhooksSettings({
  getAccessToken,
  sub,
  isLight,
}: {
  getAccessToken: () => Promise<string | null>;
  sub: string;
  isLight: boolean;
}) {
  const { toast } = useToast();
  const [hooks, setHooks] = useState<WebhookPublic[] | null>(null);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [url, setUrl] = useState("");
  const [pickedEvents, setPickedEvents] = useState<string[]>(["new-sale"]);
  const [creatingHook, setCreatingHook] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadHooks() {
    try {
      const res = await fetch("/api/api-webhooks", { headers: await authHeaders() });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { webhooks: WebhookPublic[]; availableEventTypes: string[] };
      setHooks(data.webhooks);
      setEventTypes(data.availableEventTypes);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }

  useEffect(() => { void loadHooks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createHook() {
    if (!url.trim() || pickedEvents.length === 0 || creatingHook) return;
    setCreatingHook(true);
    try {
      const res = await fetch("/api/api-webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ url: url.trim(), events: pickedEvents }),
      });
      const data = (await res.json().catch(() => ({}))) as { secret?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? "create failed");
      setFreshSecret(data.secret ?? null);
      setSecretCopied(false);
      setUrl("");
      await loadHooks();
    } catch (err) {
      toast({ title: "Couldn't create the webhook", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setCreatingHook(false);
    }
  }

  async function setStatus(id: string, status: "paused" | "active") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/api-webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("update failed");
      await loadHooks();
    } catch {
      toast({ title: "Couldn't update that webhook", description: "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function removeHook(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/api-webhooks/${id}`, { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error("delete failed");
      if (historyFor === id) setHistoryFor(null);
      await loadHooks();
    } catch {
      toast({ title: "Couldn't delete that webhook", description: "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleHistory(id: string) {
    if (historyFor === id) {
      setHistoryFor(null);
      return;
    }
    setHistoryFor(id);
    setDeliveries(null);
    try {
      const res = await fetch(`/api/api-webhooks/${id}/deliveries`, { headers: await authHeaders() });
      if (!res.ok) throw new Error("history failed");
      const data = (await res.json()) as { deliveries: WebhookDelivery[] };
      setDeliveries(data.deliveries);
    } catch {
      setDeliveries([]);
    }
  }

  return (
    <div className="border-t border-white/10 pt-6">
      <div className="flex items-center gap-2">
        <Webhook className="h-4 w-4 text-primary" />
        <p className="text-sm font-bold">Webhooks</p>
      </div>
      <p className={`mt-1 text-xs ${sub}`}>
        We POST a signed JSON event to your endpoint when a sale, follow, or membership happens for you — and only for you.
        Failed deliveries retry 5 times (30s, 5 min, 30 min, 2 hrs); an endpoint that keeps failing is switched off automatically.
      </p>

      {unavailable ? (
        <p className="mt-3 flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          Webhooks aren't switched on yet — check back soon.
        </p>
      ) : hooks === null ? (
        <div className="mt-3 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-4 space-y-5">
          {freshSecret && (
            <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-4">
              <p className="text-sm font-bold text-amber-300">Copy this signing secret now — it is shown only once.</p>
              <p className={`mt-1 text-xs ${sub}`}>We store only a scrambled hash of it. Use it to verify that deliveries really came from us (recipe below). Lose it and you'll need to delete the endpoint and make a new one.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="break-all rounded-lg bg-black/60 px-3 py-2 text-xs text-amber-200">{freshSecret}</code>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(freshSecret).then(() => setSecretCopied(true)); }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400/10"
                >
                  {secretCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {secretCopied ? "Copied" : "Copy"}
                </button>
                <button type="button" onClick={() => setFreshSecret(null)} className="text-xs font-semibold underline">Done, hide it</button>
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-bold">Register an endpoint</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-server.example/webhooks/bowdown"
                maxLength={2048}
                className="w-full max-w-md rounded-xl bg-black/50 border border-white/15 px-3 py-2 text-sm text-white outline-none focus:border-primary placeholder:text-white/25"
              />
              <button
                type="button"
                onClick={() => { void createHook(); }}
                disabled={!url.trim() || pickedEvents.length === 0 || creatingHook}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {creatingHook ? <Loader2 className="h-4 w-4 animate-spin" /> : <Webhook className="h-4 w-4" />}
                Add webhook
              </button>
            </div>
            <p className={`mt-1 text-[11px] ${sub}`}>https only — the address must resolve to a public server (private / local addresses are rejected).</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {eventTypes.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={pickedEvents.includes(t)}
                    onChange={(e) => setPickedEvents((p) => (e.target.checked ? [...p, t] : p.filter((x) => x !== t)))}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span>{EVENT_LABELS[t] ?? t}</span>
                  <code className={`text-[11px] ${sub}`}>{t}</code>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-bold">Your endpoints</p>
            {hooks.length === 0 ? (
              <p className={`mt-1 text-xs ${sub}`}>No endpoints yet. Register one above to start receiving events.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {hooks.map((h) => (
                  <li key={h.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{h.url}</p>
                        <p className={`text-[11px] ${sub}`}>
                          {h.events.join(", ")} · secret {h.secretPrefix}… · created {new Date(h.createdAt).toLocaleDateString()}
                          {" · "}<strong>{h.status}</strong>
                          {h.consecutiveFailures > 0 ? ` · ${h.consecutiveFailures} failed deliver${h.consecutiveFailures === 1 ? "y" : "ies"} in a row` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => { void toggleHistory(h.id); }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/5"
                        >
                          <History className="h-3.5 w-3.5" /> Deliveries
                        </button>
                        {h.status === "active" ? (
                          <button
                            type="button"
                            onClick={() => { void setStatus(h.id, "paused"); }}
                            disabled={busyId === h.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/5 disabled:opacity-40"
                          >
                            <Pause className="h-3.5 w-3.5" /> Pause
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { void setStatus(h.id, "active"); }}
                            disabled={busyId === h.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-40"
                          >
                            <Play className="h-3.5 w-3.5" /> {h.status === "disabled" ? "Re-enable" : "Resume"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { void removeHook(h.id); }}
                          disabled={busyId === h.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                        >
                          {busyId === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Delete
                        </button>
                      </div>
                    </div>
                    {historyFor === h.id && (
                      <div className="mt-3 border-t border-white/10 pt-2">
                        {deliveries === null ? (
                          <p className={`flex items-center gap-2 text-xs ${sub}`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading deliveries…</p>
                        ) : deliveries.length === 0 ? (
                          <p className={`text-xs ${sub}`}>No deliveries yet for this endpoint.</p>
                        ) : (
                          <ul className="space-y-1">
                            {deliveries.map((d) => (
                              <li key={d.id} className={`text-[11px] ${sub}`}>
                                {new Date(d.createdAt).toLocaleString()} · {d.eventType} · attempt {d.attempt} ·{" "}
                                <strong>{d.status}</strong>
                                {d.responseStatus ? ` (HTTP ${d.responseStatus})` : ""}
                                {d.error ? ` · ${d.error}` : ""} · event {d.eventId.slice(0, 8)}…
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm font-bold">Verifying a delivery really came from us</p>
            <div className={`mt-2 space-y-2 text-xs leading-relaxed ${isLight ? "text-[#55471f]" : "text-white/65"}`}>
              <p>Every delivery is a POST with headers <code>X-BDV-Event-Id</code> (stable per event — dedupe retries on it), <code>X-BDV-Timestamp</code>, and <code>X-BDV-Signature: t=&lt;timestamp&gt;,v1=&lt;signature&gt;</code>. The body is <code>{"{ id, type, createdAt, data }"}</code>; sale amounts are integer cents, exactly as recorded.</p>
              <p>To verify: take the secret you were shown once, hash it — <code>key = SHA-256(secret)</code> as a hex string — then compute <code>HMAC-SHA256(key, timestamp + "." + rawBody)</code> and compare it (in constant time) with <code>v1</code>. Reject deliveries whose timestamp is more than 5 minutes from your clock.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
