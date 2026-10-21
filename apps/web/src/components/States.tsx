import type { CSSProperties, ReactNode } from "react";
import { usePrefs } from "../lib/prefs";

export function Skeleton({ h = 16, w = "100%", style }: { h?: number | string; w?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 3, h = 120 }: { lines?: number; h?: number }) {
  return (
    <div className="card stack" aria-busy="true">
      <Skeleton h={12} w="35%" />
      <Skeleton h={h} />
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
