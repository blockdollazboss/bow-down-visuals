import { useCallback, useEffect, useRef, useState } from "react";
import { Zap, Save } from "lucide-react";
import { goldInput, goldButton, ghostButton } from "@/lib/community-ui";
import {
  canBuyPriority, priorityPurchaseStatement, priorityRowLabel,
  newPriorityIntentKey, PRIORITY_DM_GATE_OFF_COPY,
  type PriorityStatusResponse, type PriorityDmRowDto,
} from "@/lib/priority-dms";

/* ─── Priority DMs (Wave-4 #44) — docked INSIDE Messages ─────────────
   Three pieces, all in the existing Messages surface (no new page):
     1. PriorityDmSettingsCard — the creator's own controls in the
        sidebar: opt in/out, MY price, MY stated reply window.
     2. PriorityDmLane — the creator's priority inbox lane: held /
        replied / refunded rows, labelled honestly.
     3. PriorityDmComposer — the fan's buy action in the thread: the
        full statement (price + window + auto-refund) before paying.
   PRICE GATE: platform_enabled=false renders the honest not-yet
   copy and NO price, ever (lib/priority-dms). */

type Api = {
  get: (p: string) => Promise<unknown>;
  post: (p: string, body?: unknown) => Promise<unknown>;
  put: (p: string, body?: unknown) => Promise<unknown>;
};

interface MySettings {
  platform_enabled: boolean;
  opted_in: boolean;
  min_price_vb: number | null;
  reply_window_hours: number;
  not_ready?: boolean;
}

export function PriorityDmSettingsCard({ api, onNotice }: { api: Api; onNotice: (msg: string) => void }) {
  const [settings, setSettings] = useState<MySettings | null>(null);
  const [priceText, setPriceText] = useState("");
  const [windowHours, setWindowHours] = useState(48);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/priority-dms/my-settings").then(
      (d) => {
        const s = d as MySettings;
        setSettings(s);
        setPriceText(s.min_price_vb != null ? String(s.min_price_vb) : "");
        setWindowHours(s.reply_window_hours || 48);
      },
      () => setSettings({ platform_enabled: false, opted_in: false, min_price_vb: null, reply_window_hours: 48 }),
    );
  }, [api]);

  async function save(optedIn: boolean) {
    setSaving(true);
    try {
      const price = priceText.trim() === "" ? null : Number(priceText);
      const d = (await api.put("/api/priority-dms/my-settings", {
        opted_in: optedIn,
        min_price_vb: price,
        reply_window_hours: windowHours,
      })) as MySettings;
      setSettings(d);
      onNotice(optedIn
        ? "Priority DMs on — fans see your price and your reply window before they pay."
        : "Priority DMs off — your normal inbox is untouched.");
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Couldn't save your priority DM settings.");
    } finally { setSaving(false); }
  }

  if (!settings) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-3" data-testid="priority-dm-settings">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-[#e8c86a]">
        <Zap className="h-3.5 w-3.5" /> Priority DMs
      </p>
      {!settings.platform_enabled ? (
        <p className="mt-2 text-xs leading-relaxed text-white/50" data-testid="priority-dm-gate-off">
          {PRIORITY_DM_GATE_OFF_COPY} You can set your price and reply window now — they only go live if the platform turns priority DMs on.
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-white/50">
          Fans pay your price to land in your priority lane. No reply inside your window = they are refunded in full, automatically.
        </p>
      )}
      <label className="mt-3 block text-[11px] font-semibold text-white/60">
        My price (Visual Bucs — you set it, there is no default)
        <input value={priceText} onChange={(e) => setPriceText(e.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric" placeholder="e.g. 500" data-testid="priority-dm-price"
          className={`${goldInput} mt-1`} />
      </label>
      <label className="mt-2 block text-[11px] font-semibold text-white/60">
        I reply within
        <select value={windowHours} onChange={(e) => setWindowHours(Number(e.target.value))}
          data-testid="priority-dm-window"
          className="mt-1 w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white focus:border-[#e8c86a]/60 focus:outline-none">
          <option value={12}>12 hours</option>
          <option value={24}>24 hours</option>
          <option value={48}>2 days</option>
          <option value={72}>3 days</option>
          <option value={168}>7 days</option>
        </select>
      </label>
      <div className="mt-3 flex gap-2">
        {settings.opted_in ? (
          <button type="button" disabled={saving} onClick={() => save(false)} className={ghostButton}
            data-testid="priority-dm-opt-out">Turn off</button>
        ) : (
          <button type="button" disabled={saving} onClick={() => save(true)} className={goldButton}
            data-testid="priority-dm-opt-in">
            <span className="inline-flex items-center gap-1.5"><Save className="h-3.5 w-3.5" /> Turn on</span>
          </button>
        )}
        {settings.opted_in && (
          <button type="button" disabled={saving} onClick={() => save(true)} className={ghostButton}
            data-testid="priority-dm-save">Save</button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-white/40">
        {settings.opted_in ? "On — your stated price and window are what fans see." : "Off — nobody can buy a priority DM from you."}
      </p>
    </div>
  );
}

export function PriorityDmLane({ api, onOpenConversation }: {
  api: Api;
  onOpenConversation: (conversationId: string) => void;
}) {
  const [rows, setRows] = useState<PriorityDmRowDto[]>([]);
  const [enabled, setEnabled] = useState(false);
  const load = useCallback(() => {
    api.get("/api/priority-dms/inbox").then(
      (d) => {
        const data = d as { platform_enabled: boolean; priority: PriorityDmRowDto[] };
        setEnabled(data.platform_enabled);
        setRows(data.priority);
      },
      () => { setRows([]); },
    );
  }, [api]);
  useEffect(() => { load(); }, [load]);

  if (!enabled) {
    return <p className="py-8 text-center text-sm text-white/40" data-testid="priority-lane-gate-off">{PRIORITY_DM_GATE_OFF_COPY}</p>;
  }
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-white/40">No priority DMs yet. When a fan pays for one, it lands here — ahead of everything else.</p>;
  }
  return (
    <div className="space-y-2" data-testid="priority-lane">
      {rows.map((r) => (
        <button key={r.id} type="button" disabled={!r.conversation_id}
          onClick={() => r.conversation_id && onOpenConversation(r.conversation_id)}
          className="w-full rounded-xl border border-[#e8c86a]/30 bg-[#e8c86a]/5 p-3 text-left transition hover:border-[#e8c86a]/60">
          <p className="flex items-center justify-between gap-2 text-sm font-semibold">
            <span className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-[#e8c86a]" /> Priority · {r.amount_vb} VB</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "held" ? "bg-[#e8c86a] text-black" : "bg-white/10 text-white/60"}`}>
              {r.status === "held" ? "WAITING" : r.status.toUpperCase().replace("_", " ")}
            </span>
          </p>
          <p className="mt-1 text-xs text-white/50">{priorityRowLabel(r)}</p>
        </button>
      ))}
    </div>
  );
}

export function PriorityDmComposer({ api, creatorUserId, body, onSent, onNotice }: {
  api: Api;
  creatorUserId: string;
  body: string;
  onSent: () => void;
  onNotice: (msg: string) => void;
}) {
  const [status, setStatus] = useState<PriorityStatusResponse | null>(null);
  const [sending, setSending] = useState(false);
  const intentRef = useRef<string>(newPriorityIntentKey());

  useEffect(() => {
    intentRef.current = newPriorityIntentKey();
    setStatus(null);
    if (!creatorUserId) return;
    api.get(`/api/priority-dms/status?creator=${encodeURIComponent(creatorUserId)}`).then(
      (d) => setStatus(d as PriorityStatusResponse),
      () => setStatus(null),
    );
  }, [api, creatorUserId]);

  if (!status) return null;
  if (!status.platform_enabled) return null; // gate off: no surface, no price — settings card carries the honest copy
  if (!canBuyPriority(status)) return null;

  const statement = priorityPurchaseStatement(status);
  async function sendPriority() {
    if (!body.trim()) { onNotice("Write your priority message first — the words above are what gets delivered."); return; }
    setSending(true);
    try {
      await api.post("/api/priority-dms/send", {
        creator_user_id: creatorUserId,
        body: body.trim(),
        idempotency_key: intentRef.current,
      });
      intentRef.current = newPriorityIntentKey();
      onNotice("Priority DM sent — it sits at the top of their priority lane. No reply in the stated window refunds you in full.");
      onSent();
    } catch (e) {
      const data = (e as Error & { data?: { message?: string } }).data;
      onNotice(data?.message ?? (e instanceof Error ? e.message : "Couldn't send your priority DM."));
    } finally { setSending(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e8c86a]/30 bg-[#e8c86a]/5 px-3 py-2"
      data-testid="priority-dm-composer">
      <p className="min-w-0 flex-1 text-xs text-white/70">{statement}</p>
      <button type="button" disabled={sending} onClick={sendPriority} className={goldButton}
        data-testid="priority-dm-send">
        <span className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Send priority</span>
      </button>
    </div>
  );
}
