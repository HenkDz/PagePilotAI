import React from 'react';
import ReactDOM from 'react-dom/client';
import SidepanelApp from './SidepanelApp';
import './SidepanelApp.css';

const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <SidepanelApp />
    </React.StrictMode>,
  );
}
