import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityCalibrationPanel } from '../src/features/identity/IdentityCalibrationPanel';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const snapshot = {
  fromUtc: '2026-08-07T00:00:00Z',
  toUtc: '2026-11-05T00:00:00Z',
  cameraPublicId: null,
  bins: 2,
  snapshotHash: 'abc123',
  activePolicy: { threshold: 0.363, margin: 0.05, version: 'identity-match.baseline.v1' },
  genuineCount: 40,
  impostorCount: 40,
  excludedCount: 2,
  singleCandidateCount: 0,
  minimumSamplesPerClass: 30,
  canPromote: true,
  scoreBins: [
    { lowerBound: 0, upperBound: 0.5, genuineCount: 0, impostorCount: 40 },
    { lowerBound: 0.5, upperBound: 1, genuineCount: 40, impostorCount: 0 },
  ],
  marginBins: [
    { lowerBound: 0, upperBound: 0.5, genuineCount: 0, impostorCount: 0 },
    { lowerBound: 0.5, upperBound: 1, genuineCount: 40, impostorCount: 40 },
  ],
};

const version = {
  publicId: 'MPL000000000001',
  version: 1,
  threshold: 0.42,
  margin: 0.06,
  status: 'draft',
  genuineCount: 40,
  impostorCount: 40,
  excludedCount: 2,
  estimatedFar: 0.5,
  estimatedFrr: 0.1,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('identity calibration panel', () => {
  it('recomputes the estimate and saves a draft with the loaded snapshot', async () => {
    const requests: Array<{ path: string; method: string; body?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? String(init.body) : undefined;
      requests.push({ path, method, body });
      if (path.startsWith('/api/v1/admin/identity-match-policy/calibration?')) return response(snapshot);
      if (path === '/api/v1/admin/identity-match-policy' && method === 'GET') return response([version]);
      if (path === '/api/v1/admin/identity-match-policy/drafts' && method === 'POST')
        return response({ ...version, publicId: 'MPL000000000002' }, 201);
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const user = userEvent.setup();
    render(
      <I18nProvider>
        <IdentityCalibrationPanel />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Calibração de reconhecimento' })).toBeInTheDocument();
    expect(screen.getByText(/baseline/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeEnabled();

    const thresholdInputs = screen.getAllByLabelText('Limiar de similaridade');
    const thresholdNumber = thresholdInputs[1]!;
    await user.clear(thresholdNumber);
    await user.type(thresholdNumber, '0.8');
    expect(screen.getByText('100%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(
      await screen.findByText('Rascunho salvo. Promova para aplicar a novas observações.'),
    ).toBeInTheDocument();
    const draft = requests.find((entry) => entry.path === '/api/v1/admin/identity-match-policy/drafts');
    expect(draft?.method).toBe('POST');
    const payload = JSON.parse(draft?.body ?? '{}') as {
      threshold: number;
      margin: number;
      snapshotHash: string;
    };
    expect(payload.threshold).toBe(0.8);
    expect(payload.margin).toBe(0.05);
    expect(payload.snapshotHash).toBe('abc123');
  });

  it('blocks drafts with insufficient sample and promotes a version only after confirmation', async () => {
    const requests: Array<{ path: string; method: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ path, method });
      if (path.startsWith('/api/v1/admin/identity-match-policy/calibration?'))
        return response({ ...snapshot, canPromote: false, genuineCount: 4, impostorCount: 4 });
      if (path === '/api/v1/admin/identity-match-policy' && method === 'GET') return response([version]);
      if (path === '/api/v1/admin/identity-match-policy/MPL000000000001/promote')
        return response({ ...version, status: 'active' });
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const user = userEvent.setup();
    render(
      <I18nProvider>
        <IdentityCalibrationPanel />
      </I18nProvider>,
    );

    const insufficient = await screen.findByText(/Amostra insuficiente/);
    expect(insufficient).toHaveTextContent(
      'Amostra insuficiente: são necessárias ao menos 30 revisões genuínas e 30 impostoras para promover.',
    );
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Promover' }));
    expect(screen.getByText('Confirmar promoção?')).toBeInTheDocument();
    expect(requests.some((entry) => entry.path.endsWith('/promote'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(
      await screen.findByText('Política promovida. Novas observações passarão a usá-la.'),
    ).toBeInTheDocument();
    expect(
      requests.some(
        (entry) =>
          entry.path === '/api/v1/admin/identity-match-policy/MPL000000000001/promote' &&
          entry.method === 'POST',
      ),
    ).toBe(true);
    const table = screen.getByRole('table');
    expect(within(table).getByText('v1')).toBeInTheDocument();
  });
});
