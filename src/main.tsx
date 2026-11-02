import { I18nProvider } from 'home-ia-shared';
import React from 'react';
import ReactDOM from 'react-dom/client';
import 'home-ia-shared/styles.css';
import MonitoringModule from './MonitoringModule';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz do módulo não encontrado.');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <I18nProvider initialLocale="pt-BR">
      <MonitoringModule locale="pt-BR" cameras={[]} onCameraSelect={() => {}} userRole="Viewer" />
    </I18nProvider>
  </React.StrictMode>,
);
