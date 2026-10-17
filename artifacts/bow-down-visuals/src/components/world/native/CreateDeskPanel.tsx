import type { PalaceStation } from "@/lib/world/stations";
import { NativePlaceholder } from "./NativePlaceholder";
import { AudioDesk } from "./AudioDesk";
import {
  CoverArtDesk,
  SongDesk,
  SongVideoDesk,
  ThumbnailDesk,
  VideoDesk,
  type CreateDeskProps,
} from "./CreateDesks";

/* ─── CreateDeskPanel — the "create" pattern's dispatch (§3.6) ──────
   The panel host renders this for every native station whose
   pattern is "create"; the station id picks the bench. All six
   Create Wing desks are real instruments now — the placeholder
   remains only as the honest fallback for an id this dispatch
   doesn't know (registry drift), never as a shipped desk. */

export interface CreateDeskPanelProps extends CreateDeskProps {
  station: PalaceStation;
}

export function CreateDeskPanel({ station, ...props }: CreateDeskPanelProps) {
  switch (station.id) {
    case "song-desk":
      return <SongDesk {...props} />;
    case "video-desk":
      return <VideoDesk {...props} />;
    case "song-video-desk":
      return <SongVideoDesk {...props} />;
    case "cover-art-desk":
      return <CoverArtDesk {...props} />;
    case "thumbnail-desk":
      return <ThumbnailDesk {...props} />;
    case "audio-desk":
      return <AudioDesk {...props} />;
    default:
      return <NativePlaceholder station={station} isLight={props.isLight} />;
  }
}
