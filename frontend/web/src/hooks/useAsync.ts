import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

/** Runs `fn` whenever `deps` change; ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const callId = useRef(0);

  useEffect(() => {
    const id = ++callId.current;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (id === callId.current) setData(d);
      })
      .catch((e: unknown) => {
        if (id === callId.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (id === callId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
