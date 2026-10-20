/* ─── Optional session resolution (never a gate) ───────────────────────
   The pattern community.ts / social.ts already use locally, shared for
   the chat routes: when a valid Bearer token rides along, stamp the
   caller's identity onto the request (userId + userEmail); when it
   doesn't — or doesn't validate — the request simply stays anonymous.
   It NEVER 401s and NEVER throws: routes that use it keep their exact
   guest behavior, and signed-in members gain an identity the Cloud
   Operator's executor can act as (Phase 2: the executor resolves the
   caller's session server-side, and this is where free chat surfaces
   get one). */

import type { Request } from "express";
import { createClient } from "@supabase/supabase-js";

export async function resolveOptionalSession(req: Request): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) return;
  try {
    const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
    const key = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "";
    if (!url || !key) return;
    const client = createClient(url, key, { auth: { persistSession: false } });
    const { data: { user } } = await client.auth.getUser(authHeader.slice(7));
    if (user) {
      req.userId = user.id;
      req.userEmail = user.email;
      req.accessToken = authHeader.slice(7);
    }
  } catch {
    /* viewer stays anonymous — optional auth must never break a route */
  }
}
