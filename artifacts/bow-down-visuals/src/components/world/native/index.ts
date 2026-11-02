/* ─── The Native Panel kit (NATIVE-PLAN §3.0) ───────────────────────
   The shared primitives the pattern lanes build on. One frame
   (TransferFooter), one card ground (NativeCard), the honest
   states, and the shelf player. Lanes import from here, never
   re-invent.

   WORLD-PERF ROUND 3 — this barrel re-exports ONLY the kit: every
   name below homes in the frame's own chunks (the world-kit group,
   the shelf-player chunk, the states chunk). The family desks
   (Create / Shop / Business / Audio / Hook / ListeningBooth) used
   to be re-exported from here too, and nobody imported them
   through the barrel — the panel lazy-imports them from their own
   modules — but the dead re-exports still cost real bytes:
   Rolldown kept a side-effect import of the whole ~546 kB family
   web chunk in this barrel's chunk, so opening ANY station
   statically dragged the entire web. Do not re-add desk
   re-exports here; import a desk from its own module (lazily,
   like StationPanel does). ResultChips lives in CreateDeskShared
   and is imported directly by the desks that render it — same
   rule. */
export { TransferFooter, type TransferFooterProps } from "./TransferFooter";
export { NativeCard, type NativeCardProps } from "./NativeCard";
export { NativeLoadingState, NativeEmptyState, NativeErrorState } from "./NativeStates";
export {
  NativeBoard,
  NativeBoardRow,
  type NativeBoardProps,
  type NativeBoardRowProps,
} from "./NativeBoard";
export { NativeShelf, NativeShelfRow, type NativeShelfRowProps } from "./NativeShelf";
export { NativePlaceholder, type NativePlaceholderProps } from "./NativePlaceholder";
export {
  useShelfPlayer,
  NowPlayingCard,
  type ShelfPlayerController,
} from "./ShelfPlayer";
export { AdvancedExpander } from "./CreateDeskLeaf";
