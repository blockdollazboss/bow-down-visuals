import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Package, Loader2, Check, Circle, ArrowRight, AlertTriangle, ChevronDown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { buildSchedulerHref, releaseAnnounceCaption } from "@/lib/scheduler-handoff";

/* ── Drop Day Kit — the Promote home (#169, H3 delta) ────────────────
   The kit itself lives in the Distribute release editor (one tap
   assembles the teaser spec, the banner set, the presave countdown,
   and the land-time fan heads-up from the release's own art and
   track). This panel is the kit's second home, docked in Promote
   where release day is worked: every release the creator owns, its
   kit state, and the RELEASE-DAY CHECKLIST derived server-side from
   the real rails (GET /api/drop-day-kits/mine).

   Honesty rules, same as the kit's own:
   - the panel renders only what the server derived — no step is
     ticked here; steps the kit cannot verify (renders in Create)
     arrive as 'action' and stay that way;
   - the announcement step goes through the Scheduler's own door
     (buildSchedulerHref — the DE-4 protocol, release-attributed);
     this panel never posts, sends, or schedules anything itself;
   - no releases is an honest empty state pointing at Distribute,
     never a demo release. */

interface KitTeaserWire { createLink: string; durationSec: number }
interface KitBannerWire { size: string; width: number; height: number; createLink: string }
interface KitPayloadWire {
  teaser: KitTeaserWire | null;
  banners: KitBannerWire[];
  countdown: { presaveUrl: string | null; releaseDate: string | null };
  missing: string[];
}
interface ChecklistStepWire {
  id: string;
  label: string;
  state: "done" | "todo" | "action";
  detail: string;
}
interface KitViewWire {
  id: string | null;
  releaseId: string;
  status: string | null;
  kit: KitPayloadWire | null;
  captures: number;
  announce: { draft: number; scheduled: number; posted: number };
  checklist: ChecklistStepWire[];
  updatedAt: string | null;
}
interface ReleaseSummaryWire {
  id: string;
  title: string;
  artistName: string;
  releaseDate: string | null;
  status: string;
  artworkUrl: string | null;
  presaveUrl: string | null;
}
interface MineEntry { release: ReleaseSummaryWire; kit: KitViewWire }

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Live",
  landed: "Landed",
};

export function DropDayPanel() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [entries, setEntries] = useState<MineEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [working, setWorking] = useState<{ releaseId: string; kind: "assemble" | "activate" } | null>(null);
  const [notice, setNotice] = useState<{ releaseId: string; text: string } | null>(null);
  const [error, setError] = useState<{ releaseId: string; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/drop-day-kits/mine", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        const d = (await res.json()) as { releases: MineEntry[] };
        if (cancelled) return;
        setEntries(d.releases);
        setOpenId((cur) => cur ?? d.releases[0]?.release.id ?? null);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken, retryNonce]);

  if (!user) return null;

  async function call(releaseId: string, kind: "assemble" | "activate") {
    setWorking({ releaseId, kind });
    setError(null);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const res = kind === "assemble"
        ? await fetch("/api/drop-day-kits", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ releaseId }),
          })
        : await fetch(`/api/drop-day-kits/${releaseId}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ status: "active" }),
          });
      const d = (await res.json().catch(() => null)) as KitViewWire | { error?: string } | null;
      if (!res.ok) throw new Error((d as { error?: string } | null)?.error ?? "That didn't work");
      const view = d as KitViewWire;
      setEntries((prev) => (prev ?? []).map((e) => (e.release.id === releaseId ? { ...e, kit: view } : e)));
      setNotice({
        releaseId,
        text: kind === "assemble"
          ? "Kit assembled as a draft — work the checklist, then activate."
          : "Kit is live. On release day, every fan on the presave list gets the heads-up — exactly once.",
      });
    } catch (e) {
      setError({ releaseId, text: e instanceof Error ? e.message : "That didn't work" });
    } finally {
      setWorking(null);
    }
  }

  const cardClass = `rounded-2xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-white/[0.05] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-white/[0.05] to-[#0d0a04]"}`;
  const headingClass = `text-base font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`;
  const subClass = `mt-0.5 text-xs ${isLight ? "text-[#5c5138]" : "text-white/40"}`;
  const rowClass = `rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`;
  const bodyClass = `text-xs ${isLight ? "text-[#5c5138]" : "text-white/55"}`;
  const strongClass = `font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`;
  const goldBtn =
    "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50";
  const ghostBtn = `inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-bold transition disabled:opacity-50 ${isLight ? "border-[#7A5A12]/40 text-[#6B5B36] hover:bg-[#C9A84C]/10" : "border-white/15 text-white/80 hover:bg-white/5"}`;
  const linkClass = "font-bold text-primary hover:brightness-110";

  function announceHref(entry: MineEntry): string {
    const { release } = entry;
    /* A draft already waiting in the Scheduler is opened THERE, not
       re-composed here — the prefill door would start a second post. */
    if (entry.kit.announce.draft > 0 && entry.kit.announce.scheduled === 0 && entry.kit.announce.posted === 0) {
      return "/scheduler";
    }
    return buildSchedulerHref({
      caption: releaseAnnounceCaption({
        title: release.title,
        artistName: release.artistName,
        releaseDate: release.releaseDate,
        presaveUrl: release.presaveUrl ?? "",
      }),
      media: release.artworkUrl,
      mediaType: release.artworkUrl ? "image" : undefined,
      releaseId: release.id,
    });
  }

  function stepAction(entry: MineEntry, step: ChecklistStepWire) {
    const { release, kit } = entry;
    if (step.state === "todo" && ["audio", "artwork", "release_date", "presave_page"].includes(step.id)) {
      return (
        <Link href="/distribute" className={linkClass}>
          Fix in Distribute <ArrowRight className="inline h-3 w-3" />
        </Link>
      );
    }
    if (step.id === "teaser" && step.state === "action" && kit.kit?.teaser) {
      return (
        <a href={kit.kit.teaser.createLink} className={linkClass}>
          Open in Create <ArrowRight className="inline h-3 w-3" />
        </a>
      );
    }
    if (step.id === "banners" && step.state === "action" && kit.kit && kit.kit.banners.length > 0) {
      return (
        <span>
          {kit.kit.banners.map((b, i) => (
            <span key={b.size}>
              {i > 0 && " · "}
              <a href={b.createLink} className={linkClass}>
                {b.size} {b.width}×{b.height}
              </a>
            </span>
          ))}
        </span>
      );
    }
    if (step.id === "announce" && step.state === "action") {
      return (
        <a href={announceHref(entry)} className={linkClass}>
          Open in the Scheduler <ArrowRight className="inline h-3 w-3" />
        </a>
      );
    }
    if (step.id === "presave_page" && step.state === "done" && release.presaveUrl) {
      return (
        <a href={release.presaveUrl} className={linkClass}>
          View the page <ArrowRight className="inline h-3 w-3" />
        </a>
      );
    }
    return null;
  }

  return (
    <section className={cardClass} data-testid="drop-day-panel">
      <div className="flex flex-wrap items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${isLight ? "border-[#C9A84C]/40 bg-[#C9A84C]/15" : "border-primary/25 bg-primary/[0.12]"}`}>
          <Package className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={headingClass}>Drop Day Kit</h2>
          <p className={subClass}>
            The release-day run-through for every drop — teaser, banners, announcement, and the fan heads-up,
            assembled from each release's own art and track.
          </p>
        </div>
      </div>

      {!entries && !loadError && (
        <p className={`mt-4 ${bodyClass}`}>Loading your releases…</p>
      )}
      {loadError && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className={`flex items-center gap-2 ${bodyClass}`}>
            <AlertTriangle className="h-4 w-4 shrink-0" /> Your Drop Day Kits couldn't load.
          </p>
          <button type="button" onClick={() => setRetryNonce((n) => n + 1)} className={ghostBtn}>
            Try again
          </button>
        </div>
      )}
      {entries && entries.length === 0 && (
        <div className="mt-4">
          <p className={bodyClass}>
            No releases yet — a Drop Day Kit is assembled per release, from the release's own track and cover art.
          </p>
          <Link href="/distribute" className={`${goldBtn} mt-3`}>
            Start a release in Distribute <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="mt-5 space-y-3">
          {entries.map((entry) => {
            const { release, kit } = entry;
            const open = openId === release.id;
            const doneCount = kit.checklist.filter((s) => s.state === "done").length;
            return (
              <div key={release.id} className={rowClass}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : release.id)}
                  className="flex w-full flex-wrap items-center gap-3 text-left"
                  aria-expanded={open}
                >
                  <div className="min-w-0 flex-1">
                    <p className={strongClass}>
                      <span className="text-sm">{release.title}</span>
                      <span className={`ml-2 text-xs font-semibold ${isLight ? "text-[#5c5138]" : "text-white/45"}`}>
                        {release.artistName}
                      </span>
                    </p>
                    <p className={bodyClass}>
                      {release.releaseDate ? `Drops ${release.releaseDate}` : "No release date set"} ·{" "}
                      {kit.captures} {kit.captures === 1 ? "fan" : "fans"} on the presave list ·{" "}
                      {doneCount} of {kit.checklist.length} checklist steps done
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                    {kit.status ? (STATUS_LABELS[kit.status] ?? kit.status) : "No kit yet"}
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""} ${isLight ? "text-[#5c5138]" : "text-white/40"}`} />
                </button>

                {open && (
                  <div className="mt-4">
                    {error?.releaseId === release.id && (
                      <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 text-xs text-red-500">
                        <AlertTriangle className="h-4 w-4 shrink-0" /> {error.text}
                      </div>
                    )}
                    {notice?.releaseId === release.id && (
                      <div className={`mb-3 flex items-center gap-2 rounded-xl border p-3 text-xs ${isLight ? "border-emerald-600/30 bg-emerald-500/[0.08] text-emerald-800" : "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200/85"}`}>
                        <Check className="h-4 w-4 shrink-0" /> {notice.text}
                      </div>
                    )}

                    <ul className="space-y-2.5">
                      {kit.checklist.map((s) => (
                        <li key={s.id} className="flex items-start gap-2.5">
                          {s.state === "done" ? (
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          ) : s.state === "action" ? (
                            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          ) : (
                            <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${isLight ? "text-[#5c5138]/50" : "text-white/30"}`} />
                          )}
                          <p className={`flex-1 ${bodyClass}`}>
                            <span className={strongClass}>{s.label}</span> — {s.detail}{" "}
                            {stepAction(entry, s)}
                          </p>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {!kit.kit && (
                        <button
                          type="button"
                          onClick={() => void call(release.id, "assemble")}
                          disabled={working !== null}
                          className={goldBtn}
                        >
                          {working?.releaseId === release.id && working.kind === "assemble"
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Package className="h-4 w-4" />}
                          Assemble the Drop Day Kit
                        </button>
                      )}
                      {kit.kit && kit.status === "draft" && (
                        <button
                          type="button"
                          onClick={() => void call(release.id, "activate")}
                          disabled={working !== null}
                          className={goldBtn}
                        >
                          {working?.releaseId === release.id && working.kind === "activate"
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Check className="h-4 w-4" />}
                          Activate the kit
                        </button>
                      )}
                      {kit.kit && (
                        <button
                          type="button"
                          onClick={() => void call(release.id, "assemble")}
                          disabled={working !== null}
                          className={ghostBtn}
                        >
                          {working?.releaseId === release.id && working.kind === "assemble"
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Package className="h-4 w-4" />}
                          Re-assemble
                        </button>
                      )}
                      <Link href="/distribute" className={ghostBtn}>
                        Open the release in Distribute
                      </Link>
                    </div>
                    {!kit.kit && (
                      <p className={`mt-2 ${bodyClass}`}>
                        It lands as a draft for your review — nothing goes live until you activate it.
                      </p>
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
