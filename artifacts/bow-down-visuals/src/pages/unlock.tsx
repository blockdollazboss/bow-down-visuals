import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { CheckCircle2, Loader2, Lock, Share2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";

/* Public unlock-gate page (/unlock/:slug). The gate's content link is
   never in this page's data — it arrives only after the server verifies
   the fan's follow (real follows graph) or recorded share. */

interface GateInfo { slug: string; title: string; action: "follow" | "share"; contentLabel: string; active: boolean }

export default function UnlockGatePage() {
  usePageTitle("Unlock", "Unlock exclusive content on Bow Down Visuals.");
  const { user, getAccessToken } = useAuth();
  const [, params] = useRoute("/unlock/:slug");
  const slug = params?.slug ?? "";
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "working" | "unlocked" | "locked">("idle");
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/promote/unlock-gates/${encodeURIComponent(slug)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.gate) throw new Error(json.error || "This unlock link doesn't exist.");
        setGate(json.gate);
      } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load this gate."); }
    })();
  }, [slug]);

  async function tryUnlock() {
    if (!user) { window.location.href = `/login?next=${encodeURIComponent(`/unlock/${slug}`)}`; return; }
    setState("working"); setMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/promote/unlock-gates/${encodeURIComponent(slug)}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.unlocked) { setState("unlocked"); setContentUrl(json.contentUrl); return; }
      setState("locked");
      setMsg(json.message || "Not unlocked yet — complete the step first, then try again.");
    } catch { setState("locked"); setMsg("Couldn't check the unlock — try again."); }
  }

  async function doShare() {
    if (!user) { window.location.href = `/login?next=${encodeURIComponent(`/unlock/${slug}`)}`; return; }
    const url = window.location.href;
    const canShare = typeof navigator !== "undefined" && "share" in navigator;
    try {
      if (canShare) await navigator.share({ title: gate?.title ?? "Exclusive", url });
      else await navigator.clipboard.writeText(url);
    } catch { /* dismissed — the share still needs recording below */ }
    try {
      const token = await getAccessToken();
      await fetch(`/api/promote/unlock-gates/${encodeURIComponent(slug)}/record-share`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ channel: canShare ? "native" : "copy" }),
      });
      setMsg("Share recorded on your account — now unlock it.");
    } catch { setMsg("Couldn't record your share — try again."); }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-xl px-5 pb-24 pt-16">
        <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-8 text-center md:p-12">
          {error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : !gate ? (
            <p className="text-sm text-white/40"><Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />Loading…</p>
          ) : (
            <>
              <Lock className="mx-auto h-10 w-10 text-primary" />
              <h1 className="mt-4 font-display text-2xl font-black">{gate.title}</h1>
              <p className="mt-2 text-sm text-white/55">
                {gate.action === "follow"
                  ? "Follow the artist on Bow Down Visuals to unlock this. We check your real follow — no honor system."
                  : "Share this page to unlock. Your share is recorded on your account first — that's what opens the gate."}
              </p>
              {gate.action === "share" && state !== "unlocked" && (
                <button onClick={doShare} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-primary">
                  <Share2 className="h-4 w-4" /> Share this page
                </button>
              )}
              {state === "unlocked" && contentUrl ? (
                <a href={contentUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110">
                  <CheckCircle2 className="h-4 w-4" /> {gate.contentLabel || "Open your unlock"}
                </a>
              ) : (
                <button onClick={tryUnlock} disabled={state === "working"} className="ml-2 mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60">
                  {state === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  {user ? "Unlock it" : "Sign in to unlock"}
                </button>
              )}
              {msg && <p className={`mt-3 text-xs ${state === "locked" ? "text-amber-300" : "text-emerald-300"}`}>{msg}</p>}
              <p className="mt-6 text-xs text-white/30">Made with Bow Down Visuals</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
