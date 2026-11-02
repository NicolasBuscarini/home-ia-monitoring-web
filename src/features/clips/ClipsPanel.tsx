import type { TranslationKey } from 'home-ia-shared';
import { ApiError, getJson, request, useI18n } from 'home-ia-shared';
import { useCallback, useEffect, useState } from 'react';

interface ClipItem {
  publicId: string;
  cameraId: string;
  startedAtUtc: string;
  endedAtUtc: string;
  state: string;
  archiveStatus: string;
  analysisStatus: string;
  thumbnailUrl: string | null;
  sizeBytes: number | null;
  triggerReason: string | null;
  triggerConfigVersion: string | null;
  isPreserved: boolean;
  preservationVersion: number;
}
interface ClipPage {
  items: ClipItem[];
  page: number;
  pageSize: number;
  total: number;
}
interface ClipDetails {
  clip: ClipItem;
  mediaUrl: string | null;
  mediaSha256: string | null;
  thumbnailSha256: string | null;
  attemptCount: number;
  updatedAtUtc: string;
}

const PAGE_SIZE = 20;
const stateKeys: Record<string, TranslationKey> = {
  collecting: 'clips.state.collecting',
  ready: 'clips.state.ready',
  failed: 'clips.state.failed',
  lost_capacity: 'clips.state.lost_capacity',
};
const archiveKeys: Record<string, TranslationKey> = {
  not_requested: 'clips.archive.not_requested',
  pending: 'clips.archive.pending',
  copying: 'clips.archive.copying',
  verifying: 'clips.archive.verifying',
  archived: 'clips.archive.archived',
  expiring: 'clips.archive.expiring',
  expired: 'clips.archive.expired',
  retry_wait: 'clips.archive.retry_wait',
  failed: 'clips.archive.failed',
};
const analysisKeys: Record<string, TranslationKey> = {
  not_requested: 'clips.analysisState.not_requested',
  analysis_pending: 'clips.analysisState.analysis_pending',
  processing: 'clips.analysisState.processing',
  retry_wait: 'clips.analysisState.retry_wait',
  failed: 'clips.analysisState.failed',
};
interface TriggerConfiguration {
  cameraId: string;
  enabled: boolean;
  version: number;
  updatedAtUtc: string;
  name?: string;
}
interface AdminCamera {
  cameraId: string;
  name: string;
  isEnabled: boolean;
}
interface RetentionConfiguration {
  cameraId: string;
  retentionDays: number;
  maximumStorageGigabytes: number | null;
  version: number;
  updatedAtUtc: string | null;
  name?: string;
}
type DispatchPolicy = 'always' | 'large_motion' | 'manual_only' | 'never';
interface DispatchPolicyView {
  cameraId: string;
  contextId: string;
  policy: DispatchPolicy;
  version: number;
  updatedAtUtc: string | null;
  canRequest: boolean;
  canManage: boolean;
}
const dispatchPolicyKeys: Record<DispatchPolicy, TranslationKey> = {
  always: 'clips.policy.always',
  large_motion: 'clips.policy.large_motion',
  manual_only: 'clips.policy.manual_only',
  never: 'clips.policy.never',
};
const dispatchPolicyDescriptionKeys: Record<DispatchPolicy, TranslationKey> = {
  always: 'clips.policy.description.always',
  large_motion: 'clips.policy.description.large_motion',
  manual_only: 'clips.policy.description.manual_only',
  never: 'clips.policy.description.never',
};

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error('secure_random_unavailable');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ClipsPanel({ cameraId, isAdmin = false }: { cameraId?: string; isAdmin?: boolean }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ClipItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<ClipDetails>();
  const [playbackError, setPlaybackError] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [triggerConfigurations, setTriggerConfigurations] = useState<TriggerConfiguration[]>([]);
  const [triggerBusy, setTriggerBusy] = useState<string>();
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerError, setTriggerError] = useState('');
  const [triggerMessage, setTriggerMessage] = useState('');
  const [dispatchPolicies, setDispatchPolicies] = useState<DispatchPolicyView[]>([]);
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, DispatchPolicy>>({});
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyLoadErrors, setPolicyLoadErrors] = useState<string[]>([]);
  const [policyBusyCamera, setPolicyBusyCamera] = useState<string>();
  const [policyNotice, setPolicyNotice] = useState<{ text: string; error: boolean }>();
  const [analysisBusyClip, setAnalysisBusyClip] = useState<string>();
  const [analysisNotice, setAnalysisNotice] = useState<{ clipId: string; text: string; error: boolean }>();
  const [retentionConfigurations, setRetentionConfigurations] = useState<RetentionConfiguration[]>([]);
  const [retentionDrafts, setRetentionDrafts] = useState<Record<string, { days: number; gigabytes: string }>>(
    {},
  );
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionBusyCamera, setRetentionBusyCamera] = useState<string>();
  const [retentionNotice, setRetentionNotice] = useState<{ text: string; error: boolean }>();
  const [preservationBusyClip, setPreservationBusyClip] = useState<string>();
  const [preservationNotice, setPreservationNotice] = useState<{
    clipId: string;
    text: string;
    error: boolean;
  }>();

  const loadDispatchPolicies = useCallback(async (cameraIds: string[]) => {
    const ids = [...new Set(cameraIds.filter(Boolean))];
    if (ids.length === 0) {
      setDispatchPolicies([]);
      setPolicyLoadErrors([]);
      return;
    }
    setPolicyLoading(true);
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          return await getJson<DispatchPolicyView>(
            `/api/v1/cameras/${encodeURIComponent(id)}/clip-analysis-dispatch-policy`,
          );
        } catch {
          return null;
        }
      }),
    );
    const loaded = results.filter((item): item is DispatchPolicyView => item !== null);
    setDispatchPolicies(loaded);
    setPolicyDrafts(Object.fromEntries(loaded.map((item) => [item.cameraId, item.policy])));
    setPolicyLoadErrors(ids.filter((_, index) => results[index] === null));
    setPolicyLoading(false);
  }, []);

  const load = useCallback(
    async (targetPage = 1) => {
      setBusy(true);
      setError('');
      try {
        const query = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
        if (cameraId) query.set('cameraId', cameraId);
        if (state) query.set('state', state);
        if (from) query.set('fromUtc', new Date(`${from}T00:00:00Z`).toISOString());
        if (to) query.set('toUtc', new Date(`${to}T23:59:59.999Z`).toISOString());
        const result = await getJson<ClipPage>(`/api/v1/clips?${query}`);
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
        await loadDispatchPolicies([
          ...(cameraId ? [cameraId] : []),
          ...result.items.map((item) => item.cameraId),
        ]);
      } catch (failure) {
        setError(
          failure instanceof ApiError && failure.status === 403
            ? t('clips.error.denied')
            : t('clips.error.load'),
        );
        setItems([]);
        setTotal(0);
      } finally {
        setBusy(false);
      }
    },
    [cameraId, from, loadDispatchPolicies, state, t, to],
  );

  useEffect(() => {
    setSelected(undefined);
    void load(1);
  }, [load]);

  const loadTriggerConfigurations = useCallback(async () => {
    if (!isAdmin) return;
    setTriggerLoading(true);
    setTriggerError('');
    try {
      const catalog = await getJson<{ items: AdminCamera[] }>('/api/v1/admin/cameras?page=1&pageSize=100');
      const settings = await Promise.all(
        catalog.items.map(async (camera) => ({
          ...(await getJson<TriggerConfiguration>(
            `/api/v1/admin/cameras/${encodeURIComponent(camera.cameraId)}/clip-trigger`,
          )),
          name: camera.name,
        })),
      );
      setTriggerConfigurations(settings);
    } catch {
      setTriggerError(t('clips.trigger.loadError'));
      setTriggerConfigurations([]);
    } finally {
      setTriggerLoading(false);
    }
  }, [isAdmin, t]);

  useEffect(() => {
    void loadTriggerConfigurations();
  }, [loadTriggerConfigurations]);

  const loadRetentionConfigurations = useCallback(async () => {
    if (!isAdmin) return;
    setRetentionLoading(true);
    try {
      const catalog = await getJson<{ items: AdminCamera[] }>('/api/v1/admin/cameras?page=1&pageSize=100');
      const settings = await Promise.all(
        catalog.items.map(async (camera) => ({
          ...(await getJson<RetentionConfiguration>(
            `/api/v1/admin/cameras/${encodeURIComponent(camera.cameraId)}/clip-retention`,
          )),
          name: camera.name,
        })),
      );
      setRetentionConfigurations(settings);
      setRetentionDrafts(
        Object.fromEntries(
          settings.map((item) => [
            item.cameraId,
            {
              days: item.retentionDays,
              gigabytes: item.maximumStorageGigabytes === null ? '' : String(item.maximumStorageGigabytes),
            },
          ]),
        ),
      );
    } catch {
      setRetentionNotice({ text: t('clips.retention.loadError'), error: true });
    } finally {
      setRetentionLoading(false);
    }
  }, [isAdmin, t]);

  useEffect(() => {
    void loadRetentionConfigurations();
  }, [loadRetentionConfigurations]);

  async function updateRetention(setting: RetentionConfiguration) {
    const draft = retentionDrafts[setting.cameraId];
    if (!draft) return;
    const gigabytes = draft.gigabytes.trim() === '' ? null : Number(draft.gigabytes);
    if (
      !Number.isInteger(draft.days) ||
      draft.days < 1 ||
      draft.days > 3650 ||
      (gigabytes !== null && (!Number.isInteger(gigabytes) || gigabytes < 1 || gigabytes > 1024))
    ) {
      setRetentionNotice({ text: t('clips.retention.invalid'), error: true });
      return;
    }
    setRetentionBusyCamera(setting.cameraId);
    setRetentionNotice(undefined);
    try {
      const response = await request(
        `/api/v1/admin/cameras/${encodeURIComponent(setting.cameraId)}/clip-retention`,
        {
          method: 'PUT',
          body: JSON.stringify({
            expectedVersion: setting.version,
            retentionDays: draft.days,
            maximumStorageGigabytes: gigabytes,
          }),
        },
      );
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      await loadRetentionConfigurations();
      setRetentionNotice({ text: t('clips.retention.saved'), error: false });
    } catch (failure) {
      setRetentionNotice({
        text: t(
          failure instanceof ApiError && failure.status === 409
            ? 'clips.retention.conflict'
            : 'clips.retention.saveError',
        ),
        error: true,
      });
      await loadRetentionConfigurations();
    } finally {
      setRetentionBusyCamera(undefined);
    }
  }

  async function togglePreservation(clip: ClipItem) {
    setPreservationBusyClip(clip.publicId);
    setPreservationNotice(undefined);
    try {
      const response = await request(`/api/v1/clips/${encodeURIComponent(clip.publicId)}/preservation`, {
        method: 'PUT',
        body: JSON.stringify({ expectedVersion: clip.preservationVersion, isPreserved: !clip.isPreserved }),
      });
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      const updated = (await response.json()) as { isPreserved: boolean; version: number };
      const apply = (current: ClipItem): ClipItem =>
        current.publicId === clip.publicId
          ? { ...current, isPreserved: updated.isPreserved, preservationVersion: updated.version }
          : current;
      setItems((current) => current.map(apply));
      setSelected((current) => (current ? { ...current, clip: apply(current.clip) } : current));
      setPreservationNotice({
        clipId: clip.publicId,
        text: t(updated.isPreserved ? 'clips.preservation.enabled' : 'clips.preservation.disabled'),
        error: false,
      });
    } catch (failure) {
      setPreservationNotice({
        clipId: clip.publicId,
        text: t(
          failure instanceof ApiError && failure.status === 409
            ? 'clips.preservation.conflict'
            : 'clips.preservation.error',
        ),
        error: true,
      });
      await load(page);
    } finally {
      setPreservationBusyClip(undefined);
    }
  }

  async function updateTrigger(setting: TriggerConfiguration) {
    setTriggerBusy(setting.cameraId);
    setTriggerError('');
    setTriggerMessage('');
    try {
      const response = await request(
        `/api/v1/admin/cameras/${encodeURIComponent(setting.cameraId)}/clip-trigger`,
        {
          method: 'PUT',
          body: JSON.stringify({ expectedVersion: setting.version, enabled: !setting.enabled }),
        },
      );
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      const updated = (await response.json()) as TriggerConfiguration;
      setTriggerConfigurations((current) =>
        current.map((item) => (item.cameraId === updated.cameraId ? { ...updated, name: item.name } : item)),
      );
      setTriggerMessage(t(updated.enabled ? 'clips.trigger.enabled' : 'clips.trigger.disabled'));
    } catch (failure) {
      setTriggerError(
        failure instanceof ApiError && failure.status === 409
          ? t('clips.trigger.conflict')
          : t('clips.trigger.updateError'),
      );
      await loadTriggerConfigurations();
    } finally {
      setTriggerBusy(undefined);
    }
  }

  const visiblePolicyCameraIds = () => [
    ...(cameraId ? [cameraId] : []),
    ...items.map((item) => item.cameraId),
  ];

  async function updateDispatchPolicy(setting: DispatchPolicyView) {
    const policy = policyDrafts[setting.cameraId] ?? setting.policy;
    if (policy === setting.policy) return;
    setPolicyBusyCamera(setting.cameraId);
    setPolicyNotice(undefined);
    try {
      const response = await request(
        `/api/v1/cameras/${encodeURIComponent(setting.cameraId)}/clip-analysis-dispatch-policy`,
        { method: 'PUT', body: JSON.stringify({ expectedVersion: setting.version, policy }) },
      );
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      const updated = (await response.json()) as Omit<DispatchPolicyView, 'canRequest' | 'canManage'>;
      setDispatchPolicies((current) =>
        current.map((item) => (item.cameraId === updated.cameraId ? { ...item, ...updated } : item)),
      );
      setPolicyDrafts((current) => ({ ...current, [updated.cameraId]: updated.policy }));
      setPolicyNotice({ text: t('clips.policy.saved'), error: false });
    } catch (failure) {
      setPolicyNotice({
        text:
          failure instanceof ApiError && failure.status === 409
            ? t('clips.policy.conflict')
            : t('clips.policy.saveError'),
        error: true,
      });
      await loadDispatchPolicies(visiblePolicyCameraIds());
    } finally {
      setPolicyBusyCamera(undefined);
    }
  }

  async function requestClipAnalysis(clip: ClipItem) {
    setAnalysisBusyClip(clip.publicId);
    setAnalysisNotice(undefined);
    try {
      const response = await request(`/api/v1/clips/${encodeURIComponent(clip.publicId)}/analysis-requests`, {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: createIdempotencyKey() }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { code?: string };
        if (response.status === 409 && payload.code === 'analysis_not_allowed') {
          setAnalysisNotice({ clipId: clip.publicId, text: t('clips.analysis.never'), error: true });
          await loadDispatchPolicies(visiblePolicyCameraIds());
          return;
        }
        if (response.status === 409 && payload.code === 'analysis_capacity_reached')
          throw new Error('capacity');
        if (response.status === 404 || response.status === 403) throw new Error('denied');
        throw new Error('request');
      }
      const result = (await response.json()) as { state: string; existing: boolean };
      setItems((current) =>
        current.map((item) =>
          item.publicId === clip.publicId ? { ...item, analysisStatus: result.state } : item,
        ),
      );
      setSelected((current) =>
        current?.clip.publicId === clip.publicId
          ? { ...current, clip: { ...current.clip, analysisStatus: result.state } }
          : current,
      );
      setAnalysisNotice({
        clipId: clip.publicId,
        text: t(result.existing ? 'clips.analysis.existing' : 'clips.analysis.submitted'),
        error: false,
      });
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : 'request';
      setAnalysisNotice({
        clipId: clip.publicId,
        text: t(
          reason === 'capacity'
            ? 'clips.analysis.capacity'
            : reason === 'denied'
              ? 'clips.analysis.denied'
              : reason === 'secure_random_unavailable'
                ? 'clips.analysis.secureRandom'
                : 'clips.analysis.requestError',
        ),
        error: true,
      });
    } finally {
      setAnalysisBusyClip(undefined);
    }
  }

  function renderAnalysisAction(clip: ClipItem) {
    if (clip.state !== 'ready') return null;
    const policy = dispatchPolicies.find((item) => item.cameraId === clip.cameraId);
    if (!policy) {
      if (policyLoading) return <span role="status">{t('clips.policy.loading')}</span>;
      if (policyLoadErrors.includes(clip.cameraId))
        return (
          <span role="alert" className="error-text">
            {t('clips.policy.unavailable')}
          </span>
        );
      return null;
    }
    if (!policy.canRequest) return null;
    const never = policy.policy === 'never';
    return (
      <div className="d-flex flex-column align-items-start gap-1">
        <button
          className="btn btn-outline-primary"
          type="button"
          disabled={never || analysisBusyClip !== undefined}
          onClick={() => void requestClipAnalysis(clip)}
        >
          {analysisBusyClip === clip.publicId
            ? t('clips.analysis.sending')
            : t(clip.analysisStatus === 'not_requested' ? 'clips.analysis.send' : 'clips.analysis.resend')}
        </button>
        {never && <span className="small text-secondary">{t('clips.analysis.never')}</span>}
        {analysisNotice?.clipId === clip.publicId && (
          <span
            role={analysisNotice.error ? 'alert' : 'status'}
            aria-live="polite"
            className={analysisNotice.error ? 'error-text' : 'small text-secondary'}
          >
            {analysisNotice.text}
          </span>
        )}
      </div>
    );
  }

  async function openClip(clipId: string) {
    setSelected(undefined);
    setPlaybackError(false);
    setPlaybackAttempt(0);
    setError('');
    try {
      setSelected(await getJson<ClipDetails>(`/api/v1/clips/${encodeURIComponent(clipId)}`));
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 403
          ? t('clips.error.denied')
          : t('clips.error.detail'),
      );
    }
  }

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

  return (
    <section className="panel-card clips-panel" aria-labelledby="clips-title">
      <span className="eyebrow">{t('clips.eyebrow')}</span>
      <h2 id="clips-title" className="h5 mt-2">
        {t('clips.title')}
      </h2>
      <p className="small text-secondary">{t('clips.description')}</p>
      {isAdmin && (
        <section className="panel-card mb-3" aria-labelledby="clip-trigger-title">
          <h3 id="clip-trigger-title" className="h6">
            {t('clips.trigger.title')}
          </h3>
          <p className="small text-secondary">{t('clips.trigger.description')}</p>
          {triggerError && (
            <p role="alert" className="error-text">
              {triggerError}
            </p>
          )}
          {triggerMessage && (
            <p role="status" aria-live="polite">
              {triggerMessage}
            </p>
          )}
          {triggerLoading && (
            <p role="status" aria-live="polite">
              {t('clips.trigger.loading')}
            </p>
          )}
          <ul className="list-unstyled mb-0">
            {triggerConfigurations.map((setting) => (
              <li
                key={setting.cameraId}
                className="d-flex flex-wrap align-items-center justify-content-between gap-2 py-2"
              >
                <span>{setting.name ?? setting.cameraId}</span>
                <button
                  className={`btn ${setting.enabled ? 'btn-outline-danger' : 'btn-outline-primary'}`}
                  type="button"
                  disabled={triggerLoading || triggerBusy !== undefined}
                  aria-pressed={setting.enabled}
                  onClick={() => void updateTrigger(setting)}
                >
                  {triggerBusy === setting.cameraId
                    ? t('clips.trigger.saving')
                    : t(setting.enabled ? 'clips.trigger.turnOff' : 'clips.trigger.turnOn')}
                </button>
              </li>
            ))}
          </ul>
          {triggerConfigurations.length === 0 && !triggerError && !triggerLoading && (
            <p role="status">{t('clips.trigger.empty')}</p>
          )}
        </section>
      )}
      {isAdmin && (
        <section className="panel-card mb-3" aria-labelledby="clip-retention-title">
          <h3 id="clip-retention-title" className="h6">
            {t('clips.retention.title')}
          </h3>
          <p className="small text-secondary">{t('clips.retention.description')}</p>
          {retentionNotice && (
            <p
              role={retentionNotice.error ? 'alert' : 'status'}
              aria-live="polite"
              className={retentionNotice.error ? 'error-text' : undefined}
            >
              {retentionNotice.text}
            </p>
          )}
          {retentionLoading && (
            <p role="status" aria-live="polite">
              {t('clips.retention.loading')}
            </p>
          )}
          <ul className="list-unstyled mb-0">
            {retentionConfigurations.map((setting) => {
              const draft = retentionDrafts[setting.cameraId] ?? {
                days: setting.retentionDays,
                gigabytes:
                  setting.maximumStorageGigabytes === null ? '' : String(setting.maximumStorageGigabytes),
              };
              return (
                <li key={setting.cameraId} className="border-top py-3">
                  <strong>{setting.name ?? setting.cameraId}</strong>
                  <div className="d-flex flex-wrap align-items-end gap-2 mt-2">
                    <div>
                      <label className="form-label" htmlFor={`clip-retention-days-${setting.cameraId}`}>
                        {t('clips.retention.days')}
                      </label>
                      <input
                        className="form-control"
                        id={`clip-retention-days-${setting.cameraId}`}
                        type="number"
                        min="1"
                        max="3650"
                        value={draft.days}
                        disabled={retentionBusyCamera !== undefined}
                        onChange={(event) =>
                          setRetentionDrafts((current) => ({
                            ...current,
                            [setting.cameraId]: { ...draft, days: Number(event.target.value) },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor={`clip-retention-gb-${setting.cameraId}`}>
                        {t('clips.retention.quota')}
                      </label>
                      <input
                        className="form-control"
                        id={`clip-retention-gb-${setting.cameraId}`}
                        type="number"
                        min="1"
                        max="1024"
                        placeholder={t('clips.retention.unlimited')}
                        value={draft.gigabytes}
                        disabled={retentionBusyCamera !== undefined}
                        onChange={(event) =>
                          setRetentionDrafts((current) => ({
                            ...current,
                            [setting.cameraId]: { ...draft, gigabytes: event.target.value },
                          }))
                        }
                      />
                    </div>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={
                        retentionBusyCamera !== undefined ||
                        (draft.days === setting.retentionDays &&
                          (draft.gigabytes === '' ? null : Number(draft.gigabytes)) ===
                            setting.maximumStorageGigabytes)
                      }
                      onClick={() => void updateRetention(setting)}
                    >
                      {retentionBusyCamera === setting.cameraId
                        ? t('clips.retention.saving')
                        : t('clips.retention.save')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {(cameraId || dispatchPolicies.length > 0 || policyLoading || policyLoadErrors.length > 0) && (
        <section className="panel-card mb-3" aria-labelledby="clip-policy-title">
          <h3 id="clip-policy-title" className="h6">
            {t('clips.policy.title')}
          </h3>
          <p className="small text-secondary">{t('clips.policy.description')}</p>
          {policyLoading && (
            <p role="status" aria-live="polite">
              {t('clips.policy.loading')}
            </p>
          )}
          {policyNotice && (
            <p
              role={policyNotice.error ? 'alert' : 'status'}
              aria-live="polite"
              className={policyNotice.error ? 'error-text' : undefined}
            >
              {policyNotice.text}
            </p>
          )}
          {policyLoadErrors.length > 0 && (
            <p role="alert" className="error-text">
              {t('clips.policy.unavailable')}
            </p>
          )}
          <ul className="list-unstyled mb-0">
            {dispatchPolicies.map((setting) => {
              const draft = policyDrafts[setting.cameraId] ?? setting.policy;
              return (
                <li key={setting.cameraId} className="border-top py-3">
                  <strong>{setting.cameraId}</strong>
                  <p className="small text-secondary mt-1 mb-2">
                    {t('clips.policy.current', { policy: t(dispatchPolicyKeys[setting.policy]) })} —{' '}
                    {t(dispatchPolicyDescriptionKeys[setting.policy])}
                  </p>
                  {setting.policy === 'never' && (
                    <p className="small text-secondary">{t('clips.policy.neverExplanation')}</p>
                  )}
                  {setting.canManage && (
                    <div className="d-flex flex-wrap align-items-end gap-2">
                      <div className="flex-grow-1">
                        <label className="form-label" htmlFor={`clip-policy-${setting.cameraId}`}>
                          {t('clips.policy.label')}
                        </label>
                        <select
                          className="form-select"
                          id={`clip-policy-${setting.cameraId}`}
                          value={draft}
                          disabled={policyBusyCamera !== undefined}
                          onChange={(event) =>
                            setPolicyDrafts((current) => ({
                              ...current,
                              [setting.cameraId]: event.target.value as DispatchPolicy,
                            }))
                          }
                        >
                          {(['always', 'large_motion', 'manual_only', 'never'] as const).map((value) => (
                            <option key={value} value={value}>
                              {t(dispatchPolicyKeys[value])}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={policyBusyCamera !== undefined || draft === setting.policy}
                        onClick={() => void updateDispatchPolicy(setting)}
                      >
                        {policyBusyCamera === setting.cameraId
                          ? t('clips.policy.saving')
                          : t('clips.policy.save')}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <form
        className="row g-2 align-items-end mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          void load(1);
        }}
      >
        <div className="col-12 col-sm-6 col-lg-3">
          <label className="form-label" htmlFor="clips-from">
            {t('clips.from')}
          </label>
          <input
            className="form-control"
            id="clips-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="col-12 col-sm-6 col-lg-3">
          <label className="form-label" htmlFor="clips-to">
            {t('clips.to')}
          </label>
          <input
            className="form-control"
            id="clips-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <div className="col-12 col-sm-6 col-lg-3">
          <label className="form-label" htmlFor="clips-state">
            {t('clips.state.label')}
          </label>
          <select
            className="form-select"
            id="clips-state"
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            <option value="">{t('clips.state.all')}</option>
            {(['collecting', 'ready', 'failed', 'lost_capacity'] as const).map((item) => (
              <option key={item} value={item}>
                {t(`clips.state.${item}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12 col-lg-3">
          <button className="btn btn-secondary w-100" type="submit" disabled={busy}>
            {t('clips.filter')}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" aria-live="polite">
          {t('clips.loading')}
        </p>
      )}
      {!busy && !error && items.length === 0 && <p role="status">{t('clips.empty')}</p>}
      {items.length > 0 && (
        <>
          <ol className="clip-timeline" aria-label={t('clips.timeline')}>
            {items.map((clip) => (
              <li className="clip-timeline-item" key={clip.publicId}>
                {clip.thumbnailUrl && (
                  <img src={clip.thumbnailUrl} alt="" loading="lazy" className="clip-thumbnail" />
                )}
                <div className="clip-summary">
                  <strong>{formatDate(clip.startedAtUtc)}</strong>
                  <span>
                    {clip.cameraId} · {t(stateKeys[clip.state] ?? 'clips.unknown')} ·{' '}
                    {t(archiveKeys[clip.archiveStatus] ?? 'clips.unknown')}
                  </span>
                  <span>
                    {t('clips.analysis')}: {t(analysisKeys[clip.analysisStatus] ?? 'clips.unknown')}
                  </span>
                  {clip.isPreserved && (
                    <span className="badge text-bg-warning">{t('clips.preservation.preserved')}</span>
                  )}
                </div>
                <div className="d-flex flex-wrap align-items-start gap-2">
                  <button
                    className="btn btn-outline-primary"
                    type="button"
                    onClick={() => void openClip(clip.publicId)}
                  >
                    {t('clips.details')}
                  </button>
                  {renderAnalysisAction(clip)}
                  {isAdmin && clip.state === 'ready' && clip.archiveStatus === 'archived' && (
                    <button
                      className="btn btn-outline-secondary"
                      type="button"
                      disabled={preservationBusyClip !== undefined}
                      onClick={() => void togglePreservation(clip)}
                    >
                      {preservationBusyClip === clip.publicId
                        ? t('clips.preservation.saving')
                        : t(clip.isPreserved ? 'clips.preservation.release' : 'clips.preservation.preserve')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="d-flex align-items-center justify-content-between gap-2 mt-3">
            <span aria-live="polite">
              {t('clips.page', { current: page, total: Math.max(1, Math.ceil(total / PAGE_SIZE)) })}
            </span>
            <div className="d-flex gap-2">
              <button
                className="btn btn-outline-secondary"
                type="button"
                disabled={busy || page <= 1}
                onClick={() => void load(page - 1)}
              >
                {t('clips.previous')}
              </button>
              <button
                className="btn btn-outline-secondary"
                type="button"
                disabled={busy || page * PAGE_SIZE >= total}
                onClick={() => void load(page + 1)}
              >
                {t('clips.next')}
              </button>
            </div>
          </div>
        </>
      )}
      {selected && (
        <section className="clip-detail panel-card mt-4" aria-labelledby="clip-detail-title">
          <h3 id="clip-detail-title" className="h6">
            {t('clips.detailTitle')}
          </h3>
          <p>
            {formatDate(selected.clip.startedAtUtc)} – {formatDate(selected.clip.endedAtUtc)}
          </p>
          <dl className="clip-metadata">
            <dt>{t('clips.camera')}</dt>
            <dd>{selected.clip.cameraId}</dd>
            <dt>{t('clips.mediaState')}</dt>
            <dd>{t(stateKeys[selected.clip.state] ?? 'clips.unknown')}</dd>
            <dt>{t('clips.archiveState')}</dt>
            <dd>{t(archiveKeys[selected.clip.archiveStatus] ?? 'clips.unknown')}</dd>
            <dt>{t('clips.analysis')}</dt>
            <dd>{t(analysisKeys[selected.clip.analysisStatus] ?? 'clips.unknown')}</dd>
            <dt>{t('clips.trigger')}</dt>
            <dd>{selected.clip.triggerReason ?? t('clips.unknown')}</dd>
            <dt>{t('clips.updated')}</dt>
            <dd>{formatDate(selected.updatedAtUtc)}</dd>
          </dl>
          {renderAnalysisAction(selected.clip)}
          {isAdmin && selected.clip.state === 'ready' && selected.clip.archiveStatus === 'archived' && (
            <div className="mt-2">
              <button
                className="btn btn-outline-secondary"
                type="button"
                disabled={preservationBusyClip !== undefined}
                onClick={() => void togglePreservation(selected.clip)}
              >
                {preservationBusyClip === selected.clip.publicId
                  ? t('clips.preservation.saving')
                  : t(
                      selected.clip.isPreserved
                        ? 'clips.preservation.release'
                        : 'clips.preservation.preserve',
                    )}
              </button>
              {preservationNotice?.clipId === selected.clip.publicId && (
                <p
                  role={preservationNotice.error ? 'alert' : 'status'}
                  aria-live="polite"
                  className={preservationNotice.error ? 'error-text' : undefined}
                >
                  {preservationNotice.text}
                </p>
              )}
            </div>
          )}
          {selected.mediaUrl && (
            <>
              <p className="small text-secondary">{t('clips.captionsUnavailable')}</p>
              {/* biome-ignore lint/a11y/useMediaCaption: The clip contract has no caption track; explicitly disclose this limitation. */}
              <video
                key={`${selected.clip.publicId}-${playbackAttempt}`}
                className="clip-video"
                controls
                preload="metadata"
                src={selected.mediaUrl}
                onError={() => setPlaybackError(true)}
                onLoadedMetadata={() => setPlaybackError(false)}
              >
                {t('clips.videoFallback')}
              </video>
              {playbackError && (
                <div className="error-text mt-2" role="alert">
                  <p>{t('clips.playback.error')}</p>
                  <button
                    className="btn btn-outline-secondary btn-sm"
                    type="button"
                    onClick={() => {
                      setPlaybackError(false);
                      setPlaybackAttempt((current) => current + 1);
                    }}
                  >
                    {t('clips.playback.retry')}
                  </button>
                </div>
              )}
            </>
          )}
          {!selected.mediaUrl && <p role="status">{t('clips.mediaUnavailable')}</p>}
        </section>
      )}
    </section>
  );
}
