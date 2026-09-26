import { useCallback, useEffect, useState } from "react";
import {
  Loader2, Coins, ShieldCheck, Trophy, Delete, RotateCcw,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Play, Square, Crown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

type Direction = "up" | "down" | "left" | "right";

interface JackpotEvent {
  id: string;
  name: string;
  codeLength: number;
  prizeCredits: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  winnerUserId: string | null;
  winnerDisplayName: string | null;
  claimedAt: string | null;
}

const DIR_ICON: Record<Direction, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
};

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function JackpotAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const [events, setEvents] = useState<JackpotEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Season 1");
  const [sequence, setSequence] = useState<Direction[]>([]);
  const [prize, setPrize] = useState("100");
  const [startsAt, setStartsAt] = useState(() => toDatetimeLocal(new Date()));
  const [endsAt, setEndsAt] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    return toDatetimeLocal(d);
  });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cheat-code/admin/events", { headers: await authHeaders() });
      const data = (await res.json()) as { events?: JackpotEvent[] };
      if (res.ok) setEvents(data.events ?? []);
    } catch {
      /* leave list empty */
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  function pushDir(d: Direction) {
    setSequence((s) => (s.length >= 10 ? s : [...s, d]));
  }

  async function handleCreate() {
    setError(null);
    setMessage(null);
    if (sequence.length < 4) {
      setError("Tap at least 4 directions on the D-pad to set the code.");
      return;
    }
    const prizeCredits = parseInt(prize, 10);
    if (!Number.isFinite(prizeCredits) || prizeCredits < 1 || prizeCredits > 10000) {
      setError("Prize must be between 1 and 10000 credits.");
      return;
    }
    if (!name.trim()) {
      setError("Give the season a name.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/cheat-code/admin/events", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          codeSequence: sequence,
          prizeCredits,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      const data = (await res.json()) as { error?: string; event?: JackpotEvent };
      if (!res.ok) throw new Error(data.error || "Could not create the season.");
      setMessage(`"${data.event?.name}" created — only the code's hash is stored, never the code itself. Activate it below to go live.`);
      setSequence([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the season.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(ev: JackpotEvent) {
    setBusyId(ev.id);
    setError(null);
    setMessage(null);
    try {
      const action = ev.isActive ? "deactivate" : "activate";
      const res = await fetch(`/api/cheat-code/admin/events/${ev.id}/${action}`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Could not ${action}.`);
      setMessage(ev.isActive ? "Season deactivated." : `"${ev.name}" is LIVE — players can hunt the code now.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  const phaseOf = (ev: JackpotEvent) => {
    if (ev.winnerUserId) return "claimed";
    if (ev.isActive) return "live";
    if (ev.endsAt && new Date(ev.endsAt).getTime() <= Date.now()) return "ended";
    return "upcoming";
  };

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          Cheat Code Jackpot
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">
        Set the secret D-pad code. Players enter it on the site to win the prize —
        only a hash of your code is ever stored.
      </p>

      {/* Create a season */}
      <div className="rounded-xl bg-black/40 border border-white/10 p-4 mb-4">
        <p className="text-sm font-semibold text-white mb-3">Set the cheat code</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          <label className="block">
            <span className="text-xs text-white/50">Season name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/50">Prize (credits)</span>
            <input
              type="number" min={1} max={10000}
              value={prize}
              onChange={(e) => setPrize(e.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/50">Starts</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/50">Ends</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            />
          </label>
        </div>

        {/* D-pad code entry */}
        <p className="text-xs text-white/50 mb-2">Tap the D-pad to build the secret code (4–10 moves)</p>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="grid grid-cols-3 gap-1.5 w-fit" aria-label="D-pad code entry">
            <span />
            <button type="button" onClick={() => pushDir("up")} disabled={saving}
              aria-label="Up"
              className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/15 text-white flex items-center justify-center active:bg-primary/40 active:border-primary transition">
              <ArrowUp className="h-5 w-5" />
            </button>
            <span />
            <button type="button" onClick={() => pushDir("left")} disabled={saving}
              aria-label="Left"
              className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/15 text-white flex items-center justify-center active:bg-primary/40 active:border-primary transition">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => pushDir("down")} disabled={saving}
              aria-label="Down"
              className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/15 text-white flex items-center justify-center active:bg-primary/40 active:border-primary transition">
              <ArrowDown className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => pushDir("right")} disabled={saving}
              aria-label="Right"
              className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/15 text-white flex items-center justify-center active:bg-primary/40 active:border-primary transition">
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 min-w-[140px]">
            <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
              {sequence.length === 0 && (
                <span className="text-xs text-white/30">No moves yet — tap the pad.</span>
              )}
              {sequence.map((d, i) => {
                const Icon = DIR_ICON[d];
                return (
                  <span key={i} className="h-7 w-7 rounded-lg bg-primary/20 border border-primary/40 text-primary flex items-center justify-center">
                    <Icon className="h-4 w-4" />
                  </span>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">{sequence.length}/10 moves</span>
              <button type="button" onClick={() => setSequence((s) => s.slice(0, -1))} disabled={saving || sequence.length === 0}
                className="rounded-lg bg-white/[0.06] border border-white/10 p-1.5 text-white/70 disabled:opacity-40" aria-label="Delete last move">
                <Delete className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setSequence([])} disabled={saving || sequence.length === 0}
                className="rounded-lg bg-white/[0.06] border border-white/10 p-1.5 text-white/70 disabled:opacity-40" aria-label="Clear code">
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <Button onClick={() => { void handleCreate(); }} disabled={saving} className="rounded-xl w-full sm:w-auto">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create season
        </Button>
        {message && <p className="mt-3 text-sm text-green-400">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      {/* Existing seasons */}
      <p className="text-sm font-semibold text-white mb-2">Seasons</p>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
      ) : events.length === 0 ? (
        <p className="text-sm text-white/40 py-4 text-center">No jackpot seasons yet — set the code above.</p>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => {
            const phase = phaseOf(ev);
            return (
              <div key={ev.id} className="rounded-xl bg-black/40 border border-white/10 p-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-semibold text-white">{ev.name}</p>
                  <p className="text-xs text-white/40">
                    {ev.prizeCredits} credits · {ev.codeLength}-move code ·{" "}
                    {ev.endsAt ? new Date(ev.endsAt).toLocaleDateString() : "no end"} ·{" "}
                    <span className={
                      phase === "live" ? "text-green-400 font-semibold"
                      : phase === "claimed" ? "text-primary font-semibold"
                      : "text-white/40"
                    }>
                      {phase === "live" ? "LIVE" : phase === "claimed" ? `claimed by ${ev.winnerDisplayName ?? "a player"}` : phase}
                    </span>
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { void handleToggle(ev); }}
                  disabled={busyId === ev.id}
                  className="rounded-xl"
                >
                  {busyId === ev.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : ev.isActive ? <><Square className="h-3.5 w-3.5" /> Deactivate</>
                    : <><Play className="h-3.5 w-3.5" /> Activate</>}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-white/30">
        Only one season can be live at a time — activating one deactivates the rest.
        Keep your code private: anyone who knows it can claim the prize.
      </p>
    </div>
  );
}

export default function AdminPage() {
  usePageTitle("Admin", "Site administration.");
  const { getAccessToken, profile, refreshProfile } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [amount, setAmount] = useState("500");
  const [granting, setGranting] = useState(false);
  const [bowCfg, setBowCfg] = useState<{ targetBows: number; rewardCredits: number; enabled: boolean } | null>(null);
  const [bowTarget, setBowTarget] = useState("100");
  const [bowReward, setBowReward] = useState("5");
  const [bowEnabled, setBowEnabled] = useState(true);
  const [bowSaving, setBowSaving] = useState(false);
  const [bowMsg, setBowMsg] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/admin/bow-challenge", { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setBowCfg(data);
        setBowTarget(String(data.targetBows));
        setBowReward(String(data.rewardCredits));
        setBowEnabled(data.enabled);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBowSave = useCallback(async () => {
    setBowSaving(true);
    setBowMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/bow-challenge", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          targetBows: parseInt(bowTarget, 10),
          rewardCredits: parseInt(bowReward, 10),
          enabled: bowEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      setBowCfg(data);
      setBowMsg("Secret challenge updated.");
    } catch (e) {
      setBowMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBowSaving(false);
    }
  }, [authHeaders, bowTarget, bowReward, bowEnabled]);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/status", { headers: await authHeaders() });
        const data = (await res.json()) as { isAdmin?: boolean };
        if (!cancelled) setIsAdmin(res.ok && data.isAdmin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  async function handleGrant() {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100000) {
      setError("Enter an amount between 1 and 100000.");
      return;
    }
    setGranting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/credits/grant", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n }),
      });
      const data = (await res.json()) as { granted?: number; credits?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Grant failed.");
      setMessage(`Granted ${data.granted} credits. New balance: ${data.credits}.`);
      await refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grant failed.");
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Admin</h1>
      </div>
      <p className="text-sm text-white/50 mb-6">Owner-only controls.</p>

      {checking ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-white/40" />
        </div>
      ) : !isAdmin ? (
        <p className="text-sm text-white/40 py-8 text-center">Not authorized.</p>
      ) : (
        <>
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5">
            <div className="flex items-center gap-2 mb-1">
              <Coins className="h-4 w-4 text-primary" />
              <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                Give myself credits
              </p>
            </div>
            <p className="text-sm text-white/60 mb-4">
              Current balance: <span className="font-bold text-white">{profile?.credits ?? "—"}</span> credits
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={100000}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={granting}
                className="w-36 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
              />
              <Button onClick={() => { void handleGrant(); }} disabled={granting} className="rounded-xl">
                {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Grant credits
              </Button>
            </div>
            {message && <p className="mt-3 text-sm text-green-400">{message}</p>}
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <p className="mt-4 text-[11px] text-white/30">
              Grants are logged as "Admin Credit Grant" in the credit ledger.
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5">
            <div className="flex items-center gap-2 mb-1">
              <Crown className="h-4 w-4 text-primary" />
              <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                Secret Bow Challenge
              </p>
            </div>
            <p className="text-sm text-white/60 mb-4">
              Hidden monthly milestone. Users bow the shark for fun — when they hit the
              target in a calendar month, they get a surprise &ldquo;You Cracked the Code!&rdquo;
              popup and the credit reward. The challenge is never announced anywhere.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-white/40">
                Bows to win
                <input
                  type="number" min={1} max={100000}
                  value={bowTarget}
                  onChange={(e) => setBowTarget(e.target.value)}
                  disabled={bowSaving}
                  className="mt-1 block w-32 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                />
              </label>
              <label className="text-xs text-white/40">
                Credit reward
                <input
                  type="number" min={1} max={10000}
                  value={bowReward}
                  onChange={(e) => setBowReward(e.target.value)}
                  disabled={bowSaving}
                  className="mt-1 block w-32 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-white/40 pb-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bowEnabled}
                  onChange={(e) => setBowEnabled(e.target.checked)}
                  disabled={bowSaving}
                  className="h-4 w-4 accent-[#C9A84C]"
                />
                Enabled
              </label>
              <Button onClick={() => { void handleBowSave(); }} disabled={bowSaving} className="rounded-xl">
                {bowSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
            {bowMsg && <p className="mt-3 text-sm text-green-400">{bowMsg}</p>}
            <p className="mt-4 text-[11px] text-white/30">
              Counts reset automatically on the 1st of every month. Rewards are logged as
              &ldquo;Secret Bow Challenge&rdquo; in the credit ledger.
            </p>
          </div>
          <JackpotAdmin authHeaders={authHeaders} />
        </>
      )}
    </div>
  );
}
