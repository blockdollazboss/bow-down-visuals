import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, Copy, Check, Trash2, AlertTriangle, BookOpen } from "lucide-react";
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
  "generate:bio": "Generate bios (charged, 50 VB each)",
};

export function DeveloperApiSettings() {
  const isLight = useIsLightTheme();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyPublic[] | null>(null);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
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
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { keys: ApiKeyPublic[]; availableScopes: string[] };
      setKeys(data.keys);
      setAvailableScopes(data.availableScopes);
      loadedRef.current = true;
      setLoadError(false);
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

      {loadError ? (
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
        </div>
      )}
    </section>
  );
}
