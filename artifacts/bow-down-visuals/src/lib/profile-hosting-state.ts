/* ─── profile-hosting-state — the Hosting card's render derivation ────
   Stack-200 wave A5 (money census item 5): Profile Hosting ($9/mo,
   owner-ruled 2026-10-27, included with Creator Elite) had a complete
   API rail and NO door — zero frontend callers. The door is the
   ProfileHosting card docked on /creator-pricing; this module is the
   one derivation its render and its tests share, in the
   pricing-card-state tradition:

     viewer / load state                     card state
     ──────────────────────────────────────  ──────────────────────────
     signed out                              "signed-out" — pitch +
                                             price + sign-in door
     signed in, /me still loading            "loading"
     signed in, /me load FAILED              "load-failed" — an honest
                                             retry, never a fake plan
                                             state (the empty-lie rule)
     signed in, no creator profile (404)     "no-profile" — Hosting
                                             runs your page; make the
                                             page first
     entitled via Creator Elite              "elite-included" — on,
                                             NO buy button (a second
                                             charge is what the ruling
                                             forbids; the rail 409s it)
     entitled via the admin exemption        "admin-entitled" — on,
                                             no buy button
     entitled via own Hosting subscription   "hosting-active" — on,
                                             period end shown
     not entitled, checkout configured       "buy" — price + the
                                             embedded checkout action
     not entitled, checkout NOT configured   "not-switched-on" — the
                                             ruled price still shows;
                                             honest nothing-to-pay line

   The derivation reads ONLY the server's /creator-hosting/me answer
   (plan + entitlement resolve server-side in lib/profile-website.ts);
   the card never invents a state the rail didn't state.            */

export interface HostingPlanView {
  name: string;
  tagline: string;
  features: Array<{ label: string; detailsUrl: string }>;
  priceUsdPerMonth: number;
  includedWithTier: string;
  priceConfigured: boolean;
  available: boolean;
}

export interface HostingMeView {
  hostingEntitled: boolean;
  hostingStatus: string | null;
  hostingSource: "hosting" | "elite" | "admin" | null;
  includedWithElite: boolean;
  currentPeriodEnd: string | null;
  cleanBranding: boolean;
  plan: HostingPlanView;
}

export type HostingLoadPhase = "loading" | "failed" | "no-profile" | "ready";

export type HostingCardState =
  | { kind: "signed-out"; plan: HostingPlanView | null }
  | { kind: "loading" }
  | { kind: "load-failed" }
  | { kind: "no-profile"; plan: HostingPlanView | null }
  | { kind: "elite-included"; me: HostingMeView }
  | { kind: "admin-entitled"; me: HostingMeView }
  | { kind: "hosting-active"; me: HostingMeView }
  | { kind: "buy"; me: HostingMeView }
  | { kind: "not-switched-on"; me: HostingMeView };

export function hostingCardState(input: {
  signedIn: boolean;
  phase: HostingLoadPhase;
  me: HostingMeView | null;
  plan: HostingPlanView | null;
}): HostingCardState {
  if (!input.signedIn) return { kind: "signed-out", plan: input.plan };
  if (input.phase === "loading") return { kind: "loading" };
  if (input.phase === "failed") return { kind: "load-failed" };
  if (input.phase === "no-profile") return { kind: "no-profile", plan: input.plan };
  const me = input.me;
  if (!me) return { kind: "load-failed" };
  if (me.includedWithElite || me.hostingSource === "elite") return { kind: "elite-included", me };
  if (me.hostingSource === "admin") return { kind: "admin-entitled", me };
  if (me.hostingEntitled) return { kind: "hosting-active", me };
  if (!me.plan.available) return { kind: "not-switched-on", me };
  return { kind: "buy", me };
}
