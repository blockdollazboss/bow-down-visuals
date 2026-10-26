/**
 * video-call-signaling.ts — the transport half of video-call
 * signaling: which sockets belong to which signed-in member, and the
 * relay rule for one signal frame. DB-free and gateway-free (the
 * minimal WsClientSocket shape from live-ws), so it unit-tests with
 * fake sockets; routes/video-calls.ts wires it to the real gateway,
 * the ledger, and the block-sever hook.
 *
 * One member may hold several sockets (phone + laptop); call events
 * fan out to all of them and the client dedupes by call id. A guest
 * never gets a socket here at all — the WS register handler verifies
 * the session token first and refuses the upgrade without one.
 */

import { WS_OPEN, type WsClientSocket } from "./live-ws";
import {
  parseCallClientFrame, canSignalForCall, callPeerOf,
  type CallServerEvent, type CallStatus,
} from "./video-calls";

export interface SignalingCallView {
  id: string;
  conversationId: string;
  callerUserId: string;
  calleeUserId: string;
  status: CallStatus;
  conversationStatus: string;
}

export class VideoCallHub {
  private byUser = new Map<string, Set<WsClientSocket>>();
  private userOf = new Map<WsClientSocket, string>();

  attach(userId: string, socket: WsClientSocket): void {
    let set = this.byUser.get(userId);
    if (!set) { set = new Set(); this.byUser.set(userId, set); }
    set.add(socket);
    this.userOf.set(socket, userId);
  }

  detach(socket: WsClientSocket): void {
    const userId = this.userOf.get(socket);
    this.userOf.delete(socket);
    if (!userId) return;
    const set = this.byUser.get(userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.byUser.delete(userId);
  }

  /** Is this member reachable for a ring right now? */
  isOnline(userId: string): boolean {
    const set = this.byUser.get(userId);
    if (!set) return false;
    for (const s of set) if (s.readyState === WS_OPEN) return true;
    return false;
  }

  socketCount(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  /** Deliver one server event to every live socket a member holds.
   *  Returns how many sockets took it; dead sockets are pruned. */
  sendToUser(userId: string, event: CallServerEvent): number {
    const set = this.byUser.get(userId);
    if (!set || set.size === 0) return 0;
    const data = JSON.stringify(event);
    let delivered = 0;
    for (const socket of [...set]) {
      if (socket.readyState !== WS_OPEN) { this.detach(socket); continue; }
      try { socket.send(data); delivered++; } catch { this.detach(socket); }
    }
    return delivered;
  }

  /**
   * Relay one raw client frame. The frame must parse, the call must
   * exist, the sender must be a participant, and the call + its
   * conversation must still be in a signalable state (ringing or
   * live, conversation in the inbox — a block that landed a second
   * ago stops this frame). Returns true when the frame reached the
   * peer. `getCall` is injected by the route (the ledger read).
   */
  async relayFrame(
    fromUserId: string,
    raw: string,
    getCall: (callId: string) => Promise<SignalingCallView | null>,
  ): Promise<boolean> {
    const frame = parseCallClientFrame(raw);
    if (!frame) return false;
    if (frame.type === "call.ping") return true; // app-level keepalive, swallowed on purpose
    const call = await getCall(frame.callId).catch(() => null);
    if (!call) return false;
    if (!canSignalForCall({
      conversationStatus: call.conversationStatus,
      callStatus: call.status,
      fromUserId,
      callerUserId: call.callerUserId,
      calleeUserId: call.calleeUserId,
    })) return false;
    const peer = callPeerOf(call, fromUserId);
    if (!peer) return false;
    const delivered = this.sendToUser(peer, {
      type: "call.signal", callId: call.id, fromUserId, data: frame.data,
    });
    return delivered > 0;
  }
}

/** The process-wide hub the routes share (REST events + WS relay +
 *  the block-sever hook all speak through this one instance). */
export const videoCallHub = new VideoCallHub();
