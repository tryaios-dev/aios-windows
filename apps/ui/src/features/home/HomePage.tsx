import { inElectron, useHealth } from "../../bridge";

const DB_LABEL = { ok: "Encrypted, ready", locked: "Locked (key missing)", error: "Error" } as const;

export function HomePage() {
  const health = useHealth();
  const electron = inElectron();

  const status = health.isPending
    ? { label: "Connecting...", tone: "wait" }
    : health.isError
      ? { label: "Backend not reachable", tone: "bad" }
      : health.data.backend === "ok"
        ? { label: "Backend connected", tone: "ok" }
        : { label: "Browser preview (no backend)", tone: "wait" };

  return (
    <main className="home">
      <header>
        <h1>AIOS</h1>
        <p className="muted">Local AI assistant for Windows</p>
      </header>

      <section className="card" aria-label="Status">
        <div className="row">
          <span className={`dot ${status.tone}`} aria-hidden />
          <strong>{status.label}</strong>
        </div>
        <dl>
          <dt>Shell</dt>
          <dd>{electron ? "Electron" : "Browser (window.aios not available)"}</dd>
          <dt>Database</dt>
          <dd>{!electron ? "-" : health.data ? DB_LABEL[health.data.database] : "-"}</dd>
          <dt>Backend version</dt>
          <dd>{health.data?.version ?? "-"}</dd>
        </dl>
      </section>
    </main>
  );
}
