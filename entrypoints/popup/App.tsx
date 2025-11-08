import './App.css';
import { runtimeEnv } from '../../src/shared/env';

const App = () => {
  return (
    <main className="app">
      <header className="header">
        <h1>PagePilot AI</h1>
        <p className="subtitle">Customize any webpage with AI-guided scripts.</p>
      </header>

      <section className="card">
        <h2>Today&apos;s goals</h2>
        <ul>
          <li>Capture DOM elements and preview selectors.</li>
          <li>Iterate with AI-generated JavaScript safely.</li>
          <li>Persist trusted rules in IndexedDB.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Getting started</h2>
        <p>
          Review <code>docs/detailed-plan.md</code> for the current phase, then
          open the element capture tools via the toolbar button.
        </p>
      </section>

      <footer className="footer">
        <span>Mode: {runtimeEnv.mode}</span>
        <a
          href="https://github.com/your-org/pagepilot-ai"
          target="_blank"
          rel="noreferrer"
        >
          Repo
        </a>
      </footer>
    </main>
  );
};

export default App;
