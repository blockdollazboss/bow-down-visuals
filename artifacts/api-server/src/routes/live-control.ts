/**
 * live-control.ts — the Stream Controller socket endpoint.
 *
 *   GET (upgrade) /api/live/controller/ws?token=<session>&role=stage|remote
 *
 * Same session verification as the chat socket: the site's session is
 * a Bearer token (Supabase), browsers can't set WS headers, so the
 * token rides as a query param and is verified with requireAuth's own
 * call. The room is keyed by the verified user — a socket only ever
 * joins its OWN account's control room.
 *
 * The studio (role=stage) executes commands against its real state
 * and publishes confirmed state; remotes (role=remote) send commands
 * and render state.sync only. See lib/control-relay.ts.
 */
import { ControlRelay, controlRoomId, type ControllerRole } from "../lib/control-relay";
import { LiveWsGateway, RoomHub, verifyAccessToken, type AccessTokenVerifier } from "../lib/live-ws";
import { logger } from "../lib/logger";

export interface LiveControlDeps {
  verifyToken?: AccessTokenVerifier;
}

export function registerLiveControlWs(gateway: LiveWsGateway, deps: LiveControlDeps = {}): ControlRelay {
  const verify = deps.verifyToken ?? verifyAccessToken;
  // Its own hub: control rooms are separate from chat rooms.
  const hub = new RoomHub();
  const relay = new ControlRelay(hub);

  gateway.register("/api/live/controller/ws", async ({ socket, query }) => {
    const roleRaw = query.get("role");
    if (roleRaw !== "stage" && roleRaw !== "remote") {
      try {
        socket.close(4400, "role_required");
      } catch {
        /* already gone */
      }
      return;
    }
    const role = roleRaw as ControllerRole;
    const token = query.get("token");
    const auth = token ? await verify(token).catch(() => null) : null;
    if (!auth) {
      try {
        socket.close(4401, "unauthorized");
      } catch {
        /* already gone */
      }
      return;
    }

    const room = controlRoomId(auth.userId);
    relay.join(room, socket, role);
    socket.on("message", (data) => {
      try {
        relay.handleFrame(room, socket, data.toString());
      } catch (err) {
        logger.warn({ err }, "live controller: frame handling failed");
      }
    });
    socket.on("close", () => relay.leave(room, socket));
    socket.on("error", () => relay.leave(room, socket));
  });

  return relay;
}
