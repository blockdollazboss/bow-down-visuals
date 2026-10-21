import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, ArrowRight, BadgeDollarSign, Check, Coffee, Copy, Crown,
  Disc3, Eye, Inbox, Mail, MessageSquare, Music2, Play, RotateCcw,
  Sparkles, Store, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  initialSectionStates,
  markSectionLoading,
  sectionStatusFromSettled,
  settleSection,
  type SectionStates,
} from "@/lib/dashboard-sections";
import {
  COMMAND_PANEL_KEYS,
  briefApproveTarget,
  shapeActions,
  shapeAudience,
  shapeBrief,
  shapeContent,
  shapeRevenue,
  type ActionsPayload,
  type AudiencePayload,
  type BriefMoveKind,
  type BriefPayload,
  type CommandPanelKey,
  type ContentPayload,
  type RevenuePayload,
} from "@/lib/command-center";

/* ─── HOME-BASE COMMAND CENTER ───────────────────────────────────────
   Docked inside the creator dashboard, directly under the command
   bar: the one morning view of the creator's HOME business — audience,
   revenue by rail, top content, pending actions — plus Thy Cheat
   Code's AI morning brief.

   Resilience law (the dashboard's own, via lib/dashboard-sections):
   five panels, five endpoints, each settles and retries on its own.
   A failed panel renders its own failure note in its own area; it
   never blanks the page, never shows a fake-empty state, and its
   Retry refetches that panel alone.

   The brief is a DRAFT: its move renders as a copyable draft plus a
   link into the real surface where the creator reviews and acts
   themselves. This component never POSTs an action — approving is
   the creator's click, on the surface that owns the action. */

type PanelStates = SectionStates<CommandPanelKey>;

function fmtInt(n: number) {
  return n.toLocaleString("en-US");
}

function fmtMoney(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function PanelFailure({ label, testId, onRetry, isLight }: {
  label: string;
  testId: string;
  onRetry: () => void;
  isLight: boolean;
}) {
  return (
    <div data-testid={testId} className={`rounded-2xl border p-5 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
      <AlertTriangle className="mx-auto h-6 w-6 text-primary" />
      <p className={`mt-2 text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{label} couldn’t load.</p>
      <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
        This panel just couldn’t load — the rest of your dashboard is fine.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-black hover:brightness-110"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Try again
      </button>
    </div>
  );
}

function PanelShell({ title, icon: Icon, children, isLight }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  isLight: boolean;
}) {
  const I = Icon;
  return (
    <div className={`rounded-2xl border p-4 md:p-5 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <h3 className="flex items-center gap-2 text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-3">
        <I className="h-3.5 w-3.5 text-primary/70" />{title}
      </h3>
      {children}
    </div>
  );
}

function PartialNote() {
  return (
    <p className="mt-3 flex items-start gap-1.5 text-[11px] font-medium text-amber-300/80">
      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
      One source couldn’t load — what’s shown is real, the rest is missing, never guessed.
    </p>
  );
}

function StatRow({ label, stat, isLight }: {
  label: string;
  stat: { total: number; new7: number } | null;
  isLight: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={`text-sm font-bold ${isLight ? "text-[#2A1E07]/70" : "text-white/60"}`}>{label}</span>
      {stat === null ? (
        <span className="text-sm font-bold text-white/30">Unavailable</span>
      ) : (
        <span className="flex items-baseline gap-2">
          <span className={`text-base font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{fmtInt(stat.total)}</span>
          {stat.new7 > 0 && (
            <span className="text-[11px] font-black text-green-400">+{fmtInt(stat.new7)} this week</span>
          )}
        </span>
      )}
    </div>
  );
}

export default function CommandCenter({ getToken, isLight }: {
  getToken: () => Promise<string | null>;
  isLight: boolean;
}) {
  const { t } = useTranslation();
  const [states, setStates] = useState<PanelStates>(() => initialSectionStates(COMMAND_PANEL_KEYS));
  const [brief, setBrief] = useState<BriefPayload | null>(null);
  const [audience, setAudience] = useState<AudiencePayload | null>(null);
  const [revenue, setRevenue] = useState<RevenuePayload | null>(null);
  const [content, setContent] = useState<ContentPayload | null>(null);
  const [actions, setActions] = useState<ActionsPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchPanel = async (key: CommandPanelKey): Promise<void> => {
    const run = async (): Promise<{ ok: boolean }> => {
      let headers: HeadersInit = {};
      try {
        const token = await getToken();
        headers = token ? { Authorization: `Bearer ${token}` } : {};
      } catch {
        return { ok: false };
      }
      const res = await fetch(`/api/command/${key}`, { headers });
      if (res.ok) {
        const raw = await res.json().catch(() => null);
        if (!mountedRef.current) return res;
        if (key === "brief") setBrief(shapeBrief(raw));
        else if (key === "audience") setAudience(shapeAudience(raw));
        else if (key === "revenue") setRevenue(shapeRevenue(raw));
        else if (key === "content") setContent(shapeContent(raw));
        else setActions(shapeActions(raw));
      }
      return res;
    };
    const [settled] = await Promise.allSettled([run()]);
    if (!mountedRef.current) return;
    setStates((prev) => settleSection(prev, key, sectionStatusFromSettled(settled) === "ok"));
  };

  useEffect(() => {
    setStates(initialSectionStates(COMMAND_PANEL_KEYS));
    void Promise.allSettled(COMMAND_PANEL_KEYS.map((k) => fetchPanel(k)));
    // Panels load once per mount; each Retry below refetches its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryPanel = (key: CommandPanelKey) => {
    setStates((prev) => markSectionLoading(prev, key));
    void fetchPanel(key);
  };

  const card = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";

  const moveCta: Record<BriefMoveKind, string> = {
    post: t("command.brief_cta_post", { defaultValue: "Review it in the Scheduler" }),
    winback: t("command.brief_cta_winback", { defaultValue: "Review your members" }),
    reply: t("command.brief_cta_reply", { defaultValue: "Open Messages" }),
    deliver: t("command.brief_cta_deliver", { defaultValue: "Open Shoutouts" }),
    price_check: t("command.brief_cta_price", { defaultValue: "Open Earnings" }),
    create: t("command.brief_cta_create", { defaultValue: "Start creating" }),
  };

  const actionMeta: Record<string, { label: string; icon: React.ReactNode }> = {
    unreadMessages: {
      label: t("command.action_unread", { defaultValue: "Unread messages" }),
      icon: <MessageSquare className="h-4 w-4" />,
    },
    pastDueMembers: {
      label: t("command.action_pastdue", { defaultValue: "Members past due" }),
      icon: <Crown className="h-4 w-4" />,
    },
    shoutoutsToDeliver: {
      label: t("command.action_shoutouts", { defaultValue: "Shoutouts to deliver" }),
      icon: <Play className="h-4 w-4" />,
    },
  };

  const copyDraft = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief.move.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard unavailable — the draft stays on screen to copy by hand. */
    }
  };

  return (
    <section aria-label={t("command.title", { defaultValue: "Command center" })}>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="flex items-center gap-2 text-xs font-black tracking-[0.18em] text-white/40 uppercase">
          <Sparkles className="h-3.5 w-3.5 text-primary/70" />
          {t("command.title", { defaultValue: "Command center" })}
        </h2>
        <span className="text-[11px] font-medium text-white/30">
          {t("command.subtitle", { defaultValue: "Your whole home business, one view." })}
        </span>
      </div>

      {/* ── MORNING BRIEF ── */}
      {states.brief === "failed" ? (
        <PanelFailure
          isLight={isLight}
          label={t("command.brief_label", { defaultValue: "Your morning brief" })}
          testId="command-brief-failure"
          onRetry={() => retryPanel("brief")}
        />
      ) : states.brief === "loading" ? (
        <div className="h-36 rounded-2xl lux-skeleton" />
      ) : brief ? (
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.13] via-primary/[0.05] to-transparent p-5 md:p-6">
          <p className="flex items-center gap-2 text-[10px] font-black tracking-[0.22em] text-primary/70 uppercase">
            <Sparkles className="h-3.5 w-3.5" />
            {t("command.brief_label", { defaultValue: "Thy Cheat Code’s morning brief" })}
          </p>
          <p className={`mt-2 text-[15px] leading-relaxed font-medium ${isLight ? "text-[#2A1E07]" : "text-white/90"}`}>
            {brief.summary}
          </p>
          <div className={`mt-4 rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/40" : "border-white/[0.08] bg-black/30"}`}>
            <p className="text-[10px] font-black tracking-[0.18em] text-primary/60 uppercase">
              {t("command.brief_next_move", { defaultValue: "Next best move — drafted for you" })}
            </p>
            <p className={`mt-1.5 text-sm font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{brief.move.title}</p>
            <p className={`mt-1 text-sm leading-relaxed whitespace-pre-wrap ${isLight ? "text-[#2A1E07]/75" : "text-white/60"}`}>
              {brief.move.draft}
            </p>
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              <Link href={briefApproveTarget(brief)}>
                <span className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-black text-black hover:brightness-110 transition-all cursor-pointer">
                  {moveCta[brief.move.kind]}<ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
              <button
                type="button"
                onClick={copyDraft}
                className="inline-flex items-center gap-2 rounded-full border border-primary/30 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied
                  ? t("command.brief_copied", { defaultValue: "Copied" })
                  : t("command.brief_copy", { defaultValue: "Copy draft" })}
              </button>
              <span className="text-[11px] font-medium text-white/30">
                {t("command.brief_draft_note", { defaultValue: "A draft — you review and send it. Nothing goes out on its own." })}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className={`rounded-2xl border p-5 text-center ${card}`}>
          <p className={`text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("command.brief_empty", { defaultValue: "Your brief isn’t ready yet." })}
          </p>
          <button
            type="button"
            onClick={() => retryPanel("brief")}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("command.try_again", { defaultValue: "Try again" })}
          </button>
        </div>
      )}

      {/* ── PANEL GRID ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 mt-4 md:mt-5">

        {/* AUDIENCE */}
        {states.audience === "failed" ? (
          <PanelFailure isLight={isLight} label={t("command.audience_label", { defaultValue: "Your audience" })} testId="command-audience-failure" onRetry={() => retryPanel("audience")} />
        ) : (
          <PanelShell isLight={isLight} icon={Users} title={t("command.audience_label", { defaultValue: "Audience at home" })}>
            {states.audience === "loading" || !audience ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded-lg lux-skeleton" />)}</div>
            ) : (
              <>
                <StatRow isLight={isLight} label={t("command.aud_followers", { defaultValue: "Followers" })} stat={audience.followers} />
                <StatRow isLight={isLight} label={t("command.aud_subscribers", { defaultValue: "Email list" })} stat={audience.subscribers} />
                <StatRow isLight={isLight} label={t("command.aud_members", { defaultValue: "Members" })} stat={audience.members} />
                {audience.offPlatform.connected ? (
                  <div className="mt-3 border-t border-white/[0.07] pt-3">
                    <p className="text-[10px] font-black tracking-[0.16em] text-white/35 uppercase mb-2">
                      {t("command.aud_offplatform", { defaultValue: "Connected platforms" })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {audience.offPlatform.platforms.map((p) => (
                        <span key={p.platform} className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-[11px] font-bold text-white/70">
                          <span className="capitalize">{p.platform}</span>
                          {p.username && <span className="text-white/40">@{p.username}</span>}
                          {p.followers !== null ? (
                            <span className="text-white">{fmtInt(p.followers)}</span>
                          ) : (
                            <span className="text-white/35">{t("command.aud_connected", { defaultValue: "Connected" })}</span>
                          )}
                          {p.delta !== null && p.delta !== 0 && (
                            <span className={`inline-flex items-center gap-0.5 font-black ${p.delta > 0 ? "text-green-400" : "text-red-400"}`}>
                              {p.delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                              {p.delta > 0 ? "+" : ""}{fmtInt(p.delta)}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 border-t border-white/[0.07] pt-3 text-[11px] font-medium text-white/35">
                    {t("command.aud_connect_hint", { defaultValue: "Connect Instagram, TikTok or Facebook and their audiences show up here too." })}{" "}
                    <Link href="/analytics"><span className="font-bold text-primary/70 hover:text-primary cursor-pointer">{t("command.aud_connect_link", { defaultValue: "Connect" })}</span></Link>
                  </p>
                )}
                {audience.partial && <PartialNote />}
              </>
            )}
          </PanelShell>
        )}

        {/* REVENUE */}
        {states.revenue === "failed" ? (
          <PanelFailure isLight={isLight} label={t("command.revenue_label", { defaultValue: "Your revenue" })} testId="command-revenue-failure" onRetry={() => retryPanel("revenue")} />
        ) : (
          <PanelShell isLight={isLight} icon={BadgeDollarSign} title={t("command.revenue_label", { defaultValue: "Revenue by rail — all time" })}>
            {states.revenue === "loading" || !revenue ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded-lg lux-skeleton" />)}</div>
            ) : (
              <>
                {[
                  { icon: <Store className="h-4 w-4" />, label: t("command.rev_store", { defaultValue: "Store & shops" }), rail: revenue.rails.store },
                  { icon: <Crown className="h-4 w-4" />, label: t("command.rev_memberships", { defaultValue: "Memberships" }), rail: revenue.rails.memberships },
                  { icon: <BadgeDollarSign className="h-4 w-4" />, label: t("command.rev_deals", { defaultValue: "Brand deals" }), rail: revenue.rails.brandDeals },
                  { icon: <Disc3 className="h-4 w-4" />, label: t("command.rev_beats", { defaultValue: "Beat licenses" }), rail: revenue.rails.beats },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-2.5 py-1.5">
                    <span className="text-primary/70">{row.icon}</span>
                    <span className={`flex-1 text-sm font-bold ${isLight ? "text-[#2A1E07]/70" : "text-white/60"}`}>{row.label}</span>
                    {row.rail.totalCents === null ? (
                      <span className="text-sm font-bold text-white/30">Unavailable</span>
                    ) : (
                      <span className={`text-sm font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                        {fmtMoney(row.rail.totalCents)}
                        {row.rail.count !== null && row.rail.count > 0 && (
                          <span className="ml-1.5 text-[11px] font-bold text-white/35">×{fmtInt(row.rail.count)}</span>
                        )}
                      </span>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-2.5 py-1.5">
                  <span className="text-primary/70"><Coffee className="h-4 w-4" /></span>
                  <span className={`flex-1 text-sm font-bold ${isLight ? "text-[#2A1E07]/70" : "text-white/60"}`}>
                    {t("command.rev_tips", { defaultValue: "Stream tips" })}
                  </span>
                  {revenue.rails.tipsVb === null ? (
                    <span className="text-sm font-bold text-white/30">Unavailable</span>
                  ) : (
                    <span className={`text-sm font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                      {fmtInt(revenue.rails.tipsVb)} VB
                    </span>
                  )}
                </div>
                {revenue.rails.tipJarPendingCents !== null && revenue.rails.tipJarPendingCents > 0 && (
                  <p className="text-[11px] font-medium text-white/35 mt-0.5">
                    {t("command.rev_tipjar_pending", { defaultValue: "Tip jar: {{amount}} pledged, not yet paid — not counted above.", amount: fmtMoney(revenue.rails.tipJarPendingCents) })}
                  </p>
                )}
                <div className="mt-2.5 flex items-baseline justify-between border-t border-white/[0.07] pt-2.5">
                  <span className={`text-xs font-black tracking-wide uppercase ${isLight ? "text-[#2A1E07]/60" : "text-white/40"}`}>
                    {t("command.rev_total", { defaultValue: "Total earned" })}
                    {revenue.partial && <span className="ml-1.5 normal-case tracking-normal text-amber-300/80">{t("command.rev_partial", { defaultValue: "(partial — a floor)" })}</span>}
                  </span>
                  <span className={`text-lg font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                    {revenue.totalCents === null ? "—" : fmtMoney(revenue.totalCents)}
                  </span>
                </div>
                {revenue.partial && <PartialNote />}
              </>
            )}
          </PanelShell>
        )}

        {/* CONTENT */}
        {states.content === "failed" ? (
          <PanelFailure isLight={isLight} label={t("command.content_label", { defaultValue: "Your content" })} testId="command-content-failure" onRetry={() => retryPanel("content")} />
        ) : (
          <PanelShell isLight={isLight} icon={Music2} title={t("command.content_label", { defaultValue: "Content performance" })}>
            {states.content === "loading" || !content ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded-lg lux-skeleton" />)}</div>
            ) : !content.hasProfile ? (
              <div className="py-2 text-center">
                <p className={`text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                  {t("command.content_noprofile", { defaultValue: "Your stage isn’t set up yet." })}
                </p>
                <p className="mt-1 text-xs text-white/40">
                  {t("command.content_noprofile_sub", { defaultValue: "Publish your first track or video and its performance lands here." })}
                </p>
                <Link href="/create">
                  <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-black hover:brightness-110 cursor-pointer">
                    {t("command.content_noprofile_cta", { defaultValue: "Start creating" })}<ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              </div>
            ) : (
              <>
                {content.totals && (
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                    <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                      <Music2 className="h-4 w-4 text-primary/70" />
                      {fmtInt(content.totals.trackPlays)} {t("command.content_plays", { defaultValue: "plays" })}
                      <span className="text-[11px] font-bold text-white/35">· {fmtInt(content.totals.trackCount)} {t("command.content_tracks", { defaultValue: "tracks" })}</span>
                    </span>
                    <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                      <Eye className="h-4 w-4 text-primary/70" />
                      {fmtInt(content.totals.videoViews)} {t("command.content_views", { defaultValue: "views" })}
                      <span className="text-[11px] font-bold text-white/35">· {fmtInt(content.totals.videoCount)} {t("command.content_videos", { defaultValue: "videos" })}</span>
                    </span>
                  </div>
                )}
                {content.topTrack && (
                  <p className="mt-3 text-sm">
                    <span className="font-bold text-white/40">{t("command.content_top_track", { defaultValue: "Top track:" })} </span>
                    <span className={`font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{content.topTrack.title}</span>
                    <span className="text-white/35 text-xs font-bold"> · {fmtInt(content.topTrack.playCount)} {t("command.content_plays", { defaultValue: "plays" })}</span>
                  </p>
                )}
                {content.topVideo && (
                  <p className="mt-1.5 text-sm">
                    <span className="font-bold text-white/40">{t("command.content_top_video", { defaultValue: "Top video:" })} </span>
                    <span className={`font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{content.topVideo.title}</span>
                    <span className="text-white/35 text-xs font-bold"> · {fmtInt(content.topVideo.viewCount)} {t("command.content_views", { defaultValue: "views" })}</span>
                  </p>
                )}
                {content.profile && (
                  <Link href={`/artist/${content.profile.slug}`}>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary/70 hover:text-primary cursor-pointer">
                      {t("command.content_view_page", { defaultValue: "View your page" })}<ArrowRight className="h-3 w-3" />
                    </span>
                  </Link>
                )}
                {content.partial && <PartialNote />}
              </>
            )}
          </PanelShell>
        )}

        {/* ACTIONS */}
        {states.actions === "failed" ? (
          <PanelFailure isLight={isLight} label={t("command.actions_label", { defaultValue: "Needs you" })} testId="command-actions-failure" onRetry={() => retryPanel("actions")} />
        ) : (
          <PanelShell isLight={isLight} icon={Inbox} title={t("command.actions_label", { defaultValue: "Needs you today" })}>
            {states.actions === "loading" || !actions ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded-lg lux-skeleton" />)}</div>
            ) : actions.total === 0 ? (
              <div className="flex items-center gap-3 py-1.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-500/[0.12] border border-green-500/25 text-green-400">
                  <Check className="h-4 w-4" />
                </span>
                <div>
                  <p className={`text-sm font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                    {t("command.actions_clear", { defaultValue: "All clear." })}
                  </p>
                  <p className="text-[11px] text-white/35">
                    {t("command.actions_clear_sub", { defaultValue: "No unread messages, no past-due members, nothing waiting on delivery." })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {actions.items.filter((i) => i.count > 0).map((item) => (
                  <Link key={item.key} href={item.href}>
                    <span className="flex items-center gap-3 py-2.5 cursor-pointer group">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/[0.12] border border-primary/20 text-primary shrink-0">
                        {actionMeta[item.key]?.icon ?? <Inbox className="h-4 w-4" />}
                      </span>
                      <span className={`flex-1 text-sm font-bold group-hover:text-primary transition-colors ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                        {actionMeta[item.key]?.label ?? item.key}
                      </span>
                      <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-black text-black">{fmtInt(item.count)}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-white/30 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
            {actions && actions.partial && <PartialNote />}
          </PanelShell>
        )}
      </div>

      {/* Off-platform honesty footnote: renders only when the audience
          panel loaded and the creator HAS connected accounts — the
          numbers above came from their own in-product snapshots. */}
      {audience?.offPlatform.connected && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-white/30">
          <Mail className="h-3 w-3" />
          {t("command.offplatform_note", { defaultValue: "Platform numbers come from your connected accounts’ own snapshots — refreshed when you open Analytics." })}
        </p>
      )}
    </section>
  );
}
