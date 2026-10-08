import { useEffect, useState } from "react";
import { Link } from "wouter";
import { TrendingUp, Hash, MessageCircle, Clapperboard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { apiJson, type TrendingTopic } from "@/lib/social-api";

/* ─── /trending — what's moving in the last 24h ───────────────────────────
   Hashtag velocity from posts + video tags. Every topic links to its
   hashtag page (/hashtag/:tag) — topics that go nowhere are a bug. */
export default function TrendingPage() {
  const { getAccessToken } = useAuth();
  const [topics, setTopics] = useState<TrendingTopic[]>([]);
  const [loading, setLoading] = useState(true);

  usePageTitle("Trending", "The hashtags moving right now across posts and videos.");

  useEffect(() => {
    apiJson<{ topics: TrendingTopic[] }>(getAccessToken, "/api/trending/topics")
      .then((d) => setTopics(d.topics))
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-24 pt-6">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-black text-white">
        <TrendingUp className="h-6 w-6 text-[#d4af37]" /> Trending
      </h1>
      <p className="mb-6 text-xs text-neutral-500">Hashtag velocity over the last 24 hours — posts + video tags.</p>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-[#2a2a2a] bg-[#111]" />
          ))}
        </div>
      )}

      {!loading && topics.length === 0 && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#111] p-10 text-center">
          <p className="text-lg font-bold text-white">Nothing trending yet 🦈</p>
          <p className="mt-2 text-sm text-neutral-400">Start a hashtag in your next post and watch it climb.</p>
        </div>
      )}

      <div className="space-y-3">
        {topics.map((t, i) => (
          <Link
            key={t.tag}
            href={`/hashtag/${t.tag}`}
            className="flex items-center gap-4 rounded-2xl border border-[#2a2a2a] bg-[#111] p-4 transition hover:border-[#d4af37]/60"
          >
            <span className="w-8 text-center text-lg font-black text-[#d4af37]">{i + 1}</span>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#d4af37]/10">
              <Hash className="h-5 w-5 text-[#d4af37]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-bold text-white">#{t.tag}</span>
              <span className="mt-0.5 flex items-center gap-3 text-xs text-neutral-400">
                <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{t.posts} posts</span>
                <span className="flex items-center gap-1"><Clapperboard className="h-3.5 w-3.5" />{t.videos} videos</span>
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-[#d4af37]/10 px-3 py-1 text-xs font-bold text-[#d4af37]">
              {t.velocity} heat
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
