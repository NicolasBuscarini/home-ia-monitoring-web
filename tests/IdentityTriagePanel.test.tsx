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
