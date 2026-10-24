/**
 * Email automation copy catalog (lib/email-automation-i18n).
 *
 * Pins:
 *  - the en entry is BYTE-IDENTICAL to the copy the automations
 *    shipped with (the literals below are the pre-catalog source of
 *    truth — if someone edits English copy, it happens here on
 *    purpose, never by accident);
 *  - every locale carries every string for every kind, non-empty,
 *    with delay hours matching en exactly;
 *  - no non-English locale quietly serves English (each label,
 *    note, subject and body must differ from en);
 *  - placeholder parity: whatever interpolation tokens en carries
 *    (none today), every locale carries the same multiset;
 *  - locale resolution: base-language normalization ("pt-BR" →
 *    pt), first-resolvable-candidate wins, English fallback.
 */
import { describe, it, expect } from "vitest";
import { EMAIL_AUTOMATION_KINDS } from "@workspace/db";
import {
  AUTOMATION_COPY,
  AUTOMATION_LOCALES,
  automationCopyFor,
  normalizeAutomationLocale,
  resolveAutomationLocale,
} from "../email-automation-i18n";

const EN_LABELS = {
  post_purchase: "Post-purchase thank-you",
  abandoned_checkout: "Abandoned checkout",
  membership_winback: "Membership winback",
  membership_payment_recovery: "Membership payment recovery",
} as const;

const EN_NOTES = {
  post_purchase:
    "Fires once per completed purchase — a sale in your shop (one email per checkout, however many items) or a paid download. Only confirmed paid sales count.",
  abandoned_checkout:
    "Fires when a checkout is started but left unpaid until it closes — a shop checkout that never pays, or a checkout in your store or on your profile that expires unpaid (an unpaid checkout closes about a day after it starts). One email per checkout.",
  membership_winback:
    "Fires when a fan's membership is canceled or expires. The fan is emailed at the address on their account, or the email you recorded for them.",
  membership_payment_recovery:
    "Fires when a fan's membership payment fails and the membership is past due: a notice at the failure, a reminder after 3 days, a card-update nudge after 5 days, and a final warning after 6 days — one day before access pauses at the end of the 7-day grace. The first email uses the subject and body here; the later steps use fixed recovery wording so the dates fans are told never drift.",
} as const;

const EN_DEFAULTS = {
  post_purchase: {
    subject: "Thank you for your purchase!",
    body: "Hi there,\n\nThank you for buying from my shop — it means a lot, and it directly helps me keep creating.\n\nIf anything about your order needs attention, just reply to this email.\n\nMore is on the way — stay close.",
    delayHours: 2,
  },
  abandoned_checkout: {
    subject: "You left something behind",
    body: "Hi there,\n\nYou started checking out in my shop but didn't finish — your picks are still waiting for you.\n\nHead back to the shop any time to complete your order. No pressure, and thanks for looking.",
    delayHours: 24,
  },
  membership_winback: {
    subject: "We miss you — your membership is waiting",
    body: "Hi there,\n\nYour membership recently ended, and the door is still open. Everything you loved is still here, plus everything new since you've been gone.\n\nCome back any time — we'd love to have you again.",
    delayHours: 72,
  },
  membership_payment_recovery: {
    subject: "Your membership payment didn't go through",
    body: "Hi there,\n\nWe tried to take the payment for your membership and it didn't go through — this happens with expired cards, replaced cards, and banks being careful.\n\nYour membership is still on for now. You have 7 days from the failed payment to update your card before access pauses. Update it any time from Your Memberships on Bow Down Visuals (/memberships) — you'll enter your new card on Stripe's secure page.\n\nIf you already fixed it, you can ignore this — a successful payment ends these reminders.",
    delayHours: 0,
  },
} as const;

const tokens = (s: string): string[] =>
  [...s.matchAll(/\{[^}]+\}|%[a-zA-Z]/g)].map((m) => m[0]).sort();

describe("automation copy catalog — en is byte-identical", () => {
  it("labels, notes and defaults match the shipped English exactly", () => {
    expect(AUTOMATION_COPY.en.labels).toEqual(EN_LABELS);
    expect(AUTOMATION_COPY.en.triggerNotes).toEqual(EN_NOTES);
    expect(AUTOMATION_COPY.en.defaults).toEqual(EN_DEFAULTS);
    expect(automationCopyFor("en").labels).toEqual(EN_LABELS);
  });

  it("carries exactly the ten site locales", () => {
    expect([...AUTOMATION_LOCALES]).toEqual([
      "en",
      "es",
      "fr",
      "pt",
      "de",
      "it",
      "hi",
      "ar",
      "ja",
      "ko",
    ]);
    expect(Object.keys(AUTOMATION_COPY).sort()).toEqual([...AUTOMATION_LOCALES].sort());
  });
});

describe("automation copy catalog — every locale is complete and real", () => {
  for (const locale of AUTOMATION_LOCALES) {
    it(`${locale}: all kinds, all fields, non-empty, en delay hours`, () => {
      const copy = AUTOMATION_COPY[locale];
      for (const kind of EMAIL_AUTOMATION_KINDS) {
        expect(copy.labels[kind].trim().length).toBeGreaterThan(0);
        expect(copy.triggerNotes[kind].trim().length).toBeGreaterThan(0);
        expect(copy.defaults[kind].subject.trim().length).toBeGreaterThan(0);
        expect(copy.defaults[kind].body.trim().length).toBeGreaterThan(0);
        expect(copy.defaults[kind].delayHours).toBe(EN_DEFAULTS[kind].delayHours);
      }
    });

    if (locale === "en") continue;
    it(`${locale}: nothing silently falls back to English`, () => {
      const copy = AUTOMATION_COPY[locale];
      for (const kind of EMAIL_AUTOMATION_KINDS) {
        expect(copy.labels[kind]).not.toBe(EN_LABELS[kind]);
        expect(copy.triggerNotes[kind]).not.toBe(EN_NOTES[kind]);
        expect(copy.defaults[kind].subject).not.toBe(EN_DEFAULTS[kind].subject);
        expect(copy.defaults[kind].body).not.toBe(EN_DEFAULTS[kind].body);
      }
    });

    it(`${locale}: placeholder parity with en on every string`, () => {
      const copy = AUTOMATION_COPY[locale];
      for (const kind of EMAIL_AUTOMATION_KINDS) {
        expect(tokens(copy.labels[kind])).toEqual(tokens(EN_LABELS[kind]));
        expect(tokens(copy.triggerNotes[kind])).toEqual(tokens(EN_NOTES[kind]));
        expect(tokens(copy.defaults[kind].subject)).toEqual(tokens(EN_DEFAULTS[kind].subject));
        expect(tokens(copy.defaults[kind].body)).toEqual(tokens(EN_DEFAULTS[kind].body));
      }
    });
  }
});

describe("automation locale resolution", () => {
  it("normalizes base languages and case, rejects the unknown", () => {
    expect(normalizeAutomationLocale("es")).toBe("es");
    expect(normalizeAutomationLocale("pt-BR")).toBe("pt");
    expect(normalizeAutomationLocale("fr_ca")).toBe("fr");
    expect(normalizeAutomationLocale("EN")).toBe("en");
    expect(normalizeAutomationLocale(" ja ")).toBe("ja");
    expect(normalizeAutomationLocale("xx")).toBeNull();
    expect(normalizeAutomationLocale("")).toBeNull();
    expect(normalizeAutomationLocale(undefined)).toBeNull();
    expect(normalizeAutomationLocale(null)).toBeNull();
    expect(normalizeAutomationLocale(42)).toBeNull();
  });

  it("first resolvable candidate wins; English is the fallback", () => {
    expect(resolveAutomationLocale("ko", "es")).toBe("ko");
    expect(resolveAutomationLocale("xx", "de")).toBe("de");
    expect(resolveAutomationLocale(undefined, "pt-BR")).toBe("pt");
    expect(resolveAutomationLocale()).toBe("en");
    expect(resolveAutomationLocale(null, "nope")).toBe("en");
  });
});
