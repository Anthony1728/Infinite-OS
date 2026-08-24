import React from 'react';
import ReactDOM from 'react-dom/client';
import { MiniBar } from './components/mini/MiniBar';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MiniBar />
  </React.StrictMode>,
);
