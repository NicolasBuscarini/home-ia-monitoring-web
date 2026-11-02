import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import MonitoringModule from '../src/MonitoringModule';

afterEach(() => cleanup());

describe('monitoring remote module', () => {
  it('renders the dashboard with the camera collection provided by the shell', () => {
    render(
      <MonitoringModule
        locale="pt-BR"
        cameras={[
          {
            cameraId: 'garage-01',
            status: 'capturing',
            streamEpoch: 'epoch-1',
            liveUrl: '/api/v1/live/garage-01/index.m3u8',
          },
        ]}
        selectedCameraId="garage-01"
        onCameraSelect={() => {}}
        userRole="Viewer"
        portalModuleIds={['monitoring']}
      />,
    );

    expect(screen.getByText('garage-01')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
  });

  it('renders the empty state without cameras', () => {
    render(<MonitoringModule locale="pt-BR" cameras={[]} onCameraSelect={() => {}} userRole="Viewer" />);

    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma câmera disponível');
  });
});
