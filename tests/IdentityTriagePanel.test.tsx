import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityTriagePanel } from '../src/features/identity/IdentityTriagePanel';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const person = {
  publicId: 'PER000000000001',
  displayName: 'Morador',
  purpose: 'Reconhecimento de entrada',
  authorizationRecordedAtUtc: '2026-11-01T09:00:00Z',
  createdAtUtc: '2026-11-01T09:00:00Z',
  version: 1,
};

const observation = {
  publicId: 'OBV000000000001',
  cameraPublicId: 'CAM000000000001',
  clipPublicId: 'CLP000000000001',
  observedAtUtc: '2026-11-05T12:00:00Z',
  ingestedAtUtc: '2026-11-05T12:00:01Z',
  matchStatus: 'suggested',
  bestPersonPublicId: person.publicId,
  bestScore: 0.91,
  margin: 0.2,
  policyVersion: 'identity-match.baseline.v1',
  candidateCount: 1,
  reviewStatus: 'pending',
  resolvedPersonPublicId: null,
  latestReviewPublicId: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('identity triage panel', () => {
  it('lists pending observations and records a confirmed review without changing the prediction', async () => {
    const requests: Array<{ path: string; method: string; body?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? String(init.body) : undefined;
      requests.push({ path, method, body });
      if (path.startsWith('/api/v1/admin/known-people'))
        return response({ items: [person], page: 1, pageSize: 100, total: 1 });
      if (path.startsWith('/api/v1/admin/identity-observations?') && method === 'GET')
        return response({ items: [observation], page: 1, pageSize: 25, total: 1 });
      if (path === '/api/v1/admin/identity-observations/OBV000000000001' && method === 'GET')
        return response({
          summary: observation,
          candidates: [{ personPublicId: person.publicId, score: 0.91 }],
          reviews: [],
        });
      if (path.endsWith('/reviews') && method === 'POST')
        return response({
          publicId: 'RVW000000000001',
          decision: 'confirmed',
          selectedPersonPublicId: person.publicId,
          note: 'Confirmado no teste',
          reviewerPublicId: 'USR000000000001',
          createdAtUtc: '2026-11-05T12:05:00Z',
        });
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const user = userEvent.setup();
    render(
      <I18nProvider>
        <IdentityTriagePanel />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Triagem de identidade' })).toBeInTheDocument();
    expect(await screen.findByText('Morador')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Sugerido')).toBeInTheDocument();
    expect(
      requests.some(
        (entry) => entry.path.includes('reviewStatus=pending') && entry.path.includes('pageSize=25'),
      ),
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Abrir observação OBV000000000001' }));
    expect(
      await screen.findByRole('heading', { name: 'Revisar observação OBV000000000001' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Pessoa')).toHaveValue(person.publicId);
    await user.type(screen.getByLabelText('Nota da revisão (opcional)'), 'Confirmado no teste');
    await user.click(screen.getByRole('button', { name: 'Registrar revisão' }));

    expect(
      await screen.findByText('Revisão registrada; a predição original foi preservada.'),
    ).toBeInTheDocument();
    const review = requests.find((entry) => entry.method === 'POST');
    expect(review?.body).toBeDefined();
    expect(JSON.parse(review?.body ?? '')).toEqual({
      decision: 'confirmed',
      personPublicId: person.publicId,
      note: 'Confirmado no teste',
    });
  });

  it('shows the sampled clip frames of an observation and explains when there is no clip', async () => {
    const withoutClip = { ...observation, publicId: 'OBV000000000002', clipPublicId: null };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/v1/admin/known-people'))
        return response({ items: [person], page: 1, pageSize: 100, total: 1 });
      if (path.startsWith('/api/v1/admin/identity-observations?'))
        return response({ items: [observation, withoutClip], page: 1, pageSize: 25, total: 2 });
      if (path === '/api/v1/admin/identity-observations/OBV000000000001')
        return response({
          summary: observation,
          candidates: [{ personPublicId: person.publicId, score: 0.91 }],
          reviews: [],
        });
      if (path === '/api/v1/admin/identity-observations/OBV000000000001/frames')
        return response({
          clipPublicId: 'CLP000000000001',
          durationMilliseconds: 10000,
          sampledFrames: 2,
          frames: [
            {
              index: 0,
              offsetMilliseconds: 1666,
              faces: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
            },
            { index: 1, offsetMilliseconds: 5000, faces: [] },
          ],
        });
      if (path === '/api/v1/admin/identity-observations/OBV000000000002')
        return response({ summary: withoutClip, candidates: [], reviews: [] });
      throw new Error(`Unexpected request: ${path}`);
    });

    const user = userEvent.setup();
    render(
      <I18nProvider>
        <IdentityTriagePanel />
      </I18nProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Abrir observação OBV000000000001' }));
    expect(await screen.findByAltText('Frame 1 do clipe em 1.7 s')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Frames amostrados pelo reconhecimento facial. Cada imagem é gerada sob demanda a partir do clipe e não fica armazenada.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Rosto detectado nesta amostra')).toBeInTheDocument();
    expect(screen.getByText('Frame 1 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selecionar frame 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Próximo frame' }));
    expect(screen.getByAltText('Frame 2 do clipe em 5.0 s')).toHaveAttribute(
      'src',
      '/api/v1/admin/identity-observations/OBV000000000001/frames/1',
    );
    expect(screen.getByText('Frame 2 de 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Selecionar frame 1' }));
    expect(screen.getByAltText('Frame 1 do clipe em 1.7 s')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abrir observação OBV000000000002' }));
    expect(
      await screen.findByText('Esta observação não tem clipe associado, então não há frames para revisar.'),
    ).toBeInTheDocument();
    expect(screen.queryByAltText('Frame 1 do clipe em 1.7 s')).not.toBeInTheDocument();
  });

  it('requests the clip frames with a timeout long enough for inline face detection', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/v1/admin/known-people'))
        return response({ items: [person], page: 1, pageSize: 100, total: 1 });
      if (path.startsWith('/api/v1/admin/identity-observations?'))
        return response({ items: [observation], page: 1, pageSize: 25, total: 1 });
      if (path === '/api/v1/admin/identity-observations/OBV000000000001')
        return response({ summary: observation, candidates: [], reviews: [] });
      if (path === '/api/v1/admin/identity-observations/OBV000000000001/frames')
        return response({
          clipPublicId: 'CLP000000000001',
          durationMilliseconds: 10000,
          sampledFrames: 1,
          frames: [{ index: 0, offsetMilliseconds: 1666, faces: [] }],
        });
      throw new Error(`Unexpected request: ${path}`);
    });

    const user = userEvent.setup();
    render(
      <I18nProvider>
        <IdentityTriagePanel />
      </I18nProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Abrir observação OBV000000000001' }));
    await screen.findByAltText('Frame 1 do clipe em 1.7 s');

    expect(timeoutSpy).toHaveBeenCalledWith(120_000);
  });

  it('closes the review and returns to the list with the back-to-list button', async () => {
    const withoutClip = { ...observation, clipPublicId: null };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/v1/admin/known-people'))
        return response({ items: [person], page: 1, pageSize: 100, total: 1 });
      if (path.startsWith('/api/v1/admin/identity-observations?'))
        return response({ items: [withoutClip], page: 1, pageSize: 25, total: 1 });
      if (path === '/api/v1/admin/identity-observations/OBV000000000001')
        return response({ summary: withoutClip, candidates: [], reviews: [] });
      throw new Error(`Unexpected request: ${path}`);
    });

    const user = userEvent.setup();
    render(
      <I18nProvider>
        <IdentityTriagePanel />
      </I18nProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Abrir observação OBV000000000001' }));
    expect(
      await screen.findByRole('heading', { name: 'Revisar observação OBV000000000001' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voltar à lista' }));
    expect(
      screen.queryByRole('heading', { name: 'Revisar observação OBV000000000001' }),
    ).not.toBeInTheDocument();
  });

  it('shows an empty state when the triage queue has no observations', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/v1/admin/known-people'))
        return response({ items: [], page: 1, pageSize: 100, total: 0 });
      if (path.startsWith('/api/v1/admin/identity-observations'))
        return response({ items: [], page: 1, pageSize: 25, total: 0 });
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <I18nProvider>
        <IdentityTriagePanel />
      </I18nProvider>,
    );

    expect(
      await screen.findByText('Nenhuma observação de identidade corresponde a estes filtros.'),
    ).toBeInTheDocument();
  });
});
