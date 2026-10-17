/* ─── The Native Panel kit (NATIVE-PLAN §3.0) ───────────────────────
   The shared primitives the pattern lanes build on. One frame
   (TransferFooter), one card ground (NativeCard), the honest
   states, and one kit per read/create pattern family shipped in
   this framework step. Lanes import from here, never re-invent. */
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
export {
  CreateDeskRunner,
  type CreateDeskJobState,
  type CreateDeskRunnerProps,
} from "./CreateDeskRunner";
export { NativePlaceholder, type NativePlaceholderProps } from "./NativePlaceholder";
export {
  useShelfPlayer,
  NowPlayingCard,
  type ShelfPlayerController,
} from "./ShelfPlayer";
export { ListeningBooth, type ListeningBoothProps } from "./ListeningBooth";
export { ShopStand, type ShopStandProps } from "./ShopStands";
export { CreateDeskPanel, type CreateDeskPanelProps } from "./CreateDeskPanel";
export {
  SongDesk,
  VideoDesk,
  SongVideoDesk,
  CoverArtDesk,
  ThumbnailDesk,
  type CreateDeskProps,
} from "./CreateDesks";
export { AudioDesk } from "./AudioDesk";
export {
  AdvancedExpander,
  ResultChips,
  type ResultChipsProps,
} from "./CreateDeskShared";
export { BrandingKitDesk, PressKitDesk, PromoteDesk } from "./BusinessDesks";
