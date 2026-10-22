import { useSyncExternalStore } from "react";

/**
 * Backend calls in flight, for the global loading indicator. Every HTTP call through ApiService and every live stream
 * that is still connecting counts; a background refresh of data already on screen (a poll) is wrapped in `quietly`
 * and doesn't, so live views don't flash the indicator every few seconds.
 */
export type Activity = { busy: boolean; since: number };

const IDLE: Activity = { busy: false, since: 0 };
let pending = 0;
let quietDepth = 0;
let snapshot = IDLE;
const listeners = new Set<() => void>();

function publish(next: Activity) {
  snapshot = next;
  listeners.forEach((l) => l());
}

/** Runs `fn` with any backend call it starts synchronously marked as a background refresh. */
export function quietly<T>(fn: () => T): T {
  quietDepth++;
  try {
    return fn();
  } finally {
    quietDepth--;
  }
}

/** Marks one backend call as started; returns the function that marks it finished (safe to call twice). */
export function beginActivity(): () => void {
  if (quietDepth > 0) return () => undefined;
  if (pending++ === 0) publish({ busy: true, since: Date.now() });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--pending === 0) publish(IDLE);
  };
}

export function getActivity(): Activity {
  return snapshot;
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActivity(): Activity {
  return useSyncExternalStore(subscribeActivity, getActivity, getActivity);
}
