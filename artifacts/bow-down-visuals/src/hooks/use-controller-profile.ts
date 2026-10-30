import { useEffect, useSyncExternalStore } from "react";
import {
  GENERIC_CONTROLLER_PROFILE,
  getControllerProfile,
  refreshControllerProfile,
  subscribeControllerProfile,
  type ControllerProfile,
} from "@/lib/world/controller-profile";

/**
 * The controller in the player's hand, as a reactive profile
 * (stack900) — which family it is, what it is called in plain
 * words ("PS5 DualSense"), and what every button the World
 * talks about is named ON THAT PAD (lib/world/controller-
 * profile.ts carries the tables and the why).
 *
 * The Gamepad API only hands a pad's `id` over once the pad
 * has woken (a button press), and a different pad can take
 * the first slot mid-session — so beside the connect /
 * disconnect events this hook re-reads the id on a slow poll.
 * The store itself judges change on id + family, so the poll
 * costs a string compare a second and re-renders only when
 * the pad in hand actually changes.
 *
 * The scene does not use this hook (a frame loop has no use
 * for React state): it classifies the pad it already holds
 * through controllerProfileFromPad, the same classifier, so
 * the names the page paints and the buttons the scene reads
 * can never disagree about which pad is in hand.
 */
export function useControllerProfile(): ControllerProfile {
  const profile = useSyncExternalStore(
    subscribeControllerProfile,
    getControllerProfile,
    () => GENERIC_CONTROLLER_PROFILE,
  );

  useEffect(() => {
    refreshControllerProfile();
    const onPadChange = () => refreshControllerProfile();
    window.addEventListener("gamepadconnected", onPadChange);
    window.addEventListener("gamepaddisconnected", onPadChange);
    const poll = window.setInterval(refreshControllerProfile, 1000);
    return () => {
      window.removeEventListener("gamepadconnected", onPadChange);
      window.removeEventListener("gamepaddisconnected", onPadChange);
      window.clearInterval(poll);
    };
  }, []);

  return profile;
}
