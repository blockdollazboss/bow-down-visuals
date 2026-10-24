import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Megaphone, Send, Undo2, XCircle } from "lucide-react";
import {
  CO_POST_CONSENT_COPY,
  CO_POSTS_MINE_PATH,
  CO_POSTS_PATH,
  coPostActionPath,
  coPostStateLabel,
  coPostViewerActions,
  standingAuthors,
  type CoPostItem,
} from "@/lib/co-posts";

/* ─── Co-posts panel — the Collabs payoff step (Stack-100 #3, #24) ──────────
   Docked INSIDE the Collabs page (PROMOTE step of the flow), never a
   standalone page: an accepted collab — or a direct co-author invite —
   becomes one Feed post on BOTH creators' profiles.

   The consent copy on this panel is the product rule, stated where the
   creators act on it (lib/co-posts CO_POST_CONSENT_COPY, pinned by
   tests): both approve before it goes live; one shared set of likes
   and comments, never counted twice; either side can withdraw THEIR
   side — the post leaves their profile, the other creator keeps
   theirs. */

export interface CoPostPartner {
  userId: string;
  displayName: string;
  /* The accepted collab request this partnership came from, if any. */
  collabRequestId?: string;
}

type AuthedFn = (
  path: string,
  opts?: { method?: string; body?: unknown },
) => Promise<{ res: Response; data: Record<string, unknown> }>;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const labelClass = "mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/50";
const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-yellow-600 px-5 py-3 text-sm font-extrabold uppercase tracking-wider text-black shadow-[0_0_24px_rgba(234,179,8,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white disabled:opacity-50";

export function CoPostsPanel({
  authed,
  partners,
  preselectUserId,
}: {
  authed: AuthedFn;
  partners: CoPostPartner[];
  preselectUserId: string | null;
}) {
  const [items, setItems] = useState<CoPostItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setupPending, setSetupPending] = useState(false);

  const [partnerUserId, setPartnerUserId] = useState("");
  const [body, setBody] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const { res, data } = await authed(CO_POSTS_MINE_PATH);
      if (!res.ok) throw new Error("load failed");
      setItems((data.posts as CoPostItem[]) ?? []);
      setSetupPending(data.pending_setup === true);
    } catch {
      setLoadError("Couldn't load your co-posts — try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (preselectUserId) setPartnerUserId(preselectUserId);
  }, [preselectUserId]);

  async function create() {
    if (creating || !partnerUserId || !body.trim()) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      const partner = partners.find((p) => p.userId === partnerUserId);
      const { res, data } = await authed(CO_POSTS_PATH, {
        method: "POST",
        body: {
          body: body.trim(),
          co_author_user_id: partnerUserId,
          ...(partner?.collabRequestId ? { collab_request_id: partner.collabRequestId } : {}),
          ...(mediaUrl.trim()
            ? { media_urls: [{ kind: "image", url: mediaUrl.trim() }] }
            : {}),
        },
      });
      if (res.status === 503) {
        setCreateMsg("Co-posts are almost ready — the final setup step hasn't landed yet, so nothing was posted and your collaborator hasn't been notified.");
        return;
      }
      if (!res.ok) throw new Error((data.message as string) || (data.error as string) || "Couldn't create that co-post.");
      setBody("");
      setMediaUrl("");
      setCreateMsg("Co-post created — it's waiting on your collaborator's approval. It goes live on both profiles only when they approve it.");
      load();
    } catch (err) {
      setCreateMsg(err instanceof Error ? err.message : "Couldn't create that co-post.");
    } finally {
      setCreating(false);
    }
  }

  async function act(item: CoPostItem, action: "accept" | "decline" | "withdraw") {
    if (actingId) return;
    if (
      action === "withdraw" &&
      !window.confirm(
        "Withdraw your side of this co-post? The post leaves YOUR profile, and the other creator keeps theirs — with the same likes and comments. This is exactly your side only.",
      )
    ) {
      return;
    }
    setActingId(item.id);
    try {
      const { res, data } = await authed(coPostActionPath(item.id, action), { method: "POST", body: {} });
      if (res.status === 503) {
        setLoadError("Co-posts are almost ready — the final setup step hasn't landed yet, so nothing changed.");
        return;
      }
      if (!res.ok) throw new Error((data.message as string) || "Couldn't update that co-post.");
      load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't update that co-post.");
    } finally {
      setActingId(null);
    }
  }

  const awaitingMe = items.filter((i) => i.viewer_side?.status === "pending" && i.co_post_state === "pending");

  return (
    <section className="mx-auto max-w-3xl">
      {/* consent rules — stated where creators act on them */}
      <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/[0.04] p-5">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-extrabold text-white">
          <Megaphone className="h-5 w-5 text-amber-300" /> Co-posts — one post, both audiences
        </h2>
        <ul className="space-y-1.5 text-sm leading-relaxed text-white/70">
          <li>🤝 {CO_POST_CONSENT_COPY.bothApprove}</li>
          <li>📊 {CO_POST_CONSENT_COPY.sharedCounts}</li>
          <li>↩️ {CO_POST_CONSENT_COPY.withdraw}</li>
          <li className="text-white/45">Co-posts are public posts — they go to both audiences. Creating and approving a co-post is free.</li>
        </ul>
      </div>

      {/* create */}
      <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="mb-4 text-base font-extrabold text-white">Start a co-post</h3>
        {partners.length === 0 ? (
          <p className="text-sm text-white/50">
            No collaborators yet — browse creators above, or accept a collab in your inbox, and they'll appear here as co-post partners.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Co-author</label>
              <select value={partnerUserId} onChange={(e) => setPartnerUserId(e.target.value)} className={inputClass}>
                <option value="">Choose your collaborator…</option>
                {partners.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.displayName}
                    {p.collabRequestId ? " · accepted collab" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>The post</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="What did you two make together?"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Image URL (optional)</label>
              <input
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://…"
                className={inputClass}
              />
            </div>
            <button onClick={create} disabled={creating || !partnerUserId || !body.trim()} className={goldBtn}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {creating ? "Creating…" : "Send for their approval"}
            </button>
            <p className="text-xs text-white/40">
              Your side is approved the moment you create it (you wrote it). The post is NOT live until your co-author approves it too.
            </p>
          </div>
        )}
        {createMsg && <p className="mt-3 text-sm text-white/60">{createMsg}</p>}
      </div>

      {/* mine */}
      <h3 className="mb-3 text-base font-extrabold text-white">
        Your co-posts{awaitingMe.length > 0 ? ` — ${awaitingMe.length} waiting on you` : ""}
      </h3>
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <p className="text-sm text-red-300">{loadError}</p>
          <button onClick={load} className={`${ghostBtn} mt-3`}>Try again</button>
        </div>
      ) : setupPending ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/50">
          Co-posts are almost ready — the final setup step hasn't landed yet. Nothing is waiting on you.
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/40">
          No co-posts yet — start one above and it lands here, along with any invites waiting on your approval.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const names = standingAuthors(item.authors).map((a) => a.display_name ?? "Creator");
            const actions = coPostViewerActions(item);
            return (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-white">{names.join(" × ") || "Co-post"}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      item.co_post_state === "live"
                        ? "bg-emerald-400/15 text-emerald-300"
                        : item.co_post_state === "pending"
                          ? "bg-amber-400/15 text-amber-300"
                          : "bg-white/10 text-white/50"
                    }`}
                  >
                    {coPostStateLabel(item.co_post_state)}
                  </span>
                </div>
                <p className="mb-2 whitespace-pre-wrap text-sm text-white/75">{item.body}</p>
                <p className="mb-3 text-xs text-white/40">
                  {item.engagement.like_count} likes · {item.engagement.reply_count} comments · {item.engagement.repost_count} reposts
                  {" "}— one shared set, the same on both profiles.
                </p>
                {item.co_post_state === "live_one_side" && (
                  <p className="mb-3 text-xs text-white/45">{CO_POST_CONSENT_COPY.withdraw}</p>
                )}
                {actions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {actions.includes("accept") && (
                      <button onClick={() => act(item, "accept")} disabled={actingId === item.id} className={ghostBtn}>
                        <CheckCircle2 className="h-4 w-4" /> Approve — post it on both profiles
                      </button>
                    )}
                    {actions.includes("decline") && (
                      <button onClick={() => act(item, "decline")} disabled={actingId === item.id} className={ghostBtn}>
                        <XCircle className="h-4 w-4" /> Decline
                      </button>
                    )}
                    {actions.includes("withdraw") && (
                      <button onClick={() => act(item, "withdraw")} disabled={actingId === item.id} className={ghostBtn}>
                        <Undo2 className="h-4 w-4" /> Withdraw my side
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
