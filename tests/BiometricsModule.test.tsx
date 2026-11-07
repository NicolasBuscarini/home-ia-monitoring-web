import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BiometricsModule from '../src/features/biometrics/BiometricsModule';

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('biometrics module', () => {
  it('renders only the selected submodule and hides itself without projection', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/v1/admin/known-people'))
        return response({ items: [{ publicId: 'PER000000000001', displayName: 'Ana' }] });
      if (path === '/api/v1/admin/face-extractor-registry')
        return response({
          version: 1,
          selectedCandidate: null,
          candidates: [],
          runtimeEnabled: false,
          sampleCollectionEnabled: false,
        });
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <I18nProvider>
        <BiometricsModule
          locale="pt-BR"
          userRole="Administrator"
          portalModuleIds={['biometrics']}
          activeView="model"
        />
      </I18nProvider>,
    );

    expect(
      await screen.findByRole('region', { name: 'Candidatos de extrator para avaliação' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Biometria' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cadastros faciais' })).not.toBeInTheDocument();

    cleanup();
    render(
      <I18nProvider>
        <BiometricsModule
          locale="pt-BR"
          userRole="Administrator"
          portalModuleIds={['monitoring']}
          activeView="model"
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole('heading', { name: 'Biometria' })).not.toBeInTheDocument();
  });

  it('loads authorized people for the enrollment view', async () => {
    const requested: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      requested.push(path);
      if (path.startsWith('/api/v1/admin/known-people'))
        return response({ items: [{ publicId: 'PER000000000001', displayName: 'Ana' }] });
      if (path === '/api/v1/biometrics/enrollments') return response([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <I18nProvider>
        <BiometricsModule
          locale="pt-BR"
          userRole="Administrator"
          portalModuleIds={['biometrics']}
          activeView="enrollments"
        />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Minha biometria' })).toBeInTheDocument();
    expect(requested.some((path) => path === '/api/v1/admin/known-people?page=1&pageSize=100')).toBe(true);
    expect(requested.some((path) => path === '/api/v1/biometrics/enrollments')).toBe(true);
  });
});
