import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureSettingsPanel } from '../src/features/operations/CaptureSettingsPanel';

function response(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const snapshot = {
  schemaVersion: '1.0',
  profile: 'ffmpeg-rtsp',
  cameraId: 'garage-01',
  enabled: true,
  segmentSeconds: 5,
  maximumSegments: 120,
  maximumSegmentBytes: 67_108_864,
  revision: 2,
  state: 'capturing',
  adapter: 'ffmpeg-rtsp-h264',
  lastErrorCode: null,
  gaps: 0,
  segments: 12,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('capture settings', () => {
  it('loads and applies non-secret capture limits in megabytes', async () => {
    const requests: Array<{ method: string; body?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? String(init.body) : undefined;
      requests.push({ method, body });
      if (method === 'GET') return response(snapshot);
      if (method === 'PUT')
        return response({
          enabled: true,
          segmentSeconds: 3,
          maximumSegments: 60,
          maximumSegmentBytes: 33_554_432,
          revision: 3,
        });
      throw new Error(`Unexpected request: ${method} ${String(input)}`);
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <CaptureSettingsPanel />
      </I18nProvider>,
    );

    expect(await screen.findByText('Parâmetros em runtime')).toBeInTheDocument();
    expect(screen.getByText('ffmpeg-rtsp')).toBeInTheDocument();
    expect(screen.getByText('capturing')).toBeInTheDocument();

    const seconds = screen.getByLabelText('Duração do segmento (segundos)');
    const segments = screen.getByLabelText('Máximo de segmentos retidos');
    const megabytes = screen.getByLabelText('Tamanho máximo do segmento (MB)');
    await user.clear(seconds);
    await user.type(seconds, '3');
    await user.clear(segments);
    await user.type(segments, '60');
    await user.clear(megabytes);
    await user.type(megabytes, '32');
    await user.click(screen.getByRole('button', { name: 'Aplicar configuração' }));

    expect(await screen.findByText(/Configuração aplicada/)).toBeInTheDocument();
    const put = requests.find((entry) => entry.method === 'PUT');
    expect(put?.body).toBeDefined();
    expect(JSON.parse(put?.body ?? '')).toEqual({
      enabled: true,
      segmentSeconds: 3,
      maximumSegments: 60,
      maximumSegmentBytes: 33_554_432,
    });
  });

  it('explains that runtime settings require the remote monitoring mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({ code: 'monitoring_capture_remote_only' }, 409),
    );
    render(
      <I18nProvider>
        <CaptureSettingsPanel />
      </I18nProvider>,
    );
    expect(
      await screen.findByText(/disponível apenas quando o portal usa o serviço de Monitoramento remoto/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Aplicar configuração' })).not.toBeInTheDocument(),
    );
  });
});
