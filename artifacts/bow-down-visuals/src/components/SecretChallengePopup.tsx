/* ============================================================
   Winner popup — uses the exact approved mockup image.
   The generated scene (fireworks, gold frame, card, shark) is shown
   as-is. The artwork already bakes in "50 Visual Bucs" (see
   BAKED_IN_CREDITS below); a live overlay covers that baked-in text
   only when the awarded amount differs, so the popup never shows a
   stale amount. A working Claim button sits over the baked-in Claim
   button art.
   ============================================================ */

/** Amount baked into bow-winner-popup.webp — keep in sync with the artwork. */
const BAKED_IN_CREDITS = 50;

export function SecretChallengePopup({
  credits,
  onClaim,
}: {
  credits: number;
  onClaim: () => void;
}) {
  const base = import.meta.env.BASE_URL;
  // Cover the baked-in amount only when the real award differs from it.
  const needsAmountOverlay = credits !== BAKED_IN_CREDITS;

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="You cracked the code"
    >
      {/* The exact generated scene. Wrapper is a sized container so the
          overlays below can use cqw units and track the image exactly. */}
      <div
        className="relative w-fit animate-[popIn_0.45s_cubic-bezier(0.34,1.56,0.64,1)_both]"
        style={{ containerType: "inline-size" }}
      >
        <img
          src={`${base}images/bow-winner-popup.webp`}
          alt="You cracked the code — you've been awarded Visual Bucs"
          draggable={false}
          className="block h-auto select-none"
          style={{ width: "min(94vw, calc(90vh * 1.5))", maxHeight: "90vh" }}
        />

        {/* Live credit amount — opaque backing fully covers the baked-in
            "50 Visual Bucs" text (measured at 35–63.7% x, 55.3–61.5% y),
            then the real awarded amount goes on top. */}
        {needsAmountOverlay && (
          <div
            aria-hidden="true"
            className="absolute flex items-center justify-center bg-black"
            style={{ left: "33%", top: "53.5%", width: "34%", height: "10%" }}
          >
            <span
              className="font-display font-bold whitespace-nowrap text-[#e8c86a]"
              style={{
                fontSize: "4.4cqw",
                textShadow: "0 0 2cqw rgba(232,200,106,0.55)",
              }}
            >
              {credits} Visual Bucs
            </span>
          </div>
        )}
        {/* Screen-reader announcement of the real amount */}
        <span className="sr-only">You&rsquo;ve been awarded {credits} Visual Bucs.</span>

        {/* Working Claim button over the baked-in Claim art
            (measured at 38.8–60.4% x, 65.4–71.6% y). */}
        <button
          type="button"
          onClick={onClaim}
          aria-label="Claim your Visual Bucs"
          className="absolute cursor-pointer rounded-[1cqw] transition hover:bg-[#C9A84C]/15 active:bg-[#C9A84C]/25"
          style={{ left: "38.5%", top: "65%", width: "22%", height: "7%" }}
        />
      </div>
      <style>{`@keyframes popIn { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
    </div>
  );
}
