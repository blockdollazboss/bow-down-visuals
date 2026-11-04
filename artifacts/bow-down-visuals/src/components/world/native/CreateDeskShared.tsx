import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Disc3, ListMusic, PenLine, Rocket, Scissors, Sparkles } from "lucide-react";
import {
  jukeboxChipStateOf,
  jukeboxTrackIdOf,
} from "@/lib/world/create-desks";
import type { ReleasePrefill } from "@/lib/world/release-desk";
import type { SchedulerPrefill } from "@/lib/world/scheduler-desk";
import { ReleaseDeskStandalone } from "./ReleaseDesk";
import { SchedulerComposeStandalone } from "./SchedulerDesk";

/* ─── Result chips' home (NATIVE-PLAN §3.6) ────────────────────────
   WORLD-PERF ROUND 3 — this module used to hold every shared Create
   desk bit, and its static imports of the Release / Scheduler desks
   (for the two expansion panels below) glued the whole Create /
   Shop / Business family web to every module that needed so much
   as a form class — including the StationPanel frame. The bits
   that import no desk now live in CreateDeskLeaf (the true leaf);
   what remains here is the ONE shared piece that genuinely opens
   those desks: ResultChips, imported only by the desks that render
   it (the Create family and the Audio desk). Do not move leaf bits
   back here, and do not import this module from the frame. */

/* ─── Result chips ───────────────────────────────────────────────────
   The in-world next steps under a finished make. Every chip is a
   real rail: Send to the editor saves the result as a project and
   steps through to the editor seeded with it; Put it on the
   jukebox rides the room socket's jukebox.add intent and lights
   ONLY for a published-track id (the queue's own rule) — before
   the publish lands, the chip sits dark with its reason on its
   face ("publish first"), a plain span that takes no click at
   all, never a dead button; Schedule / Release render only where
   the desk's page offers that exact rail for that exact asset;
   Make another resets the bench. */

export interface ResultChipsProps {
  isLight: boolean;
  /** Save-as-project + step through to the seeded editor. Absent
   *  when the host gave the panel no editor door. */
  onSendToEditor?: () => void;
  editorBusy?: boolean;
  /** Publish to the creator's profile on the site's real rail
   *  (POST /api/publish/track). Offered only when the desk holds a
   *  publishable asset; once `published` is true the chip becomes
   *  the settled state and can never fire a second publish. */
  onPublish?: () => void;
  publishBusy?: boolean;
  published?: boolean;
  /** A published profile track id (`track:<uuid>`) — the only ids
   *  the room jukebox accepts. Anything else leaves the chip dark
   *  with its reason showing (see the dark chip below); the chip
   *  lights the moment a gate-passing id lands here. */
  jukeboxTrackId?: string | null;
  onJukeboxAdd?: (trackId: string) => void;
  /** The finished asset handed to the IN-WORLD scheduler
   *  (Stack-100 #46): the chip opens the scheduler compose right
   *  here, prefilled — the post completes in-world, never a
   *  target=_blank exit to the 2D scheduler. */
  schedulePrefill?: SchedulerPrefill;
  /** The finished asset handed to the IN-WORLD release desk
   *  (Stack-100 #55): the chip opens the distribution wizard right
   *  here, prefilled with the cover — the release completes
   *  in-world, never a target=_blank exit to /distribute. */
  releasePrefill?: ReleasePrefill;
  onSaveDraft?: () => void;
  draftSaved?: boolean;
  onMakeAnother: () => void;
}

export function ResultChips(props: ResultChipsProps) {
  const { t } = useTranslation();
  const { isLight } = props;
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const chipCls = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
  const goldChipCls =
    "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";
  const trackId = jukeboxTrackIdOf(props.jukeboxTrackId);
  const jukeboxChip = jukeboxChipStateOf({
    candidate: props.jukeboxTrackId,
    railOffered: Boolean(props.onJukeboxAdd),
  });
  return (
    <div data-testid="world-create-result-chips" className="mt-3 flex flex-wrap gap-1.5">
      {props.onSendToEditor ? (
        <button
          type="button"
          data-testid="world-create-chip-editor"
          onClick={props.onSendToEditor}
          disabled={props.editorBusy}
          className={goldChipCls}
        >
          <Scissors className="h-3.5 w-3.5" /> {t("worldCreateDesk.chipEditor")}
        </button>
      ) : null}
      {props.published ? (
        <span
          data-testid="world-create-chip-published"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${
            isLight ? "border-emerald-700/40 text-emerald-800" : "border-emerald-400/40 text-emerald-300"
          }`}
        >
          <BadgeCheck className="h-3.5 w-3.5" /> {t("worldCreateDesk.chipPublished")}
        </span>
      ) : props.onPublish ? (
        <button
          type="button"
          data-testid="world-create-chip-publish"
          onClick={props.onPublish}
          disabled={props.publishBusy}
          className={goldChipCls}
        >
          <Rocket className="h-3.5 w-3.5" /> {props.publishBusy ? t("worldCreateDesk.chipPublishing") : t("worldCreateDesk.chipPublish")}
        </button>
      ) : null}
      {jukeboxChip === "live" && trackId ? (
        <button
          type="button"
          data-testid="world-create-chip-jukebox"
          onClick={() => props.onJukeboxAdd?.(trackId)}
          className={chipCls}
        >
          <ListMusic className="h-3.5 w-3.5" /> {t("worldCreateDesk.chipJukebox")}
        </button>
      ) : jukeboxChip === "dark" ? (
        /* The dark chip (stack-20 round 2, #4): the desk offers the
           jukebox rail but this result carries no published track
           yet, so the chip shows its face with the reason on it —
           a span, not a button: it takes no click, so it can never
           be a dead one. It lights into the live chip above the
           moment the publish response's id passes the gate. */
        <span
          data-testid="world-create-chip-jukebox-dark"
          aria-disabled="true"
          title={t("worldCreateDesk.chipJukeboxDarkTitle")}
          className={`inline-flex cursor-not-allowed select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold opacity-50 ${
            isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"
          }`}
        >
          <ListMusic className="h-3.5 w-3.5" /> {t("worldCreateDesk.chipJukeboxDark")}
        </span>
      ) : null}
      {props.schedulePrefill ? (
        <button
          type="button"
          data-testid="world-create-chip-schedule"
          aria-expanded={schedulerOpen}
          onClick={() => setSchedulerOpen((v) => !v)}
          className={chipCls}
        >
          <Rocket className="h-3.5 w-3.5" /> {t("worldCreateDesk.chipSchedule")}
        </button>
      ) : null}
      {props.releasePrefill ? (
        <button
          type="button"
          data-testid="world-create-chip-release"
          aria-expanded={releaseOpen}
          onClick={() => setReleaseOpen((v) => !v)}
          className={chipCls}
        >
          <Disc3 className="h-3.5 w-3.5" /> {t("worldCreateDesk.chipRelease")}
        </button>
      ) : null}
      {props.onSaveDraft ? (
        <button
          type="button"
          data-testid="world-create-chip-draft"
          onClick={props.onSaveDraft}
          disabled={props.draftSaved}
          className={chipCls}
        >
          <PenLine className="h-3.5 w-3.5" /> {props.draftSaved ? t("worldCreateDesk.chipDraftSaved") : t("worldCreateDesk.chipDraftSave")}
        </button>
      ) : null}
      <button
        type="button"
        data-testid="world-create-chip-another"
        onClick={props.onMakeAnother}
        className={chipCls}
      >
        <Sparkles className="h-3.5 w-3.5" /> {t("worldCreateDesk.chipAnother")}
      </button>
      {schedulerOpen && props.schedulePrefill ? (
        <div className="w-full">
          <SchedulerComposeStandalone isLight={isLight} prefill={props.schedulePrefill} />
        </div>
      ) : null}
      {releaseOpen && props.releasePrefill ? (
        <div className="w-full">
          <ReleaseDeskStandalone isLight={isLight} prefill={props.releasePrefill} />
        </div>
      ) : null}
    </div>
  );
}
