import { Music2 } from "lucide-react";

/** Reference song audio player — plays the uploaded song on its own.
 *  Used both inside the timeline and in the wizard timeline-preview step,
 *  where it is intentionally separate from the (silent) clip previews. */
export function ReferenceAudioPlayer({
  url,
  label = "Reference Audio",
}: {
  url: string;
  label?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Music2 className="h-4 w-4 text-primary/60" />
        <span className="text-xs font-black text-white/50 uppercase tracking-widest">{label}</span>
      </div>
      <audio controls src={url} className="w-full h-10" style={{ colorScheme: "dark" }} />
    </div>
  );
}
