import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Mail, Plus, Send, Trash2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Fan Segments (fan-graph phase 2) ───────────────────────────────
   Saved segments over the One Fan Graph, docked INSIDE the Fan
   Graph tab of the Email List desk. Segments are live views: the
   counts + previews here come from the server evaluating the rules
   against the current graph, and a send re-evaluates at send time.

   One-click send rides the EXISTING email desk: the panel posts to
   /api/email-list/fan-segments/send, which creates a normal desk
   campaign on the chosen list and dispatches it through the tracked
   rail. The result line reports the desk's own accounting —
   matched fans, how many were emailable on that list, and how many
   were not (no email / not subscribed to this list / unsubscribed —
   unsubscribed fans are never emailed). */

interface FanPreview {
  id: string;
  displayName: string | null;
  email: string | null;
  spentUsdCents: number;
  purchaseCount: number;
}

interface SegmentRules {
  follows: string;
  subscribed: string;
  buyer: string;
  member: string;
  minSpentUsdCents: number;
  minSpentVb: number;
  minPurchases: number;
  hasEmail: boolean;
  sourcesAny: string[];
  activeWithinDays: number;
}

interface PresetSegment {
  id: string;
  name: string;
  description: string;
  rules: SegmentRules;
  count: number;
  preview: FanPreview[];
}

interface SavedSegment {
  id: string;
  name: string;
  rules: SegmentRules;
  count: number;
  preview: FanPreview[];
}

interface SegmentRef {
  presetId?: string;
  segmentId?: string;
  rules?: SegmentRules;
  label: string;
}

const EMPTY_RULES: SegmentRules = {
  follows: "any",
  subscribed: "any",
  buyer: "any",
  member: "any",
  minSpentUsdCents: 0,
  minSpentVb: 0,
  minPurchases: 0,
  hasEmail: false,
  sourcesAny: [],
  activeWithinDays: 0,
};

const cardClass = "rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur";
const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-primary/60";
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function FanSegmentsPanel() {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [presets, setPresets] = useState<PresetSegment[]>([]);
  const [saved, setSaved] = useState<SavedSegment[]>([]);
  const [savedAvailable, setSavedAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* custom builder */
  const [segName, setSegName] = useState("");
  const [draft, setDraft] = useState<SegmentRules>({ ...EMPTY_RULES });
  const [draftPreview, setDraftPreview] = useState<{ count: number; preview: FanPreview[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  /* send composer */
  const [sendRef, setSendRef] = useState<SegmentRef | null>(null);
  const [lists, setLists] = useState<Array<{ id: string; name: string; handle: string }>>([]);
  const [sendListId, setSendListId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const authedFetch = useCallback(
    async (path: string, opts: RequestInit = {}) => {
      const token = await getAccessToken();
      return fetch(path, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(opts.headers ?? {}),
        },
      });
    },
    [getAccessToken],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/email-list/fan-segments");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "load failed");
      setPresets(data.presets ?? []);
      setSaved(data.saved ?? []);
      setSavedAvailable(data.savedAvailable !== false);
    } catch {
      setError(t("email-list.fan_seg_error"));
    } finally {
      setLoading(false);
    }
  }, [authedFetch, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!sendRef) return;
    void (async () => {
      try {
        const res = await authedFetch("/api/email-list/lists");
        const data = await res.json();
        if (res.ok) {
          setLists(data.lists ?? []);
          if (data.lists?.length && !sendListId) setSendListId(data.lists[0].id);
        }
      } catch {
        /* the send door will surface list problems honestly */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendRef]);

  async function previewDraft() {
    setPreviewing(true);
    setSaveNote(null);
    try {
      const res = await authedFetch("/api/email-list/fan-segments/preview", {
        method: "POST",
        body: JSON.stringify({ rules: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "preview failed");
      setDraftPreview({ count: data.count, preview: data.preview ?? [] });
    } catch {
      setSaveNote(t("email-list.fan_seg_error"));
    } finally {
      setPreviewing(false);
    }
  }

  async function saveSegment() {
    if (!segName.trim()) return;
    setSaving(true);
    setSaveNote(null);
    try {
      const res = await authedFetch("/api/email-list/fan-segments", {
        method: "POST",
        body: JSON.stringify({ name: segName.trim(), rules: draft }),
      });
      const data = await res.json();
      if (res.status === 503) {
        setSaveNote(t("email-list.fan_seg_saved_unavailable"));
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "save failed");
      setSegName("");
      setDraft({ ...EMPTY_RULES });
      setDraftPreview(null);
      void load();
    } catch {
      setSaveNote(t("email-list.fan_seg_error"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSegment(id: string) {
    try {
      await authedFetch(`/api/email-list/fan-segments/${id}`, { method: "DELETE" });
      void load();
    } catch {
      setError(t("email-list.fan_seg_error"));
    }
  }

  async function sendNow() {
    if (!sendRef || !sendListId || !subject.trim() || !body.trim()) return;
    setSending(true);
    setSendResult(null);
    setSendError(null);
    try {
      const res = await authedFetch("/api/email-list/fan-segments/send", {
        method: "POST",
        body: JSON.stringify({
          ...(sendRef.presetId ? { presetId: sendRef.presetId } : {}),
          ...(sendRef.segmentId ? { segmentId: sendRef.segmentId } : {}),
          ...(sendRef.rules ? { rules: sendRef.rules } : {}),
          listId: sendListId,
          subject: subject.trim(),
          body: body.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "send failed");
      const seg = data.segment as { matchedFans: number; mailable: number; notMailable: { noEmail: number; notSubscribed: number; unsubscribed: number } };
      const skipped = seg.notMailable.noEmail + seg.notMailable.notSubscribed + seg.notMailable.unsubscribed;
      const sent = (data.campaign as { deliveredCount?: number })?.deliveredCount ?? 0;
      if (data.campaign?.status === "sent") {
        setSendResult(
          t("email-list.fan_seg_sent_result", { sent, mailable: seg.mailable, matched: seg.matchedFans, skipped }),
        );
      } else {
        setSendError(t("email-list.fan_seg_send_failed", { reason: data.dispatch?.reason ?? data.campaign?.status ?? "failed" }));
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : t("email-list.fan_seg_error"));
    } finally {
      setSending(false);
    }
  }

  const previewList = (preview: FanPreview[]) =>
    preview.length === 0 ? (
      <p className="mt-2 text-xs text-white/35">{t("email-list.fan_seg_preview_empty")}</p>
    ) : (
      <ul className="mt-2 space-y-1">
        {preview.map((f) => (
          <li key={f.id} className="flex items-center justify-between text-xs text-white/60">
            <span className="truncate">{f.displayName ?? f.email ?? f.id}</span>
            {f.spentUsdCents > 0 && <span className="ml-2 shrink-0 text-white/40">{usd(f.spentUsdCents)}</span>}
          </li>
        ))}
      </ul>
    );

  const segmentCard = (opts: {
    key: string;
    title: string;
    description?: string;
    count: number;
    preview: FanPreview[];
    ref: SegmentRef;
    onDelete?: () => void;
  }) => (
    <div key={opts.key} className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{opts.title}</p>
          {opts.description && <p className="mt-0.5 text-xs text-white/45">{opts.description}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary">
          <Users className="h-3.5 w-3.5" />
          {t("email-list.fan_seg_count_fans", { count: opts.count })}
        </span>
      </div>
      {previewList(opts.preview)}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-amber-500 px-4 py-2 text-xs font-bold text-black transition hover:brightness-110"
          onClick={() => {
            setSendRef(opts.ref);
            setSendResult(null);
            setSendError(null);
          }}
        >
          <Mail className="h-3.5 w-3.5" />
          {t("email-list.fan_seg_send_title")}
        </button>
        {opts.onDelete && (
          <button
            type="button"
            aria-label={`${t("email-list.fan_seg_delete")} ${opts.title}`}
            className="rounded-xl border border-white/10 p-2 text-white/40 transition hover:border-red-500/40 hover:text-red-300"
            onClick={opts.onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );

  const triSelect = (label: string, value: string, set: (v: string) => void) => (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-widest text-white/40">{label}</span>
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
      >
        <option value="any">{t("email-list.fan_seg_any")}</option>
        <option value="yes">{t("email-list.fan_seg_yes")}</option>
        <option value="no">{t("email-list.fan_seg_no")}</option>
      </select>
    </label>
  );

  return (
    <div className="mt-10">
      <h3 className="text-center font-display text-2xl font-black">{t("email-list.fan_seg_title")}</h3>
      <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-white/55">{t("email-list.fan_seg_intro")}</p>

      {error && (
        <div className="mx-auto mt-6 flex max-w-2xl items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.fan_seg_presets")}</p>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            {presets.map((p) =>
              segmentCard({
                key: p.id,
                title: p.name,
                description: p.description,
                count: p.count,
                preview: p.preview,
                ref: { presetId: p.id, label: p.name },
              }),
            )}
          </div>

          <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.fan_seg_saved")}</p>
          {!savedAvailable && (
            <p className="mt-2 text-sm text-amber-200/80">{t("email-list.fan_seg_saved_unavailable")}</p>
          )}
          {savedAvailable && saved.length === 0 && (
            <p className="mt-2 text-sm text-white/45">{t("email-list.fan_seg_empty_saved")}</p>
          )}
          {saved.length > 0 && (
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              {saved.map((s) =>
                segmentCard({
                  key: s.id,
                  title: s.name,
                  count: s.count,
                  preview: s.preview,
                  ref: { segmentId: s.id, label: s.name },
                  onDelete: () => void deleteSegment(s.id),
                }),
              )}
            </div>
          )}

          {/* custom builder */}
          <div className={`${cardClass} mt-6`}>
            <h4 className="font-semibold">{t("email-list.fan_seg_custom_title")}</h4>
            <input
              className={`${inputClass} mt-3`}
              placeholder={t("email-list.fan_seg_name_placeholder")}
              value={segName}
              maxLength={80}
              onChange={(e) => setSegName(e.target.value)}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {triSelect(t("email-list.fan_seg_follows"), draft.follows, (v) => setDraft((d) => ({ ...d, follows: v })))}
              {triSelect(t("email-list.fan_seg_subscribed"), draft.subscribed, (v) => setDraft((d) => ({ ...d, subscribed: v })))}
              {triSelect(t("email-list.fan_seg_buyer"), draft.buyer, (v) => setDraft((d) => ({ ...d, buyer: v })))}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.fan_seg_member")}</span>
                <select
                  value={draft.member}
                  onChange={(e) => setDraft((d) => ({ ...d, member: e.target.value }))}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
                >
                  <option value="any">{t("email-list.fan_seg_any")}</option>
                  <option value="active">{t("email-list.fan_seg_member_active")}</option>
                  <option value="member">{t("email-list.fan_seg_member_any_member")}</option>
                  <option value="none">{t("email-list.fan_seg_member_none")}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.fan_seg_min_spent")}</span>
                <input
                  type="number"
                  min={0}
                  className={`${inputClass} mt-1.5`}
                  value={draft.minSpentUsdCents ? draft.minSpentUsdCents / 100 : ""}
                  placeholder="0"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, minSpentUsdCents: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.fan_seg_min_purchases")}</span>
                <input
                  type="number"
                  min={0}
                  className={`${inputClass} mt-1.5`}
                  value={draft.minPurchases || ""}
                  placeholder="0"
                  onChange={(e) => setDraft((d) => ({ ...d, minPurchases: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.fan_seg_active_within")}</span>
                <select
                  value={draft.activeWithinDays}
                  onChange={(e) => setDraft((d) => ({ ...d, activeWithinDays: Number(e.target.value) }))}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
                >
                  <option value={0}>{t("email-list.fan_seg_any")}</option>
                  <option value={7}>7</option>
                  <option value={30}>30</option>
                  <option value={90}>90</option>
                </select>
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={draft.hasEmail}
                  onChange={(e) => setDraft((d) => ({ ...d, hasEmail: e.target.checked }))}
                />
                {t("email-list.fan_seg_has_email")}
              </label>
            </div>

            {draftPreview && (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3">
                <p className="text-sm font-semibold text-primary">{t("email-list.fan_seg_count_fans", { count: draftPreview.count })}</p>
                {previewList(draftPreview.preview)}
              </div>
            )}
            {saveNote && <p className="mt-2 text-sm text-amber-200/80">{saveNote}</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:text-white disabled:opacity-40"
                onClick={() => void previewDraft()}
                disabled={previewing}
              >
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                {t("email-list.fan_seg_preview_btn")}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:text-white disabled:opacity-40"
                onClick={() => setSendRef({ rules: draft, label: segName.trim() || t("email-list.fan_seg_custom_title") })}
              >
                <Mail className="h-4 w-4" />
                {t("email-list.fan_seg_send_title")}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-amber-500 px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40"
                onClick={() => void saveSegment()}
                disabled={saving || !segName.trim()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {t("email-list.fan_seg_save_btn")}
              </button>
            </div>
          </div>

          {/* send composer */}
          {sendRef && (
            <div className={`${cardClass} mt-6`}>
              <h4 className="flex items-center gap-2 font-semibold">
                <Send className="h-4 w-4 text-primary" />
                {t("email-list.fan_seg_send_title")} — {sendRef.label}
              </h4>
              <label className="mt-3 block">
                <span className="text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.fan_seg_list_label")}</span>
                <select
                  value={sendListId}
                  onChange={(e) => setSendListId(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
                >
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} (@{l.handle})
                    </option>
                  ))}
                </select>
              </label>
              <input
                className={`${inputClass} mt-3`}
                placeholder={t("email-list.subject")}
                value={subject}
                maxLength={200}
                onChange={(e) => setSubject(e.target.value)}
              />
              <textarea
                className={`${inputClass} mt-3`}
                rows={6}
                placeholder={t("email-list.body")}
                value={body}
                maxLength={50000}
                onChange={(e) => setBody(e.target.value)}
              />
              {sendResult && <p className="mt-3 text-sm font-semibold text-emerald-300">{sendResult}</p>}
              {sendError && <p className="mt-3 text-sm text-red-300">{sendError}</p>}
              <button
                type="button"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-amber-500 px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40"
                onClick={() => void sendNow()}
                disabled={sending || !sendListId || !subject.trim() || !body.trim()}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t("email-list.fan_seg_send_btn")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
