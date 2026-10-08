import { useMemo, useState } from "react";
import { ImagePlus, Link2, Music2, ShoppingBag, CalendarDays, Sparkles, Plus, X, BarChart3, Globe, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson, type Attachment, type FeedPost } from "@/lib/social-api";

/* The composer — difficulty ladder via data-min-stars (never gates posting):
   1★  simple box + AI "write it for me"
   2-3★ media attach, thread mode ("add another"), polls
   4-6★ scheduling, audience targeting
   Money guidance is always on: "attach your product" + sell-word nudges. */

const SELL_RE = /\b(buy|sale|drop|merch|presave|pre-save|ticket|discount|shop|link in bio|out now|stream it)\b/i;

export function Composer({
  onPosted,
  quoteOf,
  replyTo,
  placeholder,
}: {
  onPosted?: (post: FeedPost) => void;
  quoteOf?: { id: string; body: string; authorName: string } | null;
  replyTo?: string | null;
  placeholder?: string;
}) {
  const { getAccessToken } = useAuth();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [threadExtras, setThreadExtras] = useState<string[]>([]);
  const [pollOptions, setPollOptions] = useState<string[]>([]);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollDraft, setPollDraft] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [audience, setAudience] = useState<"public" | "followers">("public");
  const [urlDraft, setUrlDraft] = useState("");
  const [showUrlBox, setShowUrlBox] = useState(false);
  const [urlMode, setUrlMode] = useState<"media" | "product" | "track" | "event">("media");
  const [assistPrompt, setAssistPrompt] = useState("");
  const [showAssist, setShowAssist] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasProduct = attachments.some((a) => a.kind === "product");
  const showMoneyNudge = useMemo(
    () => SELL_RE.test(body) && !hasProduct && body.trim().length > 10,
    [body, hasProduct],
  );

  function addAttachment(a: Attachment) {
    setAttachments((prev) => (prev.length >= 10 ? prev : [...prev, a]));
  }

  function attachUrl() {
    const url = urlDraft.trim();
    if (!url) return;
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);
    addAttachment(isVideo ? { kind: "video", url } : { kind: "image", url });
    setUrlDraft("");
    setShowUrlBox(false);
  }

  function attachMoney(kind: "product" | "track" | "event") {
    /* Link-graph rule: unparseable links are rejected, never attached —
       a product mention with no destination is a bug. */
    const url = urlDraft.trim();
    setShowUrlBox(false);
    setError(null);
    if (kind === "product") {
      const m = url.match(/\/store\/buy\/([^/]+)\/([0-9a-f-]{36})/i);
      const shop = url.match(/\/shop\/([a-z0-9-]+)/i);
      if (m) addAttachment({ kind: "product", id: m[2], kindSlug: m[1], title: "My drop" });
      else if (shop) addAttachment({ kind: "product", id: `shop-${shop[1]}`, kindSlug: "shop", storeSlug: shop[1], title: "My shop" });
      else setError("Paste your drop link (/store/buy/…) or shop link (/shop/…) so buyers land somewhere real.");
      setUrlDraft("");
      return;
    }
    if (kind === "track") {
      const m = url.match(/\/(track|watch)\/([0-9a-f-]{36})/i);
      if (m && m[1].toLowerCase() === "track") addAttachment({ kind: "track", id: m[2], title: "My track" });
      else if (m) addAttachment({ kind: "watch", id: m[2], title: "My video" });
      else setError("Paste your sound link (/track/… or /watch/…) so fans land on the sound page.");
      setUrlDraft("");
      return;
    }
    addAttachment({ kind: "event", id: `event-${Date.now()}`, title: url || "My event" });
    setUrlDraft("");
  }

  async function assist() {
    if (!assistPrompt.trim() || assisting) return;
    setAssisting(true);
    setError(null);
    try {
      const data = await apiJson<{ draft: string }>(getAccessToken, "/api/posts/assist", {
        method: "POST",
        body: JSON.stringify({ prompt: assistPrompt.trim(), tone: "hype" }),
      });
      if (data.draft) setBody((b) => (b ? `${b}\n\n${data.draft}` : data.draft).slice(0, 500));
      setAssistPrompt("");
      setShowAssist(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't draft that.");
    } finally {
      setAssisting(false);
    }
  }

  async function publish() {
    if ((!body.trim() && attachments.length === 0 && pollOptions.length === 0) || posting) return;
    setPosting(true);
    setError(null);
    try {
      if (replyTo) {
        const data = await apiJson<{ post: FeedPost }>(getAccessToken, `/api/posts/${replyTo}/reply`, {
          method: "POST",
          body: JSON.stringify({ body: body.trim().slice(0, 500) }),
        });
        setBody("");
        onPosted?.(data.post);
        return;
      }
      const payload: Record<string, unknown> = {
        body: body.trim().slice(0, 500) || (pollOptions.length ? "📊" : ""),
        media_urls: attachments,
        kind: quoteOf ? "quote" : "post",
        quote_of: quoteOf?.id ?? null,
        audience,
        scheduled_for: scheduledFor || null,
      };
      if (pollOptions.length >= 2) payload.poll = pollOptions;
      const data = await apiJson<{ post: FeedPost }>(getAccessToken, "/api/posts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      /* Thread mode: "add another" — each extra becomes a reply chained below. */
      let parentId: string | null = data.post.id;
      for (const extra of threadExtras) {
        if (!extra.trim()) continue;
        const r: { post: FeedPost } = await apiJson(getAccessToken, `/api/posts/${parentId}/reply`, {
          method: "POST",
          body: JSON.stringify({ body: extra.trim().slice(0, 500) }),
        });
        parentId = r.post.id;
      }
      setBody("");
      setAttachments([]);
      setThreadExtras([]);
      setPollOptions([]);
      setPollOpen(false);
      setScheduledFor("");
      onPosted?.(data.post);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish that post.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#111] p-4">
      {quoteOf && (
        <div className="mb-3 rounded-xl border border-[#d4af37]/30 bg-[#0d0d0d] p-3">
          <p className="text-xs font-semibold text-[#d4af37]">Quoting {quoteOf.authorName}</p>
          <p className="mt-1 line-clamp-2 text-sm text-neutral-300">{quoteOf.body}</p>
        </div>
      )}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 500))}
        placeholder={placeholder ?? "What's moving in your world? 🦈"}
        rows={3}
        className="w-full resize-none bg-transparent text-[15px] text-white placeholder:text-neutral-500 focus:outline-none"
      />

      {/* thread extras (not in reply mode — a reply is one shot) */}
      {!replyTo && threadExtras.map((t, i) => (
        <div key={i} className="mt-2 flex items-start gap-2">
          <span className="mt-2 text-[#d4af37]">↳</span>
          <textarea
            value={t}
            onChange={(e) => {
              const next = [...threadExtras];
              next[i] = e.target.value.slice(0, 500);
              setThreadExtras(next);
            }}
            placeholder={`Thread ${i + 2}…`}
            rows={2}
            className="flex-1 resize-none rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] p-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-[#d4af37] focus:outline-none"
          />
          <button
            onClick={() => setThreadExtras(threadExtras.filter((_, j) => j !== i))}
            aria-label="Remove thread post"
            className="mt-2 text-neutral-500 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      {/* poll builder (2-3★) */}
      {!replyTo && <div data-min-stars="2">
        {pollOpen && (
          <>
            {pollOptions.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {pollOptions.map((o, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-white">
                    <BarChart3 className="h-4 w-4 text-[#d4af37]" />
                    <span className="flex-1 truncate">{o}</span>
                    <button onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))} aria-label="Remove option" className="text-neutral-500 hover:text-white">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {pollOptions.length < 4 && (
              <div className="mt-2 flex gap-2">
                <input
                  value={pollDraft}
                  onChange={(e) => setPollDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && pollDraft.trim()) {
                      setPollOptions([...pollOptions, pollDraft.trim().slice(0, 80)]);
                      setPollDraft("");
                    }
                  }}
                  placeholder={pollOptions.length === 0 ? "Poll option 1…" : "Add another option…"}
                  maxLength={80}
                  className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#d4af37] focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (pollDraft.trim()) {
                      setPollOptions([...pollOptions, pollDraft.trim().slice(0, 80)]);
                      setPollDraft("");
                    }
                  }}
                  className="rounded-lg border border-[#d4af37]/40 px-3 text-sm font-semibold text-[#d4af37]"
                >
                  Add
                </button>
              </div>
            )}
          </>
        )}
      </div>}

      {/* attachment chips */}
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <span key={i} className="flex items-center gap-1.5 rounded-full border border-[#d4af37]/40 bg-[#1a1408] px-3 py-1 text-xs text-[#d4af37]">
              {a.kind === "product" ? <ShoppingBag className="h-3.5 w-3.5" /> : a.kind === "track" || a.kind === "video" ? <Music2 className="h-3.5 w-3.5" /> : <ImagePlus className="h-3.5 w-3.5" />}
              {a.kind} · {a.kind === "image" || a.kind === "video" ? a.url.slice(0, 24) : a.kind === "poll" ? "poll" : a.title || "attached"}
              <button onClick={() => setAttachments(attachments.filter((_, j) => j !== i))} aria-label="Remove attachment" className="text-[#d4af37]/70 hover:text-[#d4af37]">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* money nudge — guide them to the money, every step */}
      {showMoneyNudge && (
        <div className="mt-3 rounded-xl border border-[#d4af37]/50 bg-gradient-to-r from-[#1a1408] to-transparent p-3">
          <p className="text-sm text-[#f5e08c]">
            💰 This post could sell — <button className="font-bold underline" onClick={() => { setUrlMode("product"); setShowUrlBox(true); }}>link your drop</button> and let it earn while you sleep.
          </p>
        </div>
      )}

      {/* URL attach box */}
      {showUrlBox && (
        <div className="mt-2 flex gap-2">
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (urlMode === "media") attachUrl();
                else attachMoney(urlMode);
              }
            }}
            placeholder={
              urlMode === "product"
                ? "Paste your drop link (/store/buy/…) or shop link (/shop/…)"
                : urlMode === "track"
                  ? "Paste your sound link (/track/… or /watch/…)"
                  : urlMode === "event"
                    ? "Name this event (links to /shows)"
                    : "Paste an image or video URL…"
            }
            className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#d4af37] focus:outline-none"
          />
          <button
            onClick={() => (urlMode === "media" ? attachUrl() : attachMoney(urlMode))}
            className="rounded-lg border border-[#d4af37]/40 px-3 text-sm font-semibold text-[#d4af37]"
            aria-label="Attach link"
          >
            <Link2 className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* AI assist (1★) */}
      <div data-min-stars="1">
        {showAssist ? (
          <div className="mt-2 flex gap-2">
            <input
              value={assistPrompt}
              onChange={(e) => setAssistPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && assist()}
              placeholder="What should it say? (1 Visual Buc)"
              maxLength={300}
              className="flex-1 rounded-lg border border-[#d4af37]/40 bg-[#0d0d0d] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#d4af37] focus:outline-none"
            />
            <button onClick={assist} disabled={assisting || !assistPrompt.trim()} className="rounded-lg bg-[#d4af37] px-4 text-sm font-bold text-black disabled:opacity-40">
              {assisting ? "…" : "Write"}
            </button>
          </div>
        ) : null}
      </div>

      {/* schedule + audience (4-6★) */}
      {!replyTo && <div data-min-stars="4" className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <CalendarDays className="h-4 w-4 text-[#d4af37]" />
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-1.5 text-xs text-white focus:border-[#d4af37] focus:outline-none"
          />
        </label>
        <div className="flex overflow-hidden rounded-lg border border-[#2a2a2a] text-xs">
          <button onClick={() => setAudience("public")} className={`flex items-center gap-1 px-3 py-1.5 ${audience === "public" ? "bg-[#d4af37] font-bold text-black" : "text-neutral-400"}`}>
            <Globe className="h-3.5 w-3.5" /> Everyone
          </button>
          <button onClick={() => setAudience("followers")} className={`flex items-center gap-1 px-3 py-1.5 ${audience === "followers" ? "bg-[#d4af37] font-bold text-black" : "text-neutral-400"}`}>
            <Users className="h-3.5 w-3.5" /> Followers
          </button>
        </div>
      </div>}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {/* action row — posting is never gated */}
      <div className="mt-3 flex items-center justify-between border-t border-[#1f1f1f] pt-3">
        {!replyTo && <div className="flex items-center gap-1">
          <button data-min-stars="2" onClick={() => { setUrlMode("media"); setShowUrlBox((v) => !v); }} title="Attach image/video link" className="rounded-full p-2 text-[#d4af37] hover:bg-[#d4af37]/10">
            <ImagePlus className="h-5 w-5" />
          </button>
          <button data-min-stars="2" onClick={() => { setUrlMode("track"); setShowUrlBox(true); }} title="Attach your sound (links to its page)" className="rounded-full p-2 text-[#d4af37] hover:bg-[#d4af37]/10">
            <Music2 className="h-5 w-5" />
          </button>
          <button data-min-stars="2" onClick={() => { setUrlMode("event"); setShowUrlBox(true); }} title="Attach your event (links to /shows)" className="rounded-full p-2 text-[#d4af37] hover:bg-[#d4af37]/10">
            <CalendarDays className="h-5 w-5" />
          </button>
          <button data-min-stars="2" onClick={() => setThreadExtras([...threadExtras, ""])} title="Add another (thread)" className="rounded-full p-2 text-[#d4af37] hover:bg-[#d4af37]/10">
            <Plus className="h-5 w-5" />
          </button>
          <button data-min-stars="2" onClick={() => { setPollOpen((v) => !v); if (pollOpen) setPollOptions([]); }} title="Add poll" className={`rounded-full p-2 hover:bg-[#d4af37]/10 ${pollOpen ? "bg-[#d4af37]/15 text-[#f5e08c]" : "text-[#d4af37]"}`}>
            <BarChart3 className="h-5 w-5" />
          </button>
          {/* money buttons — always visible, never gated */}
          <button onClick={() => { setUrlMode("product"); setShowUrlBox(true); }} title="Attach your product (link your drop)" className="flex items-center gap-1 rounded-full p-2 text-[#d4af37] hover:bg-[#d4af37]/10">
            <ShoppingBag className="h-5 w-5" />
            <span className="hidden text-xs font-semibold sm:inline">link your drop</span>
          </button>
          <button data-min-stars="1" onClick={() => setShowAssist((v) => !v)} title="AI writes it for you (1 Visual Buc)" className="flex items-center gap-1 rounded-full p-2 text-[#d4af37] hover:bg-[#d4af37]/10">
            <Sparkles className="h-5 w-5" />
            <span className="hidden text-xs font-semibold sm:inline">write it for me</span>
          </button>
        </div>}
        <div className="flex items-center gap-3">
          <span className={`text-xs ${body.length >= 500 ? "text-red-400" : "text-neutral-500"}`}>{body.length}/500</span>
          <button
            onClick={publish}
            disabled={posting || (!body.trim() && attachments.length === 0 && pollOptions.length < 2)}
            className="rounded-full bg-[#d4af37] px-6 py-2 text-sm font-bold text-black disabled:opacity-40"
          >
            {posting ? "Posting…" : replyTo ? "Reply" : scheduledFor ? "Schedule" : "Post"}
          </button>
        </div>
      </div>
      {pollOptions.length === 1 && (
        <p className="mt-1 text-right text-[11px] text-neutral-500">Polls need at least 2 options — add another above.</p>
      )}
    </div>
  );
}
