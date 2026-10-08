import { useCallback, useEffect, useState } from "react";
import { Share2, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Community UI shared kit (Worker 9: groups / events / DMs / explore) ──
   Gold/black luxury, cheat-code voice. Link-graph helpers keep every
   surface wired: profiles -> /creator/:slug, groups -> /groups/:slug,
   events -> /events/:id. Every card shareable with ?ref=CODE.
   Difficulty ladder (Creator Level): data-min-stars="4" on moderation +
   analytics, "5" on broadcast. Join / RSVP / chat are NEVER gated. */

export const profileLink = (slug: string) => `/creator/${slug}`;

export function timeAgo(iso: string | Date | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* Bound API caller (auth header attached when signed in). */
export function useCommunityApi() {
  const { getAccessToken } = useAuth();
  const call = useCallback(
    async (path: string, opts: { method?: string; body?: unknown } = {}) => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        method: opts.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something glitched — try again.");
      return data;
    },
    [getAccessToken],
  );
  return {
    get: useCallback((p: string) => call(p), [call]),
    post: useCallback((p: string, body?: unknown) => call(p, { method: "POST", body: body ?? {} }), [call]),
    del: useCallback((p: string) => call(p, { method: "DELETE" }), [call]),
  };
}

/* Share button: copies a ?ref=CODE link (referral loop). */
export function ShareButton({ path, label = "Share" }: { path: string; label?: string }) {
  const api = useCommunityApi();
  const [code, setCode] = useState<string>("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.get("/api/referrals/me").then(
      (d) => setCode(String((d as { code?: string }).code ?? "")),
      () => setCode(""),
    );
  }, [api]);
  const url = `${window.location.origin}${path}${code ? `?ref=${encodeURIComponent(code)}` : ""}`;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy your link:", url);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#e8c86a]/30 bg-[#e8c86a]/10 px-3 py-1.5 text-xs font-semibold text-[#e8c86a] hover:bg-[#e8c86a]/20 transition"
      title="Copy a shareable link (your referral code rides along)"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

/* Live countdown to a future date. */
export function Countdown({ to, className = "" }: { to: string | Date; className?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cell = (v: number, label: string) => (
    <span className="flex flex-col items-center rounded-lg border border-[#e8c86a]/25 bg-black/60 px-3 py-2 min-w-[64px]">
      <span className="text-2xl font-bold text-[#e8c86a] tabular-nums">{String(v).padStart(2, "0")}</span>
      <span className="text-[10px] uppercase tracking-wider text-white/50">{label}</span>
    </span>
  );
  if (ms === 0) return <span className={`text-[#e8c86a] font-semibold ${className}`}>Live now 🦈</span>;
  return (
    <div className={`flex gap-2 ${className}`}>
      {cell(d, "days")}{cell(h, "hrs")}{cell(m, "min")}{cell(s, "sec")}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-white/60">
      <Loader2 className="h-5 w-5 animate-spin text-[#e8c86a]" /> {label}…
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-center">
      <p className="text-red-200">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-full bg-[#e8c86a] px-4 py-1.5 text-sm font-bold text-black hover:bg-[#f5d67e]"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export const goldInput =
  "w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#e8c86a]/60 focus:outline-none";

export const goldButton =
  "rounded-full bg-[#e8c86a] px-5 py-2 text-sm font-bold text-black hover:bg-[#f5d67e] transition disabled:opacity-50";

export const ghostButton =
  "rounded-full border border-white/20 px-4 py-1.5 text-sm text-white/80 hover:border-[#e8c86a]/50 hover:text-[#e8c86a] transition";
