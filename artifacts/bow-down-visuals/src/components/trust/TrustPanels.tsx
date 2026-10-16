import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { statementFromPayload } from "@/lib/earnings-statement";

/* Stack 10 trust surfaces. Every panel renders recorded data only:
   a failed load says so, an empty state says it's empty — nothing is
   ever filled in with a plausible-looking zero or curve. */

async function api(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "Something went wrong.");
  return json as any;
}

const card = "rounded-2xl border border-border bg-card p-6";
const btn = "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";
const ghost = "rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50";
const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

/* ── #2 Succession ─────────────────────────────────────────────────── */
export function LegacySettings() {
  const { getAccessToken } = useAuth();
  const [designation, setDesignation] = useState<any>(null);
  const [inbox, setInbox] = useState<any[]>([]);
  const [heir, setHeir] = useState("");
  const [instructions, setInstructions] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await getAccessToken();
      const d = await api(t, "GET", "/api/legacy/designation");
      setDesignation(d.designation);
      if (d.designation) { setHeir(d.designation.heirUserId); setInstructions(d.designation.instructions); }
      const i = await api(t, "GET", "/api/legacy/inbox");
      setInbox(i.designations ?? []);
    } catch { setErr("Could not load your legacy settings."); }
  }, [getAccessToken]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setErr(null); setMsg(null);
    try {
      const t = await getAccessToken();
      const d = await api(t, "POST", "/api/legacy/designation", { heirUserId: heir.trim(), instructions });
      setDesignation(d.designation);
      setMsg("Saved. Your heir sees a pending designation and chooses whether to accept.");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
  }
  async function revoke() {
    try { const t = await getAccessToken(); const d = await api(t, "DELETE", "/api/legacy/designation"); setDesignation(d.designation); setMsg("Designation removed."); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not remove."); }
  }
  async function respond(id: string, response: "accept" | "decline") {
    try { const t = await getAccessToken(); await api(t, "POST", `/api/legacy/inbox/${id}/respond`, { response }); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not record your answer."); }
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-black tracking-tight">Legacy &amp; succession</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Name the creator who should take over your catalog and your page if you can&apos;t. Your heir would control
        your <strong>catalog and page</strong> — never your private messages, and never your payment rails or payout
        credentials. Nothing transfers automatically: activation is a manual review by our team, and this page only
        records your designation and your instructions.
      </p>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-500">{msg}</p>}
      {designation && designation.status !== "revoked" && (
        <p className="mt-3 text-sm">Current designation: <strong>{designation.status}</strong> (heir account {designation.heirUserId})</p>
      )}
      <div className="mt-4 grid gap-3">
        <input className={input} placeholder="Heir's account ID (ask them for it from their settings)" value={heir} onChange={(e) => setHeir(e.target.value)} />
        <textarea className={input} rows={3} placeholder="Your instructions for your heir (optional)" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={save} disabled={!heir.trim()}>Save designation</button>
          {designation && designation.status !== "revoked" && <button type="button" className={ghost} onClick={revoke}>Remove designation</button>}
        </div>
      </div>
      {inbox.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-sm font-bold">Designations naming you</h3>
          {inbox.map((d) => (
            <div key={d.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span>Account {d.userId} named you — status: <strong>{d.status}</strong></span>
              {d.status === "pending" && <>
                <button type="button" className={ghost} onClick={() => respond(d.id, "accept")}>Accept</button>
                <button type="button" className={ghost} onClick={() => respond(d.id, "decline")}>Decline</button>
              </>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Stack 11 #5 Permanence (same Settings area as succession) ─────── */
export function PermanenceSettings() {
  const { getAccessToken } = useAuth();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const t = await getAccessToken(); setData(await api(t, "GET", "/api/distribution/permanence")); }
    catch { setErr("Could not load your permanence settings."); }
  }, [getAccessToken]);
  useEffect(() => { void load(); }, [load]);
  async function chooseCatalog(election: string) {
    try { const t = await getAccessToken(); await api(t, "PUT", "/api/distribution/permanence/catalog", { election }); setMsg("Catalog permanence election saved."); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
  }
  async function chooseRelease(releaseId: string, election: string) {
    try { const t = await getAccessToken(); await api(t, "PUT", `/api/distribution/releases/${releaseId}/permanence`, { election }); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
  }
  return (
    <section className={card}>
      <h2 className="text-lg font-black tracking-tight">Permanence — your catalog, forever</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your succession designation (above) says <em>who</em> controls the catalog; permanence says <em>how long it
        stays</em>. The guarantee is on-platform, and it&apos;s honest about its edges:
      </p>
      {data && <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{(data.covers ?? []).map((c: string) => <li key={c}>{c}</li>)}</ul>}
      {data && <p className="mt-1 text-sm text-muted-foreground">It does not cover: {(data.excludes ?? []).join(" ")}</p>}
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      {msg && <p className="mt-2 text-sm text-emerald-500">{msg}</p>}
      {data && (
        <div className="mt-4 grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>Whole catalog: <strong>{data.catalog?.election ?? "no election recorded"}</strong></span>
            <button type="button" className={ghost} onClick={() => chooseCatalog("permanent")}>Keep permanently</button>
            <button type="button" className={ghost} onClick={() => chooseCatalog("standard")}>Standard</button>
          </div>
          {(data.releases ?? []).map((r: any) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <span className="flex-1">{r.releaseTitle ?? "Release"}: <strong>{r.election}</strong></span>
              <button type="button" className={ghost} onClick={() => chooseRelease(r.releaseId, r.election === "permanent" ? "standard" : "permanent")}>{r.election === "permanent" ? "Switch to standard" : "Keep permanently"}</button>
            </div>
          ))}
          {(data.releases ?? []).length === 0 && <p className="text-muted-foreground">Per-release elections live on each release in Distribute — this page holds the catalog-wide election.</p>}
        </div>
      )}
    </section>
  );
}

/* ── #3 Catalog portability ────────────────────────────────────────── */
export function CatalogExportPanel() {
  const { getAccessToken } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const t = await getAccessToken(); const j = await api(t, "GET", "/api/catalog-export"); setJobs(j.jobs ?? []); }
    catch { setErr("Could not load your exports."); }
  }, [getAccessToken]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setBusy(true); setErr(null);
    try {
      const t = await getAccessToken();
      const made = await api(t, "POST", "/api/catalog-export");
      const blob = new Blob([JSON.stringify(made.job.manifest, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "my-catalog-manifest.json"; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      void load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not build your package."); }
    finally { setBusy(false); }
  }
  return (
    <section className={card}>
      <h2 className="text-lg font-black tracking-tight">Your whole catalog, downloadable</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        One click builds a package of everything that&apos;s yours: songs and audio files, videos, release metadata,
        store products, and your audience list. It&apos;s a manifest, not one giant zip — video originals are large,
        so each entry carries the file&apos;s download link plus its metadata in open JSON. Nothing is re-encoded.
      </p>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      <button type="button" className={`${btn} mt-4`} onClick={create} disabled={busy}>{busy ? "Building…" : "Build my catalog package"}</button>
      {jobs.length > 0 && <ul className="mt-3 text-sm text-muted-foreground">{jobs.map((j) => <li key={j.id}>{new Date(j.createdAt).toLocaleString()} — {j.status} ({j.progress}%)</li>)}</ul>}
    </section>
  );
}

/* ── #5 Earnings documents ─────────────────────────────────────────── */
export function EarningsDocuments() {
  const { getAccessToken } = useAuth();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [stmt, setStmt] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const usd = (c: number | null) => (c == null ? "couldn't load" : `$${(c / 100).toFixed(2)}`);
  async function load() {
    setErr(null);
    try {
      const t = await getAccessToken(); const s = await api(t, "GET", `/api/earnings/statements/${year}`);
      /* Guard (DTO batch #2): a statement without a real sources map is
         malformed — the honest load error, not a render throw. */
      const normalized = statementFromPayload(s);
      if (!normalized) throw new Error("Could not load that statement.");
      setStmt(normalized);
    }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load that statement."); }
  }
  async function pdf() {
    try {
      const t = await getAccessToken();
      const res = await fetch(`/api/earnings/statements/${year}/pdf`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `earnings-statement-${year}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { setErr("Could not download that statement."); }
  }
  return (
    <section className={card}>
      <h2 className="text-lg font-black tracking-tight">Earnings statements</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A per-year statement of the earnings recorded here, per source. This is a statement of platform-recorded
        earnings — it is not a filed tax form. If a payment processor paid you, that processor issues its own tax forms.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select className={input + " w-32"} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" className={btn} onClick={load}>View statement</button>
        {stmt && <button type="button" className={ghost} onClick={pdf}>Download PDF</button>}
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      {stmt && (
        <div className="mt-4 text-sm">
          {Object.entries(stmt.sources).map(([k, s]: [string, any]) => (
            <div key={k} className="flex justify-between border-b border-border py-1.5"><span>{k}</span><span>{s.status === "error" ? "couldn't load" : `${usd(s.totalCents)} · ${s.count} records`}</span></div>
          ))}
          <div className="flex justify-between py-2 font-bold"><span>{stmt.partial ? "Total of the sources that loaded" : "Total"}</span><span>{usd(stmt.totalCents)}</span></div>
        </div>
      )}
    </section>
  );
}

/* ── #1 Claims (symmetric view) + #8 Retention ─────────────────────── */
export function ClaimsPanel() {
  const { getAccessToken } = useAuth();
  const [claims, setClaims] = useState<any[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try { const t = await getAccessToken(); const c = await api(t, "GET", "/api/content-id/claims"); setClaims(c.claims ?? []); }
    catch { setClaims([]); }
  }, [getAccessToken]);
  useEffect(() => { void load(); }, [load]);
  async function act(id: string, action: string) {
    try { const t = await getAccessToken(); await api(t, "PATCH", `/api/content-id/claims/${id}`, { action, note: notes[id] ?? "" }); void load(); } catch { /* surfaced on reload */ }
  }
  if (claims === null) return null;
  return (
    <section className={card}>
      <h2 className="text-lg font-black tracking-tight">Matches &amp; claims</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Fingerprint matches found when audio is uploaded, with the evidence both sides see — matched reference,
        position in the upload, and how much matched. Either side&apos;s claim carries the same weight; a match
        moves no money until it&apos;s resolved, and every resolution records its reason.
      </p>
      {claims.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No matches recorded yet. Matches are made when audio is scanned at upload.</p>}
      {claims.map((c) => (
        <div key={c.id} className="mt-3 rounded-xl border border-border p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span><strong>{c.sourceLabel || "Upload"}</strong> — you are the {c.youAre}</span>
            <span className="font-semibold">{c.status}</span>
          </div>
          <p className="mt-1 text-muted-foreground">Matched at {c.offsetSeconds}s · confidence {c.confidence} · {c.matchedLandmarks} of {c.totalLandmarks} landmarks</p>
          {c.disputeNote && <p className="mt-1">Dispute: {c.disputeNote}</p>}
          {c.resolutionNote && <p className="mt-1">Resolution: {c.resolutionNote}</p>}
          {c.status !== "resolved" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input className={input + " max-w-xs"} placeholder="Note (required to resolve; recorded for review)" value={notes[c.id] ?? ""} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
              {c.youAre === "uploader" && c.status === "pending" && <button type="button" className={ghost} onClick={() => act(c.id, "dispute")}>Dispute</button>}
              {c.youAre === "owner" && c.status === "pending" && <button type="button" className={ghost} onClick={() => act(c.id, "accept")}>Accept match</button>}
              {c.youAre === "owner" && (c.status === "disputed" || c.status === "accepted") && <button type="button" className={ghost} onClick={() => act(c.id, "resolve")}>Resolve with note</button>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export function RetentionPanel() {
  const { getAccessToken } = useAuth();
  const [videoId, setVideoId] = useState("");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  async function load() {
    setErr(null);
    try { const t = await getAccessToken(); setData(await api(t, "GET", `/api/analytics/videos/${videoId.trim()}/retention`)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load retention."); }
  }
  return (
    <section className={card}>
      <h2 className="text-lg font-black tracking-tight">Per-video retention</h2>
      <p className="mt-1 text-sm text-muted-foreground">Built from real playback heartbeats. Videos with no recorded heartbeats say so — curves are never back-filled or invented.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className={input + " max-w-sm"} placeholder="Video ID" value={videoId} onChange={(e) => setVideoId(e.target.value)} />
        <button type="button" className={btn} onClick={load} disabled={!videoId.trim()}>Load curve</button>
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      {data && !data.hasData && <p className="mt-3 text-sm text-muted-foreground">{data.note}</p>}
      {data?.hasData && (
        <div className="mt-4">
          <div className="flex h-28 items-end gap-1">
            {data.curve.map((b: any) => (
              <div key={b.bucketStartPct} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(2, b.retainedPct)}%` }} title={`${b.bucketStartPct}% — ${b.retainedPct}% still watching`} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{data.uniqueViewers} viewers · {data.eventCount} heartbeats</p>
          {data.audience && <p className="mt-1 text-sm">Audience: {data.audience.followers} followers · {data.audience.nonFollowers} non-followers · {data.audience.newViewers} new · {data.audience.returningViewers} returning</p>}
        </div>
      )}
    </section>
  );
}

/* ── #4 Unified mod console ────────────────────────────────────────── */
export function ModConsolePanel() {
  const { getAccessToken } = useAuth();
  const [data, setData] = useState<any>(null);
  const [state, setState] = useState<"loading" | "ready" | "noprofile" | "error">("loading");
  const [words, setWords] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await getAccessToken();
      const meRes = await fetch("/api/creator-profiles/me", { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      if (!meRes.ok) { setState("noprofile"); return; }
      const me = await meRes.json();
      const profileId = me?.id ?? me?.profile?.id;
      if (!profileId) { setState("noprofile"); return; }
      const d = await api(t, "GET", `/api/mod-console?profileId=${profileId}`);
      setData({ ...d, profileId });
      setWords((d.automod?.blockedWords ?? []).join(", "));
      setState("ready");
    } catch { setState("error"); }
  }, [getAccessToken]);
  useEffect(() => { void load(); }, [load]);

  async function saveRules(patch: any) {
    try {
      const t = await getAccessToken();
      const d = await api(t, "PUT", "/api/mod-console/automod", { profileId: data.profileId, ...patch });
      setData({ ...data, automod: d.automod });
      setMsg("Automod rules saved — they apply to your live chat right away.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save rules."); }
  }

  if (state === "loading") return null;
  if (state === "noprofile") return null; // no channel yet — nothing to moderate
  if (state === "error" || !data) return <section className={card}><h2 className="text-lg font-black">Mod console</h2><p className="mt-1 text-sm text-destructive">Couldn&apos;t load the mod console — try again in a moment.</p></section>;
  const a = data.automod;
  return (
    <section className={card}>
      <h2 className="text-lg font-black tracking-tight">Mod console</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every flag, mute, and deletion across your streams in one place — each with the reason recorded when it
        happened. Automod never acts silently: a flagged chatter sees exactly why. You are the {data.yourRole};
        {data.yourRole !== "owner" ? " only the creator sets the rules." : " your moderators work within these rules."}
      </p>
      {msg && <p className="mt-2 text-sm text-emerald-500">{msg}</p>}
      {data.yourRole === "owner" && (
        <div className="mt-4 grid gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!a.blockLinks} onChange={(e) => saveRules({ blockLinks: e.target.checked })} /> Block links in chat</label>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground">Blocked words (comma separated — your list, your call)</label>
            <div className="mt-1 flex gap-2">
              <input className={input} value={words} onChange={(e) => setWords(e.target.value)} />
              <button type="button" className={ghost} onClick={() => saveRules({ blockedWords: words.split(",").map((w) => w.trim()).filter(Boolean) })}>Save words</button>
            </div>
          </div>
          <label className="flex items-center gap-2">Caps limit
            <select className={input + " w-36"} value={a.capsPercent ?? ""} onChange={(e) => saveRules({ capsPercent: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">Off</option><option value="90">90% caps</option><option value="80">80% caps</option><option value="70">70% caps</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">Flood pacing rides the chat&apos;s built-in one-message-every-couple-of-seconds limit — it isn&apos;t a separate rule to configure.</p>
        </div>
      )}
      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-bold">Recent actions &amp; flags ({data.actions.length})</h3>
        {data.actions.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Nothing yet — flags and actions land here as they happen.</p>}
        {data.actions.slice(0, 30).map((x: any) => (
          <p key={x.id} className="mt-1.5 text-sm"><strong>{x.action}</strong>{x.rule ? ` (${x.rule})` : ""} — {x.reason} <span className="text-muted-foreground">· {x.createdAt ? new Date(x.createdAt).toLocaleString() : ""}</span></p>
        ))}
      </div>
    </section>
  );
}
