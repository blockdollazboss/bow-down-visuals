import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Loader2, Send, Sparkles, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* Wave 8 · Hook Rewriter — docks in Hook Studio after the generator UI.
   Rewrites the opening hook of an underperforming post into 5 variants.
   "Send to generator" pushes the variant into Hook Studio's topic state
   via onUseAsTopic; "Send to Scheduler" stashes the hook in localStorage
   (wave8_scheduler_draft) for the Scheduler page to pick up. */

export interface HookVariant {
  hook: string;
  angle: string;
  whyItWorks: string;
}

interface HookRewriterProps {
  onUseAsTopic: (text: string) => void;
}

const SCHEDULER_DRAFT_KEY = "wave8_scheduler_draft";

export default function HookRewriter({ onUseAsTopic }: HookRewriterProps) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();

  const [post, setPost] = useState("");
  const [niche, setNiche] = useState("");
  const [variants, setVariants] = useState<HookVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [sentToGenerator, setSentToGenerator] = useState<Record<number, boolean>>({});
  const [savedForScheduler, setSavedForScheduler] = useState<Record<number, boolean>>({});

  async function handleRewrite() {
    if (!post.trim()) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setVariants([]);
    setSentToGenerator({});
    setSavedForScheduler({});
    try {
      const res = await confirmedFetch("/api/wave8/hook-rewriter/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post: post.trim(), niche: niche.trim() || undefined }),
      });
      if (!res) {
        /* User cancelled the credit confirmation. */
        setLoading(false);
        return;
      }
      if (res.status === 402) {
        setOutOfCredits(true);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { variants?: HookVariant[] };
      if (!Array.isArray(data.variants) || data.variants.length !== 5) {
        throw new Error("bad shape");
      }
      setVariants(data.variants);
    } catch {
      setError(t("wave8.hookRewriter.errorRewrite"));
    } finally {
      setLoading(false);
    }
  }

  function handleSendToGenerator(index: number, hook: string) {
    onUseAsTopic(hook);
    setSentToGenerator((prev) => ({ ...prev, [index]: true }));
  }

  function handleSendToScheduler(index: number, hook: string) {
    try {
      window.localStorage.setItem(SCHEDULER_DRAFT_KEY, hook);
    } catch {
      /* storage unavailable — the link still gets them to the Scheduler */
    }
    setSavedForScheduler((prev) => ({ ...prev, [index]: true }));
  }

  return (
    <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Zap className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-bold">{t("wave8.hookRewriter.title")}</h2>
          <p className="text-sm text-white/45">{t("wave8.hookRewriter.sub")}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_240px]">
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/40">
            {t("wave8.hookRewriter.postLabel")}
          </label>
          <textarea
            value={post}
            onChange={(e) => setPost(e.target.value)}
            placeholder={t("wave8.hookRewriter.postPlaceholder")}
            maxLength={2000}
            rows={4}
            className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/40">
              {t("wave8.hookRewriter.nicheLabel")}
            </label>
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder={t("wave8.hookRewriter.nichePlaceholder")}
              maxLength={100}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
            />
          </div>
          <Button
            onClick={handleRewrite}
            disabled={loading || post.trim().length === 0}
            className="bg-primary font-bold text-black hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {loading ? t("wave8.hookRewriter.rewriting") : t("wave8.hookRewriter.rewrite")}
          </Button>
        </div>
      </div>

      {outOfCredits && (
        <div className="mx-auto mt-4 max-w-md">
          <OutOfCredits />
        </div>
      )}
      {error && (
        <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {variants.length > 0 && (
        <div className="mt-8">
          <p className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("wave8.hookRewriter.title")}
          </p>
          <div className="grid gap-3">
            {variants.map((v, i) => (
              <div
                key={`rewrite-${i}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40"
              >
                <div className="flex items-start gap-3.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-relaxed text-white/90">“{v.hook}”</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                        {v.angle}
                      </span>
                      <span className="text-[12px] text-white/45">
                        <span className="font-semibold text-white/60">
                          {t("wave8.hookRewriter.whyLabel")}:
                        </span>{" "}
                        {v.whyItWorks}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleSendToGenerator(i, v.hook)}
                        className="flex items-center gap-1.5 rounded-full border border-primary/40 px-3.5 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black"
                      >
                        {sentToGenerator[i] ? (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {sentToGenerator[i]
                          ? t("wave8.hookRewriter.sentToGenerator")
                          : t("wave8.hookRewriter.sendToGenerator")}
                      </button>
                      {savedForScheduler[i] ? (
                        <Link
                          href="/scheduler"
                          className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-black transition hover:bg-primary/90"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          {t("wave8.hookRewriter.savedForScheduler")}
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ) : (
                        <button
                          onClick={() => handleSendToScheduler(i, v.hook)}
                          className="flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/40 hover:text-white"
                        >
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                          {t("wave8.hookRewriter.sendToScheduler")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
