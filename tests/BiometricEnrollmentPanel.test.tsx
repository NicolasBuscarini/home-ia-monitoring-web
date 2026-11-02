import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from 'home-ia-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BIOMETRIC_CONSENT_VERSION,
  BiometricEnrollmentPanel,
} from '../src/features/biometrics/BiometricEnrollmentPanel';

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const enrollment = {
  publicId: 'BIO000000000001',
  userPublicId: 'USR000000000001',
  status: 'active',
  enrolledAtUtc: '2026-11-01T12:00:00Z',
  expiresAtUtc: '2027-11-01T12:00:00Z',
  revokedAtUtc: null,
  revokedReason: '',
  modelId: 'opencv-zoo-sface',
  modelVersion: '2021dec',
  dimensions: 128,
  keyVersion: 'v1',
  consentVersion: BIOMETRIC_CONSENT_VERSION,
  consentAcceptedAtUtc: '2026-11-01T12:00:00Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubImageDecoder() {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 160, height: 160, close: () => {} })),
  );
}

function renderPanel() {
  return render(
    <I18nProvider>
      <BiometricEnrollmentPanel />
    </I18nProvider>,
  );
}

describe('biometric enrollment panel', () => {
  it('requires consent, sends the versioned acceptance and lists the encrypted enrollment', async () => {
    stubImageDecoder();
    let items: unknown[] = [];
    const requests: Array<{ method: string; body?: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? String(init.body) : undefined;
      requests.push({ method, body });
      if (method === 'GET') return response(items);
      if (method === 'POST') {
        items = [enrollment];
        return response(enrollment, 201);
      }
      throw new Error(`Unexpected request: ${method}`);
    });

    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Minha biometria' })).toBeInTheDocument();
    expect(await screen.findByText('Nenhum cadastro biométrico para esta conta ainda.')).toBeInTheDocument();

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'rosto.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/Imagem do rosto/), file);
    await user.click(screen.getByRole('button', { name: 'Cadastrar biometria' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Aceite o consentimento');
    expect(requests.some((entry) => entry.method === 'POST')).toBe(false);

    await user.click(screen.getByRole('checkbox', { name: /autorizo este cadastro biométrico/ }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar biometria' }));

    expect(await screen.findByText('Cadastro biométrico criado e cifrado.')).toBeInTheDocument();
    const post = requests.find((entry) => entry.method === 'POST');
    expect(post?.body).toBeDefined();
    const payload = JSON.parse(post?.body ?? '') as Record<string, unknown>;
    expect(payload.consentVersion).toBe(BIOMETRIC_CONSENT_VERSION);
    expect(payload.mediaType).toBe('image/jpeg');
    expect(payload.width).toBe(160);
    expect(payload.height).toBe(160);
    expect(typeof payload.imageBase64).toBe('string');
    expect(payload.userPublicId).toBeUndefined();

    expect(await screen.findByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText(/Consentimento biometric-consent\.v1/)).toBeInTheDocument();
    expect(screen.queryByText(/imageBase64/)).not.toBeInTheDocument();
  });

  it('reports the fail-closed state when the extractor or key is not configured', async () => {
    stubImageDecoder();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return response([]);
      return response({ code: 'face_extractor_not_configured' }, 503);
    });

    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Nenhum cadastro biométrico para esta conta ainda.');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'rosto.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/Imagem do rosto/), file);
    await user.click(screen.getByRole('checkbox', { name: /autorizo este cadastro biométrico/ }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar biometria' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'o extrator facial ou a chave de cifra não estão configurados',
    );
    expect(screen.getByText(/A extração ainda não está habilitada/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Cadastro biométrico criado e cifrado.')).not.toBeInTheDocument(),
    );
  });

  it('revokes the active enrollment after confirmation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return response([enrollment]);
      if (method === 'DELETE') return response(null, 204);
      throw new Error(`Unexpected request: ${method}`);
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Revogar agora' }));
    expect(confirm).toHaveBeenCalled();
    expect(
      await screen.findByText('Cadastro biométrico revogado; o payload cifrado foi apagado.'),
    ).toBeInTheDocument();
  });
});
