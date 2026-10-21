import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/* Stack 11 (in-house half) panels for the DISTRIBUTION surface — the
   standalone release flow only, never an editor. Every panel renders
   recorded data: a failed load says so, an empty state says it's empty. */

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

const card = "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6 md:p-8 text-white";
const btn = "inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60";
const ghost = "inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-primary disabled:opacity-60";
const input = "w-full rounded-xl border border-white/15 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-primary focus:outline-none";
const label = "text-[11px] font-bold uppercase tracking-widest text-white/40";
const money = (v: string) => `$${v}`;

/* ── #1 Landing content (smartlink) ──────────────────────────────────── */
export function LandingContentPanel({ releaseId }: { releaseId: string }) {
  const { getAccessToken } = useAuth();
  const [videoUrl, setVideoUrl] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await getAccessToken();
      const d = await api(t, "GET", `/api/distribution/releases/${releaseId}/landing-content`);
      setVideoUrl(d.landing.videoUrl ?? "");
      setStoreUrl(d.landing.storeUrl ?? "");
      setSocials(d.landing.socialLinks ?? {});
    } catch { setErr("Couldn't load the landing content."); }
  }, [getAccessToken, releaseId]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setErr(null); setMsg(null);
    try {
      const t = await getAccessToken();
      await api(t, "PUT", `/api/distribution/releases/${releaseId}/landing-content`, { videoUrl, storeUrl, socialLinks: socials });
      setMsg("Saved. Your release page keeps these links after release day — it becomes your release's home link.");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
  }
  const socialKeys = ["instagram", "tiktok", "youtube", "x", "website"];
  return (
    <section className={card}>
      <h3 className="text-lg font-black">Release page — stays live after release day</h3>
      <p className="mt-1 text-sm text-white/55">
        Your pre-save page doesn&apos;t expire at the countdown. On release day it flips to &ldquo;stream now&rdquo; and
        stays as the one link for this release: the music links, the video, your socials, and your store.
      </p>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-300">{msg}</p>}
      <div className="mt-4 grid gap-3">
        <div><p className={label}>Video link (music video, visualizer…)</p><input className={input + " mt-1"} value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…" /></div>
        <div><p className={label}>Store link (this release in your store)</p><input className={input + " mt-1"} value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://…" /></div>
        {socialKeys.map((k) => (
          <div key={k}><p className={label}>{k === "x" ? "X" : k[0]!.toUpperCase() + k.slice(1)}</p>
            <input className={input + " mt-1"} value={socials[k] ?? ""} onChange={(e) => setSocials({ ...socials, [k]: e.target.value })} placeholder="https://…" /></div>
        ))}
        <div><button type="button" className={btn} onClick={save}>Save landing content · free</button></div>
      </div>
    </section>
  );
}

/* ── #4a Lyrics package step ─────────────────────────────────────────── */
export function LyricsPackagePanel({ releaseId }: { releaseId: string }) {
  const { getAccessToken } = useAuth();
  const [lyrics, setLyrics] = useState("");
  const [timedText, setTimedText] = useState("");
  const [lrc, setLrc] = useState("");
  const [complete, setComplete] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await getAccessToken();
      const d = await api(t, "GET", `/api/distribution/releases/${releaseId}/lyrics-package`);
      setLyrics(d.lyricsPackage.lyrics ?? "");
      setTimedText((d.lyricsPackage.timedLines ?? []).map((l: any) => `${l.start}|${l.end}|${l.text}`).join("\n"));
      setLrc(d.lyricsPackage.lrc ?? "");
      setComplete(Boolean(d.lyricsPackage.step?.complete));
    } catch { setErr("Couldn't load the lyrics package."); }
  }, [getAccessToken, releaseId]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setErr(null); setMsg(null);
    const timedLines = timedText.split("\n").map((line) => {
      const [s, e, ...rest] = line.split("|");
      return { start: Number(s), end: Number(e), text: rest.join("|").trim() };
    }).filter((l) => l.text && Number.isFinite(l.start));
    try {
      const t = await getAccessToken();
      const d = await api(t, "PUT", `/api/distribution/releases/${releaseId}/lyrics-package`, { lyrics, timedLines });
      setLrc(d.lyricsPackage.lrc ?? "");
      setComplete(Boolean(d.lyricsPackage.step?.complete));
      setMsg("Lyrics step saved — the lyrics and their synced timing ship with this release package.");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
  }
  return (
    <section className={card}>
      <h3 className="text-lg font-black">Lyrics — a step of this release package {complete && <span className="text-emerald-300 text-sm">· complete</span>}</h3>
      <p className="mt-1 text-sm text-white/55">
        Lyrics are a named step of the release, not an afterthought: the words plus their synced timing
        (from Lyrics-to-Timeline) are delivered with the release package.
      </p>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-300">{msg}</p>}
      <div className="mt-4 grid gap-3">
        <textarea className={input} rows={6} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Full lyrics for this release" />
        <div>
          <p className={label}>Synced timing — one line per lyric: start|end|text (seconds)</p>
          <textarea className={input + " mt-1 font-mono text-xs"} rows={4} value={timedText} onChange={(e) => setTimedText(e.target.value)} placeholder={"0|1.5|First line\n1.5|3|Second line"} />
        </div>
        {lrc.trim() && <div><p className={label}>Synced lyrics file (.lrc) in this package</p><pre className="mt-1 max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/50 p-3 text-xs text-white/70">{lrc}</pre></div>}
        <div><button type="button" className={btn} onClick={save}>Save lyrics step · free</button></div>
      </div>
    </section>
  );
}

/* ── #4b Takedown / edit requests ────────────────────────────────────── */
export function ChangeRequestsPanel({ releaseId }: { releaseId: string }) {
  const { getAccessToken } = useAuth();
  const [requests, setRequests] = useState<any[] | null>(null);
  const [kind, setKind] = useState<"takedown" | "edit">("takedown");
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const t = await getAccessToken(); const d = await api(t, "GET", `/api/distribution/releases/${releaseId}/change-requests`); setRequests(d.requests ?? []); }
    catch { setErr("Couldn't load requests."); setRequests([]); }
  }, [getAccessToken, releaseId]);
  useEffect(() => { void load(); }, [load]);

  async function file() {
    setErr(null); setMsg(null);
    try {
      const t = await getAccessToken();
      const d = await api(t, "POST", `/api/distribution/releases/${releaseId}/change-requests`, { kind, reason, details });
      setReason(""); setDetails("");
      setMsg(d.note);
      void load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't file the request."); }
  }
  return (
    <section className={card}>
      <h3 className="text-lg font-black">Takedown &amp; edit requests</h3>
      <p className="mt-1 text-sm text-white/55">
        File the request here, with your reason — it&apos;s recorded and tracked on our side
        (requested → acknowledged → sent to partner). The last step waits for the delivery partner pipe:
        stores can&apos;t honor a request until that pipe exists, and this release&apos;s delivery stays
        labeled sandbox-simulated until then.
      </p>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-300">{msg}</p>}
      <div className="mt-4 grid gap-3">
        <div className="flex gap-2">
          <button type="button" className={kind === "takedown" ? btn : ghost} onClick={() => setKind("takedown")}>Takedown</button>
          <button type="button" className={kind === "edit" ? btn : ghost} onClick={() => setKind("edit")}>Edit</button>
        </div>
        <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />
        <textarea className={input} rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Details — what should change, or why it should come down" />
        <div><button type="button" className={btn} onClick={file} disabled={!reason.trim()}>File request · free</button></div>
      </div>
      {requests && requests.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {requests.map((r) => (
            <li key={r.id} className="rounded-xl border border-white/10 bg-black/40 p-3">
              <strong>{r.kind}</strong> — {r.status} <span className="text-white/40">· {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}</span>
              <p className="text-white/60">{r.reason}</p>
              {r.details && <p className="text-white/40">{r.details}</p>}
            </li>
          ))}
        </ul>
      )}
      {requests && requests.length === 0 && <p className="mt-3 text-sm text-white/40">No requests filed for this release.</p>}
    </section>
  );
}

/* ── #5 Per-release permanence ───────────────────────────────────────── */
export function ReleasePermanencePanel({ releaseId }: { releaseId: string }) {
  const { getAccessToken } = useAuth();
  const [election, setElection] = useState<string | null>(null);
  const [covers, setCovers] = useState<string[]>([]);
  const [excludes, setExcludes] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const t = await getAccessToken();
      const d = await api(t, "GET", "/api/distribution/permanence");
      setCovers(d.covers ?? []); setExcludes(d.excludes ?? []);
      const mine = (d.releases ?? []).find((x: any) => x.releaseId === releaseId);
      setElection(mine?.election ?? null);
    } catch { /* panel shows the policy copy only when it loads */ }
  }, [getAccessToken, releaseId]);
  useEffect(() => { void load(); }, [load]);
  async function choose(e: string) {
    try { const t = await getAccessToken(); await api(t, "PUT", `/api/distribution/releases/${releaseId}/permanence`, { election: e }); setElection(e); setMsg("Permanence election recorded for this release."); }
    catch { setMsg("Couldn't save the election."); }
  }
  return (
    <section className={card}>
      <h3 className="text-lg font-black">Permanence — this release</h3>
      <p className="mt-1 text-sm text-white/55">
        Record a permanence election for this release. The guarantee is on-platform: your release page and
        smartlink stay live, your catalog records stay attached, and no plan lapse takes the release down.
        It doesn&apos;t bind stores outside this platform, legal removals, or files you delete yourself.
      </p>
      {covers.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-white/45">{covers.map((c) => <li key={c}>{c}</li>)}</ul>}
      {excludes.length > 0 && <p className="mt-1 text-xs text-white/35">Not covered: {excludes.join(" ")}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-300">{msg}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-white/60">Current: <strong className="text-white">{election ?? "no election recorded"}</strong></span>
        <button type="button" className={ghost} onClick={() => choose("permanent")}>Keep permanently</button>
        <button type="button" className={ghost} onClick={() => choose("standard")}>Standard</button>
      </div>
    </section>
  );
}

/* ── #3 Split statements (Business / Get Paid) ───────────────────────── */
export function SplitStatementsPanel() {
  const { getAccessToken } = useAuth();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const load = useCallback(async () => {
    setErr(null);
    try {
      const t = await getAccessToken();
      const qs = new URLSearchParams();
      if (periodStart) qs.set("periodStart", periodStart);
      if (periodEnd) qs.set("periodEnd", periodEnd);
      setData(await api(t, "GET", `/api/distribution/splits/statements${qs.toString() ? `?${qs}` : ""}`));
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't build statements."); }
  }, [getAccessToken, periodStart, periodEnd]);
  useEffect(() => { void load(); }, [load]);
  return (
    <section className={card}>
      <h3 className="text-lg font-black">Split statements — who earned what</h3>
      <p className="mt-1 text-sm text-white/55">
        Per-payee earnings statements built from the royalties you imported or logged, split by the agreement
        version in effect for each period. Read-only accounting — no money moves here; paying collaborators
        out runs on the delivery pipe when it lands.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className={input + " w-44"} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label="Period start" />
        <input className={input + " w-44"} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="Period end" />
        <button type="button" className={ghost} onClick={load}>Apply period</button>
      </div>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      {data && !data.hasData && <p className="mt-3 text-sm text-white/40">No recorded royalty entries match your releases for this period yet — import or log royalties and statements build themselves. Nothing is estimated.</p>}
      {data?.statements?.map((s: any) => (
        <div key={`${s.releaseId}-${s.payeeName}`} className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span><strong>{s.payeeName}</strong> — {s.releaseTitle}</span><span className="font-black text-primary">{money(s.totalAmount)}</span></div>
          <ul className="mt-2 space-y-1 text-white/55">
            {s.lines.map((l: any, i: number) => <li key={i}>{l.songTitle} · {l.platform} · {l.periodStart} → {l.periodEnd} · {money(l.grossAmount)} × {l.sharePct}% = {money(l.amount)}</li>)}
          </ul>
        </div>
      ))}
      {data?.unallocated?.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <p className="font-bold text-amber-200">Recorded but unallocated</p>
          {data.unallocated.map((u: any, i: number) => <p key={i} className="mt-1 text-amber-100/70">{u.songTitle} · {money(u.grossAmount)} — {u.reason}</p>)}
        </div>
      )}
    </section>
  );
}

/* ── #7 Label roster ─────────────────────────────────────────────────── */
export function RosterPanel() {
  const { getAccessToken } = useAuth();
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [rule, setRule] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [releases, setReleases] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await getAccessToken();
      const d = await api(t, "GET", "/api/distribution/roster");
      setMembers(d.members ?? []); setRule(d.permissionRule ?? "");
      const i = await api(t, "GET", "/api/distribution/roster/invites");
      setInvites(i.invites ?? []);
    } catch { setErr("Couldn't load the roster."); }
  }, [getAccessToken]);
  useEffect(() => { void load(); }, [load]);

  async function invite() {
    setErr(null); setMsg(null);
    try { const t = await getAccessToken(); await api(t, "POST", "/api/distribution/roster/invite", { artistName: name, artistEmail: email }); setName(""); setEmail(""); setMsg("Artist added to your roster as invited. They choose whether to accept — and whether you can see their releases."); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add the artist."); }
  }
  async function viewReleases(id: string) {
    setErr(null);
    try { const t = await getAccessToken(); const d = await api(t, "GET", `/api/distribution/roster/${id}/releases`); setReleases((p) => ({ ...p, [id]: d })); }
    catch (e) { setErr(e instanceof Error ? e.message : "That artist's releases aren't visible."); }
  }
  async function respond(id: string, response: string, grant = false) {
    try { const t = await getAccessToken(); await api(t, "POST", `/api/distribution/roster/invites/${id}/respond`, { response, distributionAccess: grant }); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't record your answer."); }
  }
  async function setAccess(id: string, grant: boolean) {
    try { const t = await getAccessToken(); await api(t, "POST", `/api/distribution/roster/invites/${id}/access`, { distributionAccess: grant }); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't update access."); }
  }
  async function remove(id: string) {
    try { const t = await getAccessToken(); await api(t, "DELETE", `/api/distribution/roster/${id}`); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't remove the artist."); }
  }
  return (
    <section className={card}>
      <h3 className="text-lg font-black">Label roster</h3>
      <p className="mt-1 text-sm text-white/55">{rule || "Invite artists to your roster. Their releases are theirs: you see them read-only only after they accept and grant distribution access."}</p>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-300">{msg}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <input className={input + " w-52"} value={name} onChange={(e) => setName(e.target.value)} placeholder="Artist name" />
        <input className={input + " w-64"} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Artist email" />
        <button type="button" className={btn} onClick={invite} disabled={!email.trim()}>Add to roster · free</button>
      </div>
      {members.map((m) => (
        <div key={m.id} className="mt-3 rounded-xl border border-white/10 bg-black/40 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><strong>{m.artistName || m.artistEmail}</strong> — {m.status}{m.status === "accepted" ? (m.distributionAccess ? " · distribution access granted" : " · no distribution access") : ""}</span>
            <span className="flex gap-2">
              {m.status === "accepted" && m.distributionAccess && <button type="button" className={ghost} onClick={() => viewReleases(m.id)}>View releases (read-only)</button>}
              {m.status !== "removed" && <button type="button" className={ghost} onClick={() => remove(m.id)}>Remove</button>}
            </span>
          </div>
          {releases[m.id]?.releases?.map((r: any) => <p key={r.id} className="mt-1 text-white/55">{r.title} — {r.status} · {r.releaseType}{r.releaseDate ? ` · ${r.releaseDate}` : ""}</p>)}
        </div>
      ))}
      {invites.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <h4 className="text-sm font-bold">Rosters that invited you</h4>
          {invites.map((m) => (
            <div key={m.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span>{m.artistName || "A label"} — {m.status}{m.status === "accepted" ? (m.distributionAccess ? " · you granted distribution access (read-only)" : " · no distribution access granted") : ""}</span>
              {m.status === "invited" && <>
                <button type="button" className={ghost} onClick={() => respond(m.id, "accept", false)}>Accept</button>
                <button type="button" className={ghost} onClick={() => respond(m.id, "accept", true)}>Accept + grant read-only release access</button>
                <button type="button" className={ghost} onClick={() => respond(m.id, "decline")}>Decline</button>
              </>}
              {m.status === "accepted" && <button type="button" className={ghost} onClick={() => setAccess(m.id, !m.distributionAccess)}>{m.distributionAccess ? "Revoke distribution access" : "Grant read-only release access"}</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
