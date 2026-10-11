import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";

const AdminPage = lazy(() => import("./pages/AdminPage.js"));
const DisplayPage = lazy(() => import("./pages/DisplayPage.js"));
const ModeratorPage = lazy(() => import("./pages/ModeratorPage.js"));

function Home() {
  return (
    <main className="home-shell">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="RallyFML inicio">
          <span className="brand-star">✦</span> RallyFML
        </Link>
        <span className="brand-note">FML · Lasallistas en misión</span>
      </header>
      <section className="hero-card">
        <div className="hero-shade" />
        <div className="hero-content">
          <p className="eyebrow">Juntos hacemos camino</p>
          <h1>
            Un rally.
            <br />
            Muchas formas de participar.
          </h1>
          <p className="hero-copy">
            Coordina estaciones, acompaña a los equipos y celebra cada logro.
          </p>
          <nav className="home-actions" aria-label="Accesos">
            <Link className="button button-primary" to="/admin">
              Administración
            </Link>
            <Link className="button button-light" to="/station">
              Panel de estación
            </Link>
          </nav>
        </div>
      </section>
      <footer className="home-footer">
        <span>RallyFML</span>
        <span>Una experiencia de comunidad y encuentro</span>
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/admin"
        element={
          <Suspense fallback={<RouteLoading />}>
            <AdminPage />
          </Suspense>
        }
      />
      <Route
        path="/station"
        element={
          <Suspense fallback={<RouteLoading />}>
            <ModeratorPage />
          </Suspense>
        }
      />
      <Route
        path="/display/:gameId"
        element={
          <Suspense fallback={<RouteLoading />}>
            <DisplayPage />
          </Suspense>
        }
      />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

function RouteLoading() {
  return (
    <main className="page-shell">
      <p className="muted">Cargando…</p>
    </main>
  );
}
