import { Suspense } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AppLayout, MatchLayout } from "./components/Layout";
import { EmptyState, Loading } from "./components/States";
import { PrefsProvider } from "./lib/prefs";
import { lazyPage } from "./lib/lazyPage";
import { Hub } from "./pages/Hub";
import { Matchday } from "./pages/Matchday";

// Secondary surfaces load on demand to keep the fan view fast on mobile.
const Tactics = lazyPage(() => import("./pages/Tactics").then((m) => ({ default: m.Tactics })));
const Ask = lazyPage(() => import("./pages/Ask").then((m) => ({ default: m.Ask })));
const Recap = lazyPage(() => import("./pages/Recap").then((m) => ({ default: m.Recap })));
const Studio = lazyPage(() => import("./pages/Studio").then((m) => ({ default: m.Studio })));
const Overlay = lazyPage(() => import("./pages/Overlay").then((m) => ({ default: m.Overlay })));
const Forge = lazyPage(() => import("./pages/Forge").then((m) => ({ default: m.Forge })));
const TeamDNA = lazyPage(() => import("./pages/TeamDNA").then((m) => ({ default: m.TeamDNA })));
const Dugout = lazyPage(() => import("./pages/Dugout").then((m) => ({ default: m.Dugout })));
const Scouting = lazyPage(() => import("./pages/Scouting").then((m) => ({ default: m.Scouting })));
const PlayerDNA = lazyPage(() => import("./pages/PlayerDNA").then((m) => ({ default: m.PlayerDNA })));
const TeamReport = lazyPage(() => import("./pages/TeamReport").then((m) => ({ default: m.TeamReport })));
const Ops = lazyPage(() => import("./pages/Ops").then((m) => ({ default: m.Ops })));
const AutoEvent = lazyPage(() => import("./pages/AutoEvent").then((m) => ({ default: m.AutoEvent })));
const Favourites = lazyPage(() => import("./pages/Favourites").then((m) => ({ default: m.Favourites })));

function NotFound() {
  return (
    <div className="card">
      <EmptyState icon="🧭">
        That page is off the pitch. <Link to="/" className="status-pass">Back to fixtures</Link>
      </EmptyState>
    </div>
  );
}

// Only the overlay route waits here; app pages load inside the layout (components/PageBoundary).
const fallback = <Loading />;

export function App() {
  return (
    <PrefsProvider>
      <BrowserRouter>
        <Suspense fallback={fallback}>
          <Routes>
            <Route path="/overlay/:id" element={<Overlay />} />
            <Route element={<AppLayout />}>
              <Route index element={<Hub />} />
              <Route path="forge" element={<Forge />} />
              <Route path="team/:teamId" element={<TeamDNA />} />
              <Route path="scouting" element={<Scouting />} />
              <Route path="scouting/player/:key" element={<PlayerDNA />} />
              <Route path="scouting/team/:teamId" element={<TeamReport />} />
              <Route path="studio/:id" element={<Studio />} />
              <Route path="ops" element={<Ops />} />
              <Route path="favourites" element={<Favourites />} />
              <Route path="match/:id" element={<MatchLayout />}>
                <Route index element={<Matchday />} />
                <Route path="tactics" element={<Tactics />} />
                <Route path="ask" element={<Ask />} />
                <Route path="recap" element={<Recap />} />
                <Route path="dugout" element={<Dugout />} />
                <Route path="video" element={<AutoEvent />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </PrefsProvider>
  );
}
