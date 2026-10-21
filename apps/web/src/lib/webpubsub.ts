/**
 * Minimal Azure Web PubSub client (subprotocol json.webpubsub.azure.v1) for the realtime broadcast.
 *
 * Flow: negotiate with the API (an Entra-issued client URL, ~60 min) -> WebSocket -> joinGroup per group, checking
 * each ack -> group messages to `onMessage`. On close it re-negotiates (tokens are short-lived) with exponential
 * backoff. `negotiate` returning enabled:false means the deployment has no Web PubSub: callers fall back to SSE.
 */
import type { RealtimeNegotiate } from "../api/types";

export const SUBPROTOCOL = "json.webpubsub.azure.v1";

export type RealtimeStatus = "idle" | "connecting" | "live" | "reconnecting" | "disabled" | "error";

export type RealtimeOptions = {
  negotiate: () => Promise<RealtimeNegotiate>;
  /** Join only the negotiated groups that pass this filter (an overlay needs overlay.{id} only). */
  groups?: (group: string) => boolean;
  onMessage: (group: string, data: unknown) => void;
  onStatus?: (status: RealtimeStatus, detail?: string) => void;
  /** First retry delay; doubles per attempt up to maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
};

type Frame =
  | { type: "ack"; ackId: number; success: boolean; error?: { name: string; message: string } }
  | { type: "message"; from: "group" | "server"; group?: string; dataType?: string; data: unknown }
  | { type: "system"; event: string; message?: string };

export function connectRealtime(opts: RealtimeOptions): { close: () => void } {
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 30000;
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const status = (s: RealtimeStatus, detail?: string) => opts.onStatus?.(s, detail);

  const retry = () => {
    if (closed) return;
    status("reconnecting");
    const delay = Math.min(max, base * 2 ** attempt);
    attempt += 1;
    timer = setTimeout(open, delay);
  };

  async function open() {
    timer = null;
    if (closed) return;
    status(attempt === 0 ? "connecting" : "reconnecting");
    let neg: RealtimeNegotiate;
    try {
      neg = await opts.negotiate();
    } catch (err) {
      if (closed) return;
      status("error", err instanceof Error ? err.message : String(err));
      retry();
      return;
    }
    if (closed) return;
    if (!neg.enabled) {
      status("disabled");
      return;
    }
    const wanted = neg.groups.filter((g) => (opts.groups ? opts.groups(g) : true));
    const pending = new Map<number, string>();
    const sock = new WebSocket(neg.url, SUBPROTOCOL);
    ws = sock;
    sock.onopen = () => {
      wanted.forEach((group, i) => {
        pending.set(i + 1, group);
        sock.send(JSON.stringify({ type: "joinGroup", group, ackId: i + 1 }));
      });
      if (!wanted.length) status("live");
    };
    sock.onmessage = (ev: MessageEvent) => {
      let frame: Frame;
      try {
        frame = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) as Frame;
      } catch {
        return;
      }
      if (frame.type === "ack") {
        const group = pending.get(frame.ackId);
        pending.delete(frame.ackId);
        // "Duplicate" means we were already in the group (a re-sent join): not a failure.
        if (!frame.success && frame.error?.name !== "Duplicate") {
          status("error", `Could not join ${group ?? "group"}: ${frame.error?.name ?? "error"}`);
          return;
        }
        if (pending.size === 0) {
          attempt = 0;
          status("live");
        }
        return;
      }
      if (frame.type === "message" && frame.from === "group" && frame.group) {
        let data = frame.data;
        if (typeof data === "string" && frame.dataType !== "text") {
          try {
            data = JSON.parse(data);
          } catch {
            /* keep the string */
          }
        }
        opts.onMessage(frame.group, data);
      }
    };
    sock.onerror = () => {
      /* onclose follows and decides */
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      if (!closed) retry();
    };
  }

  void open();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const s = ws;
      ws = null;
      if (s && (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING)) s.close();
    },
  };
}
