import { useState } from "react";
import { QrCode, X } from "lucide-react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* Simple QR code via qrserver API - no dependency needed */
export function QRCodeImage({ data, size = 200 }: { data: string; size?: number }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&bgcolor=ffffff&color=141414`;
  return <img src={url} alt="QR Code" width={size} height={size} className="rounded-lg" />;
}

export function QRCodeModal({ data, title }: { data: string; title: string }) {
  const [open, setOpen] = useState(false);
  const isLight = useIsLightTheme();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
      >
        <QrCode className="h-4 w-4" />
        <span>Show QR Code</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" style={{ backgroundColor: "rgba(16,12,4,0.78)" }} onClick={() => setOpen(false)}>
          <div className={`border rounded-2xl p-6 max-w-sm w-full text-center ${isLight ? "bg-[#FBF6E9] border-[#C9A84C]/50 shadow-[0_24px_60px_rgba(122,90,18,0.35)]" : "bg-[#171208] border-primary/30 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">{title}</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-accent/10 rounded">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex justify-center mb-4">
              <QRCodeImage data={data} size={220} />
            </div>
            <p className="text-sm text-muted-foreground">Scan with your phone camera</p>
          </div>
        </div>
      )}
    </>
  );
}
