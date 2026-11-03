import { Link } from "wouter";
import { BadgeDollarSign, Rocket, Tag, Megaphone, HandCoins, ArrowRight } from "lucide-react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  creationFinaleSteps,
  creationSurface,
  type CreationSurface,
  type CreationSurfaceId,
} from "@/lib/creation-finale";

/* ─── Creation finale (org wave #2, rank 6a) ───
   The end of every creation surface: CREATE hands off to PUBLISH →
   PRICE → PROMOTE → EARN instead of stopping at the export button.
   Companion to GetPaidFinale (which closes finished drops on the
   player side); this one closes the desks where the work is made.
   Both themes are designed: light gets the warm ivory/gold card,
   dark the gold-on-black card, same as the publish desk's panels. */

const STEP_ICONS = {
  publish: <Rocket className="h-5 w-5" />,
  price: <Tag className="h-5 w-5" />,
  promote: <Megaphone className="h-5 w-5" />,
  earn: <HandCoins className="h-5 w-5" />,
} as const;

export function CreationFinale({
  surface,
  surfaceId,
}: {
  surface?: CreationSurface;
  surfaceId?: CreationSurfaceId;
}) {
  const isLight = useIsLightTheme();
  const resolved = surface ?? (surfaceId ? creationSurface(surfaceId) : null);
  if (!resolved) return null;
  const steps = creationFinaleSteps(resolved);

  return (
    <section
      aria-label="Get paid — next steps"
      data-testid="creation-finale"
      className={`mt-12 rounded-2xl border p-6 md:p-8 ${
        isLight
          ? "border-[#C9A84C]/40 bg-gradient-to-br from-[#FCF7EA] to-[#F4E7C3]"
          : "border-[#e8c86a]/30 bg-gradient-to-br from-[#e8c86a]/10 via-transparent to-transparent"
      }`}
    >
      <div className="flex items-center gap-3 mb-1">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8c86a] text-black">
          <BadgeDollarSign className="h-5 w-5" />
        </span>
        <div>
          <h2 className={`text-lg font-black ${isLight ? "text-[#3d2f05]" : "text-white"}`}>
            Made it — now get paid from it
          </h2>
          <p className={`text-xs ${isLight ? "text-[#3d2f05]/60" : "text-white/45"}`}>
            The cheat-code chain never stops at the desk: publish it, price it, promote it, watch it earn.
          </p>
        </div>
      </div>

      <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s) => (
          <div
            key={s.key}
            className={`rounded-xl border p-4 ${
              isLight ? "border-[#C9A84C]/35 bg-white/60" : "border-white/10 bg-black/40"
            }`}
          >
            <div className="flex items-center gap-2 text-[#b8912a] mb-1.5">
              {STEP_ICONS[s.key]}
              <p className={`text-sm font-bold ${isLight ? "text-[#3d2f05]" : "text-white"}`}>{s.title}</p>
            </div>
            <p className={`text-xs leading-relaxed ${isLight ? "text-[#3d2f05]/65" : "text-white/55"}`}>{s.body}</p>
            <Link href={s.href}>
              <span className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold text-[#b8912a] hover:underline">
                {s.cta} <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
