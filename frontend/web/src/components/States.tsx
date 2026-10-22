import type { CSSProperties, ReactNode } from "react";
import { usePrefs } from "../lib/prefs";

export function Spinner({ size }: { size?: "sm" | "lg" }) {
  return <span className={size ? `spinner ${size}` : "spinner"} aria-hidden="true" />;
}

/** Spinner plus "Loading…": what a user sees in an area whose data is on its way from the API. */
export function Loading({ label }: { label?: string }) {
  const { t } = usePrefs();
  return (
    <div className="loading-line" role="status">
      <Spinner /> <span>{label ?? t("loading")}</span>
    </div>
  );
}

/** Placeholder block. Blocks 60px or taller (charts, panels) carry a spinner so the area visibly works. */
export function Skeleton({ h = 16, w = "100%", style, spinner }: { h?: number | string; w?: number | string; style?: CSSProperties; spinner?: boolean }) {
  const withSpinner = spinner ?? (typeof h !== "number" || h >= 60);
  return (
    <div className={withSpinner ? "skeleton with-spinner" : "skeleton"} style={{ height: h, width: w, ...style }} aria-hidden="true">
      {withSpinner ? <Spinner size="lg" /> : null}
    </div>
  );
}

export function SkeletonCard({ lines = 3, h = 120 }: { lines?: number; h?: number }) {
  return (
    <div className="card stack" aria-busy="true">
      <Loading />
      <Skeleton h={h} spinner={false} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={10} w={`${90 - i * 15}%`} />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  const { t } = usePrefs();
  return (
    <div className="state error" role="alert">
      <div className="icon">⚠</div>
      <div>
        <strong>{t("error.generic")}</strong>
        {message ? <div className="small faint">{message}</div> : null}
      </div>
      {onRetry ? (
        <button className="btn sm" onClick={onRetry}>
          {t("retry")}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ icon = "◌", children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="state">
      <div className="icon" aria-hidden="true">
        {icon}
      </div>
      <div className="small">{children}</div>
    </div>
  );
}
