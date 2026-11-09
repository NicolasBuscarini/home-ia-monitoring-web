import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, expect, it, vi } from 'vitest';
import { ClipsPanel } from '../src/features/clips/ClipsPanel';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

it('renders timeline thumbnails in the bounded thumbnail style', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    json({
      items: [
        {
          publicId: 'CLP000000000001',
          cameraId: 'CAM000000000001',
          startedAtUtc: '2026-10-31T00:00:00Z',
          endedAtUtc: '2026-10-31T00:00:10Z',
          state: 'ready',
          archiveStatus: 'not_requested',
          analysisStatus: 'completed',
          thumbnailUrl: '/api/v1/clips/CLP000000000001/thumbnail',
          sizeBytes: 1024,
          triggerReason: null,
          triggerConfigVersion: null,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    }),
  );

  const { container } = render(
    <I18nProvider>
      <ClipsPanel />
    </I18nProvider>,
  );

  await screen.findByRole('button', { name: /Detalhes e reprodução/ });
  const thumbnail = container.querySelector('img.clip-thumbnail');
  expect(thumbnail).not.toBeNull();
  if (!thumbnail) throw new Error('Clip thumbnail was not rendered');
  expect(thumbnail).toHaveAttribute('src', '/api/v1/clips/CLP000000000001/thumbnail');
  expect(thumbnail).toHaveClass('clip-thumbnail');
  expect(thumbnail?.parentElement).toHaveClass('clip-card-media');
  expect(screen.getByText(/Concluída/)).toBeInTheDocument();
});

it('retries a transient clips list failure before showing the load error', async () => {
  let attempts = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    if (path.startsWith('/api/v1/clips?')) {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return json({
        items: [
          {
            publicId: 'CLP000000000042',
            cameraId: 'CAM000000000001',
            startedAtUtc: '2026-10-31T00:00:00Z',
            endedAtUtc: '2026-10-31T00:00:10Z',
            state: 'ready',
            archiveStatus: 'not_requested',
            analysisStatus: 'not_requested',
            thumbnailUrl: null,
            sizeBytes: 1024,
            triggerReason: null,
            triggerConfigVersion: null,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    }
    if (path.startsWith('/api/v1/admin/cameras')) return json({ items: [] });
    if (path.startsWith('/api/v1/cameras')) return json({ items: [] });
    return json({});
  });

  render(
    <I18nProvider>
      <ClipsPanel />
    </I18nProvider>,
  );

  await screen.findByRole('button', { name: /Detalhes e reprodução/ }, { timeout: 3000 });
  expect(attempts).toBe(2);
  expect(screen.queryByText(/Não foi possível carregar os clipes/)).not.toBeInTheDocument();
});

it('lets an administrator configure the selected per-camera trigger with versioned API updates', async () => {
  let enabled = false;
  let version = 0;
  const requests: Array<{ path: string; method: string; body?: string }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ path, method, body: init?.body ? String(init.body) : undefined });
    if (path.startsWith('/api/v1/clips?')) return json({ items: [], page: 1, pageSize: 20, total: 0 });
    if (path.startsWith('/api/v1/admin/cameras?'))
      return json({ items: [{ cameraId: 'CAM000000000001', name: 'Garage', isEnabled: true }] });
    if (path === '/api/v1/admin/cameras/CAM000000000001/clip-trigger' && method === 'GET')
      return json({ cameraId: 'CAM000000000001', enabled, version, updatedAtUtc: '2026-10-31T00:00:00Z' });
    if (path === '/api/v1/admin/cameras/CAM000000000001/clip-retention' && method === 'GET')
      return json({
        cameraId: 'CAM000000000001',
        retentionDays: 15,
        maximumStorageGigabytes: null,
        version: 0,
      });
    if (path === '/api/v1/admin/cameras/CAM000000000001/clip-trigger' && method === 'PUT') {
      const body = JSON.parse(String(init?.body));
      expect(body.expectedVersion).toBe(version);
      enabled = body.enabled;
      version++;
      return json({ cameraId: 'CAM000000000001', enabled, version, updatedAtUtc: '2026-10-31T00:01:00Z' });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  const user = userEvent.setup();
  render(
    <I18nProvider>
      <ClipsPanel isAdmin view="settings" />
    </I18nProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Ativar gatilho' }));
  expect(
    await screen.findByText('Geração automática de clipes ativada para esta câmera.'),
  ).toBeInTheDocument();
  expect(requests.some((item) => item.method === 'PUT' && item.path.endsWith('/clip-trigger'))).toBe(true);
  expect(requests.find((item) => item.method === 'PUT')?.body).toBe(
    JSON.stringify({ expectedVersion: 0, enabled: true }),
  );
});

it('does not request or expose trigger configuration for non-administrators', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    if (path.startsWith('/api/v1/clips?')) return json({ items: [], page: 1, pageSize: 20, total: 0 });
    throw new Error(`Unexpected request: ${path}`);
  });
  render(
    <I18nProvider>
      <ClipsPanel />
    </I18nProvider>,
  );
  expect(await screen.findByText('Nenhum clipe corresponde aos filtros.')).toBeInTheDocument();
  expect(screen.queryByText('Geração automática de clipes')).not.toBeInTheDocument();
});

it('keeps the clip library and the administrator settings as separate submodules', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    if (path.startsWith('/api/v1/clips?')) return json({ items: [], page: 1, pageSize: 20, total: 0 });
    if (path.startsWith('/api/v1/admin/cameras?'))
      return json({ items: [{ cameraId: 'CAM000000000001', name: 'Garage', isEnabled: true }] });
    if (path.endsWith('/clip-trigger'))
      return json({ cameraId: 'CAM000000000001', enabled: false, version: 0, updatedAtUtc: null });
    if (path.endsWith('/clip-retention'))
      return json({
        cameraId: 'CAM000000000001',
        retentionDays: 15,
        maximumStorageGigabytes: null,
        version: 0,
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  const view = render(
    <I18nProvider>
      <ClipsPanel isAdmin />
    </I18nProvider>,
  );
  expect(await screen.findByText('Nenhum clipe corresponde aos filtros.')).toBeInTheDocument();
  expect(screen.queryByText('Geração automática de clipes')).not.toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  view.rerender(
    <I18nProvider>
      <ClipsPanel isAdmin view="settings" />
    </I18nProvider>,
  );
  expect(await screen.findByText('Geração automática de clipes')).toBeInTheDocument();
});

it('saves per-camera retention settings and preserves a clip through versioned administrator actions', async () => {
  const clip = {
    publicId: 'CLP000000000001',
    cameraId: 'CAM000000000001',
    startedAtUtc: '2026-10-01T00:00:00Z',
    endedAtUtc: '2026-10-01T00:00:10Z',
    state: 'ready',
    archiveStatus: 'archived',
    analysisStatus: 'not_requested',
    thumbnailUrl: null,
    sizeBytes: 1200,
    triggerReason: null,
    triggerConfigVersion: null,
    isPreserved: false,
    preservationVersion: 0,
  };
  let retentionVersion = 0;
  let preserved = false;
  const requests: Array<{ path: string; method: string; body?: string }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ path, method, body: init?.body ? String(init.body) : undefined });
    if (path.startsWith('/api/v1/clips?')) return json({ items: [clip], page: 1, pageSize: 20, total: 1 });
    if (path.startsWith('/api/v1/admin/cameras?'))
      return json({ items: [{ cameraId: clip.cameraId, name: 'Garage', isEnabled: true }] });
    if (path.endsWith('/clip-trigger'))
      return json({ cameraId: clip.cameraId, enabled: false, version: 0, updatedAtUtc: null });
    if (path.endsWith('/clip-retention') && method === 'GET')
      return json({
        cameraId: clip.cameraId,
        retentionDays: 15,
        maximumStorageGigabytes: null,
        version: retentionVersion,
      });
    if (path.endsWith('/clip-retention') && method === 'PUT') {
      const body = JSON.parse(String(init?.body));
      expect(body.expectedVersion).toBe(retentionVersion);
      retentionVersion++;
      return json({
        cameraId: clip.cameraId,
        retentionDays: body.retentionDays,
        maximumStorageGigabytes: body.maximumStorageGigabytes,
        version: retentionVersion,
      });
    }
    if (path.endsWith('/preservation') && method === 'PUT') {
      const body = JSON.parse(String(init?.body));
      expect(body.expectedVersion).toBe(clip.preservationVersion);
      preserved = body.isPreserved;
      clip.isPreserved = preserved;
      clip.preservationVersion++;
      return json({ clipPublicId: clip.publicId, isPreserved: preserved, version: clip.preservationVersion });
    }
    if (path === `/api/v1/clips/${clip.publicId}` && method === 'GET')
      return json({
        clip,
        mediaUrl: null,
        mediaSha256: null,
        thumbnailSha256: null,
        attemptCount: 0,
        updatedAtUtc: '2026-10-01T00:00:10Z',
      });
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  const user = userEvent.setup();
  const view = render(
    <I18nProvider>
      <ClipsPanel isAdmin view="settings" />
    </I18nProvider>,
  );
  await user.clear(await screen.findByLabelText('Retenção (dias)'));
  await user.type(screen.getByLabelText('Retenção (dias)'), '30');
  await user.type(screen.getByLabelText('Limite do arquivo (GB)'), '50');
  await user.click(screen.getByRole('button', { name: 'Salvar limites' }));
  expect(await screen.findByText('Configurações de retenção salvas.')).toBeInTheDocument();
  view.rerender(
    <I18nProvider>
      <ClipsPanel isAdmin />
    </I18nProvider>,
  );
  await user.click(await screen.findByRole('button', { name: /Detalhes e reprodução/ }));
  await user.click(await screen.findByRole('button', { name: 'Preservar clipe' }));
  expect((await screen.findAllByText('Preservado')).length).toBeGreaterThan(0);
  expect(requests.some((item) => item.method === 'PUT' && item.path.endsWith('/clip-retention'))).toBe(true);
  expect(requests.some((item) => item.method === 'PUT' && item.path.endsWith('/preservation'))).toBe(true);
  expect(preserved).toBe(true);
});

it('saves the clip analysis policy in clip rules and submits analysis from the clip detail', async () => {
  const clip = {
    publicId: 'CLP000000000001',
    cameraId: 'CAM000000000001',
    startedAtUtc: '2026-10-31T00:00:00Z',
    endedAtUtc: '2026-10-31T00:00:10Z',
    state: 'ready',
    archiveStatus: 'not_requested',
    analysisStatus: 'not_requested',
    thumbnailUrl: null,
    sizeBytes: 1024,
    triggerReason: null,
    triggerConfigVersion: null,
  };
  let policy = 'manual_only';
  let version = 0;
  const requests: Array<{ path: string; method: string; body?: string }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ path, method, body: init?.body ? String(init.body) : undefined });
    if (path.startsWith('/api/v1/clips?')) return json({ items: [clip], page: 1, pageSize: 20, total: 1 });
    if (path === '/api/v1/cameras/CAM000000000001/clip-analysis-dispatch-policy' && method === 'GET')
      return json({
        cameraId: clip.cameraId,
        contextId: 'CTX000000000001',
        policy,
        version,
        updatedAtUtc: null,
        canRequest: true,
        canManage: true,
      });
    if (path === '/api/v1/cameras/CAM000000000001/clip-analysis-dispatch-policy' && method === 'PUT') {
      const body = JSON.parse(String(init?.body));
      expect(body.expectedVersion).toBe(version);
      policy = body.policy;
      version++;
      return json({
        cameraId: clip.cameraId,
        contextId: 'CTX000000000001',
        policy,
        version,
        updatedAtUtc: null,
      });
    }
    if (path === '/api/v1/clips/delete' && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      return json({ deleted: body.clipIds, failed: [] });
    }
    if (path === `/api/v1/clips/${clip.publicId}/analysis-requests` && method === 'POST')
      return json(
        {
          publicId: 'JOB000000000001',
          clipPublicId: clip.publicId,
          analysisVersion: 'default',
          state: 'analysis_pending',
          existing: false,
        },
        202,
      );
    if (path === `/api/v1/clips/${clip.publicId}` && method === 'GET')
      return json({
        clip,
        mediaUrl: null,
        mediaSha256: null,
        thumbnailSha256: null,
        attemptCount: 0,
        updatedAtUtc: '2026-10-31T00:00:10Z',
      });
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  const user = userEvent.setup();
  const view = render(
    <I18nProvider>
      <ClipsPanel cameraId={clip.cameraId} view="settings" />
    </I18nProvider>,
  );
  await user.selectOptions(await screen.findByLabelText('Política'), 'always');
  await user.click(screen.getByRole('button', { name: 'Salvar política' }));
  expect(await screen.findByText('Política da câmera salva.')).toBeInTheDocument();
  view.rerender(
    <I18nProvider>
      <ClipsPanel cameraId={clip.cameraId} isAdmin />
    </I18nProvider>,
  );
  await user.click(await screen.findByRole('button', { name: /Detalhes e reprodução/ }));
  expect(screen.queryByLabelText('Política')).not.toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: 'Enviar para análise' }));
  expect(await screen.findByText('Solicitação de análise enviada.')).toBeInTheDocument();
  expect(
    requests.some(
      (item) => item.method === 'POST' && item.path.endsWith(`/${clip.publicId}/analysis-requests`),
    ),
  ).toBe(true);
  const postBody = JSON.parse(requests.find((item) => item.method === 'POST')?.body ?? '{}');
  expect(postBody.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  await user.click(screen.getByRole('button', { name: 'Excluir clipe' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar exclusão' }));
  expect(await screen.findByText('1 clipe(s) excluído(s).')).toBeInTheDocument();
  expect(
    requests.some(
      (item) =>
        item.method === 'POST' &&
        item.path === '/api/v1/clips/delete' &&
        JSON.parse(item.body ?? '{}').clipIds[0] === clip.publicId,
    ),
  ).toBe(true);
});

it('lets only an administrator delete every eligible clip including unloaded ones', async () => {
  const requests: Array<{ path: string; method: string }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ path, method });
    if (path.startsWith('/api/v1/clips?')) return json({ items: [], page: 1, pageSize: 20, total: 0 });
    if (path === '/api/v1/clips/delete-all' && method === 'POST')
      return json({
        deleted: 12,
        skippedPreserved: 2,
        skippedArchived: 1,
        skippedNotReady: 3,
        skippedActiveAnalysis: 4,
        failed: 0,
      });
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  const user = userEvent.setup();
  const view = render(
    <I18nProvider>
      <ClipsPanel isAdmin />
    </I18nProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Excluir todos os clipes' }));
  expect(
    screen.getByText(/Excluir todos os clipes elegíveis, inclusive os que não estão carregados/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Confirmar exclusão' }));

  expect(
    await screen.findByText(
      '12 excluído(s); 10 mantido(s) (preservados: 2, arquivados: 1, incompletos: 3, em análise: 4); 0 falha(s).',
    ),
  ).toBeInTheDocument();
  expect(requests.some((item) => item.method === 'POST' && item.path === '/api/v1/clips/delete-all')).toBe(
    true,
  );

  view.rerender(
    <I18nProvider>
      <ClipsPanel />
    </I18nProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Excluir todos os clipes' })).not.toBeInTheDocument();
});

it('reports an unplayable clip and offers a retry instead of failing silently', async () => {
  const clip = {
    publicId: 'CLP000000000002',
    cameraId: 'CAM000000000001',
    startedAtUtc: '2026-10-01T00:00:00Z',
    endedAtUtc: '2026-10-01T00:00:10Z',
    state: 'ready',
    archiveStatus: 'archived',
    analysisStatus: 'not_requested',
    thumbnailUrl: null,
    sizeBytes: 2048,
    triggerReason: null,
    triggerConfigVersion: null,
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    if (path.startsWith('/api/v1/clips?')) return json({ items: [clip], page: 1, pageSize: 20, total: 1 });
    if (path === `/api/v1/clips/${clip.publicId}`)
      return json({
        clip,
        mediaUrl: `/api/v1/clips/${clip.publicId}/media`,
        mediaSha256: 'a'.repeat(64),
        thumbnailSha256: null,
        attemptCount: 1,
        updatedAtUtc: '2026-10-01T00:00:10Z',
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(
    <I18nProvider>
      <ClipsPanel />
    </I18nProvider>,
  );

  await user.click(await screen.findByRole('button', { name: /Detalhes e reprodução/ }));
  const video = await screen.findByText('Seu navegador não consegue reproduzir este formato de vídeo.');
  expect(screen.queryByText(/Não foi possível reproduzir o clipe/)).not.toBeInTheDocument();

  fireEvent.error(video);
  expect(await screen.findByText(/Não foi possível reproduzir o clipe/)).toBeInTheDocument();
  const before = document.querySelector('video');
  await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(screen.queryByText(/Não foi possível reproduzir o clipe/)).not.toBeInTheDocument();
  expect(document.querySelector('video')).not.toBe(before);
});

it('opens the clip selected by the deep link, copies the canonical link and clears it on close', async () => {
  const clip = {
    publicId: 'CLP000000000009',
    cameraId: 'CAM000000000001',
    startedAtUtc: '2026-10-01T00:00:00Z',
    endedAtUtc: '2026-10-01T00:00:10Z',
    state: 'ready',
    archiveStatus: 'archived',
    analysisStatus: 'not_requested',
    thumbnailUrl: null,
    sizeBytes: 2048,
    triggerReason: null,
    triggerConfigVersion: null,
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    if (path.startsWith('/api/v1/clips?')) return json({ items: [clip], page: 1, pageSize: 20, total: 1 });
    if (path === `/api/v1/clips/${clip.publicId}`)
      return json({
        clip,
        mediaUrl: null,
        mediaSha256: null,
        thumbnailSha256: null,
        attemptCount: 0,
        updatedAtUtc: '2026-10-01T00:00:10Z',
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const onDeepLinkParamsChange = vi.fn();

  render(
    <I18nProvider>
      <ClipsPanel deepLinkParams={{ clip: clip.publicId }} onDeepLinkParamsChange={onDeepLinkParamsChange} />
    </I18nProvider>,
  );

  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Copiar link' }));
  expect(writeText).toHaveBeenCalledWith(
    `${window.location.origin}/?module=monitoring&view=clips&clip=${clip.publicId}`,
  );
  expect(await screen.findByText('Link copiado')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
  expect(onDeepLinkParamsChange).toHaveBeenLastCalledWith({});
});
it('starts with advanced filters collapsed on mobile and exposes the active count', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: true,
      media: '(max-width: 767.98px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [], page: 1, pageSize: 20, total: 0 }));
  const user = userEvent.setup();
  render(
    <I18nProvider>
      <ClipsPanel />
    </I18nProvider>,
  );

  const toggle = await screen.findByRole('button', { name: /Filtros avançados/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(document.getElementById('clips-advanced-filters')).toHaveAttribute('data-collapsed', 'true');
  expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument();

  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById('clips-advanced-filters')).toHaveAttribute('data-collapsed', 'false');
  await user.type(screen.getByLabelText('ID público'), 'CLP000000000001');
  await user.click(toggle);
  expect(document.getElementById('clips-advanced-filters')).toHaveAttribute('data-collapsed', 'true');
  expect(within(toggle).getByText('1')).toBeInTheDocument();
});

it('filters clips, loads more without pagination and downloads a selection', async () => {
  const clip = (publicId: string, startedAtUtc: string) => ({
    publicId,
    cameraId: 'CAM000000000001',
    startedAtUtc,
    endedAtUtc: startedAtUtc,
    state: 'ready',
    archiveStatus: 'archived',
    analysisStatus: 'not_requested',
    thumbnailUrl: null,
    sizeBytes: 1024,
    triggerReason: null,
    triggerConfigVersion: null,
    isPreserved: false,
    preservationVersion: 0,
  });
  const queries: string[] = [];
  const downloadRequests: string[] = [];
  const eventBodies: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === '/api/v1/events') {
      eventBodies.push(String(init?.body ?? ''));
      return new Response(null, { status: 201 });
    }
    if (path.startsWith('/api/v1/clips/download?')) {
      downloadRequests.push(path);
      return new Response(new Blob(['zip']), { status: 200 });
    }
    if (path.includes('/clip-analysis-dispatch-policy')) {
      return new Response('{}', { status: 503 });
    }
    if (path.startsWith('/api/v1/clips?')) {
      queries.push(path);
      const page = new URL(path, 'http://localhost').searchParams.get('page');
      return json({
        items:
          page === '2'
            ? [clip('CLP000000000003', '2026-10-30T00:00:00Z')]
            : [
                clip('CLP000000000001', '2026-10-31T00:00:00Z'),
                clip('CLP000000000002', '2026-10-31T00:01:00Z'),
              ],
        page: Number(page),
        pageSize: 2,
        total: 3,
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:clips') });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const user = userEvent.setup();
  render(
    <I18nProvider>
      <ClipsPanel />
    </I18nProvider>,
  );
  await screen.findByText(/CLP000000000001/);
  expect(screen.getAllByRole('link', { name: /Baixar clipe/ })[0]).toHaveAttribute(
    'href',
    '/api/v1/clips/CLP000000000001/media?download=true',
  );

  await user.type(screen.getByLabelText('ID público'), 'clp000000000001');
  await user.selectOptions(screen.getByLabelText('Análise'), 'performed');
  await user.selectOptions(screen.getByLabelText('Ordenar por'), 'longest');
  await user.selectOptions(screen.getByLabelText('Preservação'), 'true');
  await user.type(screen.getByLabelText('Duração mín. (s)'), '5');
  await user.type(screen.getByLabelText('Duração máx. (s)'), '30');
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  const filtered = queries.at(-1) ?? '';
  expect(filtered).toContain('publicId=CLP000000000001');
  expect(filtered).toContain('analysis=performed');
  expect(filtered).toContain('sort=longest');
  expect(filtered).toContain('preserved=true');
  expect(filtered).toContain('minDurationSeconds=5');
  expect(filtered).toContain('maxDurationSeconds=30');

  const firstClipCheckbox = screen.getAllByRole('checkbox', { name: /^Selecionar clipe:/ })[0];
  if (!firstClipCheckbox) throw new Error('Clip checkbox was not rendered');
  await user.click(firstClipCheckbox);
  await user.click(screen.getByRole('button', { name: /Baixar selecionados/ }));
  expect(downloadRequests).toHaveLength(1);
  expect(downloadRequests[0]).toContain('ids=CLP000000000001');
  await waitFor(() => expect(eventBodies).toHaveLength(1));
  const event = JSON.parse(eventBodies[0] ?? '{}') as {
    eventType: string;
    metadata?: { action?: string };
  };
  expect(event.eventType).toBe('ui.action');
  expect(event.metadata?.action).toBe('clip.download');

  await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
  expect(await screen.findByText(/CLP000000000003/)).toBeInTheDocument();
});

it('sends the selected analysis state filter to the clips query', async () => {
  const requested: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    requested.push(String(input));
    return json({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  render(
    <I18nProvider>
      <ClipsPanel />
    </I18nProvider>,
  );

  const user = userEvent.setup();
  const analysisFilter = await screen.findByLabelText('Análise');
  await user.selectOptions(analysisFilter, 'completed');
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

  await waitFor(() => expect(requested.some((path) => path.includes('analysis=completed'))).toBe(true));
});

it('shows the stored analysis result for a completed clip', async () => {
  const clip = {
    publicId: 'CLP000000000009',
    cameraId: 'CAM000000000001',
    startedAtUtc: '2026-11-07T19:20:00Z',
    endedAtUtc: '2026-11-07T19:20:46Z',
    state: 'ready',
    archiveStatus: 'not_requested',
    analysisStatus: 'completed',
    thumbnailUrl: null,
    sizeBytes: 1024,
    triggerReason: 'visual_change:abc',
    triggerConfigVersion: 'trigger-v1',
    isPreserved: false,
    preservationVersion: 0,
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    if (path === '/api/v1/clips/CLP000000000009/analysis-result')
      return json({
        clipPublicId: 'CLP000000000009',
        analysisVersion: 'analysis-v1',
        modelVersion: 'yolox-nano-0.1.1rc0',
        framesAnalyzed: 12,
        processedAtUtc: '2026-11-07T19:20:52Z',
        objects: [{ className: 'person', classId: 0, score: 0.87, frameIndex: 3 }],
      });
    if (path === '/api/v1/clips/CLP000000000009')
      return json({
        clip,
        mediaUrl: null,
        mediaSha256: null,
        thumbnailSha256: null,
        attemptCount: 0,
        updatedAtUtc: '2026-11-07T19:21:00Z',
      });
    return json({ items: [clip], page: 1, pageSize: 20, total: 1 });
  });

  render(
    <I18nProvider>
      <ClipsPanel />
    </I18nProvider>,
  );

  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Detalhes e reprodu/ }));

  expect(await screen.findByText('Resultado da análise')).toBeInTheDocument();
  expect(await screen.findByText('yolox-nano-0.1.1rc0')).toBeInTheDocument();
  expect(await screen.findByText(/person · 87%/)).toBeInTheDocument();
});

it('shows every identity observation of a clip in its details for an administrator', async () => {
  const clip = {
    publicId: 'CLP000000000021',
    cameraId: 'CAM000000000001',
    startedAtUtc: '2026-11-07T20:34:27Z',
    endedAtUtc: '2026-11-07T20:34:41Z',
    state: 'ready',
    archiveStatus: 'archived',
    analysisStatus: 'not_requested',
    thumbnailUrl: null,
    sizeBytes: 2048,
    triggerReason: 'visual_change:91938bb3218346aca64d29d266e72b61',
    triggerConfigVersion: 'trigger-v1',
    isPreserved: false,
    preservationVersion: 0,
  };
  const observation = {
    publicId: 'OBV000000000001',
    cameraPublicId: 'CAM000000000001',
    clipPublicId: 'CLP000000000021',
    observedAtUtc: '2026-11-07T20:34:30Z',
    ingestedAtUtc: '2026-11-07T20:36:00Z',
    matchStatus: 'suggested',
    bestPersonPublicId: 'PER000000000001',
    bestScore: 0.9838,
    margin: 0.05,
    policyVersion: 'identity-match.baseline.v1',
    candidateCount: 1,
    reviewStatus: 'reviewed',
    resolvedPersonPublicId: 'PER000000000001',
    latestReviewPublicId: 'RVW000000000001',
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input);
    if (path === '/api/v1/clips/CLP000000000021')
      return json({
        clip,
        mediaUrl: null,
        mediaSha256: null,
        thumbnailSha256: null,
        attemptCount: 0,
        updatedAtUtc: '2026-11-07T20:36:01Z',
      });
    if (path === '/api/v1/admin/identity-observations/OBV000000000001')
      return json({
        summary: observation,
        candidates: [{ personPublicId: 'PER000000000001', score: 0.971 }],
        reviews: [
          {
            publicId: 'RVW000000000001',
            decision: 'confirmed',
            selectedPersonPublicId: 'PER000000000001',
            note: 'Confirmado pelo operador',
            reviewerPublicId: 'USR000000000001',
            createdAtUtc: '2026-11-07T20:37:00Z',
          },
        ],
      });
    if (path.startsWith('/api/v1/admin/identity-observations?'))
      return json({ items: [observation], page: 1, pageSize: 50, total: 1 });
    if (path.startsWith('/api/v1/admin/known-people?'))
      return json({ items: [{ publicId: 'PER000000000001', displayName: 'Nicolas' }] });
    return json({ items: [clip], page: 1, pageSize: 20, total: 1 });
  });

  render(
    <I18nProvider>
      <ClipsPanel isAdmin />
    </I18nProvider>,
  );

  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Detalhes e reprodu/ }));

  expect(await screen.findByText('Observações de identidade')).toBeInTheDocument();
  expect(await screen.findByText('identity-match.baseline.v1')).toBeInTheDocument();
  expect(await screen.findByText(/Nicolas · 0.971/)).toBeInTheDocument();
  expect(await screen.findByText(/Confirmar sugestão/)).toBeInTheDocument();
  expect(await screen.findByText(/Confirmado pelo operador/)).toBeInTheDocument();
});
