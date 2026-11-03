import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, describe, expect, it } from 'vitest';
import MonitoringModule, { type MonitoringModuleProps } from '../src/MonitoringModule';

afterEach(() => cleanup());

function renderModule(props: MonitoringModuleProps) {
  return render(
    <I18nProvider initialLocale="pt-BR">
      <MonitoringModule {...props} />
    </I18nProvider>,
  );
}

describe('monitoring remote module', () => {
  it('renders the dashboard with the camera collection provided by the shell', () => {
    renderModule({
      locale: 'pt-BR',
      cameras: [
        {
          cameraId: 'garage-01',
          status: 'capturing',
          streamEpoch: 'epoch-1',
          liveUrl: '/api/v1/live/garage-01/index.m3u8',
        },
      ],
      selectedCameraId: 'garage-01',
      onCameraSelect: () => {},
      userRole: 'Viewer',
      portalModuleIds: ['monitoring'],
    });

    expect(screen.getByText('garage-01')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Seções de monitoramento' })).toBeInTheDocument();
  });

  it('renders the empty state without cameras', () => {
    renderModule({
      locale: 'pt-BR',
      cameras: [],
      onCameraSelect: () => {},
      userRole: 'Viewer',
    });

    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma câmera disponível');
  });
});
