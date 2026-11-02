import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../src/features/monitoring/Dashboard';
import { I18nProvider } from '../src/i18n/i18n';

afterEach(() => cleanup());

const camera = {
  cameraId: 'garage-01',
  status: 'capturing',
  streamEpoch: 'epoch-123456789',
  liveUrl: '/api/v1/live/garage-01/index.m3u8',
};

function renderDashboard(
  userRole: 'Viewer' | 'Administrator',
  cameras = [camera],
  selectedCameraId = cameras[0]?.cameraId,
  onCameraSelect = () => {},
) {
  return render(
    <I18nProvider>
      <Dashboard
        cameras={cameras}
        selectedCameraId={selectedCameraId}
        onCameraSelect={onCameraSelect}
        userRole={userRole}
      />
    </I18nProvider>,
  );
}

describe('dashboard navigation', () => {
  it('exposes only monitoring to Viewer', () => {
    renderDashboard('Viewer');
    const menu = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(within(menu).getAllByRole('button')).toHaveLength(2);
    expect(within(menu).getByRole('button', { name: 'Monitoramento' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('region', { name: 'Monitoramento' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproduzir vídeo' })).toBeDisabled();
  });

  it('groups system views under Sistema and management screens under Gestão', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path === '/api/v1/admin/access-rules') return new Response('[]', { status: 200 });
      if (path === '/api/v1/admin/permission-catalog') return new Response('[]', { status: 200 });
      if (path.startsWith('/api/v1/admin/users?page='))
        return new Response(JSON.stringify({ items: [], page: 1, pageSize: 25, totalCount: 0 }), {
          status: 200,
        });
      if (path === '/api/v1/admin/cameras?page=1&pageSize=100')
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (path === '/api/v1/admin/access-requests?page=1&pageSize=25')
        return new Response(JSON.stringify({ items: [], page: 1, pageSize: 25, totalCount: 0 }), {
          status: 200,
        });
      throw new Error(`Unexpected request: ${path}`);
    });
    renderDashboard('Administrator');
    const menu = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(within(menu).getAllByRole('button')).toHaveLength(4);
    const system = within(menu).getByRole('button', { name: 'Sistema' });
    await userEvent.setup().click(system);
    expect(system).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(system).toHaveAttribute('aria-expanded', 'false');
    expect(system).toHaveFocus();
    await userEvent.setup().click(system);
    const healthMenuItem = within(menu).getByRole('button', { name: 'Saúde do sistema' });
    await userEvent.setup().click(healthMenuItem);
    expect(screen.getByRole('region', { name: 'Saúde do sistema' })).toBeInTheDocument();

    const management = within(menu).getByRole('button', { name: 'Gestão' });
    await userEvent.setup().click(management);
    expect(within(menu).getByRole('button', { name: 'Usuários' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Perfis e permissões' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Pessoas' })).toBeInTheDocument();
    await userEvent.setup().click(within(menu).getByRole('button', { name: 'Usuários' }));
    expect(await screen.findByRole('heading', { name: 'Gestão de usuários' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Perfis e permissões' })).not.toBeInTheDocument();

    await userEvent.setup().click(management);
    await userEvent.setup().click(within(menu).getByRole('button', { name: 'Perfis e permissões' }));
    expect(await screen.findByRole('heading', { name: 'Perfis e permissões' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Gestão de usuários' })).not.toBeInTheDocument();

    await userEvent.setup().click(management);
    await userEvent.setup().click(within(menu).getByRole('button', { name: 'Pedidos de acesso' }));
    expect(await screen.findByRole('heading', { name: 'Pedidos de acesso' })).toBeInTheDocument();
  });

  it('presents one camera without adding a redundant selector', () => {
    renderDashboard('Viewer');
    expect(screen.getByText('garage-01')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /garage-01/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproduzir vídeo' })).toBeInTheDocument();
  });

  it('shows per-camera states and selects only one live camera accessibly', async () => {
    const cameras = [
      camera,
      {
        cameraId: 'side-entry',
        status: 'reconnecting',
        streamEpoch: 'epoch-2',
        liveUrl: '/api/v1/live/side-entry/index.m3u8',
      },
    ];
    const onCameraSelect = vi.fn();
    renderDashboard('Viewer', cameras, 'garage-01', onCameraSelect);
    const healthy = screen.getByRole('button', { name: /garage-01/ });
    const degraded = screen.getByRole('button', { name: /side-entry/ });
    expect(healthy).toHaveAttribute('aria-pressed', 'true');
    expect(degraded).toHaveAttribute('aria-pressed', 'false');
    expect(within(degraded).getByRole('status')).toHaveTextContent('Reconectando');
    expect(screen.getAllByLabelText('Vídeo ao vivo da câmera')).toHaveLength(1);

    degraded.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(onCameraSelect).toHaveBeenCalledWith('side-entry');
  });

  it('shows an explicit empty state without creating a player', () => {
    renderDashboard('Viewer', [], undefined);
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma câmera disponível');
    expect(screen.queryByLabelText('Vídeo ao vivo da câmera')).not.toBeInTheDocument();
  });

  it('lets only the administrator edit active camera metadata and apply a local address change', async () => {
    const activeCamera = {
      ...camera,
      cameraId: 'CAM000000000001',
      liveUrl: '/api/v1/live/CAM000000000001/index.m3u8',
    };
    const calls: Array<{ path: string; method: string; body?: string }> = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (path === '/api/v1/admin/cameras?page=1&pageSize=100')
        return new Response(
          JSON.stringify({
            items: [
              {
                cameraId: activeCamera.cameraId,
                contextId: 'CTX000000000001',
                name: 'Garagem',
                isEnabled: true,
                version: 1,
              },
            ],
          }),
          { status: 200 },
        );
      if (path === `/api/v1/admin/cameras/${activeCamera.cameraId}/connection` && method === 'GET')
        return new Response(
          JSON.stringify({
            cameraPublicId: activeCamera.cameraId,
            address: '192.168.0.120',
            isCaptureCamera: true,
          }),
          { status: 200 },
        );
      if (path === `/api/v1/admin/cameras/${activeCamera.cameraId}/connection` && method === 'PUT')
        return new Response(
          JSON.stringify({
            cameraPublicId: activeCamera.cameraId,
            address: 'camera.local',
            isCaptureCamera: true,
          }),
          { status: 200 },
        );
      if (path === `/api/v1/admin/cameras/${activeCamera.cameraId}` && method === 'PUT')
        return new Response(
          JSON.stringify({
            cameraId: activeCamera.cameraId,
            contextId: 'CTX000000000001',
            name: 'Portão',
            isEnabled: true,
            version: 2,
          }),
          { status: 200 },
        );
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderDashboard('Administrator', [activeCamera], activeCamera.cameraId);
    const menu = screen.getByRole('navigation', { name: 'Navegação principal' });
    await userEvent.setup().click(within(menu).getByRole('button', { name: 'Gestão' }));
    await userEvent.setup().click(within(menu).getByRole('button', { name: 'Câmeras' }));
    expect(await screen.findByRole('heading', { name: 'Configuração da câmera' })).toBeInTheDocument();
    expect(screen.getByLabelText('Endereço IPv4 ou hostname local da câmera')).toHaveValue('192.168.0.120');

    await userEvent.setup().clear(screen.getByLabelText('Nome da câmera'));
    await userEvent.setup().type(screen.getByLabelText('Nome da câmera'), 'Portão');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Salvar nome' }));
    expect(await screen.findByText('Nome da câmera salvo.')).toBeInTheDocument();

    await userEvent.setup().clear(screen.getByLabelText('Endereço IPv4 ou hostname local da câmera'));
    await userEvent
      .setup()
      .type(screen.getByLabelText('Endereço IPv4 ou hostname local da câmera'), 'camera.local');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Aplicar endereço' }));
    expect(
      await screen.findByText(
        'Endereço aplicado. O Neolink está reconectando com as credenciais existentes.',
      ),
    ).toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(calls).toContainEqual(
      expect.objectContaining({
        path: `/api/v1/admin/cameras/${activeCamera.cameraId}/connection`,
        method: 'PUT',
        body: JSON.stringify({ expectedAddress: '192.168.0.120', address: 'camera.local' }),
      }),
    );
    expect(calls.some((call) => call.body?.includes('password'))).toBe(false);
  });

  it('loads a chronological clip page and authorized detail/playback on demand', async () => {
    const clip = {
      publicId: 'CLP000000000001',
      cameraId: 'garage-01',
      startedAtUtc: '2026-10-31T10:00:00Z',
      endedAtUtc: '2026-10-31T10:00:30Z',
      state: 'ready',
      archiveStatus: 'not_requested',
      analysisStatus: 'not_requested',
      thumbnailUrl: null,
      sizeBytes: 20,
      triggerReason: 'visual_change:segment',
      triggerConfigVersion: 'trigger-v1',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/v1/clips?'))
        return new Response(JSON.stringify({ items: [clip], page: 1, pageSize: 20, total: 1 }), {
          status: 200,
        });
      if (path === `/api/v1/clips/${clip.publicId}`)
        return new Response(
          JSON.stringify({
            clip,
            mediaUrl: `/api/v1/clips/${clip.publicId}/media`,
            mediaSha256: 'a'.repeat(64),
            thumbnailSha256: null,
            attemptCount: 1,
            updatedAtUtc: clip.endedAtUtc,
          }),
          { status: 200 },
        );
      throw new Error(`Unexpected request: ${path}`);
    });
    renderDashboard('Viewer');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clipes' }));
    expect(await screen.findByText('Linha do tempo de clipes')).toBeInTheDocument();
    expect(await screen.findByText(/garage-01 · Pronto · Não arquivado/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Detalhes e reprodução' }));
    expect(await screen.findByRole('heading', { name: 'Detalhes do clipe' })).toBeInTheDocument();
    expect(screen.getByLabelText('Data inicial (UTC)')).toBeInTheDocument();
    expect(screen.getByLabelText('Data final (UTC)')).toBeInTheDocument();
    expect(screen.getByText('visual_change:segment')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/clips?page=1&pageSize=20&cameraId=garage-01`,
      expect.anything(),
    );
  });
});
