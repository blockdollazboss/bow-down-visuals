import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import {
  X, MoonStar, CheckCircle2, AlertTriangle, FolderOpen, Trophy, KeyRound,
  Gift, Flame, ArrowRight, Settings2,
} from "lucide-react";

/* ── While You Were Away digest modal ───────────────────────────────────
   Fires on dashboard load when last_seen_at is 24h+ ago. Shows renders
   finished while away, new projects, Bow Race + jackpot status, missed
   daily drops, and streak status. Dismissible; checked once per session and
   the server marks the user seen, so it fires at most once per return.
   Content/status only — no VB payouts. */

interface DigestJob {
  id: string;
  projectId: string | null;
  state: string;
  stage: string | null;
  completedAt: string | null;
}

interface DigestProject {
  id: string;
  title: string | null;
  projectType: string;
}

interface Digest {
  lastSeenAt: string;
  hoursAway: number;
  completedJobs: DigestJob[];
  failedJobs: number;
  newProjects: DigestProject[];
  bowRace: { period: string; target: number; totalBows: number; won: boolean; youWon: boolean } | null;
  jackpot: { name: string; prizeCredits: number; codeLength: number; endsAt: string } | null;
  missedDrops: { date: string; key: string; kind: string; href: string }[];
  streak: { currentStreak: number; longestStreak: number; lastCreationDate: string | null } | null;
}

function formatVB(n: number) {
  return n.toLocaleString("en-US");
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
      <span className="shrink-0 text-primary/80">{icon}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function AwayDigestModal() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Check once per session — the server also marks the user seen so a
    // re-fetch inside the return window won't re-fire the modal.
    if (sessionStorage.getItem("bdv_away_digest_checked")) return;
    sessionStorage.setItem("bdv_away_digest_checked", "1");
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/retention/away-digest", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const d = await res.json() as { show?: boolean } & Digest;
        if (cancelled || !d.show) return;
        setDigest(d);
        setOpen(true);
      } catch {
        /* silent — the digest is a courtesy, never a blocker */
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  if (!open || !digest) return null;

  const hours = Math.round(digest.hoursAway);
  const hasContent =
    digest.completedJobs.length > 0 ||
    digest.failedJobs > 0 ||
    digest.newProjects.length > 0 ||
    digest.bowRace !== null ||
    digest.jackpot !== null ||
    digest.streak !== null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-primary/25 bg-[#0c0a06] shadow-[0_0_80px_rgba(218,165,32,0.20)]">
        <div className="sticky top-0 z-10 bg-[#0c0a06]/95 backdrop-blur px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-2xl bg-primary text-black flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(218,165,32,0.45)]">
              <MoonStar className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-black text-white leading-tight">{t("retention.awayDigest.title")}</h2>
              <p className="text-xs text-white/40 mt-0.5">{t("retention.awayDigest.subtitle", { hours })}</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label={t("retention.awayDigest.dismiss")}
              className="text-white/30 hover:text-white/70 transition-colors shrink-0 p-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-5 space-y-2.5">
          {!hasContent && (
            <p className="text-sm text-white/40 text-center py-6">{t("retention.awayDigest.empty")}</p>
          )}

          {digest.completedJobs.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black tracking-[0.18em] text-white/35 uppercase px-1">
                {t("retention.awayDigest.jobsCompleted")}
              </p>
              {digest.completedJobs.map((j) => (
                <Row key={j.id} icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}>
                  <div className="flex items-center gap-2">
                    <p className="flex-1 min-w-0 text-xs font-bold text-white/80 truncate">
                      {t("retention.awayDigest.renderDone")}
                    </p>
                    {j.projectId && (
                      <Link href={`/video-editor?project=${j.projectId}`}>
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary/80 hover:text-primary cursor-pointer shrink-0">
                          {t("retention.awayDigest.viewProject")}<ArrowRight className="h-3 w-3" />
                        </span>
                      </Link>
                    )}
                  </div>
                </Row>
              ))}
            </div>
          )}

          {digest.failedJobs > 0 && (
            <Row icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}>
              <p className="text-xs font-bold text-amber-200/80">
                {t("retention.awayDigest.jobsFailed", { count: digest.failedJobs })}
              </p>
            </Row>
          )}

          {digest.newProjects.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black tracking-[0.18em] text-white/35 uppercase px-1">
                {t("retention.awayDigest.newProjects")}
              </p>
              {digest.newProjects.map((p) => (
                <Row key={p.id} icon={<FolderOpen className="h-4 w-4" />}>
                  <div className="flex items-center gap-2">
                    <p className="flex-1 min-w-0 text-xs font-bold text-white/80 truncate">
                      {p.title || p.projectType}
                    </p>
                    <Link href={`/video-editor?project=${p.id}`}>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary/80 hover:text-primary cursor-pointer shrink-0">
                        {t("retention.awayDigest.viewProject")}<ArrowRight className="h-3 w-3" />
                      </span>
                    </Link>
                  </div>
                </Row>
              ))}
            </div>
          )}

          {digest.bowRace && (
            <Row icon={<Trophy className="h-4 w-4 text-primary" />}>
              <p className="text-xs font-bold text-white/80">
                {t("retention.awayDigest.bowRace")}:{" "}
                <span className="text-primary">
                  {t("retention.awayDigest.bowRaceProgress", {
                    bows: formatVB(digest.bowRace.totalBows),
                    target: formatVB(digest.bowRace.target),
                  })}
                </span>
              </p>
              {digest.bowRace.youWon && (
                <p className="text-[11px] font-black text-green-400 mt-0.5">{t("retention.awayDigest.bowRaceYouWon")}</p>
              )}
            </Row>
          )}

          {digest.jackpot && (
            <Row icon={<KeyRound className="h-4 w-4 text-primary" />}>
              <p className="text-xs font-bold text-white/80">
                {t("retention.awayDigest.jackpot")}:{" "}
                <span className="text-primary">{t("retention.awayDigest.jackpotPrize", { prize: formatVB(digest.jackpot.prizeCredits) })}</span>
              </p>
              <p className="text-[11px] text-white/35 mt-0.5">
                {t("retention.awayDigest.jackpotEnds", { date: new Date(digest.jackpot.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) })}
              </p>
            </Row>
          )}

          {digest.streak && digest.streak.currentStreak > 0 && (
            <Row icon={<Flame className="h-4 w-4 text-orange-400" />}>
              <p className="text-xs font-bold text-white/80">
                {t("retention.awayDigest.streak")}:{" "}
                <span className="text-orange-300">{t("retention.awayDigest.streakDays", { count: digest.streak.currentStreak })}</span>
                <span className="text-white/30 font-medium"> · {t("retention.awayDigest.streakBest", { count: digest.streak.longestStreak })}</span>
              </p>
            </Row>
          )}

          {digest.missedDrops.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-black tracking-[0.18em] text-white/35 uppercase px-1">
                {t("retention.awayDigest.missedDrops")}
              </p>
              {digest.missedDrops.map((m) => (
                <Link key={m.date} href={m.href}>
                  <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary/[0.05] border border-primary/15 hover:border-primary/40 hover:bg-primary/[0.09] transition-all cursor-pointer">
                    <Gift className="h-4 w-4 text-primary/70 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-white truncate">{t(`retention.drops.${m.key}.title`)}</p>
                      <p className="text-[10px] text-white/30">
                        {new Date(`${m.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-[#0c0a06]/95 backdrop-blur px-5 py-4 border-t border-white/[0.06] flex items-center gap-3">
          <button
            onClick={() => setOpen(false)}
            className="flex-1 px-5 py-2.5 rounded-xl bg-primary text-black font-black text-sm hover:brightness-110 transition-all shadow-[0_0_20px_rgba(218,165,32,0.35)]"
          >
            {t("retention.awayDigest.dismiss")}
          </button>
          <Link href="/settings">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white/35 hover:text-white/60 transition-colors cursor-pointer">
              <Settings2 className="h-3.5 w-3.5" />{t("retention.awayDigest.managePrefs")}
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
