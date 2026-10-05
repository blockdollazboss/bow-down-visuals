import { useState, useEffect } from "react";
import { ShieldCheck, Loader2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { STAR_RANKS } from "@/lib/creator-level";
import { SecretChallengePopup } from "@/components/SecretChallengePopup";
import { DraggableWidget } from "@/components/draggable-widget";

/**
 * Floating admin quick-actions panel — completely separate from the star widget.
 * Has its own error boundary so a bug here can never crash the page.
 */
export function FloatingAdminPanel() {
  const { profile, getAccessToken, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);

  /* Only the site owner sees this. */
  const isAdmin = profile?.plan === "studio";
  if (!isAdmin) return null;

  return (
    <>
      {/* Toggle button — draggable, snaps to 40-position grid */}
      <DraggableWidget id="admin-shield" defaultAnchor={{ x: 0.96, y: 0.78 }} zIndex={9998}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="h-11 w-11 rounded-full border border-primary/40 bg-black/90 text-primary shadow-[0_0_16px_rgba(218,165,32,0.35)] backdrop-blur flex items-center justify-center hover:bg-primary/10 transition-colors"
          title="Admin quick actions"
          data-testid="floating-admin-toggle"
        >
          <ShieldCheck className="h-5 w-5" />
        </button>
      </DraggableWidget>

      {open && (
        <div
          className="fixed z-[9998] right-4 bottom-36 w-64 rounded-2xl border border-primary/40 bg-black/95 shadow-[0_0_24px_rgba(218,165,32,0.4)] backdrop-blur p-3 max-h-[70vh] overflow-y-auto"
          data-testid="floating-admin-panel"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-black text-primary uppercase tracking-widest">
              Admin
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-white/40 hover:text-white transition-colors"
              aria-label="Close admin panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <AdminTools
            getAccessToken={getAccessToken}
            refreshProfile={refreshProfile}
          />
        </div>
      )}
    </>
  );
}

function AdminTools({
  getAccessToken,
  refreshProfile,
}: {
  getAccessToken: () => Promise<string | null>;
  refreshProfile: () => Promise<void>;
}) {
  const [tierEmail, setTierEmail] = useState("");
  const [tierValue, setTierValue] = useState("6");
  const [tierBusy, setTierBusy] = useState(false);
  const [tierMsg, setTierMsg] = useState<string | null>(null);

  const [creditAmount, setCreditAmount] = useState("50");
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditMsg, setCreditMsg] = useState<string | null>(null);

  const [friendEmail, setFriendEmail] = useState("");
  const [friendAmount, setFriendAmount] = useState("25");
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendMsg, setFriendMsg] = useState<string | null>(null);

  async function authedFetch(path: string, body: unknown) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? ""}`,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { error?: string; [k: string]: unknown };
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  async function handleTierSet() {
    const t = parseInt(tierValue, 10);
    if (!tierEmail.trim() || !(t >= 1 && t <= 6) || tierBusy) return;
    setTierBusy(true);
    setTierMsg(null);
    try {
      const data = await authedFetch("/api/admin/plan/set", {
        tier: t,
        email: tierEmail.trim(),
      });
      setTierMsg(`✓ ${tierEmail.trim()} → ${String(data.rank)} (tier ${String(data.tier)})`);
      setTierEmail("");
    } catch (e) {
      setTierMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setTierBusy(false);
    }
  }

  async function handleCreditGrant() {
    const n = parseInt(creditAmount, 10);
    if (!(n > 0) || creditBusy) return;
    setCreditBusy(true);
    setCreditMsg(null);
    try {
      const data = await authedFetch("/api/admin/credits/grant", { amount: n });
      setCreditMsg(`✓ Granted ${String(data.granted)}. Balance: ${String(data.credits)}.`);
      await refreshProfile();
    } catch (e) {
      setCreditMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setCreditBusy(false);
    }
  }

  async function handleFriendGrant() {
    const n = parseInt(friendAmount, 10);
    if (!(n > 0) || !friendEmail.trim() || friendBusy) return;
    setFriendBusy(true);
    setFriendMsg(null);
    try {
      const data = await authedFetch("/api/admin/credits/grant", {
        amount: n,
        email: friendEmail.trim(),
      });
      setFriendMsg(`✓ ${Number(data.granted).toLocaleString("en-US")} Visual Bucs → ${friendEmail.trim()}.`);
      setFriendEmail("");
    } catch (e) {
      setFriendMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setFriendBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-white outline-none focus:border-primary/50";
  const btnCls =
    "rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-black hover:opacity-90 disabled:opacity-40 shrink-0";
  const labelCls =
    "text-[9px] font-black text-white/40 uppercase tracking-wide mb-1";

  return (
    <div className="space-y-3">
      {/* Upgrade user tier */}
      <div>
        <p className={labelCls}>Upgrade user tier</p>
        <input
          type="email"
          placeholder="user@email.com"
          value={tierEmail}
          onChange={(e) => setTierEmail(e.target.value)}
          className={`${inputCls} mb-1`}
        />
        <div className="flex gap-1">
          <select
            value={tierValue}
            onChange={(e) => setTierValue(e.target.value)}
            className="flex-1 min-w-0 rounded-lg bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-white outline-none"
            style={{ colorScheme: "dark" }}
          >
            {([1, 2, 3, 4, 5, 6] as const).map((t) => (
              <option key={t} value={String(t)}>
                {t} — {STAR_RANKS[t - 1]}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void handleTierSet()} disabled={tierBusy} className={btnCls}>
            {tierBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Set"}
          </button>
        </div>
        {tierMsg && <p className="text-[10px] mt-1 text-white/60 break-words">{tierMsg}</p>}
      </div>

      {/* Grant credits (self) */}
      <div>
        <p className={labelCls}>Grant Visual Bucs (self)</p>
        <div className="flex gap-1">
          <input
            type="number"
            min="1"
            value={creditAmount}
            onChange={(e) => setCreditAmount(e.target.value)}
            className={inputCls}
          />
          <button type="button" onClick={() => void handleCreditGrant()} disabled={creditBusy} className={btnCls}>
            {creditBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Grant"}
          </button>
        </div>
        {creditMsg && <p className="text-[10px] mt-1 text-white/60 break-words">{creditMsg}</p>}
      </div>

      {/* Give a friend credits */}
      <div>
        <p className={labelCls}>Give a friend Visual Bucs</p>
        <input
          type="email"
          placeholder="friend@email.com"
          value={friendEmail}
          onChange={(e) => setFriendEmail(e.target.value)}
          className={`${inputCls} mb-1`}
        />
        <div className="flex gap-1">
          <input
            type="number"
            min="1"
            value={friendAmount}
            onChange={(e) => setFriendAmount(e.target.value)}
            className={inputCls}
          />
          <button type="button" onClick={() => void handleFriendGrant()} disabled={friendBusy} className={btnCls}>
            {friendBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send"}
          </button>
        </div>
        {friendMsg && <p className="text-[10px] mt-1 text-white/60 break-words">{friendMsg}</p>}
      </div>

      {/* Extension promo preview reset */}
      <PromoReset labelCls={labelCls} btnCls={btnCls} />

      {/* Database repairs */}
      <DbRepairs getAccessToken={getAccessToken} labelCls={labelCls} btnCls={btnCls} />

      {/* Copy artists from staging */}
      <CopyArtists getAccessToken={getAccessToken} labelCls={labelCls} btnCls={btnCls} />

      {/* Bow Race settings */}
      <BowRaceControls getAccessToken={getAccessToken} inputCls={inputCls} btnCls={btnCls} labelCls={labelCls} />

      {/* Jackpot event creator */}
      <JackpotCreator getAccessToken={getAccessToken} inputCls={inputCls} btnCls={btnCls} labelCls={labelCls} />
    </div>
  );
}

function CopyArtists({
  getAccessToken,
  labelCls,
  btnCls,
}: {
  getAccessToken: () => Promise<string | null>;
  labelCls: string;
  btnCls: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function copy() {
    setBusy(true);
    setMsg(null);
    try {
      const token = await getAccessToken();
      // 1. Fetch vaults from staging via the gate-bypassed admin export endpoint
      // Note: no credentials:include — we use Bearer token, and staging CORS
      // does not allow credentials with wildcard origin.
      const stagingRes = await fetch("https://bow-down-visuals-staging.onrender.com/api/admin/export-my-artists", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!stagingRes.ok) throw new Error(`Staging fetch failed (${stagingRes.status})`);
      const { vaults } = (await stagingRes.json()) as { vaults?: unknown[] };
      if (!vaults || vaults.length === 0) throw new Error("No artists found on staging");
      // 2. Import to production
      const importRes = await fetch("/api/admin/import-artists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        credentials: "include",
        body: JSON.stringify({ vaults }),
      });
      const data = (await importRes.json()) as { ok?: boolean; imported?: number; skipped?: number; error?: string; rootError?: string };
      if (!data.ok) throw new Error(data.rootError ? `${data.rootError} | ${data.error}` : data.error || "Import failed");
      setMsg(`✓ Copied ${data.imported} artist(s)${data.skipped ? `, skipped ${data.skipped} (already exist)` : ""}.`);
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeDuplicate() {
    setBusy(true);
    setMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/remove-duplicate-shark", {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        credentials: "include",
      });
      const data = (await res.json()) as { ok?: boolean; deleted?: number; error?: string };
      if (!data.ok) throw new Error(data.error || "Failed");
      setMsg(`✓ Removed ${data.deleted} duplicate(s).`);
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className={labelCls}>Copy artists from staging</p>
      <button type="button" onClick={() => void copy()} disabled={busy} className={btnCls}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Copy my artists → production"}
      </button>
      <button type="button" onClick={() => void removeDuplicate()} disabled={busy} className={btnCls} style={{ marginTop: 6 }}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Remove duplicate Shark King"}
      </button>
      {msg && <p className="text-[10px] mt-1 text-white/60 break-words">{msg}</p>}
    </div>
  );
}

function DbRepairs({
  getAccessToken,
  labelCls,
  btnCls,
}: {
  getAccessToken: () => Promise<string | null>;
  labelCls: string;
  btnCls: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(path: string, label: string) {
    setBusy(label);
    setMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        credentials: "include",
      });
      const data = (await res.json()) as { ok?: boolean; results?: unknown; error?: string };
      if (!data.ok) throw new Error(data.error || "Repair failed");
      setMsg(`✓ ${label} done.`);
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className={labelCls}>Database repairs</p>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => void run("/api/admin/schema-repair", "Schema repair")}
          disabled={busy !== null}
          className={btnCls}
        >
          {busy === "Schema repair" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Run schema repair"}
        </button>
        <button
          type="button"
          onClick={() => void run("/api/admin/schema-repair-0054", "0054 repair")}
          disabled={busy !== null}
          className={btnCls}
        >
          {busy === "0054 repair" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Run 0054 DB repair"}
        </button>
      </div>
      {msg && <p className="text-[10px] mt-1 text-white/60 break-words">{msg}</p>}
    </div>
  );
}

function PromoReset({
  labelCls,
  btnCls,
}: {
  labelCls: string;
  btnCls: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  function reset() {
    try {
      localStorage.removeItem("bdv-extension-downloaded");
      localStorage.removeItem("bdv-extension-promo-optout");
      localStorage.removeItem("bdv-extension-modal-last-shown");
      sessionStorage.removeItem("bdv-extension-chat-nudge");
      setMsg("✓ Cleared — reload to see promos as a new visitor.");
    } catch {
      setMsg("✗ Could not clear (private mode?).");
    }
  }

  return (
    <div>
      <p className={labelCls}>Extension promo preview</p>
      <button type="button" onClick={reset} className={btnCls}>
        Reset promo flags
      </button>
      {msg && <p className="text-[10px] mt-1 text-white/60 break-words">{msg}</p>}
    </div>
  );
}

function BowRaceControls({
  getAccessToken,
  inputCls,
  btnCls,
  labelCls,
}: {
  getAccessToken: () => Promise<string | null>;
  inputCls: string;
  btnCls: string;
  labelCls: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [reward, setReward] = useState("50");
  const [enabled, setEnabled] = useState(true);
  const [targetOverride, setTargetOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testPopup, setTestPopup] = useState(false);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [liveTarget, setLiveTarget] = useState<number | null>(null);
  /* TEMPORARY (remove with /api/admin/schema-repair): one-click fix for
     missing bow-race schema — the container-startup drizzle push wasn't
     applying it. Shown only when the race config fails to load. */
  const [repairing, setRepairing] = useState(false);

  async function repair() {
    setRepairing(true);
    setMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/schema-repair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        credentials: "include",
        body: "{}",
      });
      const data = (await res.json()) as { ok?: boolean; results?: unknown; error?: string };
      if (!data.ok) throw new Error(data.error || "Repair failed");
      setMsg(`✓ Repair done: ${JSON.stringify(data.results)} — reloading…`);
      await load();
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Repair failed."}`);
    } finally {
      setRepairing(false);
    }
  }

  async function load() {
    if (loaded || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/bow-challenge", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const data = (await res.json()) as {
        error?: string;
        rewardCredits?: number;
        enabled?: boolean;
        targetOverride?: number | null;
        race?: { totalBows?: number; target?: number } | null;
      };
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setReward(String(data.rewardCredits ?? 50));
      setEnabled(data.enabled ?? true);
      setTargetOverride(data.targetOverride != null ? String(data.targetOverride) : "");
      setLiveCount(data.race?.totalBows ?? null);
      setLiveTarget(data.race?.target ?? null);
      setLoaded(true);
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to load."}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const token = await getAccessToken();
      const override = targetOverride.trim() === "" ? null : parseInt(targetOverride, 10);
      const res = await fetch("/api/admin/bow-challenge", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          rewardCredits: parseInt(reward, 10) || 50,
          enabled,
          targetOverride: override,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed.");
      setMsg("✓ Race settings saved.");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setBusy(false);
    }
  }

  // Auto-load race data when the panel opens — no button click needed.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-poll the bow count every second so it updates without a page refresh.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    async function poll() {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/admin/bow-challenge", {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          race?: { totalBows?: number; target?: number } | null;
        };
        if (cancelled) return;
        setLiveCount(data.race?.totalBows ?? 0);
        setLiveTarget(data.race?.target ?? null);
      } catch {
        /* keep last known count on poll failure */
      }
    }
    const id = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (!loaded) {
    return (
      <div>
        <p className={labelCls}>Bow race</p>
        <p className="text-[10px] text-white/40 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading race...
        </p>
        {msg && <p className="text-[10px] mt-1 text-red-400/80 break-words">{msg}</p>}
        {/* TEMPORARY: one-click schema repair — remove with the endpoint. */}
        {msg && (
          <button
            type="button"
            onClick={() => void repair()}
            disabled={repairing || busy}
            className="mt-2 rounded-lg border border-[#C9A84C]/40 px-3 py-1.5 text-[11px] font-bold text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {repairing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Run schema repair
          </button>
        )}
      </div>
    );
  }

  return (
    <>
    <div>
      <p className={labelCls}>Bow race</p>
      <div className="flex items-center justify-between mb-1.5 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2">
        <span className="text-xs text-white/50 font-semibold">Live bow count</span>
        <span className="text-sm font-black text-[#C9A84C]">
          {(liveCount ?? 0).toLocaleString()}
          {liveTarget != null && (
            <span className="text-white/40 font-semibold"> / {liveTarget.toLocaleString()}</span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <input
          type="number"
          min="1"
          value={reward}
          onChange={(e) => setReward(e.target.value)}
          className={inputCls}
          placeholder="Reward Visual Bucs"
        />
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`rounded-lg px-3 py-1.5 text-xs font-black shrink-0 ${
            enabled ? "bg-green-600 text-white" : "bg-white/10 text-white/50"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </button>
      </div>
      <input
        type="number"
        min="1000"
        max="5000"
        value={targetOverride}
        onChange={(e) => setTargetOverride(e.target.value)}
        className={`${inputCls} mb-1`}
        placeholder="Target override (1000–5000, blank = random)"
      />
      <button type="button" onClick={() => void save()} disabled={busy} className={btnCls}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save race"}
      </button>
      <button
        type="button"
        onClick={() => setTestPopup(true)}
        className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-bold text-white/70 hover:text-white hover:border-white/40 transition-colors ml-1"
        title="Preview the winner popup (no Visual Bucs granted, no race state changed)"
      >
        Test winner popup
      </button>
      {msg && <p className="text-[10px] mt-1 text-white/60 break-words">{msg}</p>}
    </div>
    {/* Test-only preview: purely client-side, grants nothing.
        Rendered outside the panel div so the panel's backdrop-blur
        doesn't trap its fixed positioning. */}
    {testPopup && (
      <SecretChallengePopup
        credits={parseInt(reward, 10) || 50}
        onClaim={() => setTestPopup(false)}
      />
    )}
    </>
  );
}

const DPAD_DIRS = ["up", "down", "left", "right"] as const;

function JackpotCreator({
  getAccessToken,
  inputCls,
  btnCls,
  labelCls,
}: {
  getAccessToken: () => Promise<string | null>;
  inputCls: string;
  btnCls: string;
  labelCls: string;
}) {
  const [name, setName] = useState("");
  const [sequence, setSequence] = useState<string[]>([]);
  const [endsAt, setEndsAt] = useState("");
  const [prize, setPrize] = useState("100");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function pushDir(dir: string) {
    setSequence((prev) => (prev.length >= 10 ? prev : [...prev, dir]));
  }

  async function create() {
    if (sequence.length < 4 || !name.trim() || !endsAt || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/cheat-code/admin/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          codeSequence: sequence,
          endsAt: new Date(endsAt).toISOString(),
          prizeCredits: parseInt(prize, 10) || 100,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed.");
      setMsg("✓ Jackpot event created.");
      setName("");
      setSequence([]);
      setEndsAt("");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setBusy(false);
    }
  }

  const dirArrow: Record<string, string> = { up: "↑", down: "↓", left: "←", right: "→" };

  return (
    <div>
      <p className={labelCls}>New jackpot event</p>
      <input
        type="text"
        placeholder="Event name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={`${inputCls} mb-1`}
      />
      {/* D-pad code entry */}
      <div className="grid grid-cols-4 gap-1 mb-1">
        {DPAD_DIRS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => pushDir(d)}
            className="rounded-lg bg-white/10 py-1.5 text-sm text-white hover:bg-primary/30 transition-colors"
          >
            {dirArrow[d]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 mb-1">
        <p className="text-[10px] text-white/50 flex-1 min-w-0 truncate">
          {sequence.length === 0 ? "Tap arrows (4–10)" : sequence.map((d) => dirArrow[d]).join(" ")}
        </p>
        {sequence.length > 0 && (
          <button
            type="button"
            onClick={() => setSequence([])}
            className="text-[10px] text-white/40 hover:text-white"
          >
            Clear
          </button>
        )}
      </div>
      <input
        type="datetime-local"
        value={endsAt}
        onChange={(e) => setEndsAt(e.target.value)}
        className={`${inputCls} mb-1`}
        style={{ colorScheme: "dark" }}
      />
      <div className="flex gap-1">
        <input
          type="number"
          min="1"
          value={prize}
          onChange={(e) => setPrize(e.target.value)}
          className={inputCls}
          placeholder="Prize Visual Bucs"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || sequence.length < 4}
          className={btnCls}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
        </button>
      </div>
      {msg && <p className="text-[10px] mt-1 text-white/60 break-words">{msg}</p>}
    </div>
  );
}
