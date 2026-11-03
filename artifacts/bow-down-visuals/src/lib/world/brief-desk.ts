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

/** The fallback digest as plain lines — only facts the digest
 *  itself carries, nothing derived or invented. Null panels and
 *  null figures are skipped, never zero-filled. */
export function digestLines(fallback: BriefFallbackPayload): BriefDigestLine[] {
  const lines: BriefDigestLine[] = [];
  const { audience, revenue, content, actions } = fallback.digest;
  if (audience) {
    if (audience.followers) {
      lines.push({
        label: "Followers",
        value: `${audience.followers.total.toLocaleString()} (+${audience.followers.new7} this week)`,
      });
    }
    if (audience.members) {
      lines.push({ label: "Members", value: audience.members.total.toLocaleString() });
    }
    if (audience.subscribers) {
      lines.push({ label: "Subscribers", value: audience.subscribers.total.toLocaleString() });
    }
  }
  if (revenue) {
    const total = money(revenue.totalCents);
    if (total) lines.push({ label: "All-time revenue", value: total });
    if (revenue.totalTipsVb !== null && revenue.totalTipsVb > 0) {
      lines.push({ label: "Tips (Visual Bucs)", value: revenue.totalTipsVb.toLocaleString() });
    }
  }
  if (content?.totals) {
    lines.push({
      label: "Your catalog",
      value: `${content.totals.trackCount} tracks · ${content.totals.videoCount} videos`,
    });
    if (content.topTrack) {
      lines.push({
        label: "Top track",
        value: `${content.topTrack.title} — ${content.topTrack.playCount.toLocaleString()} plays`,
      });
    }
  }
  if (actions) {
    for (const item of actions.items) {
      if (item.count > 0) {
        lines.push({
          label: "Waiting on you",
          value: `${item.count} ${BRIEF_ACTION_LABELS[item.key] ?? item.key}`,
        });
      }
    }
  }
  return lines;
}
