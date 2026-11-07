import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FaceExtractorPanel } from '../src/features/biometrics/FaceExtractorPanel';

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const candidate = {
  publicId: 'FEX635030921697',
  modelId: 'opencv-zoo-sface',
  modelVersion: '2021dec',
  artifactSha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  sourceUri: 'https://example.test/sface.zip',
  codeLicense: 'Apache-2.0 (declared)',
  weightsLicense: 'Apache-2.0 (declared)',
  adapterId: 'onnxruntime-cpu',
  adapterContractVersion: 'face-embedding.v1',
  createdAtUtc: '2026-11-01T08:27:23Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('face extractor model panel', () => {
  it('shows the evaluation-only extractor selection and pins it through the API', async () => {
    let version = 1;
    const requests: Array<{ method: string; body?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? String(init.body) : undefined;
      requests.push({ method, body });
      if (path === '/api/v1/admin/face-extractor-registry')
        return response({
          version,
          selectedCandidate: version > 1 ? candidate : null,
          candidates: [candidate],
          runtimeEnabled: false,
          sampleCollectionEnabled: false,
        });
      if (path === '/api/v1/admin/face-extractor-selection' && method === 'PUT') {
        version = 2;
        return response({
          version,
          selectedCandidate: candidate,
          runtimeEnabled: false,
          sampleCollectionEnabled: false,
        });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <FaceExtractorPanel />
      </I18nProvider>,
    );

    const section = await screen.findByRole('region', { name: 'Candidatos de extrator para avaliação' });
    expect(await within(section).findByText('opencv-zoo-sface · 2021dec')).toBeInTheDocument();
    expect(
      within(section).getByText(/runtime desabilitado · coleta de amostras desabilitada/),
    ).toBeInTheDocument();
    expect(within(section).getByText(/SHA-256 do artefato 0ba9fbfa01b5…/)).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Selecionar para avaliação' }));
    expect(
      await screen.findByText(/selecionado somente para avaliação; o runtime permanece desligado/),
    ).toBeInTheDocument();
    const selection = requests.find((entry) => entry.method === 'PUT');
    expect(selection?.body).toBeDefined();
    expect(JSON.parse(selection?.body ?? '')).toEqual({
      candidatePublicId: 'FEX635030921697',
      expectedVersion: 1,
    });
    expect(await within(section).findByText('Selecionado para avaliação')).toBeInTheDocument();
  });
});
