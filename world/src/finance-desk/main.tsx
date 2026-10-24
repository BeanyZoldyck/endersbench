import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DeskApp from './DeskApp.tsx';
import './desk.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeskApp />
  </StrictMode>
);
