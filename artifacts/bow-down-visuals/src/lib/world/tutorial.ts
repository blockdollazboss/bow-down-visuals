/**
 * "Your First 10 Minutes" — the tutorial quest line's client half
 * (Ring 3, Phase 6; the server rail is api-server lib/world-tutorial).
 *
 * The server owns the facts and the order; this module owns only
 * what a step SAYS and how the status DTO is read. The display
 * table is keyed by the server's step keys — an unknown key reads
 * as no step (the honest answer to a shape we don't understand)
 * rather than a guess at what the member should do next.
 */

export interface TutorialStepStatus {
  n: number;
  key: string;
  done: boolean;
}

export interface TutorialStatus {
  /** The current step's number (1–7); null once the line is done. */
  currentStep: number | null;
  steps: TutorialStepStatus[];
  completed: boolean;
  reward: { amountVb: number; claimed: boolean };
}

export interface TutorialStepDisplay {
  /** The step's short name (strip + panels). */
  name: string;
  /** One line of where-to-go / how-to-finish guidance. */
  guidance: string;
}

export const TUTORIAL_STEP_DISPLAY: Record<string, TutorialStepDisplay> = {
  "meet-the-king": {
    name: "Meet the King",
    guidance: "Walk up the hall to the throne, at the far end past the stage.",
  },
  "claim-daily-drop": {
    name: "Claim your Daily Drop",
    guidance: "Open the Treasury station and claim today's Daily Drop.",
  },
  "quest-board": {
    name: "Read the Quest Board",
    guidance: "Step into the Treasury — the quest board stands there.",
  },
  "make-a-song": {
    name: "Make a Song",
    guidance: "Make a song at the Song Desk — or in the studio; making it is what counts.",
  },
  publish: {
    name: "Publish It",
    guidance: "Publish the song to your profile, then find it on the Music Hall jukebox.",
  },
  applaud: {
    name: "Applaud a Show",
    guidance: "Take a seat at a show and clap or cheer — tipping the stage counts too.",
  },
  "claim-quest-reward": {
    name: "Claim a Quest Reward",
    guidance: "Finish any weekly quest, then claim its reward at the Treasury quest board.",
  },
};

/** The display for a step key; null for a key this client doesn't
 *  know (the step then reads as plain "next step" copy). */
export function tutorialStepDisplay(key: string): TutorialStepDisplay | null {
  return TUTORIAL_STEP_DISPLAY[key] ?? null;
}

/**
 * Parse the GET /api/world/tutorial body with full DTO discipline:
 * a malformed shape reads as null (unmeasured) — never a fabricated
 * "step 1 of 7" the server didn't send. Step rows carry only
 * n/key/done; a row missing any of them poisons the whole read.
 */
export function parseTutorialStatus(body: unknown): TutorialStatus | null {
  if (typeof body !== "object" || body === null) return null;
  const tut = (body as { tutorial?: unknown }).tutorial;
  if (typeof tut !== "object" || tut === null) return null;
  const t = tut as Record<string, unknown>;
  const rawSteps = t.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;
  const steps: TutorialStepStatus[] = [];
  for (const raw of rawSteps) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.n !== "number" ||
      !Number.isInteger(r.n) ||
      typeof r.key !== "string" ||
      !r.key ||
      typeof r.done !== "boolean"
    ) {
      return null;
    }
    steps.push({ n: r.n, key: r.key, done: r.done });
  }
  const completed = t.completed === true;
  const currentStep =
    typeof t.currentStep === "number" && Number.isInteger(t.currentStep)
      ? t.currentStep
      : null;
  if (!completed && currentStep === null) return null;
  const rewardRaw = t.reward;
  if (typeof rewardRaw !== "object" || rewardRaw === null) return null;
  const reward = rewardRaw as Record<string, unknown>;
  if (typeof reward.amountVb !== "number" || !Number.isFinite(reward.amountVb)) return null;
  return {
    currentStep: completed ? null : currentStep,
    steps,
    completed,
    reward: { amountVb: reward.amountVb, claimed: reward.claimed === true },
  };
}

/** The current step's row (null when the line is complete or the
 *  status is inconsistent). */
export function currentTutorialStep(status: TutorialStatus): TutorialStepStatus | null {
  if (status.completed || status.currentStep === null) return null;
  return status.steps.find((s) => s.n === status.currentStep) ?? null;
}

/**
 * The objective strip's tutorial line. While the line runs it
 * leads the strip: "Tutorial 3 of 7 — Read the Quest Board".
 * Completed with the reward unclaimed it stays as the claim line;
 * claimed (or a status with no current step) reads null and the
 * strip falls back to the quest summary.
 */
export function tutorialStripLine(status: TutorialStatus | null): string | null {
  if (!status) return null;
  if (status.completed) {
    return status.reward.claimed
      ? null
      : `Tutorial complete — claim your ${status.reward.amountVb} Bucs`;
  }
  const step = currentTutorialStep(status);
  if (!step) return null;
  const display = tutorialStepDisplay(step.key);
  const name = display?.name ?? "Your next step";
  return `Tutorial ${step.n} of ${status.steps.length} — ${name}`;
}

/** The guidance line for the current step (the strip's helper
 *  text / panel copy); null when there's nothing to guide. */
export function tutorialGuidance(status: TutorialStatus | null): string | null {
  if (!status || status.completed) return null;
  const step = currentTutorialStep(status);
  if (!step) return null;
  return tutorialStepDisplay(step.key)?.guidance ?? null;
}
