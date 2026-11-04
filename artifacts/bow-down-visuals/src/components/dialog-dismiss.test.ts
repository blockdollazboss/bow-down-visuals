/**
 * dialog-dismiss.test.ts — QC-200 fix queue #1 (stack1600/fix-dialog-dismiss):
 * no dialog in the app may be a trap.
 *
 * The live defect (staging, Nov 3): the winner popup on /admin
 * ("You cracked the code…") had NO Escape handling, NO close control
 * and NO backdrop dismiss — the only exit was its Claim button (or
 * navigating away). The sweep that followed found the same shape in
 * a second family: the Draft Recovery prompts in make-video /
 * song-and-video, whose "found" state offered only Recover or
 * Discard (destructive) and whose "failed" state had a button
 * LABELLED "Dismiss" that actually deleted the draft.
 *
 * Pins follow the house source-pin pattern (a11y-round-2.test.ts):
 * vitest runs in node, so interactive contracts are pinned by source.
 *
 * Classes pinned:
 *  1. the winner popup's dismiss contract (Escape via the house
 *     useModalA11y hook, a visible Close control in both variants,
 *     backdrop click, dismissal that can never claim), plus all
 *     three call sites passing onDismiss;
 *  2. the draft prompts' honest neutral dismiss in both pages
 *     (found + failed states, Escape, backdrop, and the Dismiss
 *     label never wired to the discard handler);
 *  3. the census: every dialog the sweep classified as a survivor
 *     keeps the dismiss evidence it was acquitted on, and NO file
 *     may declare dialog semantics (role="dialog" / aria-modal)
 *     without being classified here or in the earlier a11y rounds.
 *
 * Census scope follows a11y-round-2: World files are out of scope
 * (components/world StationPanel + GamesPanels carry their own
 * pinned family — stack1300 round 1 pins StationPanel's Escape +
 * named close; GamesPanels' frames close via Escape + Return).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const WORLD = (rel: string) =>
  rel.startsWith("pages/world") || rel.startsWith("components/world");

function allSources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) {
        const rel = path.relative(SRC, p).split(path.sep).join("/");
        if (!WORLD(rel)) out.push({ rel, src: fs.readFileSync(p, "utf8") });
      }
    }
  };
  walk(SRC);
  return out;
}

/** Scanned once at module load (not inside a timed test): walking the
 *  whole tree takes seconds on a loaded machine. */
const SOURCES = allSources();

/* ── 1. The winner popup ─────────────────────────────────────────── */

describe("winner popup (SecretChallengePopup) — the named defect", () => {
  const popup = read("components/SecretChallengePopup.tsx");

  it("routes Escape + focus through the house dialog contract, bound to onDismiss", () => {
    expect(popup).toContain("useModalA11y<HTMLDivElement>(true, onDismiss)");
    expect(popup).toContain("ref={dialogRef}");
    expect(popup).toContain('role="dialog"');
    expect(popup).toContain('aria-modal="true"');
  });

  it("renders a visible Close control in BOTH variants, wired to onDismiss — never to onClaim", () => {
    // artwork variant + fallback-card variant
    expect(popup.split('aria-label="Close"').length - 1).toBe(2);
    expect(popup.split("onClick={onDismiss}").length - 1).toBe(2);
    // Claim stays exactly the two claim controls (fallback button + art overlay)
    expect(popup.split("onClick={onClaim}").length - 1).toBe(2);
  });

  it("backdrop click dismisses, and only the backdrop itself", () => {
    expect(popup).toContain("if (e.target === e.currentTarget) onDismiss();");
  });

  it("dismissal changes no state: the component performs no fetch, storage or claim side effect", () => {
    expect(popup).not.toContain("fetch(");
    expect(popup).not.toContain("localStorage");
    expect(popup).toContain("onDismiss: () => void");
  });

  it.each([
    "components/BowTestLogo.tsx",
    "pages/admin.tsx",
    "components/layout/floating-admin-panel.tsx",
  ])("%s passes a dismiss closer to the popup", (rel) => {
    const src = read(rel);
    const at = src.indexOf("<SecretChallengePopup");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 400)).toContain("onDismiss={");
  });
});

/* ── 2. The draft-recovery prompts ───────────────────────────────── */

const DRAFT_PAGES = [
  { rel: "pages/make-video.tsx", dismissKey: "makeVideo.dismiss", discardKey: "makeVideo.discardDraft" },
  { rel: "pages/song-and-video.tsx", dismissKey: "songAndVideo.dismissButton", discardKey: "songAndVideo.discardDraftButton" },
] as const;

describe.each(DRAFT_PAGES)("draft recovery prompt — $rel", ({ rel, dismissKey, discardKey }) => {
  const src = read(rel);
  const foundBlock = src.slice(src.lastIndexOf('draftState === "found"'), src.lastIndexOf('draftState === "found"') + 2600);
  const failedBlock = src.slice(src.lastIndexOf('draftState === "failed"'), src.lastIndexOf('draftState === "failed"') + 2600);

  it("has a neutral dismiss that closes with zero state change, gated to the decision states", () => {
    expect(src).toContain("handleDismissDraftPrompt");
    expect(src).toContain('s === "found" || s === "failed" ? "idle" : s');
    // the neutral handler itself must not touch storage or the server
    const handler = src.slice(src.indexOf("const handleDismissDraftPrompt"), src.indexOf("const handleDismissDraftPrompt") + 400);
    expect(handler).not.toContain("localStorage");
    expect(handler).not.toContain("fetch(");
    expect(handler).not.toContain("handleDiscardDraft");
  });

  it("Escape dismisses while a decision is on screen", () => {
    expect(src).toContain('if (e.key === "Escape") handleDismissDraftPrompt();');
  });

  it("backdrop click dismisses", () => {
    expect(src).toContain('backdrop-blur-sm" onClick={handleDismissDraftPrompt}');
  });

  it("the found state offers Dismiss alongside Recover / Download / Discard", () => {
    expect(foundBlock).toContain("onClick={handleDismissDraftPrompt}");
    expect(foundBlock).toContain(`t("${dismissKey}")`);
    expect(foundBlock).toContain(`t("${discardKey}")`);
  });

  it("the failed state's Dismiss label is wired to the neutral dismiss — NOT the discard handler", () => {
    const labelAt = failedBlock.indexOf(`t("${dismissKey}")`);
    expect(labelAt).toBeGreaterThan(-1);
    const before = failedBlock.slice(Math.max(0, labelAt - 600), labelAt);
    // the nearest preceding click handler for the Dismiss button is the neutral one
    expect(before.lastIndexOf("onClick={handleDismissDraftPrompt}")).toBeGreaterThan(
      before.lastIndexOf("handleDiscardDraft"),
    );
    // …and the destructive choice survives under its own honest label
    expect(failedBlock).toContain(`t("${discardKey}")`);
  });
});

/* ── 3. The census — survivors keep their dismiss path ───────────── */

/** Files acquitted in the sweep: each keeps the dismiss evidence it
 *  was acquitted on. Hook-wired dialogs are pinned by
 *  a11y-round-2.test.ts / a11y-stack1300-round-1.test.ts and are
 *  covered by the completeness guard below, not re-pinned here. */
const SURVIVORS: [string, string][] = [
  ["components/FeedbackPromptHost.tsx", 'aria-label={t("pitchFix.popup.dismiss")}'],
  ["components/ThyCheatCodeChat.tsx", 'aria-label="Close chat"'],
  ["components/player/StreamingPlayerBar.tsx", 'aria-label="Close queue"'],
  ["components/social/KingEmoji.tsx", 'if (e.key === "Escape") setOpen(false);'],
  ["components/theme-packs/ThemePackQuickPicker.tsx", "setOpen((v) => !v)"],
  ["components/PWAInstallPrompt.tsx", 'aria-label="Dismiss"'],
  ["components/ui/sheet.tsx", "SheetPrimitive.Close"],
  ["pages/home.tsx", "onClick={() => setFired(false)}"],
  ["pages/beats.tsx", "onClick={() => setLicenseBeat(null)}"],
  ["pages/scheduler.tsx", "onClick={props.onClose}"],
  ["pages/setlist.tsx", "onClick={() => setLibraryOpen(false)}"],
  ["pages/collabs.tsx", "onClick={() => setProposalTo(null)}"],
  ["pages/nfc-cards.tsx", "onClick={() => setEditing(null)}"],
  ["pages/books.tsx", "onClick={onClose}"],
  ["pages/artist-vault.tsx", 'aria-label={t("artistVault.closeDialog")}'],
  ["pages/my-clips.tsx", "onClick={onClose}"],
  ["pages/my-projects.tsx", "onClick={onClose}"],
  ["pages/songs.tsx", "onClick={() => setAddToAlbumSong(null)}"],
  ["pages/thumbnail-studio.tsx", "setLightbox(null)"],
  ["components/branding/BrandingShop.tsx", 'aria-label={t("brandingShop.closeCartAria")}'],
  ["pages/artist-setup.tsx", "onClick={onClose}"],
  ["pages/shorts.tsx", "onClick={() => setOpen(false)}"],
];

describe("census — sweep survivors keep their dismiss path", () => {
  it.each(SURVIVORS)("%s still carries its dismiss evidence", (rel, evidence) => {
    expect(read(rel)).toContain(evidence);
  });
});

/** Every file that declares dialog semantics is classified: fixed by
 *  this lane, hook-wired (a11y rounds), a survivor above, or the
 *  CreditConfirm context. An unclassified dialog fails here until a
 *  human gives it a dismiss path and a row. */
const CLASSIFIED = new Set<string>([
  // fixed by this lane
  "components/SecretChallengePopup.tsx",
  // hook-wired, pinned in a11y-round-2 (wired list)
  "pages/shop.tsx",
  "components/AwayDigestModal.tsx",
  "components/DailyBonusModal.tsx",
  "components/ExtensionPromoModal.tsx",
  "components/DiscordAnnounceModal.tsx",
  "components/FacebookPostModal.tsx",
  "components/InstagramPostModal.tsx",
  "components/TikTokPostModal.tsx",
  "components/XPostModal.tsx",
  "components/GenerateArtistImageModal.tsx",
  "components/HelpPanel.tsx",
  "components/MysteryCrate.tsx",
  "components/QRCode.tsx",
  "components/QRLogin.tsx",
  "components/ShareForReview.tsx",
  "components/TemplatePicker.tsx",
  "components/LoadingScreenModal.tsx",
  "components/SpotlightModal.tsx",
  "components/player/AddToPlaylist.tsx",
  "components/social/ReportButton.tsx",
  "components/song/CoverSongModal.tsx",
  "components/song/HarmonyGeneratorModal.tsx",
  "components/song/SingingVoiceModal.tsx",
  "components/song/VocalPolishModal.tsx",
  "components/song/LrcExportModal.tsx",
  "components/wave8/SponsorPipeline.tsx",
  "contexts/CreditConfirmContext.tsx",
  "components/ShareMenu.tsx",
  "components/OnboardingTour.tsx",
  "components/PhotoLightbox.tsx",
  "components/cheat-code-easter-egg.tsx",
  "components/milestones/BragModal.tsx",
  "components/retention/LevelUpModal.tsx",
  "components/retention/SharkDropModal.tsx",
  "components/social/StoryViewer.tsx",
  "components/TeleprompterPlayer.tsx",
  "components/cheat-code-jackpot.tsx",
  // hook-wired, pinned in a11y-stack1300-round-1 (F1 / F2)
  "pages/live-shopping.tsx",
  "components/editor/sections/LipSyncSection.tsx",
  "components/tips/WatchTipDoor.tsx",
  // survivors (evidence pinned above)
  ...SURVIVORS.map(([rel]) => rel),
]);

describe("census — no unclassified dialog may appear", () => {
  it("every role=dialog / aria-modal file is classified", () => {
    const offenders: string[] = [];
    for (const { rel, src } of SOURCES) {
      if ((src.includes('role="dialog"') || src.includes('aria-modal="true"')) && !CLASSIFIED.has(rel)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
