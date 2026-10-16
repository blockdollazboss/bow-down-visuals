/**
 * control-relay.ts — the Stream Controller relay.
 *
 * A per-user control channel: the studio tab connects as role=stage,
 * phone remotes as role=remote. The room key is derived from the
 * VERIFIED session's user id (control:<userId>) — there is no field
 * in any frame that names a user, so a remote structurally cannot
 * address another account's studio. Commands only ever flow from a
 * room's remotes to that same room's stages; state only flows back.
 *
 * Frames:
 *   remote → { type: "command", id, command, args?, targetStageId? }
 *   stage  → { type: "state", state }       (state.stageId learned here)
 *   server → { type: "state.sync", state }  (relayed to the whole room)
 *   server → { type: "presence", stageConnected, stageCount }
 */
import type { RoomHub, WsClientSocket } from "./live-ws";

export const CONTROLLER_COMMANDS = [
  "scene.select",
  "transition.cut",
  "transition.fade",
  "mic.toggle",
  "camera.toggle",
  "record.toggle",
  "stream.start",
  "stream.end",
] as const;

export type ControllerRole = "stage" | "remote";

export function controlRoomId(userId: string): string {
  return `control:${userId}`;
}

export interface ControlPresence {
  stageConnected: boolean;
  stageCount: number;
}

export class ControlRelay {
  private stages = new Map<string, Set<WsClientSocket>>();
  private roles = new Map<WsClientSocket, ControllerRole>();
  private stageIds = new Map<WsClientSocket, string>();

  constructor(private hub: RoomHub) {}

  presence(room: string): ControlPresence {
    const count = this.stages.get(room)?.size ?? 0;
    return { stageConnected: count > 0, stageCount: count };
  }

  join(room: string, socket: WsClientSocket, role: ControllerRole): void {
    this.roles.set(socket, role);
    this.hub.join(room, socket);
    if (role === "stage") {
      let set = this.stages.get(room);
      if (!set) {
        set = new Set();
        this.stages.set(room, set);
      }
      set.add(socket);
      this.broadcastPresence(room);
    }
    // Every joiner learns the room's presence immediately.
    this.send(socket, { type: "presence", ...this.presence(room) });
  }

  leave(room: string, socket: WsClientSocket): void {
    const wasStage = this.stages.get(room)?.delete(socket) ?? false;
    if (this.stages.get(room)?.size === 0) this.stages.delete(room);
    this.roles.delete(socket);
    this.stageIds.delete(socket);
    this.hub.leave(room, socket);
    if (wasStage) this.broadcastPresence(room);
  }

  private broadcastPresence(room: string): void {
    this.hub.broadcast(room, { type: "presence", ...this.presence(room) });
  }

  private send(socket: WsClientSocket, frame: Record<string, unknown>): void {
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      /* the close handler cleans up */
    }
  }

  /**
   * Route one raw frame from a room member. Returns true when the
   * frame was accepted and routed; malformed/off-role frames are
   * dropped (false) — never relayed, never echoed.
   */
  handleFrame(room: string, socket: WsClientSocket, raw: string): boolean {
    const role = this.roles.get(socket);
    if (!role) return false;
    let frame: any;
    try {
      frame = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!frame || typeof frame !== "object") return false;

    if (frame.type === "state") {
      // Only stages publish state.
      if (role !== "stage") return false;
      const state = frame.state;
      if (!state || typeof state !== "object" || typeof state.stageId !== "string") return false;
      this.stageIds.set(socket, state.stageId);
      this.hub.broadcast(room, { type: "state.sync", state });
      return true;
    }

    if (frame.type === "command") {
      // Only remotes issue commands.
      if (role !== "remote") return false;
      if (typeof frame.command !== "string" || !(CONTROLLER_COMMANDS as readonly string[]).includes(frame.command)) {
        return false;
      }
      const target = typeof frame.targetStageId === "string" ? frame.targetStageId : null;
      const stages = this.stages.get(room);
      if (!stages || stages.size === 0) return false;
      const payload = JSON.stringify({
        type: "command",
        id: typeof frame.id === "string" ? frame.id : "",
        command: frame.command,
        args: frame.args && typeof frame.args === "object" ? frame.args : {},
      });
      let delivered = 0;
      for (const stage of stages) {
        if (target && this.stageIds.get(stage) !== target) continue;
        try {
          stage.send(payload);
          delivered++;
        } catch {
          /* dead stage sockets are pruned on close / hub ping */
        }
      }
      return delivered > 0;
    }

    return false;
  }
}
