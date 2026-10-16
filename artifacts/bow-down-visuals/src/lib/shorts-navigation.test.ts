import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHORTS_NAV_ENTRY, isShortsRoute } from "./shorts-navigation";

const sidebarSource = readFileSync(
  new URL("../components/layout/app-sidebar.tsx", import.meta.url),
  "utf8",
);
const footerSource = readFileSync(
  new URL("../components/layout/footer.tsx", import.meta.url),
  "utf8",
);

describe("Shorts front door", () => {
  it("defines one canonical Shorts destination", () => {
    expect(SHORTS_NAV_ENTRY).toEqual({
      href: "/shorts",
      labelKey: "nav.shorts",
      label: "Shorts",
    });
    expect(isShortsRoute("/shorts")).toBe(true);
    expect(isShortsRoute("/explore")).toBe(false);
  });

  it("wires the entry into the sidebar Social section and horizontal nav", () => {
    expect(sidebarSource).toContain(
      "href: SHORTS_NAV_ENTRY.href, labelKey: SHORTS_NAV_ENTRY.labelKey",
    );
    expect(sidebarSource).toContain(
      "titleKey: SHORTS_NAV_ENTRY.labelKey, href: SHORTS_NAV_ENTRY.href",
    );
  });

  it("wires the same entry into the footer's Social links", () => {
    expect(footerSource).toContain(
      "label: SHORTS_NAV_ENTRY.label, href: SHORTS_NAV_ENTRY.href",
    );
  });
});
