/**
 * a11y-sweep.test.ts — Stack-100 #3 wave-3 lane 17 (stack29/w3-a11y-sweep):
 * accessibility restorations on the top creator surfaces.
 *
 * Pins follow the house source-pin pattern (mobile-touch-targets.test.ts):
 * vitest runs in node, so interactive contracts are pinned by source.
 * Audit evidence: .lane/AUDIT.md in the lane worktree.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const dashboard = read("../pages/dashboard.tsx");
const create = read("../pages/create.tsx");
const goLive = read("../pages/go-live.tsx");
const editor = read("../pages/video-editor.tsx");
const shop = read("../pages/shop.tsx");
const myShop = read("../pages/my-shop.tsx");
const builder = read("../pages/storefront-builder.tsx");
const storeDashboard = read("../pages/store-dashboard.tsx");
const storefronts = read("../pages/storefronts.tsx");
const broadcast = read("./go-live/BroadcastStudio.tsx");
const chat = read("./live/LiveChatPanel.tsx");
const modalHook = read("../hooks/use-modal-a11y.ts");
const css = read("../index.css");

describe("global — light placeholders pass AA", () => {
  it("light placeholder token is the deepened #7A7266 rung, not #A39A89", () => {
    const block = css.slice(css.indexOf(".light input::placeholder"), css.indexOf(".light input:focus-visible"));
    expect(block).toContain("color: #7A7266");
    expect(block).not.toContain("#A39A89");
  });
});

describe("dashboard", () => {
  it("payment toast is a live region with a named dismiss", () => {
    expect(dashboard).toContain('role={paymentToast.type === "error" ? "alert" : "status"}');
    expect(dashboard).toContain('aria-label={t("dashboard.dismissNotification"');
  });
  it("balance, streak and level carry their meaning in aria-labels, not title only", () => {
    expect(dashboard).toContain('aria-label={`${t("dashboard.top_up")}: ${formatVB(balance)}`}');
    expect(dashboard).toContain('aria-label={`${t("dashboard.streak_days")}: ${streak}`}');
    expect(dashboard).toContain('aria-label={`${t("dashboard.creator_level")}: ${stars}`}');
  });
  it("no informational text remains below the white/50 AA step", () => {
    expect(dashboard).not.toContain("text-white/35");
    expect(dashboard).not.toContain("text-white/20");
    expect(dashboard).not.toContain("text-primary/60");
  });
});

describe("create hub — full tab pattern", () => {
  it("tabs rove, arrow-navigate and control a labelled tabpanel", () => {
    expect(create).toContain('aria-controls="create-panel"');
    expect(create).toContain("tabIndex={active ? 0 : -1}");
    expect(create).toContain('e.key === "ArrowRight"');
    expect(create).toContain('e.key === "Home"');
    expect(create).toContain('role="tabpanel"');
    expect(create).toContain("aria-labelledby={`create-tab-${panel}`}");
    expect(create).toContain("tabRefs.current[next.key]?.focus()");
  });
});

describe("go-live", () => {
  it("hub tabs implement the tab pattern with a tabpanel", () => {
    expect(goLive).toContain('role="tablist"');
    expect(goLive).toContain('aria-controls="golive-panel"');
    expect(goLive).toContain('id="golive-panel" role="tabpanel"');
    expect(goLive).toContain("tabIndex={tab === key ? 0 : -1}");
  });
  it("schedule and VOD inputs are labelled", () => {
    expect(goLive).toContain('aria-label={t("goLive.schedTitlePlaceholder")}');
    expect(goLive).toContain('aria-label={t("goLive.schedGamePlaceholder")}');
    expect(goLive).toContain('aria-label={t("goLive.vodPlaceholder")}');
    expect(goLive).toContain("goLive.schedWhenLabel");
  });
  it("the @everyone switch is not nested in a <label> and has its own name", () => {
    expect(goLive).toContain('aria-label={t("goLive.pingEveryoneAria"');
    expect(goLive).not.toContain('<label className="flex items-center gap-2.5 text-sm text-white/70 cursor-pointer select-none">');
  });
  it("inputs keep a gold focus-visible ring and AA placeholders", () => {
    expect(goLive).not.toContain("placeholder:text-white/25");
    expect(goLive.split("focus-visible:ring-2 focus-visible:ring-amber-400/60").length - 1).toBeGreaterThanOrEqual(6);
  });
  it("broadcast backdrop URL input is labelled", () => {
    expect(broadcast).toContain('aria-label="Backdrop image URL"');
  });
});

describe("live chat panel", () => {
  it("message list is a polite log live region", () => {
    expect(chat).toContain('role="log"');
    expect(chat).toContain('aria-label="Chat messages"');
  });
  it("moderation actions reveal on focus, not hover only", () => {
    expect(chat).toContain("group-focus-within:opacity-100");
  });
  it("tip results are announced", () => {
    expect(chat).toContain('data-testid="tip-note" role="status"');
  });
});

describe("video editor chrome", () => {
  it("transport controls are named from their title keys", () => {
    for (const key of ["restartTitle", "prevSceneTitle", "nextSceneTitle", "stepBackTitle", "stepForwardTitle", "back10sTitle", "forward10sTitle", "playPauseSpace"]) {
      expect(editor).toContain(`aria-label={t("videoEditor.${key}")}`);
    }
    expect(editor).toContain('aria-label={t("videoEditor.volumeTitle"');
    expect(editor).toContain('aria-label={isFullscreen ? t("videoEditor.exitFullscreen") : t("videoEditor.fullscreen")}');
  });
  it("toggle transport controls expose pressed state", () => {
    expect(editor).toContain("aria-pressed={loop}");
    expect(editor).toContain("aria-pressed={pipActive}");
    expect(editor).toContain("aria-pressed={muted}");
  });
  it("scrub bar is a keyboard slider", () => {
    const idx = editor.indexOf('aria-label={t("videoEditor.seekLabel"');
    expect(idx).toBeGreaterThan(-1);
    const slice = editor.slice(Math.max(0, idx - 300), idx + 1400);
    expect(slice).toContain('role="slider"');
    expect(slice).toContain("tabIndex={0}");
    expect(slice).toContain('e.key === "ArrowRight"');
    expect(slice).toContain("seek(currentTime + step)");
    expect(slice).toContain("aria-valuenow={Math.round(currentTime)}");
  });
  it("top-bar buttons are named even when their text hides on mobile", () => {
    expect(editor).toContain('aria-label={t("videoEditor.undoTitle")}');
    expect(editor).toContain('aria-label={t("videoEditor.redoTitle")}');
    expect(editor).toContain('aria-label={t("videoEditor.changeTemplateTitle")}');
  });
  it("mode radiogroup roves with arrow keys", () => {
    expect(editor).toContain("tabIndex={isSimple ? 0 : -1}");
    expect(editor).toContain("tabIndex={!isSimple ? 0 : -1}");
  });
  it("rail buttons expose the active section and separators are keyboard-resizable", () => {
    expect(editor).toContain("aria-current={leftTab === item.id || rightTab === item.id");
    expect(editor).toContain("aria-valuenow={panelWidth}");
    expect(editor).toContain("aria-valuenow={rightPanelWidth}");
    expect(editor.split('role="separator"').length - 1).toBeGreaterThanOrEqual(2);
  });
  it("save state is announced", () => {
    expect(editor).toContain('if (state === "saved") return <span role="status"');
    expect(editor).toContain('if (state === "error") return <span role="alert"');
  });
});

describe("storefront dialogs (useModalA11y)", () => {
  it("the hook traps Tab, closes on Escape and returns focus", () => {
    expect(modalHook).toContain('e.key === "Escape"');
    expect(modalHook).toContain('e.key !== "Tab"');
    expect(modalHook).toContain("previouslyFocused.focus()");
  });
  it("shop product modal and cart drawer are modal dialogs using the hook", () => {
    expect(shop).toContain("useModalA11y<HTMLDivElement>(!!selected");
    expect(shop).toContain("useModalA11y<HTMLElement>(cartOpen");
    expect(shop.split('aria-modal="true"').length - 1).toBe(2);
    expect(shop).toContain('aria-label={selected.name}');
  });
  it("buyer email is labelled and order results are announced", () => {
    expect(shop).toContain('aria-label={t("shop.emailPlaceholder")}');
    expect(shop).toContain('role="status"');
    expect(shop).toContain('role="alert"');
  });
});

describe("seller forms — labels are programmatically associated", () => {
  it("my-shop pairs labels with fields via htmlFor/id", () => {
    for (const id of ["myshop-create-name", "myshop-create-handle", "myshop-create-tagline", "myshop-edit-name", "myshop-edit-tagline", "myshop-edit-about", "myshop-banner-color", "myshop-accent-color", "myshop-product-name", "myshop-product-price", "myshop-product-desc", "myshop-product-image-url"]) {
      expect(myShop).toContain(`htmlFor="${id}"`);
      expect(myShop).toContain(`id="${id}"`);
    }
    expect(myShop).toContain('aria-label={t("myShop.discountCodePlaceholder")}');
    expect(myShop).toContain('aria-label={t("myShop.domainPlaceholder")}');
  });
  it("builder pairs its step labels and names product-row fields", () => {
    for (const id of ["sfb-name", "sfb-handle", "sfb-tagline", "sfb-banner-color", "sfb-accent-color", "sfb-niche", "sfb-description"]) {
      expect(builder).toContain(`htmlFor="${id}"`);
      expect(builder).toContain(`id="${id}"`);
    }
    expect(builder).toContain('aria-label={t("storefrontBuilder.productNamePlaceholder")}');
    expect(builder).toContain("storefrontBuilder.removeProduct");
  });
  it("store-dashboard placeholder-only fields carry aria-labels", () => {
    expect(storeDashboard).toContain('aria-label="Product title"');
    expect(storeDashboard).toContain('aria-label="Cover image URL"');
    expect(storeDashboard).toContain('aria-label="Discount expiry date and time"');
    expect(storeDashboard).toContain('aria-label="Custom price in dollars"');
  });
  it("storefronts search is labelled", () => {
    expect(storefronts).toContain('aria-label={t("storefronts.searchPlaceholder")}');
  });
  it("no storefront-family placeholder sits at the 2:1 white/25 step", () => {
    for (const src of [shop, myShop, builder, storefronts]) {
      expect(src).not.toContain("placeholder:text-white/25");
    }
  });
});
