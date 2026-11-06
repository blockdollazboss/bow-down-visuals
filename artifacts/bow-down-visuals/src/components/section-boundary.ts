import {
  Component,
  Fragment,
  createElement,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * SectionBoundary core — generic per-section render-error isolation,
 * extracted from the SettingsCardBoundary pattern (QC-200 G4) for the
 * Stack-200 hardening wave, section C (census items 41 + 43).
 *
 * Owner resilience law: "one bad section should never take the whole
 * dashboard down." Before this, the app had exactly ONE boundary —
 * the App-level RouteErrorBoundary around the whole Switch — so any
 * section render throw replaced the ENTIRE page: one malformed post
 * killed the /home timeline AND its composer, and one throwing
 * marketing section blanked the public homepage for every signed-out
 * visitor. Pages now wrap their independent sections in this
 * boundary: a throwing section degrades to its own contained,
 * honest fallback while every sibling keeps rendering and working.
 *
 * Data/load errors are NOT what this catches — sections already track
 * those per section (loading / load-error states). This is the
 * render-throw layer underneath them.
 *
 * Variants:
 *  - "section" — the full honest error card (title + description +
 *    retry), styled like the Settings card fallback. For page
 *    sections: homepage bands, the feed's Drops view.
 *  - "compact" — a slim contained row (label + retry). For items
 *    inside a flowing list: one feed post, the composer, the rails —
 *    a full card would shout; a quiet placeholder keeps the timeline
 *    readable and is never a fake empty state.
 *  - "silent" — no visual fallback at all: the piece degrades to
 *    nothing and the static surroundings carry the page. For purely
 *    decorative layers (the homepage hero's canvas/WebGL pieces) —
 *    a fog or spotlight failure must leave the static hero standing,
 *    not replace it with an error card floating mid-hero. The catch
 *    is still logged with the section slug.
 *
 * The class lives in this .ts core (createElement, no JSX, no hooks)
 * so the test suite can import and exercise the real class under the
 * repo's node vitest harness; SectionBoundary.tsx is the thin hook
 * wrapper (translation + theme) the pages import.
 */

export type SectionBoundaryVariant = "section" | "compact" | "silent";

interface SectionBoundaryCoreProps {
  /** Stable slug for the section ("composer", "post-<id>", "hero-fog",
   *  …) — used in the console tag and the fallback's test id. */
  name: string;
  variant: SectionBoundaryVariant;
  title: string;
  description?: string;
  retryLabel: string;
  isLight: boolean;
  /** Extra classes for the fallback root (pages constrain the card
   *  inside their own layout rhythm — e.g. the homepage centers it in
   *  the section column). Healthy renders never see it. */
  fallbackClassName?: string;
  children: ReactNode;
}

interface SectionBoundaryState {
  error: Error | null;
  /** Bumped on retry so the failed section remounts from scratch
   *  instead of re-rendering whatever internal state threw. */
  attempt: number;
}

export class SectionBoundaryCore extends Component<
  SectionBoundaryCoreProps,
  SectionBoundaryState
> {
  state: SectionBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[SectionBoundary:${this.props.name}]`,
      error,
      info.componentStack,
    );
  }

  handleRetry = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    const {
      name,
      variant,
      title,
      description,
      retryLabel,
      isLight,
      fallbackClassName,
    } = this.props;
    if (this.state.error) {
      if (variant === "silent") {
        /* Decorative layer: degrade to nothing — the static page
           around it is the fallback. */
        return null;
      }
      if (variant === "compact") {
        return createElement(
          "div",
          {
            role: "alert",
            "data-testid": `section-error-${name}`,
            "data-section-boundary": name,
            className: `flex items-center gap-3 rounded-xl border px-4 py-3 ${
              isLight
                ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
                : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
            }${fallbackClassName ? ` ${fallbackClassName}` : ""}`,
          },
          createElement(
            "span",
            {
              className:
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/10",
            },
            createElement(AlertTriangle, {
              className: "h-3.5 w-3.5 text-red-400",
            }),
          ),
          createElement(
            "span",
            {
              className: `min-w-0 flex-1 text-sm font-semibold ${
                isLight ? "text-[#6B5B36]" : "text-white/70"
              }`,
            },
            title,
          ),
          createElement(
            "button",
            {
              type: "button",
              onClick: this.handleRetry,
              className:
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20",
            },
            createElement(RotateCcw, { className: "h-3.5 w-3.5" }),
            retryLabel,
          ),
        );
      }
      return createElement(
        "section",
        {
          role: "alert",
          "data-testid": `section-error-${name}`,
          "data-section-boundary": name,
          className: `rounded-2xl border p-5 md:p-6 ${
            isLight
              ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
              : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
          }${fallbackClassName ? ` ${fallbackClassName}` : ""}`,
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
            description
              ? createElement(
                  "p",
                  {
                    className: `mt-1 text-xs leading-relaxed ${
                      isLight ? "text-[#6B5B36]" : "text-white/50"
                    }`,
                  },
                  description,
                )
              : null,
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
