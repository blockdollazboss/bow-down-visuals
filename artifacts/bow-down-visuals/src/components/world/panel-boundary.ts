/**
 * PanelBoundary — the World's panel-level error boundary.
 *
 * A panel page that failed to load or render: said plainly, with a
 * retry — never a blank frame dressed as a door.
 *
 * History (Stack-200 hardening C, item 31): this class lived inside
 * StationPanel.tsx; it was extracted verbatim, then converted from
 * JSX to createElement form — the same core/wrapper split as
 * components/section-boundary.ts — so its behavior is unit-testable
 * in isolation (vitest cannot import JSX modules in this repo's
 * setup). The conversion is render-identical: the failed-state and
 * healthy-state HTML for both themes were captured from the JSX
 * version and diffed byte-for-byte against this version before the
 * JSX file was removed.
 */
import { Component, createElement, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

export class PanelBoundary extends Component<
  { isLight: boolean; resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const isLight = this.props.isLight;
    return createElement(
      "div",
      { className: "flex flex-col items-center gap-3 px-4 py-10 text-center" },
      createElement(AlertTriangle, { className: "h-7 w-7 text-[#d4af37]" }),
      createElement(
        "p",
        { className: `text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}` },
        "This desk wouldn’t open in the palace",
      ),
      createElement(
        "p",
        { className: `max-w-sm text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}` },
        "The feature itself is fine — the panel couldn’t bring it in. Try the door again.",
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => this.setState({ failed: false }),
          className:
            "rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target",
        },
        "Try again",
      ),
    );
  }
}
