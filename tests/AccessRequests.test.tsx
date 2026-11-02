import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminAccessRequestsPanel } from '../src/features/admin/AdminAccessRequestsPanel';

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

describe('access request screens', () => {
  it('shows request state, marks review without reloading, and opens the exact user in management', async () => {
    let status = 'pending';
    const calls: string[] = [];
    const onManageUser = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path.startsWith('/api/v1/admin/access-requests?')) {
        return response({
          items: [
            {
              publicId: 'ARQ000000000001',
              userPublicId: 'USR000000000001',
              username: 'local-user',
              purpose: 'live_monitoring',
              status,
              createdAtUtc: '2026-10-30T00:00:00Z',
            },
          ],
          page: 1,
          pageSize: 25,
          totalCount: 1,
        });
      }
      if (path === '/api/v1/admin/access-requests/ARQ000000000001/review' && init?.method === 'POST') {
        status = 'reviewed';
        return response(null, 204);
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AdminAccessRequestsPanel onManageUser={onManageUser} />
      </I18nProvider>,
    );
    expect(await screen.findByText('local-user')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gerenciar usuário' }));
    expect(onManageUser).toHaveBeenCalledWith('USR000000000001');
    await user.click(screen.getByRole('button', { name: 'Marcar como analisado' }));
    expect(await screen.findByText(/as permissões do usuário não foram alteradas/i)).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText(/Analisado/)).toBeInTheDocument();
    expect(calls).toContain('POST /api/v1/admin/access-requests/ARQ000000000001/review');
    expect(calls.filter((call) => call.startsWith('GET /api/v1/admin/access-requests?'))).toHaveLength(1);
    expect(calls.some((call) => call.includes('/access-rules') || call.includes('/access-profiles'))).toBe(
      false,
    );
  });

  it('filters the requests loaded on the page by username, status and purpose', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith('/api/v1/admin/access-requests?')) {
        return response({
          items: [
            {
              publicId: 'ARQ000000000001',
              userPublicId: 'USR000000000001',
              username: 'local-user',
              purpose: 'live_monitoring',
              status: 'pending',
              createdAtUtc: '2026-10-30T00:00:00Z',
            },
            {
              publicId: 'ARQ000000000002',
              userPublicId: 'USR000000000002',
              username: 'garage-operator',
              purpose: 'camera_access',
              status: 'reviewed',
              createdAtUtc: '2026-10-30T01:00:00Z',
            },
          ],
          page: 1,
          pageSize: 25,
          totalCount: 2,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AdminAccessRequestsPanel onManageUser={() => {}} />
      </I18nProvider>,
    );
    expect(await screen.findByText('local-user')).toBeInTheDocument();
    expect(screen.getByText('garage-operator')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Filtrar pedidos'), 'garage');
    expect(screen.getByText('garage-operator')).toBeInTheDocument();
    expect(screen.queryByText('local-user')).not.toBeInTheDocument();
    expect(screen.getByText('1 de 2 pedidos nesta página')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Filtrar pedidos'));
    await user.selectOptions(screen.getByLabelText('Estado'), 'reviewed');
    expect(screen.getByText('garage-operator')).toBeInTheDocument();
    expect(screen.queryByText('local-user')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Motivo'), 'live_monitoring');
    expect(screen.getByText('Nenhum pedido nesta página corresponde aos filtros.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByText('local-user')).toBeInTheDocument();
    expect(screen.getByText('garage-operator')).toBeInTheDocument();
  });
});
