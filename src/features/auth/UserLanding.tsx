import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/i18n';
import { ApiError, getJson, request } from '../../services/http';
import { BiometricEnrollmentPanel } from '../biometrics/BiometricEnrollmentPanel';

interface AccessRequest {
  id: string;
  purpose: 'live_monitoring' | 'camera_access';
  status: 'pending' | 'reviewed';
  createdAtUtc: string;
}

interface UserLandingProps {
  canRequestAccess: boolean;
}

export function UserLanding({ canRequestAccess }: UserLandingProps) {
  const { t } = useI18n();
  const [purpose, setPurpose] = useState<AccessRequest['purpose']>('live_monitoring');
  const [current, setCurrent] = useState<AccessRequest | null>(null);
  const [loading, setLoading] = useState(canRequestAccess);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (!canRequestAccess) return;
    const controller = new AbortController();
    void getJson<{ request: AccessRequest | null }>('/api/v1/access-requests/mine', controller.signal)
      .then((result) => setCurrent(result.request))
      .catch(() => setError(t('accessRequest.error.load')))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [canRequestAccess, t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const key = idempotencyKey.current ?? createIdempotencyKey();
    idempotencyKey.current = key;
    try {
      const response = await request('/api/v1/access-requests', {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: key, purpose }),
      });
      if (response.status === 429) throw new ApiError('rate-limited', 429);
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      setCurrent((await response.json()) as AccessRequest);
      idempotencyKey.current = null;
      setNotice(t('accessRequest.notice.submitted'));
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 429
          ? t('accessRequest.error.rateLimited')
          : t('accessRequest.error.submit'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-card user-landing mx-auto" aria-labelledby="user-landing-title" tabIndex={-1}>
      <span className="eyebrow">{t('auth.user.eyebrow')}</span>
      <h2 id="user-landing-title" className="h4 mt-2">
        {t('auth.user.title')}
      </h2>
      <p>{t('auth.user.role', { role: t('role.user') })}</p>
      <p className="text-secondary">{t('auth.user.limits')}</p>
      {canRequestAccess && (
        <section aria-labelledby="access-request-title">
          <h3 id="access-request-title" className="h5">
            {t('accessRequest.title')}
          </h3>
          {loading ? (
            <p role="status">{t('accessRequest.loading')}</p>
          ) : current?.status === 'pending' ? (
            <p className="admin-notice" role="status" aria-live="polite">
              {t('accessRequest.pending')}
            </p>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              <label className="form-label" htmlFor="access-request-purpose">
                {t('accessRequest.purpose')}
              </label>
              <select
                id="access-request-purpose"
                className="form-select mb-3"
                value={purpose}
                onChange={(event) => setPurpose(event.currentTarget.value as AccessRequest['purpose'])}
                disabled={busy}
              >
                <option value="live_monitoring">{t('accessRequest.purpose.live')}</option>
                <option value="camera_access">{t('accessRequest.purpose.camera')}</option>
              </select>
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" aria-live="polite">
                  {notice}
                </p>
              )}
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? t('accessRequest.submitting') : t('accessRequest.submit')}
              </button>
            </form>
          )}
        </section>
      )}
      <div className="mt-4">
        <BiometricEnrollmentPanel />
      </div>
    </section>
  );
}

function createIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean))
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
