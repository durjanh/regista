import { Component, Suspense, type ReactNode } from "react";
import { Loading } from "./States";

type State = { failed: boolean };

/** Catches a page that fails to load or render, so the app shows a way back instead of a blank screen. */
class Boundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card state error" role="alert">
        <div className="icon">⚠</div>
        <div className="small">This page didn't load. A new version may have just been published.</div>
        <button className="btn sm primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}

/** A page slot: a spinner while its code loads, and a reload offer if it fails. The top bar stays in place. */
export function PageBoundary({ children }: { children: ReactNode }) {
  return (
    <Boundary>
      <Suspense fallback={<div className="card"><Loading label="Loading page…" /></div>}>{children}</Suspense>
    </Boundary>
  );
}
