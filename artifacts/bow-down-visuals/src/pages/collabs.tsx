import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Users, Sparkles, Loader2, Inbox, UserRound, Search, Send, Copy,
  CheckCircle2, XCircle, ChevronRight, MessageSquareText,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { NicheLabel, PlatformLabel, scoreColor, fillProposalTemplate, clampFollowers } from "@/lib/collabs";
import { useTranslation } from "react-i18next";

/* ─── Collab Finder ─────────────────────────────────────────────────────────
   /collabs — find collaboration partners. AI-powered per the standing rule.

   Pricing: browsing profiles FREE · my profile FREE · AI match report 1 credit
   · sending/answering collab requests FREE (inbox is pure interface).
   Outreach templates are static copy (zero runtime compute) so proposals stay
   genuinely free: if it burns compute it charges; if it's just interface it's
   free. */

const MATCH_CREDIT_COST = 1;

const NICHES = [
  "music", "gaming", "vlogging", "comedy", "education", "fitness",
  "beauty", "tech", "cooking", "travel", "fashion", "podcasting", "other",
] as const;

const PLATFORMS = ["tiktok", "instagram", "youtube", "twitch", "x", "discord"] as const;

/* Static outreach templates — written once, zero runtime AI cost, free forever.
   Bodies keep single-brace placeholders ({name}, {niche}, {me}, {myNiche}) so
   fillProposalTemplate can substitute them after t() returns the raw string. */
const PROPOSAL_TEMPLATES: { nameKey: string; bodyKey: string }[] = [
  { nameKey: "collabs.templateWarmIntroName", bodyKey: "collabs.templateWarmIntroBody" },
  { nameKey: "collabs.templateSpecificIdeaName", bodyKey: "collabs.templateSpecificIdeaBody" },
  { nameKey: "collabs.templateCasualDmName", bodyKey: "collabs.templateCasualDmBody" },
];

interface PlatformEntry {
  platform: string;
  label: string;
  followers: number;
  followersLabel: string;
}

interface CreatorProfile {
  userId: string;
  displayName: string;
  niche: string;
  nicheLabel: string;
  platforms: PlatformEntry[];
  collabInterests: string;
  bio: string;
  isOwn: boolean;
}

interface MatchReport {
  score: number;
  verdict: string;
  strengths: string[];
  risks: string[];
  ideas: string[];
  targetDisplayName: string;
}

interface InboxRequest {
  id: string;
  message: string;
  status: string;
  createdAt: string;
  fromDisplayName?: string | null;
  fromNiche?: string | null;
  toDisplayName?: string | null;
  toNiche?: string | null;
}

type Tab = "browse" | "profile" | "match" | "inbox";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const labelClass = "mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/50";
const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-yellow-600 px-5 py-3 text-sm font-extrabold uppercase tracking-wider text-black shadow-[0_0_24px_rgba(234,179,8,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white disabled:opacity-50";

export default function CollabFinder() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [tab, setTab] = useState<Tab>("browse");

  /* ── browse ── */
  const [profiles, setProfiles] = useState<CreatorProfile[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [nicheFilter, setNicheFilter] = useState("");

  /* ── my profile ── */
  const [displayName, setDisplayName] = useState("");
  const [niche, setNiche] = useState<string>("music");
  const [platformRows, setPlatformRows] = useState<{ platform: string; followers: string }[]>([
    { platform: "tiktok", followers: "" },
  ]);
  const [collabInterests, setCollabInterests] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [hasProfile, setHasProfile] = useState(false);

  /* ── match ── */
  const [matchTarget, setMatchTarget] = useState("");
  const [report, setReport] = useState<MatchReport | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchOutOfCredits, setMatchOutOfCredits] = useState(false);

  /* ── inbox + proposal ── */
  const [received, setReceived] = useState<InboxRequest[]>([]);
  const [sent, setSent] = useState<InboxRequest[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [proposalTo, setProposalTo] = useState<CreatorProfile | null>(null);
  const [proposalText, setProposalText] = useState("");
  const [proposalSending, setProposalSending] = useState(false);
  const [proposalMsg, setProposalMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function authed(path: string, opts: { method?: string; body?: unknown } = {}) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  }

  async function loadBrowse() {
    setBrowseLoading(true);
    try {
      const q = nicheFilter ? `?niche=${encodeURIComponent(nicheFilter)}` : "";
      const { res, data } = await authed(`/api/collabs/profiles${q}`);
      if (res.ok) setProfiles((data.profiles as CreatorProfile[]) ?? []);
    } finally {
      setBrowseLoading(false);
    }
  }

  async function loadMyProfile() {
    const { res, data } = await authed("/api/collabs/profile/me");
    if (res.ok && data.profile) {
      const p = data.profile as {
        displayName: string; niche: string;
        platforms: { platform: string; followers: number }[];
        collabInterests: string; bio: string; isPublic: boolean;
      };
      setDisplayName(p.displayName);
      setNiche(p.niche);
      setPlatformRows(
        p.platforms.length > 0
          ? p.platforms.map((e) => ({ platform: e.platform, followers: String(e.followers) }))
          : [{ platform: "tiktok", followers: "" }],
      );
      setCollabInterests(p.collabInterests);
      setBio(p.bio);
      setIsPublic(p.isPublic);
      setHasProfile(true);
    }
  }

  async function loadInbox() {
    setInboxLoading(true);
    try {
      const { res, data } = await authed("/api/collabs/requests");
      if (res.ok) {
        setReceived((data.received as InboxRequest[]) ?? []);
        setSent((data.sent as InboxRequest[]) ?? []);
      }
    } finally {
      setInboxLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    loadBrowse();
    loadMyProfile();
    loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (user) loadBrowse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nicheFilter]);

  async function saveProfile() {
    if (profileSaving || !displayName.trim()) {
      if (!displayName.trim()) setProfileMsg(t("collabs.errorNoDisplayName"));
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const platforms = platformRows
        .filter((r) => r.platform)
        .map((r) => ({
          platform: r.platform,
          followers: clampFollowers(r.followers),
        }));
      const { res, data } = await authed("/api/collabs/profile", {
        method: "POST",
        body: {
          displayName: displayName.trim(),
          niche,
          platforms,
          collabInterests: collabInterests.trim(),
          bio: bio.trim(),
          isPublic,
        },
      });
      if (!res.ok) throw new Error((data.error as string) || t("collabs.errorSaveFailed"));
      setHasProfile(true);
      setProfileMsg(t("collabs.profileLive"));
      loadBrowse();
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : t("collabs.errorSaveFailed"));
    } finally {
      setProfileSaving(false);
    }
  }

  async function runMatch() {
    if (matchLoading || !matchTarget) return;
    if (!hasProfile) {
      setMatchError(t("collabs.errorNoProfileForMatch"));
      return;
    }
    setMatchLoading(true);
    setMatchError(null);
    setMatchOutOfCredits(false);
    try {
      const { res, data } = await authed("/api/collabs/match", {
        method: "POST",
        body: { targetUserId: matchTarget },
      });
      if (res.status === 402) {
        setMatchOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error((data.error as string) || t("collabs.errorMatchFailed"));
      setReport(data.report as MatchReport);
      document.getElementById("match-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : t("collabs.errorMatchFailed"));
    } finally {
      setMatchLoading(false);
    }
  }

  function openProposal(p: CreatorProfile) {
    setProposalTo(p);
    setProposalText(
      fillProposalTemplate(
        t(PROPOSAL_TEMPLATES[0].bodyKey),
        { displayName: p.displayName, nicheLabel: p.nicheLabel },
        { displayName: displayName.trim(), nicheLabel: NicheLabel(niche) },
      ),
    );
    setProposalMsg(null);
  }

  async function sendProposal() {
    if (proposalSending || !proposalTo || !proposalText.trim()) return;
    setProposalSending(true);
    setProposalMsg(null);
    try {
      const { res, data } = await authed("/api/collabs/requests", {
        method: "POST",
        body: { toUserId: proposalTo.userId, message: proposalText.trim().slice(0, 1000) },
      });
      if (!res.ok) throw new Error((data.error as string) || t("collabs.errorSendFailed"));
      setProposalMsg(t("collabs.proposalSent"));
      setProposalTo(null);
      setProposalText("");
      loadInbox();
    } catch (err) {
      setProposalMsg(err instanceof Error ? err.message : t("collabs.errorSendFailed"));
    } finally {
      setProposalSending(false);
    }
  }

  async function respond(id: string, action: "accepted" | "declined") {
    const { res } = await authed(`/api/collabs/requests/${id}/respond`, {
      method: "POST",
      body: { action },
    });
    if (res.ok) loadInbox();
  }

  function copyProposal() {
    navigator.clipboard.writeText(proposalText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const pendingCount = received.filter((r) => r.status === "pending").length;
  const tabs: { key: Tab; label: string; icon: typeof Search }[] = [
    { key: "browse", label: t("collabs.tabBrowse"), icon: Search },
    { key: "profile", label: t("collabs.tabProfile"), icon: UserRound },
    { key: "match", label: t("collabs.tabMatch"), icon: Sparkles },
    { key: "inbox", label: pendingCount > 0 ? t("collabs.tabInboxWithCount", { count: pendingCount }) : t("collabs.tabInbox"), icon: Inbox },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-10">
        {/* hero */}
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-300">
            <Users className="h-3.5 w-3.5" /> {t("collabs.badge")}
          </div>
          <h1 className="bg-gradient-to-b from-amber-200 via-amber-400 to-yellow-600 bg-clip-text text-4xl font-black text-transparent sm:text-5xl">
            {t("collabs.title")}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-white/60">
            {t("collabs.subtitle")}
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-xs text-white/40">
            {t("collabs.collabExplainer", { defaultValue: "Creator-to-creator partnerships — find collaborators, not sponsors. Chasing brand money instead? See " })}
            <Link href="/brand-deals" className="font-semibold text-primary hover:underline">{t("collabs.brandDealsLink", { defaultValue: "Brand Deals" })}</Link>.
          </p>
        </div>

        {/* tabs */}
        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                tab === t.key
                  ? "bg-gradient-to-b from-amber-300 to-yellow-600 text-black"
                  : "border border-white/15 bg-white/5 text-white/70 hover:border-amber-400/40 hover:text-white"
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {!user && (
          <div className="mx-auto max-w-xl rounded-2xl border border-amber-400/30 bg-amber-400/5 p-6 text-center">
            <p className="text-white/70">
              <Link href="/login" className="font-bold text-amber-300 underline">{t("collabs.loginLink")}</Link> {t("collabs.loginPrompt")}
            </p>
          </div>
        )}

        {user && tab === "browse" && (
          <section>
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <select value={nicheFilter} onChange={(e) => setNicheFilter(e.target.value)} className="rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white outline-none focus:border-amber-400/60">
                <option value="">{t("collabs.allNiches")}</option>
                {NICHES.map((n) => (
                  <option key={n} value={n}>{NicheLabel(n)}</option>
                ))}
              </select>
              <span className="text-xs text-white/40">{t("collabs.creatorCount", { count: profiles.length })}</span>
            </div>
            {browseLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-400" /></div>
            ) : profiles.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-white/50">
                {t("collabs.emptyBrowse")}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {profiles.map((p) => (
                  <div key={p.userId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-amber-400/40">
                    <div className="mb-1 flex items-center justify-between">
                      <h3 className="text-lg font-extrabold text-white">{p.displayName}</h3>
                      {p.isOwn && <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">{t("collabs.youBadge")}</span>}
                    </div>
                    <p className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-300/80">{p.nicheLabel}</p>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {p.platforms.map((e) => (
                        <span key={e.platform} className="rounded-lg bg-white/5 px-2 py-1 text-xs text-white/70">
                          {e.label} · <span className="font-bold text-white">{e.followersLabel}</span>
                        </span>
                      ))}
                    </div>
                    {p.collabInterests && <p className="mb-2 text-sm text-white/70"><span className="font-bold text-white/90">{t("collabs.wantsLabel")}</span>{p.collabInterests}</p>}
                    {p.bio && <p className="mb-4 text-sm text-white/50">{p.bio}</p>}
                    {!p.isOwn && (
                      <div className="flex gap-2">
                        <button onClick={() => { setMatchTarget(p.userId); setTab("match"); }} className={ghostBtn}>
                          <Sparkles className="h-4 w-4" /> {t("collabs.aiMatchBtn")}
                        </button>
                        <button onClick={() => openProposal(p)} className={ghostBtn}>
                          <Send className="h-4 w-4" /> {t("collabs.proposeBtn")}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {user && tab === "profile" && (
          <section className="mx-auto max-w-2xl">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="mb-5 text-xl font-extrabold">{t("collabs.profileTitle")} <span className="ml-2 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">{t("collabs.freeBadge")}</span></h2>
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>{t("collabs.displayNameLabel")}</label>
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("collabs.displayNamePlaceholder")} className={inputClass} maxLength={60} />
                </div>
                <div>
                  <label className={labelClass}>{t("collabs.nicheLabel")}</label>
                  <select value={niche} onChange={(e) => setNiche(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white outline-none focus:border-amber-400/60">
                    {NICHES.map((n) => <option key={n} value={n}>{NicheLabel(n)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>{t("collabs.platformsLabel")}</label>
                  <div className="space-y-2">
                    {platformRows.map((row, i) => (
                      <div key={i} className="flex gap-2">
                        <select value={row.platform} onChange={(e) => setPlatformRows(platformRows.map((r, j) => j === i ? { ...r, platform: e.target.value } : r))} className="rounded-xl border border-white/10 bg-black/60 px-3 py-2.5 text-sm text-white outline-none">
                          {PLATFORMS.map((p) => <option key={p} value={p}>{PlatformLabel(p)}</option>)}
                        </select>
                        <input value={row.followers} onChange={(e) => setPlatformRows(platformRows.map((r, j) => j === i ? { ...r, followers: e.target.value.replace(/[^0-9]/g, "") } : r))} placeholder={t("collabs.followersPlaceholder")} inputMode="numeric" className={inputClass} />
                        {platformRows.length > 1 && (
                          <button onClick={() => setPlatformRows(platformRows.filter((_, j) => j !== i))} className="rounded-xl border border-white/10 px-3 text-white/50 hover:text-red-400">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {platformRows.length < 6 && (
                    <button onClick={() => setPlatformRows([...platformRows, { platform: "instagram", followers: "" }])} className="mt-2 text-sm font-bold text-amber-300 hover:underline">{t("collabs.addPlatform")}</button>
                  )}
                </div>
                <div>
                  <label className={labelClass}>{t("collabs.collabInterestsLabel")}</label>
                  <input value={collabInterests} onChange={(e) => setCollabInterests(e.target.value)} placeholder={t("collabs.collabInterestsPlaceholder")} className={inputClass} maxLength={500} />
                </div>
                <div>
                  <label className={labelClass}>{t("collabs.bioLabel")}</label>
                  <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t("collabs.bioPlaceholder")} rows={3} className={inputClass} maxLength={500} />
                </div>
                <label className="flex items-center gap-3 text-sm text-white/70">
                  <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="h-4 w-4 accent-amber-400" />
                  {t("collabs.publicLabel")}
                </label>
                <button onClick={saveProfile} disabled={profileSaving} className={goldBtn}>
                  {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {profileSaving ? t("collabs.saving") : t("collabs.saveProfile")}
                </button>
                {profileMsg && <p className="text-sm text-white/60">{profileMsg}</p>}
              </div>
            </div>
          </section>
        )}

        {user && tab === "match" && (
          <section className="mx-auto max-w-2xl">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="mb-2 text-xl font-extrabold">{t("collabs.matchTitle")}</h2>
              <p className="mb-5 text-sm text-white/50">
                {t("collabs.matchDescription")} <span className="font-bold text-amber-300">{t("collabs.matchCostNote")}</span>
              </p>
              <div className="mb-4 flex gap-2">
                <select value={matchTarget} onChange={(e) => setMatchTarget(e.target.value)} className="flex-1 rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white outline-none focus:border-amber-400/60">
                  <option value="">{t("collabs.chooseCreator")}</option>
                  {profiles.filter((p) => !p.isOwn).map((p) => (
                    <option key={p.userId} value={p.userId}>{p.displayName} · {p.nicheLabel}</option>
                  ))}
                </select>
                <button onClick={runMatch} disabled={matchLoading || !matchTarget} className={goldBtn}>
                  {matchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {matchLoading ? t("collabs.scoring") : t("collabs.scoreBtn")}
                </button>
              </div>
              {matchOutOfCredits && <div className="mb-4"><OutOfCredits /></div>}
              {matchError && <p className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">{matchError}</p>}
              {report && (
                <div id="match-result" className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.04] p-6">
                  <div className="mb-4 flex items-center gap-4">
                    <div className={`text-5xl font-black ${scoreColor(report.score)}`}>{report.score}</div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest text-white/40">{t("collabs.compatibilityWith", { name: report.targetDisplayName })}</div>
                      <div className="text-lg font-extrabold text-white">{report.verdict}</div>
                    </div>
                  </div>
                  {report.strengths.length > 0 && (
                    <div className="mb-4">
                      <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-emerald-300">{t("collabs.whyItWorks")}</div>
                      <ul className="space-y-1 text-sm text-white/75">{report.strengths.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{s}</li>)}</ul>
                    </div>
                  )}
                  {report.risks.length > 0 && (
                    <div className="mb-4">
                      <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-red-300">{t("collabs.watchOutFor")}</div>
                      <ul className="space-y-1 text-sm text-white/75">{report.risks.map((s, i) => <li key={i} className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />{s}</li>)}</ul>
                    </div>
                  )}
                  {report.ideas.length > 0 && (
                    <div className="mb-5">
                      <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-amber-300">{t("collabs.collabIdeas")}</div>
                      <ul className="space-y-1 text-sm text-white/75">{report.ideas.map((s, i) => <li key={i} className="flex gap-2"><ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />{s}</li>)}</ul>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      const target = profiles.find((p) => p.userId === matchTarget);
                      if (target) { setTab("browse"); openProposal(target); }
                    }}
                    className={goldBtn}
                  >
                    <Send className="h-4 w-4" /> {t("collabs.sendProposalBtn")}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {user && tab === "inbox" && (
          <section className="mx-auto max-w-3xl">
            {inboxLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-400" /></div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold"><Inbox className="h-5 w-5 text-amber-300" /> {t("collabs.received")}</h2>
                  {received.length === 0 ? (
                    <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/40">{t("collabs.emptyReceived")}</p>
                  ) : (
                    <div className="space-y-3">
                      {received.map((r) => (
                        <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="font-bold text-white">{r.fromDisplayName ?? t("collabs.anonymousCreator")}</span>
                            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${r.status === "pending" ? "bg-amber-400/15 text-amber-300" : r.status === "accepted" ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-white/50"}`}>{r.status}</span>
                          </div>
                          <p className="mb-3 text-sm text-white/70">{r.message}</p>
                          {r.status === "pending" && (
                            <div className="flex gap-2">
                              <button onClick={() => respond(r.id, "accepted")} className={ghostBtn}><CheckCircle2 className="h-4 w-4" /> {t("collabs.accept")}</button>
                              <button onClick={() => respond(r.id, "declined")} className={ghostBtn}><XCircle className="h-4 w-4" /> {t("collabs.decline")}</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold"><Send className="h-5 w-5 text-amber-300" /> {t("collabs.sent")}</h2>
                  {sent.length === 0 ? (
                    <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/40">{t("collabs.emptySent")}</p>
                  ) : (
                    <div className="space-y-3">
                      {sent.map((r) => (
                        <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="font-bold text-white">{r.toDisplayName ?? t("collabs.anonymousCreator")}</span>
                            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${r.status === "pending" ? "bg-amber-400/15 text-amber-300" : r.status === "accepted" ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-white/50"}`}>{r.status}</span>
                          </div>
                          <p className="text-sm text-white/60">{r.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* proposal modal */}
        {proposalTo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setProposalTo(null)}>
            <div className="w-full max-w-lg rounded-2xl border border-amber-400/30 bg-[#0d0d0d] p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-1 text-xl font-extrabold">{t("collabs.proposeTitle")} <span className="ml-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">{t("collabs.freeBadge")}</span></h3>
              <p className="mb-4 text-sm text-white/50">{t("collabs.proposalSubtitle", { name: proposalTo.displayName })}</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {PROPOSAL_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.nameKey}
                    onClick={() => setProposalText(fillProposalTemplate(
                      t(tpl.bodyKey),
                      { displayName: proposalTo.displayName, nicheLabel: proposalTo.nicheLabel },
                      { displayName: displayName.trim(), nicheLabel: NicheLabel(niche) },
                    ))}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 hover:border-amber-400/50 hover:text-white"
                  >
                    <MessageSquareText className="mr-1 inline h-3.5 w-3.5" />{t(tpl.nameKey)}
                  </button>
                ))}
              </div>
              <textarea value={proposalText} onChange={(e) => setProposalText(e.target.value)} rows={6} maxLength={1000} className={inputClass} />
              <div className="mt-4 flex items-center justify-between">
                <button onClick={copyProposal} className={ghostBtn}>
                  {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  {copied ? t("collabs.copied") : t("collabs.copy")}
                </button>
                <div className="flex gap-2">
                  <button onClick={() => setProposalTo(null)} className={ghostBtn}>{t("collabs.cancel")}</button>
                  <button onClick={sendProposal} disabled={proposalSending || !proposalText.trim()} className={goldBtn}>
                    {proposalSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {proposalSending ? t("collabs.sending") : t("collabs.sendRequest")}
                  </button>
                </div>
              </div>
              {proposalMsg && <p className="mt-3 text-sm text-white/60">{proposalMsg}</p>}
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
