import {
  Component,
  Fragment,
  createElement,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * SettingsCardBoundary core — per-card render-error isolation for
 * /settings (QC-200 G4; owner resilience law: "one bad section should
 * never take the whole dashboard down").
 *
 * Before this, /settings had only the App-level RouteErrorBoundary: a
 * render throw inside any one Settings card unmounted the whole page,
 * hiding every card below it — the theme desk included. Each card now
 * sits behind its own boundary: a throwing card degrades to its own
 * honest error card with a retry that remounts just that card, while
 * every other card keeps rendering and working.
 *
 * Data/load errors are NOT what this catches — the cards already track
 * those per card (loading / load-error / 503-not-ready states). This is
 * the render-throw layer underneath them.
 *
 * The class lives in this .ts core (createElement, no JSX, no hooks)
 * so the test suite can import and exercise the real class under the
 * repo's node vitest harness; SettingsCardBoundary.tsx is the thin
 * hook wrapper (translation + theme) the page imports.
 */

export interface SettingsCardBoundaryCoreProps {
  /** Stable slug for the card ("sounds", "theme-packs", …) — used in
   *  the console tag and the fallback's test id. */
  name: string;
  title: string;
  description: string;
  retryLabel: string;
  isLight: boolean;
  children: ReactNode;
}

export interface SettingsCardBoundaryState {
  error: Error | null;
  /** Bumped on retry so the failed card remounts from scratch instead
   *  of re-rendering whatever internal state threw. */
  attempt: number;
}

export class SettingsCardBoundaryCore extends Component<
  SettingsCardBoundaryCoreProps,
  SettingsCardBoundaryState
> {
  state: SettingsCardBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[SettingsCardBoundary:${this.props.name}]`,
      error,
      info.componentStack,
    );
  }

  handleRetry = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    const { name, title, description, retryLabel, isLight } = this.props;
    if (this.state.error) {
      return createElement(
        "section",
        {
          role: "alert",
          "data-testid": `settings-card-error-${name}`,
          "data-settings-card": name,
          className: `rounded-2xl border p-5 md:p-6 ${
            isLight
              ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
              : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
          }`,
        },
        createElement(
          "div",
          { className: "flex items-start gap-3" },
          createElement(
            "span",
            {
              className:
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10",
            },
            createElement(AlertTriangle, {
              className: "h-4 w-4 text-red-400",
            }),
          ),
          createElement(
            "div",
            { className: "min-w-0" },
            createElement("h2", { className: "text-lg font-bold" }, title),
            createElement(
              "p",
              {
                className: `mt-1 text-xs leading-relaxed ${
                  isLight ? "text-[#6B5B36]" : "text-white/50"
                }`,
              },
              description,
            ),
            createElement(
              "button",
              {
                type: "button",
                onClick: this.handleRetry,
                className:
                  "mt-4 inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20",
              },
              createElement(RotateCcw, { className: "h-4 w-4" }),
              retryLabel,
            ),
          ),
        ),
      );
    }
    return createElement(
      Fragment,
      { key: this.state.attempt },
      this.props.children,
    );
  }
}
