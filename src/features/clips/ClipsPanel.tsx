import type { TranslationKey } from 'home-ia-shared';
import { ApiError, buildDeepLink, getJson, request, useI18n } from 'home-ia-shared';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { emitClipDownload } from './clipEvents';

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

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}
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
  unavailable: 'clips.analysisState.unavailable',
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

export function ClipsPanel({
  cameraId,
  isAdmin = false,
  view = 'library',
  deepLinkParams,
  onDeepLinkParamsChange,
}: {
  cameraId?: string;
  isAdmin?: boolean;
  view?: 'library' | 'settings';
  deepLinkParams?: Record<string, string>;
  onDeepLinkParamsChange?: (params: Record<string, string>) => void;
}) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ClipItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const [publicId, setPublicId] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [sort, setSort] = useState('newest');
  const [preserved, setPreserved] = useState('');
  const [minDuration, setMinDuration] = useState('');
  const [maxDuration, setMaxDuration] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [from, setFrom] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [to, setTo] = useState('');
  const [toTime, setToTime] = useState('');
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
  const [range, setRange] = useState<'all' | 'today' | '7d' | '30d' | 'custom'>('all');
  const [detailLoading, setDetailLoading] = useState<string>();
  const [linkNotice, setLinkNotice] = useState<{ text: string; error: boolean }>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const requestedClipRef = useRef<string | undefined>(undefined);

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
    async (
      targetPage = 1,
      overrides?: {
        from?: string;
        fromTime?: string;
        to?: string;
        toTime?: string;
        state?: string;
        publicId?: string;
        analysis?: string;
        sort?: string;
        preserved?: string;
        minDuration?: string;
        maxDuration?: string;
      },
      append = false,
    ) => {
      const fromValue = overrides?.from ?? from;
      const fromTimeValue = overrides?.fromTime ?? fromTime;
      const toValue = overrides?.to ?? to;
      const toTimeValue = overrides?.toTime ?? toTime;
      const stateValue = overrides?.state ?? state;
      const publicIdValue = (overrides?.publicId ?? publicId).trim().toUpperCase();
      const analysisValue = overrides?.analysis ?? analysis;
      const sortValue = overrides?.sort ?? sort;
      const preservedValue = overrides?.preserved ?? preserved;
      const minDurationValue = overrides?.minDuration ?? minDuration;
      const maxDurationValue = overrides?.maxDuration ?? maxDuration;
      if (append) setLoadingMore(true);
      else {
        setBusy(true);
        setSelectedIds(new Set());
      }
      setError('');
      try {
        const query = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
        if (cameraId) query.set('cameraId', cameraId);
        if (publicIdValue) query.set('publicId', publicIdValue);
        if (stateValue) query.set('state', stateValue);
        if (analysisValue) query.set('analysis', analysisValue);
        if (sortValue && sortValue !== 'newest') query.set('sort', sortValue);
        if (preservedValue) query.set('preserved', preservedValue);
        if (minDurationValue) query.set('minDurationSeconds', minDurationValue);
        if (maxDurationValue) query.set('maxDurationSeconds', maxDurationValue);
        if (fromValue)
          query.set('fromUtc', new Date(`${fromValue}T${fromTimeValue || '00:00'}:00Z`).toISOString());
        if (toValue)
          query.set('toUtc', new Date(`${toValue}T${toTimeValue || '23:59'}:59.999Z`).toISOString());
        const result = await getJson<ClipPage>(`/api/v1/clips?${query}`);
        setItems((current) => {
          if (!append) return result.items;
          const seen = new Set(current.map((item) => item.publicId));
          return [...current, ...result.items.filter((item) => !seen.has(item.publicId))];
        });
        setTotal(result.total);
        setPage(result.page);
        setHasMore(result.page * result.pageSize < result.total);
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
        if (!append) {
          setItems([]);
          setTotal(0);
          setHasMore(false);
        }
      } finally {
        if (append) setLoadingMore(false);
        else setBusy(false);
      }
    },
    [
      analysis,
      cameraId,
      from,
      fromTime,
      loadDispatchPolicies,
      maxDuration,
      minDuration,
      preserved,
      publicId,
      sort,
      state,
      t,
      to,
      toTime,
    ],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial load; filters reload explicitly.
  useEffect(() => {
    setSelected(undefined);
    setSelectedIds(new Set());
    void load(1);
  }, [cameraId]);

  function toggleSelection(publicIdValue: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(publicIdValue)) next.delete(publicIdValue);
      else next.add(publicIdValue);
      return next;
    });
  }

  function toggleAllLoaded() {
    setSelectedIds((current) =>
      current.size === items.length ? new Set() : new Set(items.map((item) => item.publicId)),
    );
  }

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loadingMore || busy || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(page + 1, undefined, true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [busy, hasMore, load, loadingMore, page]);

  async function downloadSelected() {
    if (selectedIds.size === 0) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const response = await fetch(
        `/api/v1/clips/download?ids=${encodeURIComponent([...selectedIds].join(','))}`,
        { credentials: 'same-origin' },
      );
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'clips.zip';
      anchor.click();
      emitClipDownload();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setDownloadError(t('clips.download.error'));
    } finally {
      setDownloading(false);
    }
  }

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

  const openClip = useCallback(
    async (clipId: string) => {
      lastFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSelected(undefined);
      setDetailLoading(clipId);
      setPlaybackError(false);
      setPlaybackAttempt(0);
      setError('');
      try {
        setSelected(await getJson<ClipDetails>(`/api/v1/clips/${encodeURIComponent(clipId)}`));
        setLinkNotice(undefined);
        requestedClipRef.current = clipId;
        if (deepLinkParams?.clip !== clipId) {
          onDeepLinkParamsChange?.({ ...(deepLinkParams ?? {}), clip: clipId });
        }
      } catch (failure) {
        setError(
          failure instanceof ApiError && failure.status === 403
            ? t('clips.error.denied')
            : t('clips.error.detail'),
        );
      } finally {
        setDetailLoading(undefined);
      }
    },
    [deepLinkParams, onDeepLinkParamsChange, t],
  );

  const closeDetail = useCallback(() => {
    setSelected(undefined);
    setPlaybackError(false);
    setPlaybackAttempt(0);
    setLinkNotice(undefined);
    requestedClipRef.current = undefined;
    if (deepLinkParams?.clip) {
      const next = { ...(deepLinkParams ?? {}) };
      delete next.clip;
      onDeepLinkParamsChange?.(next);
    }
    lastFocusRef.current?.focus();
  }, [deepLinkParams, onDeepLinkParamsChange]);

  useEffect(() => {
    const requested = deepLinkParams?.clip;
    if (!requested || requested === requestedClipRef.current) return;
    requestedClipRef.current = requested;
    if (selected?.clip.publicId === requested) return;
    void openClip(requested);
    // openClip re-reads the current detail state; the ref guards repeated requests.
  }, [deepLinkParams?.clip, selected?.clip.publicId, openClip]);

  async function copyClipLink(clipId: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(
        buildDeepLink(window.location, { module: 'monitoring', view: 'clips', clip: clipId }),
      );
      setLinkNotice({ text: t('clips.link.copied'), error: false });
    } catch {
      setLinkNotice({ text: t('clips.link.failed'), error: true });
    }
  }

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDetail();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeDetail, selected]);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), video, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

  const formatDateOnly = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(new Date(value));

  const formatTime = (value: string) =>
    new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(value));

  function formatDuration(startedAtUtc: string, endedAtUtc: string) {
    const seconds = Math.max(
      0,
      Math.round((new Date(endedAtUtc).getTime() - new Date(startedAtUtc).getTime()) / 1000),
    );
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function formatSize(sizeBytes: number | null) {
    if (sizeBytes === null) return t('clips.unknown');
    if (sizeBytes >= 1024 ** 3) return `${(sizeBytes / 1024 ** 3).toFixed(1)} GB`;
    if (sizeBytes >= 1024 ** 2) return `${(sizeBytes / 1024 ** 2).toFixed(1)} MB`;
    if (sizeBytes >= 1024) return `${Math.round(sizeBytes / 1024)} KB`;
    return `${sizeBytes} B`;
  }

  const groups = useMemo(() => {
    const map = new Map<string, ClipItem[]>();
    for (const clip of items) {
      const key = dayKey(clip.startedAtUtc);
      const list = map.get(key) ?? [];
      list.push(clip);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [items]);

  function applyQuickRange(value: 'all' | 'today' | '7d' | '30d') {
    const today = new Date();
    const toValue = value === 'all' ? '' : today.toISOString().slice(0, 10);
    let fromValue = '';
    if (value === 'today') fromValue = toValue;
    if (value === '7d' || value === '30d') {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - (value === '7d' ? 6 : 29));
      fromValue = start.toISOString().slice(0, 10);
    }
    setRange(value);
    setFrom(fromValue);
    setFromTime('');
    setTo(toValue);
    setToTime('');
    void load(1, { from: fromValue, to: toValue });
  }

  function clearFilters() {
    setRange('all');
    setFrom('');
    setFromTime('');
    setTo('');
    setToTime('');
    setState('');
    setPublicId('');
    setAnalysis('');
    setSort('newest');
    setPreserved('');
    setMinDuration('');
    setMaxDuration('');
    void load(1, {
      from: '',
      fromTime: '',
      to: '',
      toTime: '',
      state: '',
      publicId: '',
      analysis: '',
      sort: 'newest',
      preserved: '',
      minDuration: '',
      maxDuration: '',
    });
  }

  function mediaBadgeClass(value: string) {
    if (value === 'ready') return 'text-bg-success';
    if (value === 'collecting') return 'text-bg-info';
    return 'text-bg-danger';
  }

  function archiveBadgeClass(value: string) {
    if (value === 'archived') return 'text-bg-success';
    if (value === 'failed' || value === 'expired') return 'text-bg-danger';
    if (['pending', 'copying', 'verifying', 'retry_wait', 'expiring'].includes(value)) {
      return 'text-bg-warning';
    }
    return 'text-bg-secondary';
  }

  function analysisBadgeClass(value: string) {
    if (value === 'failed') return 'text-bg-danger';
    if (['processing', 'analysis_pending', 'retry_wait'].includes(value)) return 'text-bg-info';
    return 'text-bg-secondary';
  }

  return (
    <section className="panel-card clips-panel" aria-labelledby="clips-title">
      <div className="clips-header">
        <div>
          <span className="eyebrow">{t('clips.eyebrow')}</span>
          <h2 id="clips-title" className="h5 mt-2">
            {t('clips.title')}
          </h2>
          <p className="small text-secondary mb-0">{t('clips.description')}</p>
        </div>
        <div className="clips-header-actions">
          <button
            className="btn btn-outline-secondary btn-sm"
            type="button"
            disabled={busy}
            onClick={() => void load(page)}
          >
            {t('clips.refresh')}
          </button>
        </div>
      </div>

      {view === 'library' && (
        <section id="clips-view-library" aria-label={t('clips.tab.library')}>
          <form
            className="clips-filters"
            onSubmit={(event) => {
              event.preventDefault();
              void load(1);
            }}
          >
            <fieldset className="clips-quick-ranges">
              <legend className="visually-hidden">{t('clips.quickRange.label')}</legend>
              {(['today', '7d', '30d', 'all'] as const).map((value) => (
                <button
                  key={value}
                  className={`btn btn-sm ${range === value ? 'btn-primary' : 'btn-outline-secondary'}`}
                  type="button"
                  aria-pressed={range === value}
                  onClick={() => applyQuickRange(value)}
                >
                  {t(`clips.quickRange.${value}`)}
                </button>
              ))}
            </fieldset>
            <fieldset className="clips-filter-group">
              <legend>{t('clips.filter.groupPeriod')}</legend>
              <div className="clips-filter-grid">
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-from">
                    {t('clips.from')}
                  </label>
                  <input
                    className="form-control"
                    id="clips-from"
                    type="date"
                    value={from}
                    onChange={(event) => {
                      setFrom(event.target.value);
                      setRange('custom');
                    }}
                  />
                </div>
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-from-time">
                    {t('clips.filter.fromTime')}
                  </label>
                  <input
                    className="form-control"
                    id="clips-from-time"
                    type="time"
                    value={fromTime}
                    onChange={(event) => setFromTime(event.target.value)}
                  />
                </div>
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-to">
                    {t('clips.to')}
                  </label>
                  <input
                    className="form-control"
                    id="clips-to"
                    type="date"
                    value={to}
                    onChange={(event) => {
                      setTo(event.target.value);
                      setRange('custom');
                    }}
                  />
                </div>
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-to-time">
                    {t('clips.filter.toTime')}
                  </label>
                  <input
                    className="form-control"
                    id="clips-to-time"
                    type="time"
                    value={toTime}
                    onChange={(event) => setToTime(event.target.value)}
                  />
                </div>
              </div>
            </fieldset>
            <fieldset className="clips-filter-group">
              <legend>{t('clips.filter.groupIdentity')}</legend>
              <div className="clips-filter-grid">
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-public-id">
                    {t('clips.filter.publicId')}
                  </label>
                  <input
                    className="form-control"
                    id="clips-public-id"
                    value={publicId}
                    placeholder={t('clips.filter.publicIdPlaceholder')}
                    onChange={(event) => setPublicId(event.target.value)}
                  />
                </div>
                <div className="clips-filter-field">
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
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-analysis">
                    {t('clips.filter.analysis')}
                  </label>
                  <select
                    className="form-select"
                    id="clips-analysis"
                    value={analysis}
                    onChange={(event) => setAnalysis(event.target.value)}
                  >
                    <option value="">{t('clips.filter.analysisAny')}</option>
                    <option value="performed">{t('clips.filter.analysisPerformed')}</option>
                    <option value="not_performed">{t('clips.filter.analysisNotPerformed')}</option>
                  </select>
                </div>
              </div>
            </fieldset>
            <fieldset className="clips-filter-group">
              <legend>{t('clips.filter.groupDuration')}</legend>
              <div className="clips-filter-grid">
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-min-duration">
                    {t('clips.filter.minDuration')}
                  </label>
                  <input
                    className="form-control"
                    id="clips-min-duration"
                    type="number"
                    min="0"
                    max="86400"
                    value={minDuration}
                    onChange={(event) => setMinDuration(event.target.value)}
                  />
                </div>
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-max-duration">
                    {t('clips.filter.maxDuration')}
                  </label>
                  <input
                    className="form-control"
                    id="clips-max-duration"
                    type="number"
                    min="0"
                    max="86400"
                    value={maxDuration}
                    onChange={(event) => setMaxDuration(event.target.value)}
                  />
                </div>
              </div>
            </fieldset>
            <fieldset className="clips-filter-group">
              <legend>{t('clips.filter.groupOrder')}</legend>
              <div className="clips-filter-grid">
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-sort">
                    {t('clips.sort.label')}
                  </label>
                  <select
                    className="form-select"
                    id="clips-sort"
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                  >
                    {(['newest', 'oldest', 'longest', 'shortest', 'largest', 'smallest'] as const).map(
                      (value) => (
                        <option key={value} value={value}>
                          {t(`clips.sort.${value}`)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="clips-filter-field">
                  <label className="form-label" htmlFor="clips-preserved">
                    {t('clips.filter.preserved')}
                  </label>
                  <select
                    className="form-select"
                    id="clips-preserved"
                    value={preserved}
                    onChange={(event) => setPreserved(event.target.value)}
                  >
                    <option value="">{t('clips.filter.preservedAll')}</option>
                    <option value="true">{t('clips.filter.preservedYes')}</option>
                    <option value="false">{t('clips.filter.preservedNo')}</option>
                  </select>
                </div>
              </div>
            </fieldset>
            <div className="clips-filter-actions">
              <button className="btn btn-secondary" type="submit" disabled={busy}>
                {t('clips.filter')}
              </button>
            </div>
            {(from ||
              to ||
              state ||
              publicId ||
              analysis ||
              minDuration ||
              maxDuration ||
              preserved ||
              sort !== 'newest') && (
              <div className="clips-filter-summary">
                <span>{t('clips.filters.active')}</span>
                <button className="btn btn-link btn-sm p-0" type="button" onClick={clearFilters}>
                  {t('clips.filters.clear')}
                </button>
              </div>
            )}
          </form>

          <div className="clips-results-header">
            <span aria-live="polite">{t('clips.resultCount', { count: total })}</span>
            {busy && (
              <span role="status" aria-live="polite">
                {t('clips.loading')}
              </span>
            )}
          </div>

          {items.length > 0 && (
            <div className="clips-selection-bar">
              <label className="form-check-label small">
                <input
                  className="form-check-input me-2"
                  type="checkbox"
                  checked={selectedIds.size === items.length}
                  onChange={toggleAllLoaded}
                />
                {t('clips.selectAll')}
              </label>
              <button
                className="btn btn-outline-secondary btn-sm"
                type="button"
                disabled={selectedIds.size === 0 || downloading}
                onClick={() => void downloadSelected()}
              >
                {downloading
                  ? t('clips.downloading')
                  : t('clips.downloadSelected', { count: selectedIds.size })}
              </button>
              {downloadError && (
                <span className="error-text" role="alert">
                  {downloadError}
                </span>
              )}
            </div>
          )}

          {error && (
            <div className="error-text" role="alert">
              <p>{error}</p>
              <button
                className="btn btn-outline-secondary btn-sm"
                type="button"
                onClick={() => void load(page)}
              >
                {t('clips.retry')}
              </button>
            </div>
          )}

          {!busy && !error && items.length === 0 && (
            <div className="clips-empty" role="status">
              <p className="mb-2">{t('clips.empty')}</p>
              {(from || to || state) && (
                <button className="btn btn-outline-secondary btn-sm" type="button" onClick={clearFilters}>
                  {t('clips.filters.clear')}
                </button>
              )}
            </div>
          )}

          {items.length > 0 && (
            <>
              <div className="clip-groups">
                {groups.map(([key, clips]) => (
                  <section className="clip-day" key={key} aria-labelledby={`clip-day-${key}`}>
                    <h3 id={`clip-day-${key}`} className="clip-day-title">
                      {formatDateOnly(
                        clips[0]?.startedAtUtc ?? items[0]?.startedAtUtc ?? new Date().toISOString(),
                      )}
                    </h3>
                    <ul className="clip-card-grid" aria-label={t('clips.timeline')}>
                      {clips.map((clip) => (
                        <li className="clip-card" key={clip.publicId}>
                          <label className="clip-card-select">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(clip.publicId)}
                              onChange={() => toggleSelection(clip.publicId)}
                              aria-label={`${t('clips.selectClip')}: ${formatDate(clip.startedAtUtc)}`}
                            />
                          </label>
                          <button
                            className="clip-card-open"
                            type="button"
                            aria-busy={detailLoading === clip.publicId}
                            aria-label={`${t('clips.details')}: ${formatDate(clip.startedAtUtc)}`}
                            onClick={() => void openClip(clip.publicId)}
                          >
                            <span className="clip-card-media">
                              {clip.thumbnailUrl ? (
                                <img
                                  src={clip.thumbnailUrl}
                                  alt=""
                                  loading="lazy"
                                  className="clip-thumbnail"
                                />
                              ) : (
                                <span
                                  className="clip-thumbnail clip-thumbnail-placeholder"
                                  aria-hidden="true"
                                >
                                  ▶
                                </span>
                              )}
                              <span className="clip-card-duration">
                                {formatDuration(clip.startedAtUtc, clip.endedAtUtc)}
                              </span>
                            </span>
                            <span className="clip-card-body">
                              <span className="clip-card-time">
                                {formatTime(clip.startedAtUtc)} – {formatTime(clip.endedAtUtc)}
                              </span>
                              <span className="clip-card-meta">
                                {clip.publicId} · {clip.cameraId} · {formatSize(clip.sizeBytes)}
                              </span>
                              <span className="clip-card-badges">
                                <span className={`badge ${mediaBadgeClass(clip.state)}`}>
                                  {t(stateKeys[clip.state] ?? 'clips.unknown')}
                                </span>
                                <span className={`badge ${archiveBadgeClass(clip.archiveStatus)}`}>
                                  {t(archiveKeys[clip.archiveStatus] ?? 'clips.unknown')}
                                </span>
                                {clip.analysisStatus !== 'not_requested' && (
                                  <span className={`badge ${analysisBadgeClass(clip.analysisStatus)}`}>
                                    {t('clips.analysis')}:{' '}
                                    {t(analysisKeys[clip.analysisStatus] ?? 'clips.unknown')}
                                  </span>
                                )}
                                {clip.isPreserved && (
                                  <span className="badge text-bg-warning">
                                    {t('clips.preservation.preserved')}
                                  </span>
                                )}
                              </span>
                            </span>
                          </button>
                          <a
                            className="clip-card-download"
                            href={`/api/v1/clips/${clip.publicId}/media?download=true`}
                            download
                            aria-label={`${t('clips.downloadClip')}: ${formatDate(clip.startedAtUtc)}`}
                          >
                            ↓
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <div className="clips-load-more">
                <span aria-live="polite">{t('clips.loadedCount', { loaded: items.length, total })}</span>
                {hasMore && (
                  <button
                    className="btn btn-outline-secondary btn-sm"
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void load(page + 1, undefined, true)}
                  >
                    {loadingMore ? t('clips.loadingMore') : t('clips.loadMore')}
                  </button>
                )}
                <div ref={sentinelRef} aria-hidden="true" className="clips-sentinel" />
              </div>
            </>
          )}
        </section>
      )}

      {view === 'settings' && (
        <section id="clips-view-settings" aria-label={t('clips.tab.settings')} className="clips-settings">
          <p className="small text-secondary mb-0">{t('clips.settings.description')}</p>
          {isAdmin && (
            <section className="panel-card" aria-labelledby="clip-trigger-title">
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
            <section className="panel-card" aria-labelledby="clip-retention-title">
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
            <section className="panel-card" aria-labelledby="clip-policy-title">
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
        </section>
      )}

      {selected &&
        createPortal(
          <div className="clip-dialog-backdrop">
            <button
              className="clip-dialog-scrim"
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={closeDetail}
            />
            <div
              className="clip-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clip-detail-title"
              onKeyDown={handleDialogKeyDown}
            >
              <div className="clip-dialog-header">
                <div>
                  <span className="eyebrow">{t('clips.detailEyebrow')}</span>
                  <h3 id="clip-detail-title" className="h5 mt-1">
                    {t('clips.detailTitle')}
                  </h3>
                  <p className="small text-secondary mb-0">
                    {formatDate(selected.clip.startedAtUtc)} – {formatDate(selected.clip.endedAtUtc)}
                  </p>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <button
                    className="btn btn-outline-secondary btn-sm"
                    type="button"
                    onClick={() => void copyClipLink(selected.clip.publicId)}
                  >
                    {t('clips.link.copy')}
                  </button>
                  <button
                    ref={closeButtonRef}
                    className="btn-close"
                    type="button"
                    aria-label={t('clips.close')}
                    onClick={closeDetail}
                  />
                </div>
              </div>
              {linkNotice && (
                <p
                  role={linkNotice.error ? 'alert' : 'status'}
                  aria-live="polite"
                  className={linkNotice.error ? 'error-text mb-0 px-3' : 'small text-secondary mb-0 px-3'}
                >
                  {linkNotice.text}
                </p>
              )}
              <div className="clip-dialog-body">
                {selected.mediaUrl ? (
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
                ) : (
                  <p role="status">{t('clips.mediaUnavailable')}</p>
                )}
                <dl className="clip-metadata">
                  <dt>{t('clips.camera')}</dt>
                  <dd>{selected.clip.cameraId}</dd>
                  <dt>{t('clips.mediaState')}</dt>
                  <dd>{t(stateKeys[selected.clip.state] ?? 'clips.unknown')}</dd>
                  <dt>{t('clips.archiveState')}</dt>
                  <dd>{t(archiveKeys[selected.clip.archiveStatus] ?? 'clips.unknown')}</dd>
                  <dt>{t('clips.analysis')}</dt>
                  <dd>{t(analysisKeys[selected.clip.analysisStatus] ?? 'clips.unknown')}</dd>
                  <dt>{t('clips.duration')}</dt>
                  <dd>{formatDuration(selected.clip.startedAtUtc, selected.clip.endedAtUtc)}</dd>
                  <dt>{t('clips.size')}</dt>
                  <dd>{formatSize(selected.clip.sizeBytes)}</dd>
                  <dt>{t('clips.trigger')}</dt>
                  <dd>{selected.clip.triggerReason ?? t('clips.unknown')}</dd>
                  <dt>{t('clips.updated')}</dt>
                  <dd>{formatDate(selected.updatedAtUtc)}</dd>
                </dl>
                <div className="clip-dialog-actions">
                  <a
                    className="btn btn-outline-secondary"
                    href={`/api/v1/clips/${selected.clip.publicId}/media?download=true`}
                    download
                  >
                    {t('clips.download')}
                  </a>
                  {renderAnalysisAction(selected.clip)}
                  {isAdmin &&
                    selected.clip.state === 'ready' &&
                    selected.clip.archiveStatus === 'archived' && (
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
                    )}
                </div>
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
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
