import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { reachApi, type LoyaltyState } from "@/lib/reach-api";
import { pendingRedemptionsFromPayload } from "@/lib/reach-watch";
import { apiJson } from "@/lib/social-api";

/* ── Loyalty settings + redemption queue (Stack 9 #6, creator side) ────
   Earn rules and perk costs come from fixed menus — the selects ARE
   the menu, so a creator can never type an arbitrary formula. The
   redemption queue is resolved by hand: fulfilled means the creator
   did the perk; declined refunds the fan's points automatically. */

const WATCH_MENU = [0, 5, 10, 20];
const CHAT_MENU = [0, 1, 2, 5];
const TIP_MENU = [0, 5, 10];
const CUSTOM_COST_MENU = [500, 1000, 2500, 5000];

export default function LoyaltySettingsPanel() {
  const { getAccessToken } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [state, setState] = useState<LoyaltyState | null>(null);
  const [queue, setQueue] = useState<Array<{ id: string; perkLabel: string; pointsCost: number; status: string }>>([]);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ enabled: true, watch: 10, chat: 2, tip: 5, customLabel: "", customCost: 1000 });

  const load = useCallback(
    async (pid: string) => {
      const [s, q] = await Promise.all([
        reachApi.loyalty(getAccessToken, pid),
        reachApi.redemptionQueue(getAccessToken, pid).catch((): { redemptions: Array<{ id: string; userId: string; perkLabel: string; pointsCost: number; status: string; createdAt: string | null }> } => ({ redemptions: [] })),
      ]);
      setState(s);
      setForm({
        enabled: s.enabled,
        watch: s.watchPointsPer10Min,
        chat: s.chatPoints,
        tip: s.tipPointsPer100Vb,
        customLabel: s.customRewardLabel ?? "",
        customCost: s.customRewardCost ?? 1000,
      });
      /* Guard (DTO batch #2): a success payload missing the list is the
         honest empty queue — the raw .filter used to throw inside load(). */
      setQueue(pendingRedemptionsFromPayload(q));
    },
    [getAccessToken],
  );

  useEffect(() => {
    (async () => {
      try {
        const me = await apiJson<{ id?: string }>(getAccessToken, "/api/creator-profiles/me").catch(() => null);
        const pid = me?.id ?? null;
        setProfileId(pid);
        if (pid) await load(pid);
      } catch {
        /* no profile → panel explains itself below */
      }
    })();
  }, [getAccessToken, load]);

  if (!profileId) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 pb-10">
        <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 text-white">
          <h2 className="flex items-center gap-2 text-lg font-black"><Trophy className="h-5 w-5 text-[#e8c86a]" /> Channel loyalty</h2>
          <p className="mt-1 text-sm text-white/50">Create your creator profile first — loyalty points live on your channel.</p>
        </div>
      </section>
    );
  }

  const selectCls = "rounded-lg border border-white/15 bg-black px-2 py-1.5 text-sm focus:border-[#e8c86a] focus:outline-none";

  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-10" data-testid="loyalty-settings-panel">
      <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 text-white">
        <h2 className="flex items-center gap-2 text-lg font-black"><Trophy className="h-5 w-5 text-[#e8c86a]" /> Channel loyalty</h2>
        <p className="mt-1 text-sm text-white/50">
          Fans earn your channel's points for watching, chatting and tipping, and spend them on perks you fulfill.
          Points are not Visual Bucs and can't be turned into Visual Bucs or money — they're your channel's own thank-you.
        </p>
        <form
          className="mt-4 grid gap-3 text-sm md:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setNote(null);
            try {
              await reachApi.saveLoyaltySettings(getAccessToken, profileId, {
                enabled: form.enabled,
                watchPointsPer10Min: form.watch,
                chatPoints: form.chat,
                tipPointsPer100Vb: form.tip,
                customRewardLabel: form.customLabel.trim() || null,
                customRewardCost: form.customLabel.trim() ? form.customCost : null,
              });
              setNote("Saved. Your fans earn at these rates from now on.");
              await load(profileId);
            } catch (err) {
              setNote(err instanceof Error ? err.message : "Settings couldn't be saved.");
            }
          }}
        >
          <label className="flex items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
            Program on
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 accent-[#e8c86a]" />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
            Points per 10 min watched
            <select value={form.watch} onChange={(e) => setForm({ ...form, watch: Number(e.target.value) })} className={selectCls}>
              {WATCH_MENU.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
            Points per chat message
            <select value={form.chat} onChange={(e) => setForm({ ...form, chat: Number(e.target.value) })} className={selectCls}>
              {CHAT_MENU.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
            Points per 100 VB tipped
            <select value={form.tip} onChange={(e) => setForm({ ...form, tip: Number(e.target.value) })} className={selectCls}>
              {TIP_MENU.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2 md:col-span-2">
            Custom reward (you fulfill it)
            <input value={form.customLabel} onChange={(e) => setForm({ ...form, customLabel: e.target.value })} placeholder="e.g. Pick next stream's game" className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black px-2 py-1.5 text-sm focus:border-[#e8c86a] focus:outline-none" />
            <select value={form.customCost} onChange={(e) => setForm({ ...form, customCost: Number(e.target.value) })} className={selectCls}>
              {CUSTOM_COST_MENU.map((v) => <option key={v} value={v}>{v} pts</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-full bg-[#e8c86a] px-4 py-2 text-sm font-bold text-black transition hover:scale-[1.02]">Save loyalty settings</button>
        </form>
        {note && <p className="mt-3 text-sm text-white/60">{note}</p>}
        {state && <p className="mt-2 text-xs text-white/40">Perks on your menu: {state.perks.map((p) => `${p.label} (${p.cost})`).join(" · ")}</p>}

        <h3 className="mt-6 text-sm font-black uppercase tracking-wider text-white/70">Redemption queue</h3>
        {queue.length === 0 ? (
          <p className="mt-2 text-sm text-white/40">Nothing waiting. When a fan redeems a perk it lands here.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {queue.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm">
                <span>{r.perkLabel} <span className="text-white/40">({r.pointsCost} pts)</span></span>
                <span className="flex gap-2">
                  {(["fulfilled", "declined"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={async () => {
                        await reachApi.resolveRedemption(getAccessToken, r.id, d).catch(() => undefined);
                        await load(profileId);
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-bold ${d === "fulfilled" ? "bg-[#e8c86a] text-black" : "border border-white/20 text-white/70"}`}
                    >
                      {d === "fulfilled" ? "Mark fulfilled" : "Decline (refunds points)"}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
