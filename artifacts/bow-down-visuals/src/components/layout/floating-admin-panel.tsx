import { useState } from "react";
import { ShieldCheck, Loader2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { STAR_RANKS } from "@/lib/creator-level";

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
      {/* Toggle button — right side, above the chat widget */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed z-[9998] right-4 bottom-24 h-11 w-11 rounded-full border border-primary/40 bg-black/90 text-primary shadow-[0_0_16px_rgba(218,165,32,0.35)] backdrop-blur flex items-center justify-center hover:bg-primary/10 transition-colors"
        title="Admin quick actions"
        data-testid="floating-admin-toggle"
      >
        <ShieldCheck className="h-5 w-5" />
      </button>

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
      setFriendMsg(`✓ ${String(data.granted)} Visual Bucs → ${friendEmail.trim()}.`);
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

      {/* Bow Race settings */}
      <BowRaceControls getAccessToken={getAccessToken} inputCls={inputCls} btnCls={btnCls} labelCls={labelCls} />

      {/* Jackpot event creator */}
      <JackpotCreator getAccessToken={getAccessToken} inputCls={inputCls} btnCls={btnCls} labelCls={labelCls} />
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

  async function load() {
    if (loaded || busy) return;
    setBusy(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/admin/bow-challenge", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const data = (await res.json()) as {
        rewardCredits?: number;
        enabled?: boolean;
        targetOverride?: number | null;
      };
      if (res.ok) {
        setReward(String(data.rewardCredits ?? 50));
        setEnabled(data.enabled ?? true);
        setTargetOverride(data.targetOverride != null ? String(data.targetOverride) : "");
        setLoaded(true);
      }
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
      const res = await fetch("/admin/bow-challenge", {
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

  if (!loaded) {
    return (
      <div>
        <p className={labelCls}>Bow race</p>
        <button type="button" onClick={() => void load()} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Load race settings"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className={labelCls}>Bow race</p>
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
      {msg && <p className="text-[10px] mt-1 text-white/60 break-words">{msg}</p>}
    </div>
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
