/* ── TemplatePicker ───────────────────────────────────────────────────
   "What are you making?" — shown when the video editor opens. Cards are
   draggable to reorder (custom order persists); clicking one applies the
   template's defaults (format, caption style, tool order).
------------------------------------------------------------------------ */

import { useState } from "react";
import {
  Music2, Megaphone, Mic2, Video, Smartphone, Images, Sparkles,
  LayoutDashboard, GripVertical, X,
} from "lucide-react";
import {
  VIDEO_TEMPLATES, getVideoTemplate,
  getTemplateOrder, setTemplateOrder,
  type VideoTemplateId, type TemplateIconName,
} from "@/lib/video-templates";

const ICONS: Record<TemplateIconName, React.ReactNode> = {
  music:      <Music2 className="h-6 w-6" />,
  megaphone:   <Megaphone className="h-6 w-6" />,
  mic:         <Mic2 className="h-6 w-6" />,
  video:       <Video className="h-6 w-6" />,
  smartphone:  <Smartphone className="h-6 w-6" />,
  images:      <Images className="h-6 w-6" />,
  sparkles:    <Sparkles className="h-6 w-6" />,
  layout:      <LayoutDashboard className="h-6 w-6" />,
};

interface TemplatePickerProps {
  activeId: VideoTemplateId | null;
  onSelect: (id: VideoTemplateId) => void;
  onClose: () => void;
}

export default function TemplatePicker({ activeId, onSelect, onClose }: TemplatePickerProps) {
  const [order, setOrder] = useState<VideoTemplateId[]>(getTemplateOrder);
  const [dragId, setDragId] = useState<VideoTemplateId | null>(null);

  const ordered = order.map(getVideoTemplate);

  function handleDrop(targetId: VideoTemplateId) {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const next = [...order];
    const from = next.indexOf(dragId);
    const to = next.indexOf(targetId);
    next.splice(to, 0, next.splice(from, 1)[0]!);
    setOrder(next);
    setTemplateOrder(next);
    setDragId(null);
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      data-testid="template-picker"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#C9A84C]/30 bg-[#0b0b0c] p-6 shadow-[0_0_60px_rgba(201,168,76,0.15)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-xl font-black text-white">What are you making?</h2>
            <p className="text-xs text-white/40 mt-1">
              Pick a template — it sets your format, surfaces the right tools, and curates the presets.
              Everything stays customizable. Drag cards to reorder.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white p-1"
            aria-label="Close template picker"
            data-testid="template-picker-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {ordered.map((t) => {
            const active = activeId === t.id;
            return (
              <div
                key={t.id}
                draggable
                onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(t.id)}
                onDragEnd={() => setDragId(null)}
                className={`relative rounded-xl border bg-gradient-to-br p-4 cursor-grab active:cursor-grabbing transition-all group ${t.accent} ${
                  active ? "ring-2 ring-[#C9A84C] shadow-[0_0_24px_rgba(201,168,76,0.25)]" : "hover:scale-[1.03]"
                } ${dragId === t.id ? "opacity-40" : ""}`}
                data-testid={`template-card-${t.id}`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className="absolute inset-0 rounded-xl"
                  aria-label={`Choose ${t.name} template`}
                />
                <div className="flex items-start justify-between">
                  <span className="text-[#C9A84C]">{ICONS[t.icon]}</span>
                  <GripVertical className="h-4 w-4 text-white/20 group-hover:text-white/50" />
                </div>
                <p className="text-sm font-black text-white mt-3">{t.name}</p>
                <p className="text-[11px] font-bold text-[#C9A84C]/90 mt-0.5">{t.tagline}</p>
                <p className="text-[10px] text-white/35 mt-1.5 leading-relaxed">{t.description}</p>
                {active && (
                  <span className="absolute top-2 right-2 text-[9px] font-black uppercase tracking-wider text-black bg-[#C9A84C] rounded-full px-2 py-0.5">
                    Active
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-white/25 mt-4 text-center">
          Templates are starting points — every format, tool, and preset stays adjustable after you pick.
        </p>
      </div>
    </div>
  );
}
