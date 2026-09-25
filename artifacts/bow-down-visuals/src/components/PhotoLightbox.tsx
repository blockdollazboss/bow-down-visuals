import { useEffect } from "react";
import { X } from "lucide-react";

interface PhotoLightboxProps {
  photoUrl: string | null;
  artistName?: string;
  onClose: () => void;
}

/**
 * Full-screen photo lightbox for Artist Vault photos.
 * Click any artist photo to see it big.
 */
export function PhotoLightbox({ photoUrl, artistName, onClose }: PhotoLightboxProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!photoUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      <div
        className="max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl border border-[#c9a84c]/30 shadow-[0_0_60px_rgba(201,168,76,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={photoUrl}
          alt={artistName || "Artist photo"}
          className="max-h-[85vh] w-auto object-contain"
        />
        {artistName && (
          <div className="bg-black/80 px-4 py-3 text-center">
            <p className="text-sm font-bold text-[#c9a84c]">{artistName}</p>
          </div>
        )}
      </div>
      <p className="absolute bottom-4 text-xs text-white/40">Click anywhere or press ESC to close</p>
    </div>
  );
}
