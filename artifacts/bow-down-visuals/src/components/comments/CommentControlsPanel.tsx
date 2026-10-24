import { useCallback, useEffect, useState } from "react";
import { Pin, EyeOff, Check, X, ShieldCheck, ListFilter } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchCommentSettings,
  saveCommentSettings,
  fetchHeldComments,
  runCommentAction,
  HELD_COPY,
  type CommentHoldMode,
  type CommentSettings,
  type HeldComment,
} from "@/lib/comment-controls";

/* Creator comment controls (#27) — the settings + held queue panel.
   Docks on the creator's OWN surfaces (rendered inside the Shout Wall
   section of their own profile, owner's view only) — never a standalone
   page. Everything here is OFF by default and creator-chosen; held
   comments are a delay in this queue, never a silent deletion. */

const HOLD_MODES: Array<{ value: CommentHoldMode; label: string; blurb: string }> = [
  { value: "off", label: "Off — comments post right away", blurb: "The default. Nothing is held." },
  { value: "first_time", label: "Hold first-time commenters", blurb: "A fan's first comment on your content waits for your review; after that they post freely." },
  { value: "all", label: "Hold every comment", blurb: "Every audience comment waits in your queue until you approve it." },
];

export function CommentControlsPanel() {
  const { getAccessToken } = useAuth();
  const [settings, setSettings] = useState<CommentSettings | null>(null);
  const [wordsDraft, setWordsDraft] = useState("");
  const [held, setHeld] = useState<HeldComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const [s, q] = await Promise.all([
        fetchCommentSettings(token).catch(() => null),
        fetchHeldComments(token).catch(() => null),
      ]);
      if (s) {
        setSettings(s);
        setWordsDraft(s.blocked_words.join(", "));
      }
      if (q) setHeld(q.comments);
      if (!s && !q) setUnavailable(true);
    } catch {
      setUnavailable(true);
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  if (unavailable) return null;
  if (!settings) return null;

  async function save(patch: { hold_mode?: CommentHoldMode; blocked_words?: string[] }) {
    setBusy(true);
    setNote(null);
    try {
      const token = await getAccessToken();
      const next = await saveCommentSettings(token, patch);
      setSettings(next);
      setWordsDraft(next.blocked_words.join(", "));
      setNote("Saved. Your comments, your rules.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function act(c: HeldComment, action: "approve" | "reject") {
    setBusy(true);
    try {
      const token = await getAccessToken();
      await runCommentAction(token, c.surface, c.id, action);
      setHeld((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't stick — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border p-4" style={{ backgroundColor: "var(--ap-card)", borderColor: "var(--ap-border)" }}>
      <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--ap-text)" }}>
        <ShieldCheck className="h-4 w-4" style={{ color: "var(--ap-primary)" }} /> Your comment controls
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--ap-muted)" }}>
        These are your controls for comments on your own posts, videos and wall — separate from the platform's
        moderation. Everything is off until you turn it on, and it's free.
      </p>

      <div className="mt-3 space-y-2">
        {HOLD_MODES.map((m) => (
          <label key={m.value} className="flex cursor-pointer items-start gap-2 text-sm" style={{ color: "var(--ap-text)" }}>
            <input
              type="radio"
              name="hold-mode"
              checked={settings.hold_mode === m.value}
              disabled={busy}
              onChange={() => void save({ hold_mode: m.value })}
              className="mt-1"
            />
            <span>
              <span className="font-semibold">{m.label}</span>
              <span className="block text-xs" style={{ color: "var(--ap-muted)" }}>{m.blurb}</span>
            </span>
          </label>
        ))}
      </div>

      <label className="mt-4 block text-xs font-semibold" style={{ color: "var(--ap-muted)" }}>
        <ListFilter className="mr-1 inline h-3.5 w-3.5" />
        Keyword blocklist — comments using these words or phrases are held for your review, never deleted (comma separated)
      </label>
      <div className="mt-1 flex gap-2">
        <input
          value={wordsDraft}
          onChange={(e) => setWordsDraft(e.target.value)}
          placeholder="e.g. spamword, free money"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: "var(--ap-surface)", borderColor: "var(--ap-border)", color: "var(--ap-text)" }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void save({ blocked_words: wordsDraft.split(",").map((w) => w.trim()).filter(Boolean) })}
          className="rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-40"
          style={{ backgroundColor: "var(--ap-primary)", color: "#000" }}
        >
          Save
        </button>
      </div>

      <div className="mt-4">
        <p className="text-sm font-bold" style={{ color: "var(--ap-text)" }}>
          Held for your review ({held.length})
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--ap-muted)" }}>
          Held is a delay, not a deletion — {HELD_COPY} Rejecting moves a comment to hidden; it is never deleted,
          and its author can still see it marked hidden.
        </p>
        {held.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "var(--ap-muted)" }}>Nothing waiting. Your queue is clear.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {held.map((c) => (
              <div key={`${c.surface}-${c.id}`} className="rounded-lg border p-3" style={{ borderColor: "var(--ap-border)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--ap-muted)" }}>
                  {c.surface === "media" ? `On your ${c.media_kind ?? "media"}${c.media_title ? ` “${c.media_title}”` : ""}` : "On your wall"}
                  {c.held_reason ? ` · held: ${c.held_reason.replace(/_/g, " ")}` : ""}
                </p>
                <p className="mt-1 text-sm" style={{ color: "var(--ap-text)" }}>{c.body}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void act(c, "approve")}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold disabled:opacity-40"
                    style={{ backgroundColor: "var(--ap-primary)", color: "#000" }}>
                    <Check className="h-3.5 w-3.5" /> Approve — post it
                  </button>
                  <button type="button" disabled={busy} onClick={() => void act(c, "reject")}
                    className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-40"
                    style={{ borderColor: "var(--ap-border)", color: "var(--ap-text)" }}>
                    <X className="h-3.5 w-3.5" /> Reject — hide it
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs" style={{ color: "var(--ap-muted)" }}>
        <Pin className="h-3.5 w-3.5" /> Pin one favourite comment per post from the comment itself.
        <EyeOff className="ml-2 h-3.5 w-3.5" /> Hide is reversible — hidden comments stay visible to you and their author, marked hidden.
      </p>
      {note && <p className="mt-2 text-xs font-semibold" style={{ color: "var(--ap-primary)" }}>{note}</p>}
    </div>
  );
}
