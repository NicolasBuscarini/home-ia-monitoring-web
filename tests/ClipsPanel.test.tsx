import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
          analysisStatus: 'not_requested',
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
      <ClipsPanel isAdmin />
    </I18nProvider>,
  );
  await user.click(await screen.findByRole('tab', { name: 'Ajustes' }));
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

it('opens the clip library first and keeps administrator settings in a separate tab', async () => {
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
  const user = userEvent.setup();
  render(
    <I18nProvider>
      <ClipsPanel isAdmin />
    </I18nProvider>,
  );
  expect(await screen.findByText('Nenhum clipe corresponde aos filtros.')).toBeInTheDocument();
  expect(screen.queryByText('Geração automática de clipes')).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Ajustes' }));
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
  render(
    <I18nProvider>
      <ClipsPanel isAdmin />
    </I18nProvider>,
  );
  await user.click(await screen.findByRole('tab', { name: 'Ajustes' }));
  await user.clear(await screen.findByLabelText('Retenção (dias)'));
  await user.type(screen.getByLabelText('Retenção (dias)'), '30');
  await user.type(screen.getByLabelText('Limite do arquivo (GB)'), '50');
  await user.click(screen.getByRole('button', { name: 'Salvar limites' }));
  expect(await screen.findByText('Configurações de retenção salvas.')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Clipes' }));
  await user.click(await screen.findByRole('button', { name: /Detalhes e reprodução/ }));
  await user.click(await screen.findByRole('button', { name: 'Preservar clipe' }));
  expect((await screen.findAllByText('Preservado')).length).toBeGreaterThan(0);
  expect(requests.some((item) => item.method === 'PUT' && item.path.endsWith('/clip-retention'))).toBe(true);
  expect(requests.some((item) => item.method === 'PUT' && item.path.endsWith('/preservation'))).toBe(true);
  expect(preserved).toBe(true);
});

it('loads persisted policy, saves it with optimistic version, and submits analysis by public clip id', async () => {
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
  render(
    <I18nProvider>
      <ClipsPanel cameraId={clip.cameraId} />
    </I18nProvider>,
  );
  await user.click(await screen.findByRole('tab', { name: 'Ajustes' }));
  await user.selectOptions(await screen.findByLabelText('Política'), 'always');
  await user.click(screen.getByRole('button', { name: 'Salvar política' }));
  expect(await screen.findByText('Política da câmera salva.')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Clipes' }));
  await user.click(await screen.findByRole('button', { name: /Detalhes e reprodução/ }));
  await user.click(await screen.findByRole('button', { name: 'Enviar para análise' }));
  expect(await screen.findByText('Solicitação de análise enviada.')).toBeInTheDocument();
  expect(
    requests.some(
      (item) => item.method === 'POST' && item.path.endsWith(`/${clip.publicId}/analysis-requests`),
    ),
  ).toBe(true);
  const postBody = JSON.parse(requests.find((item) => item.method === 'POST')?.body ?? '{}');
  expect(postBody.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
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
