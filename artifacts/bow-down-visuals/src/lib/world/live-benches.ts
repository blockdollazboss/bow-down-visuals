/* ─── Live Desk benches seam (Stack 400 world parity, census
   B-11 + B-15) ────────────────────────────────────────────────
   The go-live family's two prep tools, native at the Live
   Desk — the 2D surfaces' own rails, verbatim:

     POST /api/show-finder        (ShowFinder.tsx, on /go-live)
       { location, genre, opportunityTypes, dateWindow,
         artistBio }
       → { opportunities[], disclaimer, creditsUsed,
           creditsRemaining }
       200 Visual Bucs — the credit registry's
       "/api/show-finder" entry; the bench reads the registry,
       so the shown price can never drift from the
       confirmation's price.
     POST /api/show-finder/pitch
       { opportunityTitle, opportunityType, organizer,
         creatorName, genre, artistBio, location }
       → { pitch: { subject, body }, tips[], creditsUsed,
           creditsRemaining }
       100 Visual Bucs — registry "/api/show-finder/pitch".
     POST /api/guest-questions    (GuestQuestions.tsx, in the
       { guestName, topic, bio }    podcast flow)
       → { guestName, topic, warmup, deepDive, rapidFire,
           closer, total, creditsUsed, creditsRemaining }
       75 Visual Bucs — registry "/api/guest-questions".

   Confirmation law: every post rides useConfirmedApi's
   confirmedFetch — the registry-priced spend confirmation
   shows BEFORE anything is charged, and a declined
   confirmation runs nothing. Payload shaping below is the
   twins' own (same trims, same slice ceilings, same key
   order, same fallbacks), and the response readers hold the
   twins' own drift discipline: a payload that drifts parses
   to null and the bench shows its error copy — never a
   dressed-up empty answer. (The one exception the twin
   itself makes: an EMPTY opportunities array is a real,
   charged answer — a hunt that matched nothing — and it
   parses as a successful empty result.)

   Copy rides the pages' own catalog namespaces (shows.* and
   podcast.guestQuestions.*) so the benches' labels can never
   drift from the pages'. */
import { getCreditCost } from "../credit-costs";

export const SHOW_FINDER_PATH = "/api/show-finder";
export const SHOW_FINDER_PITCH_PATH = "/api/show-finder/pitch";
export const GUEST_QUESTIONS_PATH = "/api/guest-questions";

/** POST /api/show-finder — registry 200, the route's charge
 *  and the 2D page's SEARCH_COST agree. */
export function showFinderCost(): number {
  const entry = getCreditCost(SHOW_FINDER_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${SHOW_FINDER_PATH}`);
  return entry.cost;
}

/** POST /api/show-finder/pitch — registry 100 (PITCH_COST). */
export function showFinderPitchCost(): number {
  const entry = getCreditCost(SHOW_FINDER_PITCH_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${SHOW_FINDER_PITCH_PATH}`);
  return entry.cost;
}

/** POST /api/guest-questions — registry 75 (QUESTION_COST). */
export function guestQuestionsCost(): number {
  const entry = getCreditCost(GUEST_QUESTIONS_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${GUEST_QUESTIONS_PATH}`);
  return entry.cost;
}

/* ─── Show Finder — the page's own enums, verbatim ─────────────
   Opportunity types must stay in sync with the backend
   route's OPPORTUNITY_TYPES enum (the page's own warning). */

export const SHOW_OPPORTUNITY_TYPES = [
  "open-mic",
  "showcase",
  "festival",
  "venue-gig",
  "radio",
  "podcast",
] as const;
export type ShowOpportunityType = (typeof SHOW_OPPORTUNITY_TYPES)[number];

/** The catalog label/blurb key segment per type (the page's
 *  OPPORTUNITY_OPTS labelKey/blurbKey under shows.*). */
export const SHOW_OPPORTUNITY_LABEL_KEYS: Record<ShowOpportunityType, string> = {
  "open-mic": "typeOpenMics",
  showcase: "typeShowcases",
  festival: "typeFestivals",
  "venue-gig": "typeVenueGigs",
  radio: "typeRadioSpots",
  podcast: "typePodcasts",
};
export const SHOW_OPPORTUNITY_BLURB_KEYS: Record<ShowOpportunityType, string> = {
  "open-mic": "typeOpenMicsBlurb",
  showcase: "typeShowcasesBlurb",
  festival: "typeFestivalsBlurb",
  "venue-gig": "typeVenueGigsBlurb",
  radio: "typeRadioSpotsBlurb",
  podcast: "typePodcastsBlurb",
};

export const SHOW_DATE_WINDOWS = ["next-30-days", "next-90-days", "next-6-months"] as const;
export type ShowDateWindow = (typeof SHOW_DATE_WINDOWS)[number];

/** The catalog label key per date window (shows.window*). */
export const SHOW_DATE_WINDOW_LABEL_KEYS: Record<ShowDateWindow, string> = {
  "next-30-days": "windowNext30Days",
  "next-90-days": "windowNext90Days",
  "next-6-months": "windowNext6Months",
};

export const SHOW_GENRE_PRESETS = [
  "Hip-Hop",
  "R&B",
  "Pop",
  "Afrobeats",
  "Latin",
  "EDM",
  "Rock",
  "Country",
  "Jazz",
  "Gospel",
] as const;

/** Model returns singular type labels ("Open Mic"); map them
 *  to the request enum — the page's TYPE_TO_KEY, verbatim. */
export const SHOW_TYPE_TO_KEY: Record<string, ShowOpportunityType> = {
  "Open Mic": "open-mic",
  Showcase: "showcase",
  Festival: "festival",
  "Venue Gig": "venue-gig",
  "Radio Spot": "radio",
  "Podcast Guest": "podcast",
};

/* ─── Show Finder — payload shaping, the page's own ─────────── */

export interface ShowFinderInput {
  location: string;
  genre: string;
  customGenre: string;
  opportunityTypes: ShowOpportunityType[];
  dateWindow: string;
  artistBio: string;
}

/** The page's finalGenre rule, shared by both posts: a typed
 *  custom genre wins over the preset pick. */
export function showFinderGenre(input: { genre: string; customGenre: string }): string {
  return (input.customGenre.trim() || input.genre).slice(0, 80);
}

/** POST /api/show-finder body — findShows' own shaping:
 *  location trimmed to 120, bio trimmed to 600. */
export function buildShowFinderPayload(input: ShowFinderInput): {
  location: string;
  genre: string;
  opportunityTypes: ShowOpportunityType[];
  dateWindow: string;
  artistBio: string;
} {
  return {
    location: input.location.trim().slice(0, 120),
    genre: showFinderGenre(input),
    opportunityTypes: input.opportunityTypes,
    dateWindow: input.dateWindow,
    artistBio: input.artistBio.trim().slice(0, 600),
  };
}

export interface ShowOpportunity {
  title: string;
  type: string;
  organizer: string;
  location: string;
  dateWindow: string;
  whyFit: string;
  howToApply: string;
  verifyNote: string;
}

export interface ShowPitchInput {
  opportunity: ShowOpportunity;
  creatorName: string;
  profileName: string | null | undefined;
  genre: string;
  customGenre: string;
  artistBio: string;
  location: string;
}

/** POST /api/show-finder/pitch body — draftPitch's own
 *  shaping: the typed name wins, then the profile's display
 *  name, then the page's "Independent Artist" fallback; the
 *  model's type label maps back to the request enum with
 *  "showcase" as the page's fallback. */
export function buildShowPitchPayload(input: ShowPitchInput): {
  opportunityTitle: string;
  opportunityType: ShowOpportunityType;
  organizer: string;
  creatorName: string;
  genre: string;
  artistBio: string;
  location: string;
} {
  const name = input.creatorName.trim() || input.profileName || "Independent Artist";
  return {
    opportunityTitle: input.opportunity.title,
    opportunityType: SHOW_TYPE_TO_KEY[input.opportunity.type] ?? "showcase",
    organizer: input.opportunity.organizer,
    creatorName: name.slice(0, 100),
    genre: showFinderGenre(input),
    artistBio: input.artistBio.trim().slice(0, 600),
    location: input.location.trim().slice(0, 120),
  };
}

/* ─── Show Finder — response readers (null on drift) ────────── */

function stringOr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export interface ShowFinderResult {
  opportunities: ShowOpportunity[];
  disclaimer: string;
}

/** The hunt answer: the page gates on Array.isArray alone —
 *  an empty array is a successful zero-match hunt, never a
 *  failure. Item fields coerce to strings the way the
 *  server's own parser clamps them. */
export function showOpportunitiesOf(data: unknown): ShowFinderResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.opportunities)) return null;
  const opportunities: ShowOpportunity[] = [];
  for (const raw of d.opportunities as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    opportunities.push({
      title: stringOr(o.title),
      type: stringOr(o.type),
      organizer: stringOr(o.organizer),
      location: stringOr(o.location),
      dateWindow: stringOr(o.dateWindow),
      whyFit: stringOr(o.whyFit),
      howToApply: stringOr(o.howToApply),
      verifyNote: stringOr(o.verifyNote),
    });
  }
  return { opportunities, disclaimer: stringOr(d.disclaimer) };
}

export interface ShowPitch {
  subject: string;
  body: string;
}

export interface ShowPitchResult {
  pitch: ShowPitch;
  tips: string[];
}

/** The pitch answer: the page requires a subject AND a body
 *  before it shows a draft; tips ride along when present. */
export function showPitchOf(data: unknown): ShowPitchResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!d.pitch || typeof d.pitch !== "object") return null;
  const p = d.pitch as Record<string, unknown>;
  if (typeof p.subject !== "string" || p.subject.length === 0) return null;
  if (typeof p.body !== "string" || p.body.length === 0) return null;
  const tips = Array.isArray(d.tips)
    ? (d.tips as unknown[]).filter((tip): tip is string => typeof tip === "string")
    : [];
  return { pitch: { subject: p.subject, body: p.body }, tips };
}

/* ─── Guest Questions — payload + response ──────────────────── */

export interface GuestQuestionsInput {
  guestName: string;
  topic: string;
  bio: string;
}

/** POST /api/guest-questions body — generate()'s own shaping:
 *  all three fields trimmed, nothing sliced (the route's own
 *  schema owns the ceilings). */
export function buildGuestQuestionsPayload(input: GuestQuestionsInput): {
  guestName: string;
  topic: string;
  bio: string;
} {
  return {
    guestName: input.guestName.trim(),
    topic: input.topic.trim(),
    bio: input.bio.trim(),
  };
}

export interface GuestQuestionItem {
  question: string;
  why: string;
}

export const GUEST_QUESTION_SECTIONS = ["warmup", "deepDive", "rapidFire", "closer"] as const;
export type GuestQuestionSection = (typeof GUEST_QUESTION_SECTIONS)[number];

export interface GuestQuestionsResult {
  guestName: string;
  topic: string;
  warmup: GuestQuestionItem[];
  deepDive: GuestQuestionItem[];
  rapidFire: GuestQuestionItem[];
  closer: GuestQuestionItem[];
  total: number;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

function questionItemsOf(value: unknown): GuestQuestionItem[] {
  if (!Array.isArray(value)) return [];
  const items: GuestQuestionItem[] = [];
  for (const raw of value as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;
    items.push({ question: stringOr(q.question), why: stringOr(q.why) });
  }
  return items;
}

/** The question-set answer: the page gates on the warmup
 *  array alone; the other sections coerce section by section
 *  and the total falls back to the counted questions. */
export function guestQuestionsOf(data: unknown): GuestQuestionsResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.warmup)) return null;
  const warmup = questionItemsOf(d.warmup);
  const deepDive = questionItemsOf(d.deepDive);
  const rapidFire = questionItemsOf(d.rapidFire);
  const closer = questionItemsOf(d.closer);
  const counted = warmup.length + deepDive.length + rapidFire.length + closer.length;
  return {
    guestName: stringOr(d.guestName),
    topic: stringOr(d.topic),
    warmup,
    deepDive,
    rapidFire,
    closer,
    total: typeof d.total === "number" ? d.total : counted,
    creditsUsed: typeof d.creditsUsed === "number" ? d.creditsUsed : null,
    creditsRemaining: typeof d.creditsRemaining === "number" ? d.creditsRemaining : null,
  };
}

/** The set as plain text — the page's toPlainText layout
 *  (guest line, topic line, then each section headed and its
 *  questions numbered with their why), with the catalog
 *  labels resolved by the caller. */
export function guestQuestionsPlainText(
  result: GuestQuestionsResult,
  labels: {
    forGuest: string;
    aboutTopic: string;
    sections: Record<GuestQuestionSection, string>;
    whyLabel: string;
  },
): string {
  const lines = [labels.forGuest.toUpperCase(), labels.aboutTopic, ""];
  for (const key of GUEST_QUESTION_SECTIONS) {
    lines.push(labels.sections[key].toUpperCase());
    result[key].forEach((q, i) => {
      lines.push(`${i + 1}. ${q.question}`);
      lines.push(`   ${labels.whyLabel}: ${q.why}`);
    });
    lines.push("");
  }
  return lines.join("\n");
}
