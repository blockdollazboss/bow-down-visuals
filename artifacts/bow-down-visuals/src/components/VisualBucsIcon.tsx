/* The Visual Bucs currency icon — the shark-king mark.
   Use this everywhere a Visual Bucs amount, balance, or price is shown
   instead of a generic coin glyph. */
export function VisualBucsIcon({ className = "" }: { className?: string }) {
  const base = import.meta.env.BASE_URL;
  return (
    <img
      src={`${base}images/visual-bucs-icon.webp`}
      alt="Visual Bucs"
      draggable={false}
      className={`rounded-full object-cover select-none ${className}`}
    />
  );
}
