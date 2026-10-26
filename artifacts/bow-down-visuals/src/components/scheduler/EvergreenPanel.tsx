import { useCallback, useEffect, useState } from "react";
import { Recycle, Loader2, Check, X, Sparkles, AlertTriangle, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  DAY_LABELS,
  EVERGREEN_COPY,
  EVERGREEN_PATHS,
  evergreenProposalActionPath,
  proposalStatusLabel,
  settingsValidationError,
  skipReasonLabel,
  type EvergreenCandidateDto,
  type EvergreenProposalDto,
  type EvergreenSettingsDto,
} from "@/lib/evergreen";

/* ─── Evergreen recycling desk (Wave-4 #48) ───────────────────────────────
   Docked as a Scheduler tab. The house proposes resurfacing the
   creator's own back catalog inside the creator's windows — it never
   posts: approving a proposal creates a free DRAFT (in the Drafts tab)
   that the creator still schedules themselves. Free throughout; no
   charge lives anywhere in this panel. Both themes. */

async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

export default function EvergreenPanel() {
  const isLight = useIsLightTheme();
  const { getAccessToken } = useAuth();
  const [settings, setSettings] = useState<EvergreenSettingsDto | null>(null);
  const [candidates, setCandidates] = useState<EvergreenCandidateDto[]>([]);
  const [proposals, setProposals] = useState<EvergreenProposalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const card = isLight
    ? "rounded-2xl border border-[#C9A84C]/40 bg-[#FCF7EA] p-5"
    : "rounded-2xl border border-primary/25 bg-zinc-950 p-5";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const heading = isLight ? "text-[#2A1E07]" : "text-white";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const token = await getAccessToken();
      const [s, c, p] = await Promise.all([
        api<{ settings: EvergreenSettingsDto }>(EVERGREEN_PATHS.settings, token),
        api<{ candidates: EvergreenCandidateDto[] }>(EVERGREEN_PATHS.candidates, token),
        api<{ proposals: EvergreenProposalDto[] }>(EVERGREEN_PATHS.proposals, token),
      ]);
      setSettings(s.settings);
      setCandidates(c.candidates);
      setProposals(p.proposals);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load, retryNonce]);

  async function saveSettings() {
    if (!settings) return;
    const err = settingsValidationError(settings);
    if (err) {
      setNotice(err);
      return;
    }
    setBusy("settings");
    setNotice(null);
    try {
      const token = await getAccessToken();
      const saved = await api<{ settings: EvergreenSettingsDto }>(EVERGREEN_PATHS.settings, token, {
        method: "PUT",
        body: JSON.stringify({
          enabled: settings.enabled,
          windows: settings.windows,
          baseSpacingDays: settings.base_spacing_days,
          maxCycles: settings.max_cycles,
        }),
      });
      setSettings(saved.settings);
      setNotice("Evergreen settings saved.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't save settings.");
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("generate");
    setNotice(null);
    try {
      const token = await getAccessToken();
      const out = await api<{ proposals: EvergreenProposalDto[] }>(EVERGREEN_PATHS.generate, token, { method: "POST", body: "{}" });
      setNotice(
        out.proposals.length > 0
          ? `${out.proposals.length} resurfacing proposal${out.proposals.length === 1 ? "" : "s"} ready for your approval below.`
          : "No posts are ready to resurface right now — check the back-catalog list for why.",
      );
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't generate proposals.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      const token = await getAccessToken();
      await api(evergreenProposalActionPath(id, action), token, { method: "POST", body: "{}" });
      setNotice(
        action === "approve"
          ? "Approved — a draft is waiting in your Drafts tab. Nothing posts until you schedule it."
          : "Declined. That post stays in your catalog.",
      );
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't save that decision.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-16 ${muted}`}>
        <Loader2 className="mr-3 h-5 w-5 animate-spin" /> Loading your evergreen desk…
      </div>
    );
  }
  if (loadError || !settings) {
    return (
      <div className={`${card} text-center`}>
        <AlertTriangle className="mx-auto h-8 w-8 text-primary" />
        <p className={`mt-3 font-bold ${heading}`}>Couldn't load your evergreen desk.</p>
        <p className={`mt-1 text-sm ${muted}`}>Your posts and settings are safe — this panel just couldn't reach them.</p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 font-bold text-black hover:brightness-110"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  const pending = proposals.filter((p) => p.status === "pending_approval");
  const decided = proposals.filter((p) => p.status !== "pending_approval");

  return (
    <div className="space-y-6">
      <div className={card}>
        <h3 className={`flex items-center gap-2 text-base font-bold ${heading}`}>
          <Recycle className="h-5 w-5 text-primary" /> Evergreen recycling
        </h3>
        <p className={`mt-2 text-sm ${muted}`}>{EVERGREEN_COPY.neverAutoPosts}</p>
        <p className={`mt-1 text-sm ${muted}`}>{EVERGREEN_COPY.decayStop}</p>

        <label className={`mt-4 flex cursor-pointer items-center gap-3 text-sm font-semibold ${heading}`}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            className="h-4 w-4 accent-amber-500"
          />
          Evergreen is {settings.enabled ? "ON — proposals can be generated" : "OFF — nothing is queued"}
        </label>

        <div className="mt-4">
          <span className={`mb-1.5 block text-[11px] font-bold uppercase tracking-widest ${muted}`}>Your windows (days)</span>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((label, day) => {
              const on = settings.windows.days.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      windows: {
                        ...settings.windows,
                        days: on ? settings.windows.days.filter((d) => d !== day) : [...settings.windows.days, day].sort(),
                      },
                    })
                  }
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    on
                      ? "bg-primary text-black"
                      : isLight
                        ? "border border-[#C9A84C]/50 text-[#6B5B36]"
                        : "border border-white/15 text-white/60 hover:border-primary/40"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className={`mb-1.5 block text-[11px] font-bold uppercase tracking-widest ${muted}`}>From hour</span>
            <input
              type="number" min={0} max={23} value={settings.windows.startHour}
              onChange={(e) => setSettings({ ...settings, windows: { ...settings.windows, startHour: Number(e.target.value) } })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className={`mb-1.5 block text-[11px] font-bold uppercase tracking-widest ${muted}`}>To hour</span>
            <input
              type="number" min={1} max={24} value={settings.windows.endHour}
              onChange={(e) => setSettings({ ...settings, windows: { ...settings.windows, endHour: Number(e.target.value) } })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className={`mb-1.5 block text-[11px] font-bold uppercase tracking-widest ${muted}`}>Spacing (days)</span>
            <input
              type="number" min={1} max={90} value={settings.base_spacing_days}
              onChange={(e) => setSettings({ ...settings, base_spacing_days: Number(e.target.value) })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className={`mb-1.5 block text-[11px] font-bold uppercase tracking-widest ${muted}`}>Max cycles</span>
            <input
              type="number" min={1} max={6} value={settings.max_cycles}
              onChange={(e) => setSettings({ ...settings, max_cycles: Number(e.target.value) })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <p className={`mt-2 text-xs ${muted}`}>Timezone: {settings.windows.timezone}. Spacing doubles every cycle — cycle 2 waits twice as long, cycle 3 four times.</p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button" disabled={busy !== null} onClick={() => void saveSettings()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save settings
          </button>
          <button
            type="button" disabled={busy !== null || !settings.enabled} onClick={() => void generate()}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${
              isLight ? "border border-[#C9A84C]/60 text-[#7A5A12]" : "border border-primary/40 text-primary hover:bg-primary/10"
            }`}
          >
            {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Propose resurfacings
          </button>
        </div>
        {notice && <p className={`mt-3 text-sm font-semibold ${heading}`}>{notice}</p>}
      </div>

      {pending.length > 0 && (
        <div className={card}>
          <h4 className={`text-sm font-bold uppercase tracking-widest ${heading}`}>Waiting for your approval ({pending.length})</h4>
          <div className="mt-3 space-y-3">
            {pending.map((p) => (
              <div key={p.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                <div className="min-w-0">
                  <p className={`truncate text-sm font-semibold ${heading}`}>{p.source_caption || "(no caption)"}</p>
                  <p className={`text-xs ${muted}`}>
                    Cycle {p.cycle} · proposed {new Date(p.proposed_slot).toLocaleString()} · {(p.source_platforms ?? []).join(", ") || "—"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy !== null} onClick={() => void decide(p.id, "approve")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50">
                    <Check className="h-3.5 w-3.5" /> Approve → draft
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => void decide(p.id, "reject")}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${isLight ? "border-[#C9A84C]/50 text-[#6B5B36]" : "border-white/15 text-white/70"}`}>
                    <X className="h-3.5 w-3.5" /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className={`mt-3 text-xs ${muted}`}>{EVERGREEN_COPY.approvalGate} Approving creates a draft — you still press Schedule yourself.</p>
        </div>
      )}

      <div className={card}>
        <h4 className={`text-sm font-bold uppercase tracking-widest ${heading}`}>Your back catalog ({candidates.length})</h4>
        {candidates.length === 0 ? (
          <p className={`mt-2 text-sm ${muted}`}>No posted posts yet — once a scheduled post has gone out and rested 14 days, it can be proposed here.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {candidates.map((c) => (
              <div key={c.post_id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                <p className={`min-w-0 truncate text-sm ${heading}`}>{c.caption || "(no caption)"}</p>
                <p className={`text-xs ${muted}`}>
                  Cycle {c.cycles_used}/{c.max_cycles} · {skipReasonLabel(c.skip_reason)}
                </p>
              </div>
            ))}
          </div>
        )}
        {decided.length > 0 && (
          <p className={`mt-4 text-xs ${muted}`}>
            Recent decisions: {decided.slice(0, 3).map((p) => proposalStatusLabel(p.status)).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
