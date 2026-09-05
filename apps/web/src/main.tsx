import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const conteneur = document.getElementById('root');
if (conteneur === null) {
  throw new Error('Élément #root introuvable dans index.html.');
}

createRoot(conteneur).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
