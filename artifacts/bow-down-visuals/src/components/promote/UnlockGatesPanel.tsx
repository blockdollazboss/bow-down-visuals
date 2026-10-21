import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/* Stack 11 #8 — generalized social-unlock gates (Promote surface).
   The presave share-to-unlock mechanic, generalized: a creator gates any
   exclusive link behind a follow or a share. Verification is real — the
   server checks the follows graph or a recorded share by the signed-in
   fan — and the content link is never shown before the check passes. */

async function api(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.message || (json as any)?.error || "Something went wrong.");
  return json as any;
}

const card = "rounded-3xl border border-white/10 bg-white/[0.03] p-6";
const btn = "inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60";
const ghost = "inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-primary disabled:opacity-60";
const input = "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60";
const label = "text-[11px] font-bold uppercase tracking-widest text-white/40";

export function UnlockGatesPanel() {
  const { getAccessToken } = useAuth();
  const [gates, setGates] = useState<any[] | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [action, setAction] = useState<"follow" | "share">("follow");
  const [contentUrl, setContentUrl] = useState("");
  const [contentLabel, setContentLabel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await getAccessToken();
      const d = await api(t, "GET", "/api/promote/unlock-gates");
      setGates(d.gates ?? []);
      const meRes = await fetch("/api/creator-profiles/me", { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      if (meRes.ok) { const me = await meRes.json(); setProfileId(me?.id ?? me?.profile?.id ?? null); }
    } catch { setErr("Couldn't load your unlock gates."); setGates([]); }
  }, [getAccessToken]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setErr(null); setMsg(null);
    try {
      const t = await getAccessToken();
      const d = await api(t, "POST", "/api/promote/unlock-gates", {
        title, action, contentUrl, contentLabel,
        ...(action === "follow" && profileId ? { targetProfileId: profileId } : {}),
      });
      setTitle(""); setContentUrl(""); setContentLabel("");
      setMsg(`Gate live: ${d.gate.url} — fans unlock it by ${action === "follow" ? "following you (checked against your real follower graph)" : "sharing (recorded on their account first)"}.`);
      void load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't create the gate."); }
  }
  async function deactivate(id: string) {
    try { const t = await getAccessToken(); await api(t, "DELETE", `/api/promote/unlock-gates/${id}`); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't deactivate the gate."); }
  }

  return (
    <section className={card}>
      <h3 className="text-lg font-black text-white">Unlock gates — follow or share to unlock</h3>
      <p className="mt-1 text-sm text-white/55">
        Put an exclusive track, video, or link behind a follow or a share. The unlock is verified, not
        honor-system: a follow gate checks the fan&apos;s real follow on your page, a share gate checks a share
        recorded on the fan&apos;s account — and the content link stays hidden until the check passes.
      </p>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-300">{msg}</p>}
      <div className="mt-4 grid gap-3">
        <div><p className={label}>What fans unlock</p><input className={input + " mt-1"} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Exclusive demo, unreleased video…" /></div>
        <div className="flex gap-2">
          <button type="button" className={action === "follow" ? btn : ghost} onClick={() => setAction("follow")}>Follow to unlock</button>
          <button type="button" className={action === "share" ? btn : ghost} onClick={() => setAction("share")}>Share to unlock</button>
        </div>
        {action === "follow" && !profileId && <p className="text-xs text-amber-300">Follow gates need your creator page — create your profile first, then the gate can check real follows.</p>}
        <div><p className={label}>Content link (hidden until unlocked)</p><input className={input + " mt-1"} value={contentUrl} onChange={(e) => setContentUrl(e.target.value)} placeholder="https://…" /></div>
        <div><p className={label}>Content label (optional)</p><input className={input + " mt-1"} value={contentLabel} onChange={(e) => setContentLabel(e.target.value)} placeholder="Unreleased track" /></div>
        <div><button type="button" className={btn} onClick={create} disabled={!title.trim() || !contentUrl.trim() || (action === "follow" && !profileId)}>Create gate · free</button></div>
      </div>
      {gates && gates.length > 0 && (
        <ul className="mt-5 space-y-2 text-sm">
          {gates.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 p-3">
              <span className="text-white/80"><strong className="text-white">{g.title}</strong> — {g.action} gate · {g.unlockProofs} verified proofs · <span className="text-white/40">{g.active ? "live" : "off"}</span></span>
              <span className="flex gap-2">
                <a className={ghost} href={`/unlock/${g.slug}`} target="_blank" rel="noreferrer">Open gate page</a>
                {g.active && <button type="button" className={ghost} onClick={() => deactivate(g.id)}>Turn off</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {gates && gates.length === 0 && <p className="mt-3 text-sm text-white/40">No gates yet — your first exclusive unlock is a form away.</p>}
    </section>
  );
}
