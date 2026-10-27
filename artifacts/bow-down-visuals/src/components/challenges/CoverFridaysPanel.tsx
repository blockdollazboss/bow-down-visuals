import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Music2, Crown, CalendarClock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson } from "@/lib/social-api";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── Cover Fridays (N19) ────────────────────────────────────────────────
   Docked on the Contests hub. The weekly cover ritual: theme + window
   from GET /api/cover-fridays/current, leaderboard ranked by REAL plays.
   Post a cover video tagged #CoverFriday between Friday and Sunday
   night (New York) to enter — that's the whole rulebook. */

interface CoverEntryView {
  id: string;
  title: string;
  plays: number;
  creator: { name: string; slug: string } | null;
}
interface CycleView {
  weekKey: string;
  theme: string;
  opensAt: number;
  closesAt: number;
  phase: "open" | "before" | "closed";
}

export default function CoverFridaysPanel() {
  const { getAccessToken } = useAuth();
  const isLight = useIsLightTheme();
  const [cycle, setCycle] = useState<CycleView | null>(null);
  const [entries, setEntries] = useState<CoverEntryView[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiJson<{ cycle: CycleView; entries: CoverEntryView[] }>(getAccessToken, "/api/cover-fridays/current")
      .then((d) => {
        if (!live) return;
        setCycle(d.cycle);
        setEntries(d.entries ?? []);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed || !cycle) return null;

  const card = isLight
    ? "border-amber-900/15 bg-[#FFF9EA] text-[#2A1E07]"
    : "border-white/10 bg-white/[0.03] text-white";
  const sub = isLight ? "text-[#2A1E07]/60" : "text-white/55";

  return (
    <section aria-label="Cover Fridays" className={`mb-6 rounded-3xl border p-5 ${card}`}>
      <header className="mb-1 flex items-center gap-2">
        <Music2 className="h-5 w-5 text-amber-500" aria-hidden />
        <h2 className="text-lg font-extrabold">Cover Fridays</h2>
        <span className={`ml-auto flex items-center gap-1 text-xs ${sub}`}>
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          {cycle.phase === "open"
            ? `Open now — closes ${new Date(cycle.closesAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`
            : `Opens ${new Date(cycle.opensAt).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric" })}`}
        </span>
      </header>
      <p className={`mb-3 text-sm ${sub}`}>
        This week's theme: <span className="font-semibold">{cycle.theme}</span>. Post your cover video with{" "}
        <span className="font-semibold">#CoverFriday</span> — most real plays by Sunday night takes the crown.
      </p>
      {entries.length === 0 ? (
        <p className={`text-sm ${sub}`}>No covers in yet this week. Yours could be the first.</p>
      ) : (
        <ol className="space-y-2">
          {entries.slice(0, 5).map((e, i) => (
            <li key={e.id} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-center font-bold">{i === 0 ? <Crown className="inline h-4 w-4 text-amber-500" aria-label="Leading" /> : i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
              {e.creator && (
                <Link href={`/artist/${e.creator.slug}`} className="shrink-0 underline-offset-2 hover:underline">
                  {e.creator.name}
                </Link>
              )}
              <span className={`shrink-0 tabular-nums ${sub}`}>{e.plays.toLocaleString()} plays</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
