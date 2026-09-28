/* Server-side QR generation for NFC business cards.
   Uses the vendored `qrcode` encoder (MIT, v1.5.4 — vendored because pnpm is
   unavailable in this environment; see src/vendor/). Only the SVG renderer
   path is used: SVG is vector, so it scales to any print resolution and is
   what manufacturers want for the card back. EC level M balances density
   against scuff tolerance on a printed card. */
import QRCodeCore from "../vendor/qrcode/lib/core/qrcode.js";
import SvgRenderer from "../vendor/qrcode/lib/renderer/svg-tag.js";

export function nfcProfileUrl(slug: string): string {
  const base =
    process.env.PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://bowdownvisuals.com";
  return `${base.replace(/\/$/, "")}/c/${slug}`;
}

/** Print-ready SVG QR encoding the card's tap URL. */
export function generateNfcQrSvg(slug: string): string {
  const qr = QRCodeCore.create(nfcProfileUrl(slug), {
    errorCorrectionLevel: "M",
  });
  return SvgRenderer.render(qr, { margin: 2 });
}
