import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOADED = "regista.reloadedForNewBuild";

/**
 * React.lazy for a page, made safe across deploys. Each deploy renames the page bundles, so a tab opened before it
 * asks for files that no longer exist: instead of a blank page, reload once to pick up the new build. A second
 * failure is thrown to the page error boundary, which offers a reload.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any page or component, whatever its props
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(() =>
    load()
      .then((m) => {
        try {
          sessionStorage.removeItem(RELOADED);
        } catch {
          /* storage unavailable */
        }
        return m;
      })
      .catch((err: unknown) => {
        let reloaded = false;
        try {
          reloaded = sessionStorage.getItem(RELOADED) === "1";
          if (!reloaded) sessionStorage.setItem(RELOADED, "1");
        } catch {
          /* storage unavailable: don't risk a reload loop */
          reloaded = true;
        }
        if (!reloaded) {
          window.location.reload();
          return new Promise<{ default: T }>(() => {});                 // the reload replaces the page
        }
        throw err;
      }),
  );
}
