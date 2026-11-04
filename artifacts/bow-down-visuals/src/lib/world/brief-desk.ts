/**
 * brief-desk — the Morning Brief desk's pure logic seam
 * (stack1500 world parity wave #3, census item 20).
 *
 * THE FEATURE (website): the Command Center's morning brief
 * (components/CommandCenter.tsx, shaped by lib/command-center.ts)
 * — Thy Cheat Code reads your own business digest (audience,
 * revenue, content, waiting actions) and writes ONE brief: a
 * short summary plus the single next best move, drafted for you
 * to review and send yourself. The Studio Board in the World
 * already carries the digest's raw halves (While you were away,
 * Next moves); the written brief itself is what was missing.
 *
 * THE RAIL (routes/command.ts): GET /api/command/brief,
 * requireAuth behind the free-AI limiter — FREE, and provably so:
 * there is no credit-cost registry row for the path and the
 * handler never charges; the limiter is a pacing guard, not a
 * price. Responses:
 *   { summary, move: { kind, title, draft, href }, generatedAt }
 *   { summary: "", move: null, digest, generatedAt,
 *     narrativeUnavailable: true } — the narrative couldn't be
 *     written (provider down / no key); the digest it was built
 *     from rides along so the panel shows real numbers instead.
 *   502 { error: "brief_unavailable" } — the digest itself could
 *     not be built; that is the only failure answer.
 *
 * GUARDS ARE THE WEBSITE'S OWN: shaping rides lib/command-center
 * .ts's shapeBrief / shapeBriefFallback — the same allowlist
 * discipline (kind → href mapped client-side, the payload's href
 * never trusted) — so the World desk can never accept a brief
 * the website would refuse.
 *
 * THE MOVE IN THE WORLD: the draft is the deliverable. The desk
 * shows it whole with a copy button (the creator pastes it where
 * it belongs) and names the surface each kind belongs to. It
 * NEVER sends, posts, or executes the move — approval is the
 * creator's own action, exactly the website's draft-only law.
 */
import {
  shapeBrief,
  shapeBriefFallback,
  type BriefFallbackPayload,
  type BriefMoveKind,
  type BriefPayload,
} from "../command-center";

export const BRIEF_PATH = "/api/command/brief";

/** The brief is free: no registry row, no charge in the handler —
 *  the pacing limiter is not a price. Recorded as a constant so
 *  the desk's copy and its tests pin the same fact. */
export const BRIEF_COST_VISUAL_BUCS = 0;

export type BriefRead =
  | { kind: "brief"; brief: BriefPayload }
  | { kind: "digest"; fallback: BriefFallbackPayload }
  | { kind: "unusable" };

/** One answer from the rail, sorted into the desk's three honest
 *  states: the written brief, the digest fallback (narrative
 *  unavailable), or unusable (a failure state — never dressed up
 *  as an empty brief). */
export function briefOfResponse(data: unknown): BriefRead {
  const brief = shapeBrief(data);
  if (brief) return { kind: "brief", brief };
  const fallback = shapeBriefFallback(data);
  if (fallback) return { kind: "digest", fallback };
  return { kind: "unusable" };
}

/** Where each move kind belongs — the website surface names (the
 *  move's own allowlisted hrefs, in words), so the creator knows
 *  where the draft goes. The desk never navigates for them. */
export const BRIEF_MOVE_SURFACES: Record<BriefMoveKind, string> = {
  post: "the Scheduler",
  winback: "your Memberships page",
  reply: "your Messages",
  deliver: "your Shoutouts page",
  price_check: "your Earnings page",
  create: "the Create wing",
};

/** The waiting-action rows' plain labels (the digest's three
 *  action keys, in the website's own terms). */
export const BRIEF_ACTION_LABELS: Record<string, string> = {
  unreadMessages: "unread messages",
  pastDueMembers: "members past due",
  shoutoutsToDeliver: "shoutouts waiting to deliver",
};

export interface BriefDigestLine {
  label: string;
  value: string;
}

function money(cents: number | null): string | null {
  if (cents === null || !Number.isFinite(cents)) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

/* ─── display strings (i18n seam, stack100 locale unit 46) ────────
   digestLines takes an optional strings bundle + locale whose
   defaults are the original English, byte-identical; the desk
   builds the bundle from the worldTeamLegal catalog keys and
   passes i18n.language, so the words and the number formats
   render in the walker's language. Templates carry {{token}}
   slots the seam fills itself. */

export interface BriefDigestStrings {
  followers: string;
  members: string;
  subscribers: string;
  allTimeRevenue: string;
  tips: string;
  catalog: string;
  topTrack: string;
  waiting: string;
  /** Template: {{total}} + {{new7}} tokens. */
  followersValue: string;
  /** Template: {{tracks}} + {{videos}} tokens. */
  catalogValue: string;
  /** Template: {{title}} + {{plays}} tokens. */
  topTrackValue: string;
  /** Template: {{count}} + {{label}} tokens. */
  waitingValue: string;
  actionLabels: Record<string, string>;
}

export const BRIEF_DIGEST_STRINGS_EN: BriefDigestStrings = {
  followers: "Followers",
  members: "Members",
  subscribers: "Subscribers",
  allTimeRevenue: "All-time revenue",
  tips: "Tips (Visual Bucs)",
  catalog: "Your catalog",
  topTrack: "Top track",
  waiting: "Waiting on you",
  followersValue: "{{total}} (+{{new7}} this week)",
  catalogValue: "{{tracks}} tracks · {{videos}} videos",
  topTrackValue: "{{title}} — {{plays}} plays",
  waitingValue: "{{count}} {{label}}",
  actionLabels: BRIEF_ACTION_LABELS,
};

/** Build the bundle from a translate function (the desk's `t`):
 *  every field reads its worldTeamLegal catalog key. */
export function briefDigestStrings(translate: (key: string) => string): BriefDigestStrings {
  return {
    followers: translate("worldTeamLegal.briefLabelFollowers"),
    members: translate("worldTeamLegal.briefLabelMembers"),
    subscribers: translate("worldTeamLegal.briefLabelSubscribers"),
    allTimeRevenue: translate("worldTeamLegal.briefLabelRevenue"),
    tips: translate("worldTeamLegal.briefLabelTips"),
    catalog: translate("worldTeamLegal.briefLabelCatalog"),
    topTrack: translate("worldTeamLegal.briefLabelTopTrack"),
    waiting: translate("worldTeamLegal.briefLabelWaiting"),
    followersValue: translate("worldTeamLegal.briefFollowersValue"),
    catalogValue: translate("worldTeamLegal.briefCatalogValue"),
    topTrackValue: translate("worldTeamLegal.briefTopTrackValue"),
    waitingValue: translate("worldTeamLegal.briefWaitingValue"),
    actionLabels: {
      unreadMessages: translate("worldTeamLegal.briefActionUnread"),
      pastDueMembers: translate("worldTeamLegal.briefActionPastDue"),
      shoutoutsToDeliver: translate("worldTeamLegal.briefActionShoutouts"),
    },
  };
}

function fillTokens(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [token, value] of Object.entries(values)) {
    out = out.split(`{{${token}}}`).join(value);
  }
  return out;
}

/** The fallback digest as plain lines — only facts the digest
 *  itself carries, nothing derived or invented. Null panels and
 *  null figures are skipped, never zero-filled. */
export function digestLines(
  fallback: BriefFallbackPayload,
  strings: BriefDigestStrings = BRIEF_DIGEST_STRINGS_EN,
  locale: string = "en-US",
): BriefDigestLine[] {
  const lines: BriefDigestLine[] = [];
  const { audience, revenue, content, actions } = fallback.digest;
  if (audience) {
    if (audience.followers) {
      lines.push({
        label: strings.followers,
        value: fillTokens(strings.followersValue, {
          total: audience.followers.total.toLocaleString(locale),
          new7: String(audience.followers.new7),
        }),
      });
    }
    if (audience.members) {
      lines.push({ label: strings.members, value: audience.members.total.toLocaleString(locale) });
    }
    if (audience.subscribers) {
      lines.push({ label: strings.subscribers, value: audience.subscribers.total.toLocaleString(locale) });
    }
  }
  if (revenue) {
    const total = money(revenue.totalCents);
    if (total) lines.push({ label: strings.allTimeRevenue, value: total });
    if (revenue.totalTipsVb !== null && revenue.totalTipsVb > 0) {
      lines.push({ label: strings.tips, value: revenue.totalTipsVb.toLocaleString(locale) });
    }
  }
  if (content?.totals) {
    lines.push({
      label: strings.catalog,
      value: fillTokens(strings.catalogValue, {
        tracks: String(content.totals.trackCount),
        videos: String(content.totals.videoCount),
      }),
    });
    if (content.topTrack) {
      lines.push({
        label: strings.topTrack,
        value: fillTokens(strings.topTrackValue, {
          title: content.topTrack.title,
          plays: content.topTrack.playCount.toLocaleString(locale),
        }),
      });
    }
  }
  if (actions) {
    for (const item of actions.items) {
      if (item.count > 0) {
        lines.push({
          label: strings.waiting,
          value: fillTokens(strings.waitingValue, {
            count: String(item.count),
            label: strings.actionLabels[item.key] ?? item.key,
          }),
        });
      }
    }
  }
  return lines;
}
