import React from 'react';
import ReactDOM from 'react-dom/client';
import MonitoringModule from './MonitoringModule';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz do módulo não encontrado.');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <MonitoringModule locale="pt-BR" cameras={[]} onCameraSelect={() => {}} userRole="Viewer" />
  </React.StrictMode>,
);
