import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersPanel } from '../src/features/admin/AdminUsersPanel';
import { I18nProvider } from '../src/i18n/i18n';

const account = { publicId: 'USR000000000001', userName: 'local-user', isActive: true };
const profile = {
  publicId: 'PRF000000000001',
  currentVersionPublicId: 'PVN000000000001',
  name: 'Garage operator',
  isActive: true,
  version: 1,
  updatedAtUtc: '2026-10-30T00:00:00Z',
  permissionKeys: ['live.video.view'],
};
const camera = {
  cameraId: 'CAM000000000001',
  contextId: 'CTX000000000001',
  name: 'Garagem',
  isEnabled: true,
};

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

describe('administrative user management', () => {
  it('requests the paginated account list with the selected userId filter', async () => {
    const paths: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      paths.push(path);
      if (path.startsWith('/api/v1/admin/users?page=1&pageSize=25&userId=USR000000000001'))
        return response({ items: [account], page: 1, pageSize: 25, totalCount: 1 });
      if (path === '/api/v1/admin/cameras?page=1&pageSize=100') return response({ items: [camera] });
      if (path === '/api/v1/admin/access-rules') return response([profile]);
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <I18nProvider>
        <AdminUsersPanel initialUserId="USR000000000001" />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'local-user' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Exibindo uma única conta filtrada');
    expect(paths).toContain('/api/v1/admin/users?page=1&pageSize=25&userId=USR000000000001');
    expect(screen.getByRole('button', { name: 'Limpar filtro de usuário' })).toBeInTheDocument();
  });

  it('assigns only an existing profile with explicit camera scope', async () => {
    let savedAssignments: Array<Record<string, unknown>> = [];
    const requests: Array<{ path: string; method: string; body?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? String(init.body) : undefined;
      requests.push({ path, method, body });
      if (path.startsWith('/api/v1/admin/users?page='))
        return response({ items: [account], page: 1, pageSize: 25, totalCount: 1 });
      if (path === '/api/v1/admin/cameras?page=1&pageSize=100') return response({ items: [camera] });
      if (path === '/api/v1/admin/access-rules') return response([profile]);
      if (path === '/api/v1/admin/users/USR000000000001' && method === 'GET')
        return response({ ...account, isAdministrator: false, accessProfiles: savedAssignments });
      if (path === '/api/v1/admin/users/USR000000000001/access-rules' && method === 'PUT') {
        savedAssignments = [
          {
            assignmentPublicId: 'ASN000000000001',
            profilePublicId: 'PRF000000000001',
            profileVersionPublicId: 'PVN000000000001',
            profileName: 'Garage operator',
            profileVersion: 1,
            scopes: [{ contextId: 'CTX000000000001', cameraId: 'CAM000000000001' }],
            assignedAtUtc: '2026-10-30T00:00:00Z',
          },
        ];
        return response(undefined, 204);
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AdminUsersPanel />
      </I18nProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Gestão de usuários' })).toBeInTheDocument();
    expect(screen.queryByText('Editor de perfil')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Detalhes' }));
    await screen.findByRole('group', { name: 'Perfis atribuídos e escopo de câmera' });
    await user.click(screen.getByRole('checkbox', { name: 'Garage operator · v1' }));
    await user.click(screen.getByRole('checkbox', { name: /Garagem \(CTX000000000001 · CAM000000000001\)/ }));
    await user.click(screen.getByRole('button', { name: 'Salvar atribuições de perfil' }));

    await waitFor(() =>
      expect(requests).toContainEqual({
        path: '/api/v1/admin/users/USR000000000001/access-rules',
        method: 'PUT',
        body: JSON.stringify({
          assignments: [
            {
              profileVersionPublicId: 'PVN000000000001',
              scopes: [{ contextId: 'CTX000000000001', cameraId: 'CAM000000000001' }],
            },
          ],
        }),
      }),
    );
    const assignmentRequest = requests.find(
      (item) => item.path.endsWith('/access-rules') && item.method === 'PUT',
    );
    expect(assignmentRequest?.body).not.toContain('permissionKeys');
    expect(
      await screen.findByText('Perfis de acesso salvos e sessões existentes revogadas.'),
    ).toBeInTheDocument();
  });

  it('shows retryable sanitized load errors and does not call permission catalog or profile mutation', async () => {
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requests.push(String(input));
      throw new Error('private-error-detail');
    });
    render(
      <I18nProvider>
        <AdminUsersPanel />
      </I18nProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as contas. Tente novamente.',
    );
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.queryByText('private-error-detail')).not.toBeInTheDocument();
    expect(requests.some((path) => path.endsWith('/permission-catalog'))).toBe(false);
    expect(requests.some((path) => path.endsWith('/access-rules') && !path.includes('?'))).toBe(true);
  });

  it('keeps the account list visible when a camera-scope catalog is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/v1/admin/users?page='))
        return response({ items: [account], page: 1, pageSize: 25, totalCount: 1 });
      if (path === '/api/v1/admin/cameras?page=1&pageSize=100')
        return response({ error: 'unavailable' }, 503);
      if (path === '/api/v1/admin/access-rules') return response([profile]);
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <I18nProvider>
        <AdminUsersPanel />
      </I18nProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'local-user' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'As contas carregaram, mas não foi possível carregar perfis ou escopos de câmera.',
    );
  });

  it('filters the accounts loaded on the page and makes the filter scope explicit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/v1/admin/users?page='))
        return response({
          items: [account, { publicId: 'USR000000000002', userName: 'garage-operator', isActive: true }],
          page: 1,
          pageSize: 25,
          totalCount: 2,
        });
      if (path === '/api/v1/admin/cameras?page=1&pageSize=100') return response({ items: [] });
      if (path === '/api/v1/admin/access-rules') return response([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AdminUsersPanel />
      </I18nProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'local-user' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'garage-operator' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Filtrar contas'), 'garage');
    expect(screen.getByRole('heading', { name: 'garage-operator' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'local-user' })).not.toBeInTheDocument();
    expect(screen.getByText('1 de 2 contas nesta página')).toBeInTheDocument();
    expect(screen.getByText(/Filtra as contas carregadas nesta página/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Filtrar contas'));
    await user.type(screen.getByLabelText('Filtrar contas'), 'missing');
    expect(screen.getByText('Nenhuma conta nesta página corresponde a “missing”.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpar filtro' }));
    expect(screen.getByRole('heading', { name: 'local-user' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'garage-operator' })).toBeInTheDocument();
  });
});
