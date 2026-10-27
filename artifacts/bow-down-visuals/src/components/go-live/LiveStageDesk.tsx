import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Clapperboard, GraduationCap, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ── Live Stage Desk ──────────────────────────────────────────────────────
   The real-time half of Stream Copilot, docked under it on /go-live:
   (1) Stage Manager (#166) — the creator's switches + link rules for
       Thy Cheat Code's in-stream co-hosting, the mid-stream mute,
       the co-host pin, and the trouble flags it raised.
   (2) Auto-Highlights (#172) — after a stream's recording lands, the
       house picks its best 3 moments from the stream's own signals;
       the creator approves (the cut charges the standard clip price)
       or dismisses. Nothing posts without the creator's yes.
   (3) Creator Classes (#153) — for a class stream, the roster is the
       ticket buyer list, and the replay's course listing shows here.
   The co-host never acts on a person — flags are for the creator's
   call, and this desk says so. */

interface LinkRule { keyword: string; label: string; url: string }

interface LivePrefs {
  auto_highlights_enabled: boolean;
  stage_manager_enabled: boolean;
  stage_manager_pin_enabled: boolean;
  stage_manager_links_enabled: boolean;
  stage_manager_sting_enabled: boolean;
  stage_manager_flags_enabled: boolean;
  stage_manager_link_rules: LinkRule[];
}

interface MyStream {
  id: string;
  title: string;
  status: string;
  is_class: boolean;
  ticket_price_vb: number | null;
  class_course_product_id: string | null;
  has_vod: boolean;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface StageState {
  muted: boolean;
  stagePinned: { message: { body: string; author: { displayName: string } }; pinnedUntil: string } | null;
  flags: Array<{ at: string; reason: string; messageId: string | null }>;
}

interface Proposal {
  id: string;
  start_sec: number;
  end_sec: number;
  title: string;
  reason: string;
  status: "proposed" | "approved" | "dismissed" | "posted";
  output_url: string | null;
}

interface RosterEntry { user_id: string; display_name: string; ticket_id: string; price_vb: number; purchased_at: string }

const cardShell = (isLight: boolean) =>
  isLight
    ? "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-6 md:p-8"
    : "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6 md:p-8";
const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Toggle({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-white/75">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-amber-400" : "bg-white/15"} ${disabled ? "opacity-50" : ""}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export default function LiveStageDesk() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [prefs, setPrefs] = useState<LivePrefs | null>(null);
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [streams, setStreams] = useState<MyStream[]>([]);
  const [streamId, setStreamId] = useState<string>("");
  const [stage, setStage] = useState<StageState | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const authed = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadPrefs = useCallback(async () => {
    const res = await fetch("/api/live-prefs", { headers: await authed() });
    if (res.ok) setPrefs((await res.json()) as LivePrefs);
  }, [authed]);

  const loadStreams = useCallback(async () => {
    const res = await fetch("/api/live-streams/mine", { headers: await authed() });
    if (!res.ok) return;
    const data = (await res.json()) as { streams: MyStream[] };
    setStreams(data.streams);
    setStreamId((prev) => prev || data.streams.find((s) => s.status === "live")?.id || data.streams[0]?.id || "");
  }, [authed]);

  const stream = streams.find((s) => s.id === streamId) ?? null;

  const loadDesk = useCallback(async () => {
    if (!streamId) return;
    const headers = await authed();
    const [stageRes, hlRes] = await Promise.all([
      fetch(`/api/live-streams/${streamId}/stage-manager`, { headers }),
      fetch(`/api/live-streams/${streamId}/highlights`, { headers }),
    ]);
    if (stageRes.ok) setStage((await stageRes.json()) as StageState);
    if (hlRes.ok) setProposals(((await hlRes.json()) as { proposals: Proposal[] }).proposals);
    const current = streams.find((s) => s.id === streamId);
    if (current?.is_class) {
      const rosterRes = await fetch(`/api/live-streams/${streamId}/class-roster`, { headers });
      if (rosterRes.ok) setRoster(((await rosterRes.json()) as { roster: RosterEntry[] }).roster);
    } else {
      setRoster(null);
    }
  }, [authed, streamId, streams]);

  useEffect(() => { void loadPrefs(); void loadStreams(); }, [loadPrefs, loadStreams]);
  useEffect(() => { void loadDesk(); }, [loadDesk]);

  /* While a cut is rendering, poll its settlement every few seconds. */
  const anyCutting = proposals.some((p) => p.status === "approved");
  useEffect(() => {
    if (!anyCutting || !streamId) return;
    pollRef.current = setInterval(() => {
      void (async () => {
        const headers = await authed();
        for (const p of proposals.filter((x) => x.status === "approved")) {
          await fetch(`/api/live-streams/${streamId}/highlights/${p.id}/refresh`, { method: "POST", headers });
        }
        const res = await fetch(`/api/live-streams/${streamId}/highlights`, { headers });
        if (res.ok) setProposals(((await res.json()) as { proposals: Proposal[] }).proposals);
      })();
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [anyCutting, streamId, proposals, authed]);

  async function savePrefs() {
    if (!prefs || savingPrefs) return;
    setSavingPrefs(true); setNote(null);
    try {
      const res = await fetch("/api/live-prefs", {
        method: "PATCH",
        headers: { ...(await authed()), "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (res.ok) { setPrefs((await res.json()) as LivePrefs); setPrefsDirty(false); setNote("Co-host settings saved."); }
      else setNote("Those settings didn't save — check the link rules (keyword, label, and a full http(s) link).");
    } finally { setSavingPrefs(false); }
  }

  async function toggleMute() {
    if (!streamId || !stage) return;
    const res = await fetch(`/api/live-streams/${streamId}/stage-manager/mute`, {
      method: "POST",
      headers: { ...(await authed()), "Content-Type": "application/json" },
      body: JSON.stringify({ muted: !stage.muted }),
    });
    if (res.ok) setStage({ ...stage, muted: !stage.muted });
  }

  async function clearPin() {
    if (!streamId) return;
    const res = await fetch(`/api/live-streams/${streamId}/stage-manager/unpin`, {
      method: "POST", headers: await authed(),
    });
    if (res.ok) setStage((s) => (s ? { ...s, stagePinned: null } : s));
  }

  async function decide(p: Proposal, action: "approve" | "dismiss") {
    if (!streamId || busyId) return;
    setBusyId(p.id); setNote(null);
    try {
      const headers = await authed();
      if (action === "approve") {
        const res = await confirmedFetch(`/api/live-streams/${streamId}/highlights/${p.id}/approve`, {
          method: "POST", headers, overrideCost: 200, overrideFeature: "Auto-Highlights clip cut",
        });
        if (!res) { setNote("Cut cancelled — nothing was charged."); return; }
        if (res.status === 402) { setNote("Not enough Visual Bucs for that cut — the proposal stays right here."); return; }
        if (!res.ok) { setNote("That cut didn't start. Try again in a moment."); return; }
      } else {
        const res = await fetch(`/api/live-streams/${streamId}/highlights/${p.id}/dismiss`, { method: "POST", headers });
        if (!res.ok) { setNote("That proposal didn't dismiss. Try again."); return; }
      }
      const res = await fetch(`/api/live-streams/${streamId}/highlights`, { headers });
      if (res.ok) setProposals(((await res.json()) as { proposals: Proposal[] }).proposals);
    } finally { setBusyId(null); }
  }

  function patchPrefs(patch: Partial<LivePrefs>) {
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    setPrefsDirty(true);
  }

  return (
    <div className={cardShell(isLight)}>
      <div className="mb-1 flex items-center gap-2">
        <Bot className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-black text-white">{t("liveStage.title", { defaultValue: "Live Stage — your co-host at work" })}</h3>
      </div>
      <p className="mb-6 text-sm text-white/50">
        {t("liveStage.desc", { defaultValue: "Thy Cheat Code co-hosts while you stream: it drops your links when chat asks, pins supporters, stings the milestones, and flags trouble for YOUR call. It never kicks, mutes, or locks anyone — that's an admin's command, always." })}
      </p>

      {prefs && (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-primary">Stage Manager</p>
            <Toggle label="Co-host on duty (Stage Manager)" on={prefs.stage_manager_enabled} onClick={() => patchPrefs({ stage_manager_enabled: !prefs.stage_manager_enabled })} />
            <Toggle label="Drop my links when chat mentions them" on={prefs.stage_manager_links_enabled} onClick={() => patchPrefs({ stage_manager_links_enabled: !prefs.stage_manager_links_enabled })} />
            <Toggle label="Pin supporters' tip messages" on={prefs.stage_manager_pin_enabled} onClick={() => patchPrefs({ stage_manager_pin_enabled: !prefs.stage_manager_pin_enabled })} />
            <Toggle label="Royal Sting at milestones" on={prefs.stage_manager_sting_enabled} onClick={() => patchPrefs({ stage_manager_sting_enabled: !prefs.stage_manager_sting_enabled })} />
            <Toggle label="Flag trouble for me early" on={prefs.stage_manager_flags_enabled} onClick={() => patchPrefs({ stage_manager_flags_enabled: !prefs.stage_manager_flags_enabled })} />
            <div className="mt-3 border-t border-white/10 pt-3">
              <Toggle label="Auto-Highlights after each stream" on={prefs.auto_highlights_enabled} onClick={() => patchPrefs({ auto_highlights_enabled: !prefs.auto_highlights_enabled })} />
              <p className="text-xs text-white/40">Best-3 house picks from the stream's own chat, tips, and crowd — you approve every cut.</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-primary">My link rules</p>
            <div className="space-y-2">
              {prefs.stage_manager_link_rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="rounded-md bg-white/[0.06] px-2 py-1 font-bold text-white/80">“{rule.keyword}”</span>
                  <span className="min-w-0 flex-1 truncate text-white/55">{rule.label} — {rule.url}</span>
                  <button type="button" aria-label={`Remove the ${rule.keyword} rule`} onClick={() => patchPrefs({ stage_manager_link_rules: prefs.stage_manager_link_rules.filter((_, j) => j !== i) })}
                    className="text-white/40 transition hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              {prefs.stage_manager_link_rules.length < 10 && (
                <RuleAdder onAdd={(rule) => patchPrefs({ stage_manager_link_rules: [...prefs.stage_manager_link_rules, rule] })} />
              )}
            </div>
          </div>
        </div>
      )}
      {prefsDirty && (
        <button type="button" onClick={savePrefs} disabled={savingPrefs}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
          {savingPrefs ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save co-host settings
        </button>
      )}

      <div className="mt-8 border-t border-white/10 pt-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Stream desk</p>
          <select value={streamId} onChange={(e) => setStreamId(e.target.value)} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-white" data-testid="select-stage-stream">
            {streams.length === 0 && <option value="">No streams yet</option>}
            {streams.map((s) => (
              <option key={s.id} value={s.id}>{s.title} · {s.status}{s.is_class ? " · class" : ""}</option>
            ))}
          </select>
          {stream && <span className="text-xs text-white/40">{stream.has_vod ? "Recording saved" : "No recording yet"}</span>}
        </div>

        {stage && stream && (
          <div className="mb-5 flex flex-wrap items-center gap-4">
            <Toggle label={stage.muted ? "Co-host is MUTED on this stream" : "Mute the co-host on this stream"} on={stage.muted} onClick={toggleMute} />
            {stage.stagePinned && (
              <span className="inline-flex items-center gap-2 text-sm text-white/60">
                Co-host pin up: “{stage.stagePinned.message.body.slice(0, 60)}”
                <button type="button" onClick={clearPin} className="font-bold text-amber-300 hover:text-amber-200">Clear it</button>
              </span>
            )}
          </div>
        )}

        {stage && stage.flags.length > 0 && (
          <div className="mb-5 rounded-2xl border border-red-400/25 bg-red-400/[0.06] p-4">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-red-300"><ShieldAlert className="h-4 w-4" /> Trouble flags — your call</p>
            <ul className="space-y-1 text-sm text-white/70">
              {stage.flags.map((f, i) => <li key={i}>{new Date(f.at).toLocaleTimeString()} — {f.reason}</li>)}
            </ul>
          </div>
        )}

        <div className="mb-2 flex items-center gap-1.5">
          <Clapperboard className="h-4 w-4 text-primary" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Highlight proposals</p>
        </div>
        {proposals.length === 0 ? (
          <p className="text-sm text-white/45">No proposals for this stream yet — they land when the stream's recording does, picked from its own chat spikes, tips, and crowd peaks.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {proposals.map((p) => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary">{fmtClock(p.start_sec)} – {fmtClock(p.end_sec)}</p>
                <p className="mt-1 text-sm font-black text-white">{p.title}</p>
                <p className="mt-1 text-xs text-white/50">{p.reason}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.status === "proposed" && (
                    <>
                      <button type="button" disabled={busyId === p.id} onClick={() => decide(p, "approve")}
                        className="rounded-lg bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-3 py-1.5 text-xs font-black text-black disabled:opacity-40">
                        {busyId === p.id ? "Starting…" : "Cut it · 200 VB"}
                      </button>
                      <button type="button" disabled={busyId === p.id} onClick={() => decide(p, "dismiss")}
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/60 hover:text-white">Dismiss</button>
                    </>
                  )}
                  {p.status === "approved" && <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cutting…</span>}
                  {p.status === "dismissed" && <span className="text-xs text-white/40">Dismissed</span>}
                  {p.status === "posted" && (p.output_url
                    ? <a href={p.output_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-amber-300 hover:text-amber-200">Watch the clip</a>
                    : <span className="text-xs text-white/60">Clip ready</span>)}
                </div>
              </div>
            ))}
          </div>
        )}

        {stream?.is_class && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-1.5">
              <GraduationCap className="h-4 w-4 text-primary" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Class roster — the ticket list</p>
            </div>
            {roster && roster.length > 0 ? (
              <ul className="space-y-1 text-sm text-white/70">
                {roster.map((r) => (
                  <li key={r.ticket_id} className="flex justify-between gap-3">
                    <span>{r.display_name}</span>
                    <span className="text-white/40">{r.price_vb} VB · {new Date(r.purchased_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-white/45">No tickets sold yet — every buyer lands on this roster automatically.</p>
            )}
            <p className="mt-2 text-xs text-white/40">
              {stream.class_course_product_id
                ? "The replay is listed as a course (draft) in your shop — set its price and publish when you're ready."
                : "When the session's recording lands, the replay is listed as a course (draft) here automatically."}
            </p>
          </div>
        )}
        {note && <p className="mt-4 text-sm text-amber-200">{note}</p>}
      </div>
    </div>
  );
}

function RuleAdder({ onAdd }: { onAdd: (rule: LinkRule) => void }) {
  const [keyword, setKeyword] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const ready = keyword.trim().length >= 2 && label.trim().length >= 1 && /^https?:\/\//i.test(url.trim());
  return (
    <div className="grid gap-2 pt-1 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
      <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Keyword (e.g. merch)" className={inputClass} maxLength={40} />
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className={inputClass} maxLength={60} />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={inputClass} maxLength={500} />
      <button type="button" disabled={!ready} onClick={() => { onAdd({ keyword: keyword.trim().toLowerCase(), label: label.trim(), url: url.trim() }); setKeyword(""); setLabel(""); setUrl(""); }}
        className="inline-flex items-center gap-1 rounded-xl border border-primary/40 px-3 py-2 text-xs font-black text-primary transition hover:bg-primary/10 disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  );
}
