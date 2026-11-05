import { getJson, request, useI18n } from 'home-ia-shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

interface CalibrationBin {
  lowerBound: number;
  upperBound: number;
  genuineCount: number;
  impostorCount: number;
}

interface CalibrationSnapshot {
  fromUtc: string;
  toUtc: string;
  cameraPublicId: string | null;
  bins: number;
  snapshotHash: string;
  activePolicy: { threshold: number; margin: number; version: string };
  genuineCount: number;
  impostorCount: number;
  excludedCount: number;
  singleCandidateCount: number;
  minimumSamplesPerClass: number;
  canPromote: boolean;
  scoreBins: CalibrationBin[];
  marginBins: CalibrationBin[];
}

interface PolicyVersion {
  publicId: string;
  version: number;
  threshold: number;
  margin: number;
  status: 'draft' | 'active' | 'archived';
  genuineCount: number;
  impostorCount: number;
  excludedCount: number;
  estimatedFar: number | null;
  estimatedFrr: number | null;
}

const WINDOW_DAYS = 90;
const BASELINE_VERSION = 'identity-match.baseline.v1';

const statusKeys = {
  draft: 'people.calibration.status.draft',
  active: 'people.calibration.status.active',
  archived: 'people.calibration.status.archived',
} as const;

export function IdentityCalibrationPanel() {
  const { t, locale } = useI18n();
  const thresholdId = useId();
  const marginId = useId();
  const editedRef = useRef(false);
  const [snapshot, setSnapshot] = useState<CalibrationSnapshot>();
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [threshold, setThreshold] = useState(0.363);
  const [margin, setMargin] = useState(0.05);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string>();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const query = new URLSearchParams({
        fromUtc: from.toISOString(),
        toUtc: to.toISOString(),
        bins: '50',
      });
      const [nextSnapshot, nextVersions] = await Promise.all([
        getJson<CalibrationSnapshot>(
          `/api/v1/admin/identity-match-policy/calibration?${query.toString()}`,
          signal,
        ),
        getJson<PolicyVersion[]>('/api/v1/admin/identity-match-policy', signal),
      ]);
      if (signal?.aborted) return;
      setSnapshot(nextSnapshot);
      setVersions(nextVersions);
      if (!editedRef.current) {
        setThreshold(nextSnapshot.activePolicy.threshold);
        setMargin(nextSnapshot.activePolicy.margin);
      }
    } catch {
      if (!signal?.aborted) setLoadError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const metrics = snapshot ? computeMetrics(snapshot, threshold, margin) : undefined;

  function changeThreshold(value: number) {
    editedRef.current = true;
    setThreshold(clamp(value));
  }

  function changeMargin(value: number) {
    editedRef.current = true;
    setMargin(clamp(value));
  }

  async function saveDraft() {
    if (!snapshot) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await request('/api/v1/admin/identity-match-policy/drafts', {
        method: 'POST',
        body: JSON.stringify({
          threshold,
          margin,
          fromUtc: snapshot.fromUtc,
          toUtc: snapshot.toUtc,
          cameraPublicId: snapshot.cameraPublicId,
          snapshotHash: snapshot.snapshotHash,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        setError(
          payload?.error === 'insufficient_calibration_sample'
            ? t('people.calibration.draft.error.sample')
            : payload?.error === 'calibration_snapshot_changed'
              ? t('people.calibration.draft.error.snapshot')
              : t('people.calibration.draft.error'),
        );
        return;
      }
      setNotice(t('people.calibration.draft.success'));
      await load();
    } catch {
      setError(t('people.calibration.draft.error'));
    } finally {
      setSaving(false);
    }
  }

  async function promote(publicId: string) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await request(`/api/v1/admin/identity-match-policy/${publicId}/promote`, {
        method: 'POST',
      });
      if (!response.ok) {
        setError(t('people.calibration.versions.error'));
        return;
      }
      setNotice(t('people.calibration.versions.success'));
      setPendingId(undefined);
      await load();
    } catch {
      setError(t('people.calibration.versions.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel-card mt-3" aria-labelledby="identity-calibration-title">
      <span className="eyebrow">{t('people.calibration.eyebrow')}</span>
      <h2 id="identity-calibration-title" className="h4 mt-2">
        {t('people.calibration.title')}
      </h2>
      <p className="text-secondary">{t('people.calibration.help')}</p>

      {loading && (
        <p role="status" aria-live="polite">
          {t('people.calibration.loading')}
        </p>
      )}
      {loadError && (
        <div className="error-text" role="alert">
          <p>{t('people.calibration.loadError')}</p>
          <button type="button" className="btn btn-outline-light btn-sm" onClick={() => void load()}>
            {t('people.calibration.reload')}
          </button>
        </div>
      )}

      {snapshot && metrics && (
        <>
          <p className="small text-secondary">
            {t('people.calibration.window', { days: WINDOW_DAYS })} ·{' '}
            {snapshot.activePolicy.version === BASELINE_VERSION
              ? t('people.calibration.active.baseline', {
                  threshold: formatScore(snapshot.activePolicy.threshold, locale),
                  margin: formatScore(snapshot.activePolicy.margin, locale),
                })
              : `${t('people.calibration.active')}: ${snapshot.activePolicy.version} (${formatScore(
                  snapshot.activePolicy.threshold,
                  locale,
                )}/${formatScore(snapshot.activePolicy.margin, locale)})`}
          </p>

          <div className="row g-3">
            <div className="col-12 col-md-6">
              <label className="form-label" htmlFor={thresholdId}>
                {t('people.calibration.threshold')}
              </label>
              <input
                id={thresholdId}
                className="form-range"
                type="range"
                min={0}
                max={1}
                step={0.005}
                value={threshold}
                aria-valuetext={formatScore(threshold, locale)}
                onChange={(event) => changeThreshold(Number(event.currentTarget.value))}
              />
              <input
                className="form-control form-control-sm"
                type="number"
                min={0}
                max={1}
                step={0.005}
                value={threshold}
                aria-label={t('people.calibration.threshold')}
                onChange={(event) => changeThreshold(Number(event.currentTarget.value))}
              />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label" htmlFor={marginId}>
                {t('people.calibration.margin')}
              </label>
              <input
                id={marginId}
                className="form-range"
                type="range"
                min={0}
                max={1}
                step={0.005}
                value={margin}
                aria-valuetext={formatScore(margin, locale)}
                onChange={(event) => changeMargin(Number(event.currentTarget.value))}
              />
              <input
                className="form-control form-control-sm"
                type="number"
                min={0}
                max={1}
                step={0.005}
                value={margin}
                aria-label={t('people.calibration.margin')}
                onChange={(event) => changeMargin(Number(event.currentTarget.value))}
              />
            </div>
          </div>

          <div className="row g-2 mt-1" aria-live="polite">
            <Metric label={t('people.calibration.metrics.far')} value={formatPercent(metrics.far, locale)} />
            <Metric label={t('people.calibration.metrics.frr')} value={formatPercent(metrics.frr, locale)} />
            <Metric label={t('people.calibration.metrics.genuine')} value={String(snapshot.genuineCount)} />
            <Metric label={t('people.calibration.metrics.impostor')} value={String(snapshot.impostorCount)} />
            <Metric label={t('people.calibration.metrics.excluded')} value={String(snapshot.excludedCount)} />
          </div>

          <p className="small text-secondary mt-2 mb-1">
            {t('people.calibration.metrics.marginImpact', {
              genuine: metrics.marginGenuine,
              impostor: metrics.marginImpostor,
            })}
          </p>
          <p className="small text-secondary">{t('people.calibration.metrics.bias')}</p>

          {!snapshot.canPromote && (
            <div className="alert alert-warning" role="status">
              {t('people.calibration.metrics.insufficient', {
                minimum: snapshot.minimumSamplesPerClass,
              })}
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving || !snapshot.canPromote}
            onClick={() => void saveDraft()}
          >
            {saving ? t('people.calibration.draft.saving') : t('people.calibration.draft')}
          </button>

          {notice && (
            <p className="admin-notice mt-2" role="status" aria-live="polite">
              {notice}
            </p>
          )}
          {error && (
            <p className="error-text mt-2" role="alert">
              {error}
            </p>
          )}

          <h3 className="h6 mt-4">{t('people.calibration.versions.title')}</h3>
          {versions.length === 0 ? (
            <p className="text-secondary">{t('people.calibration.versions.empty')}</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <caption className="visually-hidden">{t('people.calibration.versions.title')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('people.calibration.versions.version')}</th>
                    <th scope="col">{t('people.calibration.versions.status')}</th>
                    <th scope="col">{t('people.calibration.versions.threshold')}</th>
                    <th scope="col">{t('people.calibration.versions.margin')}</th>
                    <th scope="col">{t('people.calibration.versions.samples')}</th>
                    <th scope="col">{t('people.calibration.versions.far')}</th>
                    <th scope="col">{t('people.calibration.versions.frr')}</th>
                    <th scope="col">{t('people.calibration.versions.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.publicId}>
                      <td>v{version.version}</td>
                      <td>{t(statusKeys[version.status])}</td>
                      <td>{formatScore(version.threshold, locale)}</td>
                      <td>{formatScore(version.margin, locale)}</td>
                      <td>
                        {version.genuineCount}/{version.impostorCount}
                      </td>
                      <td>
                        {version.estimatedFar === null ? '—' : formatPercent(version.estimatedFar, locale)}
                      </td>
                      <td>
                        {version.estimatedFrr === null ? '—' : formatPercent(version.estimatedFrr, locale)}
                      </td>
                      <td>
                        {version.status === 'active' ? (
                          '—'
                        ) : pendingId === version.publicId ? (
                          <div className="d-flex flex-wrap gap-1 align-items-center">
                            <span className="small">
                              {version.status === 'archived'
                                ? t('people.calibration.versions.confirmRollback')
                                : t('people.calibration.versions.confirm')}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={saving}
                              onClick={() => void promote(version.publicId)}
                            >
                              {t('people.calibration.versions.confirmYes')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-light"
                              onClick={() => setPendingId(undefined)}
                            >
                              {t('people.calibration.versions.confirmNo')}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-light"
                            onClick={() => setPendingId(version.publicId)}
                          >
                            {version.status === 'archived'
                              ? t('people.calibration.versions.rollback')
                              : t('people.calibration.versions.promote')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-6 col-md-2">
      <div className="border rounded p-2 h-100">
        <div className="small text-secondary">{label}</div>
        <div className="fw-semibold">{value}</div>
      </div>
    </div>
  );
}

function computeMetrics(snapshot: CalibrationSnapshot, threshold: number, margin: number) {
  const farCount = snapshot.scoreBins.reduce(
    (total, bin) => total + (midpoint(bin) >= threshold ? bin.impostorCount : 0),
    0,
  );
  const frrCount = snapshot.scoreBins.reduce(
    (total, bin) => total + (midpoint(bin) < threshold ? bin.genuineCount : 0),
    0,
  );
  const marginGenuine = snapshot.marginBins.reduce(
    (total, bin) => total + (midpoint(bin) < margin ? bin.genuineCount : 0),
    0,
  );
  const marginImpostor = snapshot.marginBins.reduce(
    (total, bin) => total + (midpoint(bin) < margin ? bin.impostorCount : 0),
    0,
  );
  return {
    far: snapshot.impostorCount === 0 ? 0 : farCount / snapshot.impostorCount,
    frr: snapshot.genuineCount === 0 ? 0 : frrCount / snapshot.genuineCount,
    marginGenuine,
    marginImpostor,
  };
}

function midpoint(bin: CalibrationBin) {
  return (bin.lowerBound + bin.upperBound) / 2;
}

function clamp(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function formatScore(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value);
}

function formatPercent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}
