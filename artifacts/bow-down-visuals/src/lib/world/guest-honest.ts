/**
 * guest-honest.ts — guest honest-states for the World (access law,
 * owner default 3; Lane K2, item 4).
 *
 * Guests are look/listen-only: they hold no hand — no voice, no
 * say, no emotes, no claims, no objectives. The room already drops
 * a guest's say frame server-side; the client's job is to stop
 * PRETENDING otherwise. Every member-act control a guest can see
 * either isn't rendered for them or renders as the sign-in pitch
 * below — never a dead button, never a silent no-op.
 *
 * The pitch's sign-in action routes to /login?next=/world — the
 * house's post-login return shape (lib/auth-next.ts): sign in and
 * you land back in the palace, as a member this time.
 */

export const GUEST_SIGN_IN_HREF = "/login?next=/world";

/** The say/voice pitch, in the owner's words. */
export const GUEST_SPEAK_PITCH = "Guests can look and listen — sign in to speak";

/** The emote/action pitch — the same law, for the action bar. */
export const GUEST_EMOTE_PITCH = "Guests can look and listen — sign in to join in";

/** Which Objective Strip slots a visitor may see. Members get all
 *  three; guests get ONLY the palace slot (public information —
 *  what's on at the palace) plus the sign-in pitch. A guest's quest
 *  and streak slots do not exist: guests hold no hand, so there is
 *  no objective and no streak to name. */
export function stripSlotsFor(isGuest: boolean): {
  quest: boolean;
  streak: boolean;
  palace: boolean;
} {
  return isGuest
    ? { quest: false, streak: false, palace: true }
    : { quest: true, streak: true, palace: true };
}

/** A member-act control renders its real form only for members.
 *  For guests it renders the pitch (or nothing) — this predicate is
 *  the one gate the world chrome checks, so the rule can't drift
 *  control by control. */
export function memberControlsVisible(isGuest: boolean): boolean {
  return !isGuest;
}
