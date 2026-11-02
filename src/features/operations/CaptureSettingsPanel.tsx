import { ApiError, getJson, request, useI18n } from 'home-ia-shared';
import { useCallback, useEffect, useState } from 'react';

interface CaptureSnapshot {
  schemaVersion: string;
  profile: string;
  cameraId: string;
  enabled: boolean;
  segmentSeconds: number;
  maximumSegments: number;
  maximumSegmentBytes: number;
  revision: number;
  state: string;
  adapter: string;
  lastErrorCode?: string | null;
  gaps: number;
  segments: number;
}

interface CaptureForm {
  enabled: boolean;
  segmentSeconds: number;
  maximumSegments: number;
  maximumMegabytes: number;
}

const bytesPerMegabyte = 1_048_576;

export function CaptureSettingsPanel() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<CaptureSnapshot>();
  const [form, setForm] = useState<CaptureForm>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await getJson<CaptureSnapshot>('/api/v1/admin/monitoring/capture');
      setSnapshot(result);
      setForm(toForm(result));
      setRemoteOnly(false);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        setRemoteOnly(true);
        setSnapshot(undefined);
        setForm(undefined);
      } else {
        setError(t('operations.capture.settings.unavailable'));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!form || !snapshot) return;
    if (form.enabled !== snapshot.enabled && !window.confirm(t('operations.capture.settings.confirm')))
      return;
    if (
      form.segmentSeconds < 1 ||
      form.segmentSeconds > 60 ||
      form.maximumSegments < 1 ||
      form.maximumSegments > 10_000 ||
      form.maximumMegabytes < 1 ||
      form.maximumMegabytes > 1_024
    ) {
      setError(t('operations.capture.settings.invalid'));
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await request('/api/v1/admin/monitoring/capture/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: form.enabled,
          segmentSeconds: form.segmentSeconds,
          maximumSegments: form.maximumSegments,
          maximumSegmentBytes: form.maximumMegabytes * bytesPerMegabyte,
        }),
      });
      if (response.status === 409) {
        setRemoteOnly(true);
        return;
      }
      if (response.status === 503) {
        setError(t('operations.capture.settings.unavailable'));
        return;
      }
      if (response.status === 400) {
        setError(t('operations.capture.settings.invalid'));
        return;
      }
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      const updated = (await response.json()) as Partial<CaptureSnapshot>;
      const merged = { ...snapshot, ...updated };
      setSnapshot(merged);
      setForm(toForm(merged));
      setNotice(t('operations.capture.settings.saved'));
    } catch {
      setError(t('operations.capture.settings.unavailable'));
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <section className="panel-card mt-4" aria-live="polite">
        <p role="status">{t('operations.capture.settings.loading')}</p>
      </section>
    );

  if (remoteOnly)
    return (
      <section className="panel-card mt-4" aria-labelledby="capture-settings-title">
        <p className="eyebrow mb-1">{t('operations.capture.settings.eyebrow')}</p>
        <h3 id="capture-settings-title" className="h5 mb-2">
          {t('operations.capture.settings.title')}
        </h3>
        <p className="small text-secondary mb-0">{t('operations.capture.settings.remoteOnly')}</p>
      </section>
    );

  if (!form || !snapshot) return null;

  return (
    <section className="panel-card mt-4" aria-labelledby="capture-settings-title">
      <p className="eyebrow mb-1">{t('operations.capture.settings.eyebrow')}</p>
      <h3 id="capture-settings-title" className="h5 mb-2">
        {t('operations.capture.settings.title')}
      </h3>
      <p className="small text-secondary">{t('operations.capture.settings.description')}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="feedback" role="status" aria-live="polite">
          {notice}
        </p>
      )}
      <div className="row g-3">
        <div className="col-12 col-md-3">
          <div className="detail-item h-100">
            <span className="detail-label">{t('operations.capture.settings.profile')}</span>
            <strong>{snapshot.profile}</strong>
            <span className="detail-caption">{snapshot.adapter}</span>
          </div>
        </div>
        <div className="col-12 col-md-3">
          <div className="detail-item h-100">
            <span className="detail-label">{t('operations.capture.settings.state')}</span>
            <strong>{snapshot.state}</strong>
            <span className="detail-caption">
              {t('operations.capture.settings.revision', { revision: snapshot.revision })}
            </span>
          </div>
        </div>
        <div className="col-12 col-md-6 d-flex align-items-end">
          <div className="form-check mb-2">
            <input
              className="form-check-input"
              type="checkbox"
              id="capture-enabled"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })}
            />
            <label className="form-check-label" htmlFor="capture-enabled">
              {t('operations.capture.settings.enabled')}
            </label>
          </div>
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label" htmlFor="capture-segment-seconds">
            {t('operations.capture.settings.segmentSeconds')}
          </label>
          <input
            id="capture-segment-seconds"
            className="form-control"
            type="number"
            min={1}
            max={60}
            value={form.segmentSeconds}
            onChange={(event) => setForm({ ...form, segmentSeconds: Number(event.currentTarget.value) })}
          />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label" htmlFor="capture-maximum-segments">
            {t('operations.capture.settings.maximumSegments')}
          </label>
          <input
            id="capture-maximum-segments"
            className="form-control"
            type="number"
            min={1}
            max={10_000}
            value={form.maximumSegments}
            onChange={(event) => setForm({ ...form, maximumSegments: Number(event.currentTarget.value) })}
          />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label" htmlFor="capture-maximum-megabytes">
            {t('operations.capture.settings.maximumMegabytes')}
          </label>
          <input
            id="capture-maximum-megabytes"
            className="form-control"
            type="number"
            min={1}
            max={1_024}
            value={form.maximumMegabytes}
            onChange={(event) => setForm({ ...form, maximumMegabytes: Number(event.currentTarget.value) })}
          />
        </div>
      </div>
      <div className="d-flex flex-wrap gap-2 mt-3">
        <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? t('operations.capture.settings.saving') : t('operations.capture.settings.save')}
        </button>
        <button
          className="btn btn-outline-secondary"
          type="button"
          onClick={() => void load()}
          disabled={saving}
        >
          {t('operations.capture.settings.reload')}
        </button>
      </div>
    </section>
  );
}

function toForm(snapshot: CaptureSnapshot): CaptureForm {
  return {
    enabled: snapshot.enabled,
    segmentSeconds: snapshot.segmentSeconds,
    maximumSegments: snapshot.maximumSegments,
    maximumMegabytes: Math.max(1, Math.round(snapshot.maximumSegmentBytes / bytesPerMegabyte)),
  };
}
