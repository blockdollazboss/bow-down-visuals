/* Thy Books — Lulu Print API integration plan (STUB).
 *
 * Status: NOT IMPLEMENTED — awaiting API credentials from the user.
 *
 * ── What the user needs to provide ──
 * 1. Sign up at https://developers.lulu.com/ (production)
 *    and https://developers.sandbox.lulu.com/ (testing)
 * 2. Create an API client → copy the Client Key and Client Secret
 * 3. Set these env vars on Render (staging first):
 *      LULU_CLIENT_KEY=...
 *      LULU_CLIENT_SECRET=...
 *      LULU_USE_SANDBOX=true   (false for production)
 *
 * ── Auth ──
 * Lulu uses OAuth2 client-credentials flow (Keycloak):
 *   POST https://api.lulu.com/auth/realms/glasstree/protocol/openid-connect/token
 *   (sandbox: https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token)
 *   Body (x-www-form-urlencoded):
 *     grant_type=client_credentials&client_id={KEY}&client_secret={SECRET}
 *   → { access_token, expires_in } — cache until expiry, then refresh.
 *
 * ── Endpoints (base: https://api.lulu.com) ──
 * | Endpoint                              | Method | Purpose                              |
 * |---------------------------------------|--------|--------------------------------------|
 * | /print-jobs/                          | POST   | Create a print order                 |
 * | /print-jobs/                          | GET    | List orders (?limit, ?offset, ?status)|
 * | /print-jobs/{id}/                     | GET    | Order details                        |
 * | /print-jobs/{id}/status/              | GET    | Order status / tracking              |
 * | /print-jobs/{id}/status/              | PUT    | Cancel order (pre-production only)   |
 * | /print-job-cost-calculations/         | POST   | Price quote (before ordering)        |
 * | /shipping-options/                    | POST   | Shipping options for destination     |
 * | /validate-interior/                   | POST   | Validate interior PDF                |
 * | /validate-cover/                      | POST   | Validate cover PDF                   |
 * | /cover-dimensions/                    | POST   | Required cover size for page count   |
 * | /webhooks/                            | POST   | Register status-change webhook       |
 *
 * ── Print job payload shape (POST /print-jobs/) ──
 * {
 *   "contact_email": "author@example.com",
 *   "external_id": "bdv-book-<uuid>",        // our idempotency key
 *   "line_items": [{
 *     "external_id": "bdv-book-<uuid>-1",
 *     "title": "Book Title",
 *     "quantity": 1,
 *     "pod_package_id": "0550X0850FCP080CW444G",  // 5.5x8.5 paperback — pick per trim
 *     "cover": { "source_url": "<cover PDF URL>" },
 *     "interior": { "source_url": "<interior PDF URL>" }
 *   }],
 *   "shipping_address": { ... },
 *   "shipping_option_id": "..."               // from /shipping-options/
 * }
 * Note: Lulu downloads the PDFs from source_url — our R2 public URLs work.
 * Interior PDF: our /api/books/:id/export/pdf output (6x9 — match pod_package_id!).
 * Cover PDF: NOT YET BUILT — needs spine math via /cover-dimensions/ + pdfkit
 *   composition (front + spine + back on one sheet). Phase 2 generates the
 *   cover *image*; the print-ready cover *PDF* is a follow-up task.
 *
 * ── Suggested route plan (when credentials arrive) ──
 *   POST /api/books/:id/print/quote    → /print-job-cost-calculations/ + /shipping-options/
 *   POST /api/books/:id/print/order     → validate both PDFs, then /print-jobs/
 *   GET  /api/books/:id/print/status    → /print-jobs/{id}/status/
 *   POST /api/books/print/webhook       → Lulu status webhooks → notify user
 *
 * ── Pricing note ──
 * Lulu bills per order (print cost + shipping). Decide the markup model with
 * the user before going live: pass-through + fee, or bundled Visual Bucs price.
 * NEVER place a real order without explicit user approval per order.
 */

export const LULU_INTEGRATION_STATUS = "stub" as const;

/* Placeholder — throws until credentials are configured. */
export function assertLuluConfigured(): never {
  throw new Error(
    "Lulu Print API is not configured. Set LULU_CLIENT_KEY and LULU_CLIENT_SECRET on Render first."
  );
}
