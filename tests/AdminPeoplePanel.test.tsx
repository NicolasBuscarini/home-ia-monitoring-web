import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPeoplePanel } from '../src/features/admin/AdminPeoplePanel';

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('people management', () => {
  it('registers and removes authorized people without touching biometrics', async () => {
    let people = [person];
    const requests: Array<{ path: string; method: string; body?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? String(init.body) : undefined;
      requests.push({ path, method, body });
      if (path.startsWith('/api/v1/admin/known-people') && method === 'GET')
        return response({ items: people, page: 1, pageSize: 25, total: people.length });
      if (path === '/api/v1/admin/known-people' && method === 'POST') {
        people = [
          ...people,
          {
            ...person,
            publicId: 'PER000000000002',
            displayName: 'Visitante',
            purpose: 'Acompanhante',
          },
        ];
        return response(people[1], 201);
      }
      if (path === '/api/v1/admin/known-people/PER000000000001' && method === 'DELETE') {
        people = people.filter((item) => item.publicId !== 'PER000000000001');
        return response(null, 204);
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AdminPeoplePanel />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Pessoas autorizadas' })).toBeInTheDocument();
    const rosterRow = await screen.findByRole('cell', { name: 'Morador' });
    expect(rosterRow).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nome'), 'Visitante');
    await user.type(screen.getByLabelText('Finalidade'), 'Acompanhante');
    await user.click(screen.getByRole('checkbox', { name: /Confirmo que esta pessoa autorizou/ }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar pessoa' }));

    expect(await screen.findByText('Pessoa cadastrada no roster autorizado.')).toBeInTheDocument();
    const create = requests.find((entry) => entry.method === 'POST');
    expect(create?.body).toBeDefined();
    expect(JSON.parse(create?.body ?? '')).toEqual({
      displayName: 'Visitante',
      purpose: 'Acompanhante',
      authorizationConfirmed: true,
    });
    expect(await screen.findByRole('cell', { name: 'Visitante' })).toBeInTheDocument();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Remover Morador' }));
    expect(
      await screen.findByText('Pessoa removida; os campos identificáveis foram limpos.'),
    ).toBeInTheDocument();
    expect(requests.some((entry) => entry.method === 'DELETE')).toBe(true);
  });
});
