import { type ChangeEvent, type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { StatusBadge } from '../../components/StatusBadge';
import { useI18n } from '../../i18n/i18n';
import type { TranslationKey } from '../../i18n/messages';
import { ApiError, getJson, request } from '../../services/http';

/** Consent text version accepted by the account; the API rejects enrollment without the current value. */
export const BIOMETRIC_CONSENT_VERSION = 'biometric-consent.v1';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2048;

interface BiometricEnrollment {
  publicId: string;
  userPublicId: string;
  status: 'active' | 'revoked' | 'expired';
  enrolledAtUtc: string;
  expiresAtUtc: string;
  revokedAtUtc: string | null;
  revokedReason: string;
  modelId: string;
  modelVersion: string;
  dimensions: number;
  keyVersion: string;
  consentVersion: string;
  consentAcceptedAtUtc: string;
}

type SubmitError =
  | ''
  | 'consent'
  | 'image'
  | 'faceNotDetected'
  | 'multipleFaces'
  | 'faceTooSmall'
  | 'imageDecode'
  | 'unavailable'
  | 'conflict'
  | 'forbidden'
  | 'submit';
type LoadError = '' | 'load';

const statusKeys: Record<BiometricEnrollment['status'], TranslationKey> = {
  active: 'biometrics.status.active',
  revoked: 'biometrics.status.revoked',
  expired: 'biometrics.status.expired',
};

export function BiometricEnrollmentPanel() {
  const { t, locale } = useI18n();
  const fileId = useId();
  const consentId = useId();
  const [items, setItems] = useState<BiometricEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError>('');
  const [submitError, setSubmitError] = useState<SubmitError>('');
  const [notice, setNotice] = useState('');
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string>();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await getJson<BiometricEnrollment[]>('/api/v1/biometrics/enrollments', signal);
      if (!signal?.aborted) setItems(result);
    } catch {
      if (!signal?.aborted) setLoadError('load');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    setSubmitError('');
    setNotice('');
    setFile(event.currentTarget.files?.[0]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    if (!consent) {
      setSubmitError('consent');
      return;
    }
    if (!file) {
      setSubmitError('image');
      return;
    }
    setBusy(true);
    setSubmitError('');
    try {
      const image = await toRequestImage(file);
      const response = await request('/api/v1/biometrics/enrollments', {
        method: 'POST',
        body: JSON.stringify({
          mediaType: image.mediaType,
          width: image.width,
          height: image.height,
          imageBase64: image.base64,
          consentVersion: BIOMETRIC_CONSENT_VERSION,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new ApiError(await errorCode(response), response.status);
      setNotice(t('biometrics.notice.enrolled'));
      setConsent(false);
      setFile(undefined);
      await load();
    } catch (failure) {
      setSubmitError(submitErrorKind(failure));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(item: BiometricEnrollment) {
    if (!window.confirm(t('biometrics.confirmRevoke'))) return;
    setRevokingId(item.publicId);
    setSubmitError('');
    setNotice('');
    try {
      const response = await request(`/api/v1/biometrics/enrollments/${item.publicId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      setNotice(t('biometrics.notice.revoked'));
      await load();
    } catch (failure) {
      setSubmitError(submitErrorKind(failure));
    } finally {
      setRevokingId(undefined);
    }
  }

  const active = items.filter((item) => item.status === 'active');
  return (
    <section className="panel-card biometrics-panel" aria-labelledby="biometrics-title">
      <span className="eyebrow">{t('biometrics.eyebrow')}</span>
      <h3 id="biometrics-title" className="h5 mt-2">
        {t('biometrics.title')}
      </h3>
      <p className="text-secondary">{t('biometrics.description')}</p>

      {loading && (
        <p role="status" aria-live="polite">
          {t('biometrics.loading')}
        </p>
      )}
      {loadError && (
        <div className="error-text" role="alert">
          <p>{t('biometrics.error.load')}</p>
          <button className="btn btn-outline-light btn-sm" type="button" onClick={() => void load()}>
            {t('biometrics.retry')}
          </button>
        </div>
      )}
      {!loading && !loadError && items.length === 0 && (
        <p className="text-secondary" role="status">
          {t('biometrics.empty')}
        </p>
      )}
      {!loading && !loadError && items.length > 0 && (
        <ul className="biometrics-list" aria-label={t('biometrics.listLabel')}>
          {items.map((item) => (
            <li key={item.publicId} className="biometrics-item">
              <div className="biometrics-item-heading">
                <StatusBadge
                  label={t(statusKeys[item.status])}
                  state={item.status === 'active' ? 'healthy' : 'neutral'}
                />
                <span className="small text-secondary">
                  {t('biometrics.item.expires', { date: formatDate(item.expiresAtUtc, locale) })}
                </span>
              </div>
              <p className="small mb-1">
                {t('biometrics.item.model', { model: item.modelId, version: item.modelVersion })}
              </p>
              <p className="small text-secondary mb-2">
                {t('biometrics.item.consent', { version: item.consentVersion })} ·{' '}
                {t('biometrics.item.keyVersion', { version: item.keyVersion })}
              </p>
              {item.status === 'active' && (
                <button
                  className="btn btn-outline-light btn-sm"
                  type="button"
                  disabled={revokingId === item.publicId}
                  onClick={() => void revoke(item)}
                >
                  {revokingId === item.publicId ? t('biometrics.revoking') : t('biometrics.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="biometrics-form mt-3" onSubmit={(event) => void submit(event)}>
        <h4 className="h6">{t('biometrics.form.title')}</h4>
        <p className="small text-secondary">{t('biometrics.form.replacement')}</p>
        <label className="form-label" htmlFor={fileId}>
          {t('biometrics.file.label')}
        </label>
        <input
          id={fileId}
          className="form-control mb-1"
          type="file"
          accept="image/jpeg,image/png"
          aria-describedby={`${fileId}-hint`}
          disabled={busy}
          onChange={pickFile}
        />
        <p id={`${fileId}-hint`} className="small text-secondary">
          {t('biometrics.file.hint')}
        </p>
        <div className="form-check mb-3">
          <input
            id={consentId}
            className="form-check-input"
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(event) => setConsent(event.currentTarget.checked)}
          />
          <label className="form-check-label small" htmlFor={consentId}>
            {t('biometrics.consent.accept')}
          </label>
        </div>
        <p className="small text-secondary biometrics-consent-text" id={`${consentId}-text`}>
          {t('biometrics.consent.text')} ({BIOMETRIC_CONSENT_VERSION})
        </p>
        {submitError && (
          <p role="alert" className="error-text">
            {t(`biometrics.error.${submitError}`)}
          </p>
        )}
        {notice && (
          <p role="status" aria-live="polite">
            {notice}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? t('biometrics.submitting') : t('biometrics.submit')}
        </button>
        <p className="small text-secondary mt-2 mb-0">{t('biometrics.limits')}</p>
        {active.length > 0 && <p className="small text-secondary mb-0">{t('biometrics.active.hint')}</p>}
      </form>
    </section>
  );
}

function submitErrorKind(failure: unknown): SubmitError {
  if (failure instanceof Error && failure.message === 'invalid-image') return 'image';
  if (!(failure instanceof ApiError)) return 'submit';
  if (failure.status === 400) {
    if (failure.message === 'biometric_consent_required') return 'consent';
    if (failure.message === 'face_not_detected') return 'faceNotDetected';
    if (failure.message === 'multiple_faces') return 'multipleFaces';
    if (failure.message === 'face_too_small') return 'faceTooSmall';
    if (failure.message === 'image_decode_failed') return 'imageDecode';
    return 'image';
  }
  if (failure.status === 403) return 'forbidden';
  if (failure.status === 409) return 'conflict';
  if (failure.status === 503) return 'unavailable';
  return 'submit';
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: string };
    return body.code ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

interface RequestImage {
  mediaType: string;
  width: number;
  height: number;
  base64: string;
}

async function toRequestImage(file: File): Promise<RequestImage> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') throw new Error('invalid-image');
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) throw new Error('invalid-image');
  const dimensions = await decodeDimensions(file);
  if (
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION
  )
    throw new Error('invalid-image');
  return {
    mediaType: file.type,
    width: dimensions.width,
    height: dimensions.height,
    base64: await readBase64(file),
  };
}

async function decodeDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof globalThis.createImageBitmap !== 'function') throw new Error('invalid-image');
  const bitmap = await globalThis.createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return dimensions;
}

async function readBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < buffer.length; index += chunk)
    binary += String.fromCharCode(...buffer.subarray(index, index + chunk));
  return btoa(binary);
}

function formatDate(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(locale);
}
