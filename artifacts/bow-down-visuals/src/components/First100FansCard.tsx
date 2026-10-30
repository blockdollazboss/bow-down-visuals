import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Check, CheckCircle2, ChevronDown, Circle, Crown, PartyPopper, Users, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  celebrationHeadline,
  nextStepOf,
  shouldShowFirst100Card,
  type First100Status,
} from "@/lib/first100";

/* ── First 100 Fans dashboard dock (#155) ───────────────────────────
   The new creator's guided thread, living on the dashboard — never
   a standalone page. The server owns the truth: the count is real
   follows, the steps are real state, celebrations fire exactly
   once through the notifications rail when the creator marks the
   moment here. This card only reads + renders, and hides itself
   when the server says the journey shouldn't surface (snoozed,
   completed) — the path never nags. */

export function First100FansCard() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [status, setStatus] = useState<First100Status | null>(null);
  const [locallyDismissed, setLocallyDismissed] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [showFans, setShowFans] = useState(false);
  const celebrateInFlight = useRef(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/first100", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const d = (await res.json()) as { first100?: First100Status };
        if (!cancelled && d.first100) setStatus(d.first100);
      } catch {
        /* a failed read hides the card — never breaks the dashboard */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  if (!user || !shouldShowFirst100Card(status, locallyDismissed) || !status) return null;

  const pending = status.pendingCelebrations;
  const celebrationMilestone = pending.length > 0 ? pending[pending.length - 1] : null;
  const nextStep = nextStepOf(status);

  const call = async (path: string) => {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { first100?: First100Status };
    return d.first100 ?? null;
  };

  const celebrate = async () => {
    if (celebrateInFlight.current) return;
    celebrateInFlight.current = true;
    setCelebrating(true);
    try {
      const fresh = await call("/api/first100/celebrate");
      if (fresh) setStatus(fresh);
    } catch {
      /* the moment stays pending and can be marked again */
    } finally {
      celebrateInFlight.current = false;
      setCelebrating(false);
    }
  };

  const dismiss = async () => {
    setLocallyDismissed(true);
    try {
      const fresh = await call("/api/first100/dismiss");
      if (fresh) setStatus(fresh);
    } catch {
      /* the local hide already honored the tap */
    }
  };

  const shell = isLight
    ? "border-[#C9A84C]/50 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const heading = isLight ? "text-zinc-900" : "text-white";
  const body = isLight ? "text-zinc-600" : "text-zinc-400";
  const chipReached = isLight
    ? "border-[#C9A84C] bg-[#C9A84C] text-white"
    : "border-primary bg-primary text-black";
  const chipAhead = isLight
    ? "border-[#C9A84C]/40 text-zinc-500"
    : "border-white/15 text-zinc-400";

  return (
    <div data-testid="first100-card" className={`relative rounded-2xl border p-5 ${shell}`}>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss First 100 Fans for now"
        data-testid="first100-dismiss"
        className={`absolute right-3 top-3 rounded-full p-1 transition-colors ${
          isLight ? "text-zinc-500 hover:text-zinc-800" : "text-zinc-500 hover:text-zinc-200"
        }`}
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <h3 className={`text-base font-black ${heading}`}>First 100 Fans</h3>
          <p className={`mt-1 text-sm ${body}`}>
            {status.completed
              ? "You made it — 100 real fans, earned one follow at a time."
              : status.fanCount === 0
                ? "Your guided path to your first 100 real fans — every step inside the house."
                : `${status.fanCount} of 100 real fans so far. Every one of them is a real follow — no padding, ever.`}
          </p>
        </div>
      </div>

      {/* ── Celebration moment (pending milestone) ── */}
      {celebrationMilestone !== null && (
        <div
          data-testid="first100-celebration"
          className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
            isLight ? "border-[#C9A84C] bg-[#FFF6D8]" : "border-primary/50 bg-primary/10"
          }`}
        >
          <PartyPopper className="h-5 w-5 shrink-0 text-primary" />
          <p className={`min-w-0 flex-1 text-sm font-bold ${heading}`}>
            {celebrationHeadline(celebrationMilestone)} — the house is marking this one with you.
          </p>
          <button
            type="button"
            onClick={celebrate}
            disabled={celebrating}
            data-testid="first100-celebrate"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Crown className="h-4 w-4" />
            {celebrating ? "Marking it…" : "Mark the moment"}
          </button>
        </div>
      )}

      {/* ── Progress + milestone ladder ── */}
      <div className="mt-4">
        <div
          className={`h-2.5 w-full overflow-hidden rounded-full ${isLight ? "bg-[#E5D9B8]" : "bg-white/10"}`}
          role="progressbar"
          aria-valuenow={status.fanCount}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Fans toward 100"
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${status.progressPct}%` }}
          />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {status.milestones.map((m) => (
            <span
              key={m.milestone}
              data-testid={`first100-milestone-${m.milestone}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                m.reached ? chipReached : chipAhead
              }`}
            >
              {m.celebrated ? <Check className="h-3 w-3" /> : null}
              {m.milestone} {m.milestone === 1 ? "fan" : "fans"}
            </span>
          ))}
          {status.nextMilestone !== null && status.fansToNext !== null && (
            <span className={`ml-1 text-[11px] font-semibold ${body}`}>
              {status.fansToNext} to go to {status.nextMilestone}
            </span>
          )}
        </div>
      </div>

      {/* ── The guided steps ── */}
      <ul className="mt-4 space-y-1.5">
        {status.steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2.5">
            {step.done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
            ) : (
              <Circle className={`h-4 w-4 shrink-0 ${isLight ? "text-zinc-400" : "text-zinc-600"}`} />
            )}
            <span
              className={`text-sm ${step.done ? (isLight ? "text-zinc-500 line-through" : "text-zinc-500 line-through") : `font-semibold ${heading}`}`}
            >
              {step.title}
            </span>
          </li>
        ))}
      </ul>

      {nextStep && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            href={nextStep.href}
            data-testid="first100-next-step"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90"
          >
            Next: {nextStep.title}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <span className={`text-xs ${body}`}>{nextStep.blurb}</span>
        </div>
      )}

      {/* ── The early fans themselves ── */}
      {status.earlyFans.length > 0 && (
        <div className="mt-4">
          <button aria-expanded={showFans}
            type="button"
            onClick={() => setShowFans((v) => !v)}
            data-testid="first100-fans-toggle"
            className={`inline-flex items-center gap-1.5 text-xs font-bold ${isLight ? "text-zinc-700" : "text-zinc-200"}`}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFans ? "rotate-180" : ""}`} />
            {showFans ? "Hide" : "Meet"} your first fans ({status.earlyFans.length} of your first 100)
          </button>
          {showFans && (
            <ul data-testid="first100-fans-list" className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {status.earlyFans.map((fan) => {
                const label = fan.displayName ?? `Fan #${fan.fanNumber}`;
                const inner = (
                  <>
                    {fan.avatarUrl ? (
                      <img src={fan.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-black text-primary">
                        #{fan.fanNumber}
                      </span>
                    )}
                    <span className={`min-w-0 flex-1 truncate text-xs font-bold ${heading}`}>{label}</span>
                    <span className={`shrink-0 text-[10px] ${body}`}>
                      {new Date(fan.followedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </>
                );
                const rowClass = `flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 ${isLight ? "bg-white/50" : "bg-white/[0.04]"}`;
                return (
                  <li key={fan.userId}>
                    {fan.slug ? (
                      <Link href={`/artist/${fan.slug}`} className={rowClass}>{inner}</Link>
                    ) : (
                      <div className={rowClass}>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
