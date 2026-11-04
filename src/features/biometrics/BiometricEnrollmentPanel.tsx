import type { TranslationKey } from 'home-ia-shared';
import { ApiError, getJson, request, StatusBadge, useI18n } from 'home-ia-shared';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useId, useState } from 'react';

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
  personPublicId: string | null;
}

interface RosterPersonOption {
  publicId: string;
  displayName: string;
}

interface BiometricEnrollmentPanelProps {
  people?: RosterPersonOption[];
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
type LinkError = '' | 'target' | 'forbidden' | 'unavailable' | 'update';

const statusKeys: Record<BiometricEnrollment['status'], TranslationKey> = {
  active: 'biometrics.status.active',
  revoked: 'biometrics.status.revoked',
  expired: 'biometrics.status.expired',
};

export function BiometricEnrollmentPanel({ people = [] }: BiometricEnrollmentPanelProps) {
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
  const [linkingId, setLinkingId] = useState<string>();
  const [unlinkingId, setUnlinkingId] = useState<string>();
  const [selectedPerson, setSelectedPerson] = useState<Record<string, string>>({});
  const [linkError, setLinkError] = useState<LinkError>('');
  const [linkNotice, setLinkNotice] = useState('');

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

  async function link(item: BiometricEnrollment) {
    const personPublicId = selectedPerson[item.publicId];
    if (!personPublicId) return;
    setLinkingId(item.publicId);
    setLinkError('');
    setLinkNotice('');
    try {
      const response = await request(`/api/v1/admin/biometrics/enrollments/${item.publicId}/person`, {
        method: 'PUT',
        body: JSON.stringify({ personPublicId }),
      });
      if (!response.ok) throw new ApiError(await errorCode(response), response.status);
      setLinkNotice(t('biometrics.link.notice.linked'));
      setSelectedPerson((current) => {
        const next = { ...current };
        delete next[item.publicId];
        return next;
      });
      await load();
    } catch (failure) {
      setLinkError(linkErrorKind(failure));
    } finally {
      setLinkingId(undefined);
    }
  }

  async function unlink(item: BiometricEnrollment) {
    setUnlinkingId(item.publicId);
    setLinkError('');
    setLinkNotice('');
    try {
      const response = await request(`/api/v1/admin/biometrics/enrollments/${item.publicId}/person`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new ApiError(await errorCode(response), response.status);
      setLinkNotice(t('biometrics.link.notice.unlinked'));
      await load();
    } catch (failure) {
      setLinkError(linkErrorKind(failure));
    } finally {
      setUnlinkingId(undefined);
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
                <>
                  <button
                    className="btn btn-outline-light btn-sm"
                    type="button"
                    disabled={revokingId === item.publicId}
                    onClick={() => void revoke(item)}
                  >
                    {revokingId === item.publicId ? t('biometrics.revoking') : t('biometrics.revoke')}
                  </button>
                  <div className="biometrics-link mt-2">
                    <p className="small text-secondary mb-1">{t('biometrics.link.label')}</p>
                    {item.personPublicId ? (
                      <>
                        <p className="small mb-2">
                          {t('biometrics.link.linked', {
                            name:
                              people.find((person) => person.publicId === item.personPublicId)?.displayName ??
                              item.personPublicId,
                          })}
                        </p>
                        <button
                          className="btn btn-outline-light btn-sm"
                          type="button"
                          disabled={unlinkingId === item.publicId}
                          onClick={() => void unlink(item)}
                        >
                          {unlinkingId === item.publicId
                            ? t('biometrics.link.unlinking')
                            : t('biometrics.link.unlink')}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="small text-secondary mb-2">{t('biometrics.link.none')}</p>
                        {people.length === 0 ? (
                          <p className="small text-secondary mb-0">{t('biometrics.link.empty')}</p>
                        ) : (
                          <div className="d-flex flex-wrap gap-2 align-items-end">
                            <div>
                              <label
                                className="form-label small mb-1"
                                htmlFor={`biometrics-person-${item.publicId}`}
                              >
                                {t('biometrics.link.choose')}
                              </label>
                              <select
                                id={`biometrics-person-${item.publicId}`}
                                className="form-select form-select-sm"
                                value={selectedPerson[item.publicId] ?? ''}
                                disabled={linkingId === item.publicId}
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  setSelectedPerson((current) => ({
                                    ...current,
                                    [item.publicId]: value,
                                  }));
                                }}
                              >
                                <option value="">{t('biometrics.link.choose')}</option>
                                {people.map((person) => (
                                  <option key={person.publicId} value={person.publicId}>
                                    {person.displayName}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              className="btn btn-outline-light btn-sm"
                              type="button"
                              disabled={!selectedPerson[item.publicId] || linkingId === item.publicId}
                              onClick={() => void link(item)}
                            >
                              {linkingId === item.publicId
                                ? t('biometrics.link.linking')
                                : t('biometrics.link.link')}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {linkError && (
        <p className="error-text" role="alert">
          {t(`biometrics.link.error.${linkError}`)}
        </p>
      )}
      {linkNotice && (
        <p role="status" aria-live="polite">
          {linkNotice}
        </p>
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

function linkErrorKind(failure: unknown): LinkError {
  if (!(failure instanceof ApiError)) return 'update';
  if (failure.status === 403) return 'forbidden';
  if (failure.status === 404) return 'target';
  if (failure.status === 503) return 'unavailable';
  return 'update';
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
