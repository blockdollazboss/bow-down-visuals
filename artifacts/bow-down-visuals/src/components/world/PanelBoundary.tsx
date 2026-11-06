/**
 * PanelBoundary — the World's panel-level error boundary, extracted
 * verbatim from StationPanel.tsx (Stack-200 hardening C, item 31)
 * so its behavior is unit-testable in isolation, the same pattern
 * as components/section-boundary.ts on the 2D side. StationPanel
 * imports it from here; behavior is unchanged.
 */
import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/** A panel page that failed to load or render: said plainly, with
 *  a retry — never a blank frame dressed as a door. */
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
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <AlertTriangle className="h-7 w-7 text-[#d4af37]" />
        <p className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
          This desk wouldn&rsquo;t open in the palace
        </p>
        <p className={`max-w-sm text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          The feature itself is fine — the panel couldn&rsquo;t bring it in. Try the door again.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target"
        >
          Try again
        </button>
      </div>
    );
  }
}
