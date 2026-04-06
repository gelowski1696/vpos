import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import 'sileo/styles.css';
import './styles/tailwind.css';
import './styles/theme.css';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
