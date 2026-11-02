import { useEffect, useRef, useState } from 'react';
import { StatusBadge } from '../../components/StatusBadge';
import type { CameraStatus, ReadinessResponse, SystemProfile } from '../../domain/platform';
import { useI18n } from '../../i18n/i18n';
import type { TranslationKey, TranslationValues } from '../../i18n/messages';
import { getJson, request } from '../../services/http';

interface OperationsPanelProps {
  camera: CameraStatus;
  view: 'health' | 'dependencies' | 'capture';
  playerStatus: string;
}
type State = 'healthy' | 'pending' | 'degraded' | 'failed' | 'neutral';
interface HealthItem {
  key: TranslationKey;
  state: State;
  values?: TranslationValues;
}
interface GatewayText {
  key: TranslationKey;
  values?: TranslationValues;
}

function captureState(state: string | undefined): HealthItem {
  const labels: Record<string, [TranslationKey, State]> = {
    capturing: ['capture.state.capturing', 'healthy'],
    connecting: ['capture.state.connecting', 'pending'],
    starting: ['capture.state.starting', 'pending'],
    reconnecting: ['capture.state.reconnecting', 'degraded'],
    'spool-unavailable': ['capture.state.spoolUnavailable', 'failed'],
    stopped: ['capture.state.stopped', 'failed'],
  };
  const item = labels[state ?? ''];
  return item ? { key: item[0], state: item[1] } : { key: 'operations.state.unknown', state: 'neutral' };
}

function safeCaptureError(code: string | null | undefined, t: ReturnType<typeof useI18n>['t']) {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    capture_source_unavailable: 'operations.error.sourceUnavailable',
    capture_segment_timeout: 'operations.error.segmentTimeout',
    capture_codec_unsupported: 'operations.error.codecUnsupported',
    spool_unavailable: 'operations.error.spoolUnavailable',
  };
  return code ? t(labels[code] ?? 'operations.error.generic') : '';
}

export function OperationsPanel({ camera, view, playerStatus }: OperationsPanelProps) {
  const { t, locale } = useI18n();
  const [apiHealth, setApiHealth] = useState<HealthItem>({
    key: 'operations.state.querying',
    state: 'pending',
  });
  const [readiness, setReadiness] = useState<ReadinessResponse>();
  const [profile, setProfile] = useState<SystemProfile>();
  const [gateway, setGateway] = useState<HealthItem>({
    key: 'operations.state.waiting',
    state: 'pending',
  });
  const [gatewayDetail, setGatewayDetail] = useState<GatewayText>({
    key: 'operations.gatewayChecking',
  });
  const [gatewayDependency, setGatewayDependency] = useState<HealthItem>({
    key: 'operations.state.waiting',
    state: 'pending',
  });
  const [updated, setUpdated] = useState('—');
  const profileLoaded = useRef(false);
  const lastGatewayCheck = useRef(0);

  useEffect(() => {
    lastGatewayCheck.current = 0;
    let active = true;
    let updateInFlight = false;
    const controller = new AbortController();
    const update = async () => {
      if (updateInFlight) return;
      updateInFlight = true;
      try {
        const [liveResult, readyResult] = await Promise.allSettled([
          getJson<{ status: string }>('/health/live', controller.signal),
          request('/health/ready', { signal: controller.signal }),
        ]);
        if (!active) return;
        setApiHealth(
          liveResult.status === 'fulfilled'
            ? { key: 'operations.api.operational', state: 'healthy' }
            : { key: 'operations.api.unavailable', state: 'failed' },
        );
        if (
          readyResult.status === 'fulfilled' &&
          (readyResult.value.ok || readyResult.value.status === 503)
        ) {
          try {
            setReadiness((await readyResult.value.json()) as ReadinessResponse);
          } catch {
            setReadiness(undefined);
          }
        } else setReadiness(undefined);

        if (!profileLoaded.current) {
          try {
            setProfile(await getJson<SystemProfile>('/api/v1/system-profile', controller.signal));
            profileLoaded.current = true;
          } catch {
            /* Admin profile is optional presentation data. */
          }
        }
        if (Date.now() - lastGatewayCheck.current < 15000) {
          if (active) setUpdated(new Date().toLocaleTimeString(locale));
          return;
        }
        lastGatewayCheck.current = Date.now();
        const started = performance.now();
        try {
          const response = await request(camera.liveUrl, { signal: controller.signal });
          if (!active) return;
          const body = await response.text();
          if (response.status === 401) {
            setGateway({ key: 'operations.gateway.sessionExpired', state: 'failed' });
            setGatewayDependency({ key: 'operations.gateway.noSession', state: 'failed' });
          } else if (response.ok && body.startsWith('#EXTM3U')) {
            setGateway({ key: 'operations.gateway.available', state: 'healthy' });
            setGatewayDetail({
              key: 'operations.gateway.playlistDetail',
              values: { milliseconds: Math.round(performance.now() - started) },
            });
            setGatewayDependency({ key: 'operations.gateway.available', state: 'healthy' });
          } else if (response.status === 503) {
            setGateway({ key: 'operations.gateway.waitingSegments', state: 'degraded' });
            setGatewayDetail({ key: 'operations.gateway.waitingDetail' });
            setGatewayDependency({ key: 'operations.gateway.noSegments', state: 'degraded' });
          } else {
            setGateway({
              key: 'operations.gateway.http',
              state: 'failed',
              values: { status: response.status },
            });
            setGatewayDetail({ key: 'operations.gateway.unexpected' });
            setGatewayDependency({
              key: 'operations.gateway.http',
              state: 'failed',
              values: { status: response.status },
            });
          }
        } catch {
          if (active) {
            setGateway({ key: 'operations.gateway.noConnection', state: 'failed' });
            setGatewayDetail({ key: 'operations.gateway.noConnectionDetail' });
            setGatewayDependency({ key: 'operations.gateway.noConnection', state: 'failed' });
          }
        }
        if (active) setUpdated(new Date().toLocaleTimeString(locale));
      } finally {
        updateInFlight = false;
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
      controller.abort();
    };
  }, [camera.liveUrl, locale]);

  const capture = readiness?.capture;
  const captureHealth = captureState(capture?.state ?? camera.status);
  const count = capture?.spool?.segments ?? capture?.segments;
  const spoolHealth: HealthItem =
    capture?.spool?.status === 'available'
      ? { key: 'operations.state.available', state: 'healthy' }
      : capture?.spool?.status === 'unavailable'
        ? { key: 'operations.state.unavailable', state: 'failed' }
        : { key: 'operations.state.noData', state: 'pending' };
  return (
    <div className="operations-content">
      {view === 'health' && (
        <>
          <div className="d-flex align-items-end justify-content-between gap-2 mb-3">
            <div>
              <p className="eyebrow mb-1">{t('operations.health.eyebrow')}</p>
              <h2 className="h4 mb-0">{t('operations.health.title')}</h2>
            </div>
            <span className="small text-secondary text-end" aria-live="polite">
              {t('operations.updated', { time: updated })}
            </span>
          </div>
          <section className="row g-3 mb-3" aria-label={t('operations.health.connections')}>
            <div className="col-12 col-md-4">
              <article className="panel-card health-card h-100">
                <div className="d-flex align-items-center justify-content-between gap-2">
                  <h3 className="h6 mb-0">{t('operations.health.api')}</h3>
                  <StatusBadge label={t(apiHealth.key, apiHealth.values)} state={apiHealth.state} />
                </div>
                <p className="health-detail mt-3 mb-1">{profile?.serviceName ?? '—'}</p>
                <p className="small text-secondary mb-0">
                  {profile
                    ? t('operations.detail.environment', {
                        environment: profile.environment,
                        version: profile.applicationVersion,
                      })
                    : '—'}
                </p>
              </article>
            </div>
            <div className="col-12 col-md-4">
              <article className="panel-card health-card h-100">
                <div className="d-flex align-items-center justify-content-between gap-2">
                  <h3 className="h6 mb-0">{t('operations.health.capture')}</h3>
                  <StatusBadge
                    label={t(captureHealth.key, captureHealth.values)}
                    state={captureHealth.state}
                  />
                </div>
                <p className="health-detail mt-3 mb-1">{capture?.adapter ?? '—'}</p>
                <p className="small text-secondary mb-0">{safeCaptureError(capture?.lastErrorCode, t)}</p>
              </article>
            </div>
            <div className="col-12 col-md-4">
              <article className="panel-card health-card h-100">
                <div className="d-flex align-items-center justify-content-between gap-2">
                  <h3 className="h6 mb-0">{t('operations.health.gateway')}</h3>
                  <StatusBadge label={t(gateway.key, gateway.values)} state={gateway.state} />
                </div>
                <p className="health-detail mt-3 mb-1">{t(gatewayDetail.key, gatewayDetail.values)}</p>
                <p className="small text-secondary mb-0" role="status" aria-live="polite">
                  {playerStatus}
                </p>
              </article>
            </div>
          </section>
          <section className="panel-card system-details mb-3" aria-labelledby="details-title">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
              <div>
                <p className="eyebrow mb-1">{t('operations.health.telemetry')}</p>
                <h3 id="details-title" className="h5 mb-0">
                  {t('operations.health.processes')}
                </h3>
              </div>
              <span className="scope-label">{t('operations.health.localProfile')}</span>
            </div>
            <div className="row g-3">
              <Detail
                label={t('operations.detail.service')}
                value={profile?.serviceName ?? '—'}
                caption={t('operations.detail.environment', {
                  environment: profile?.environment ?? '—',
                  version: profile?.applicationVersion ?? '—',
                })}
              />
              <Detail
                label={t('operations.detail.adapter')}
                value={capture?.adapter ?? '—'}
                caption={t('operations.detail.version', { version: capture?.adapterVersion ?? '—' })}
              />
              <Detail
                label={t('operations.detail.capabilities')}
                value={capture?.capabilities?.join(' · ') || t('operations.detail.capabilitiesUnknown')}
                caption={t('operations.detail.adapterActive')}
              />
              <Detail
                label={t('operations.detail.streamSession')}
                value={
                  capture?.streamEpoch ? `…${capture.streamEpoch.slice(-8)}` : t('operations.detail.noEpoch')
                }
                caption={t('operations.detail.epochNote')}
              />
            </div>
          </section>
        </>
      )}
      {view === 'dependencies' && (
        <section className="panel-card dependencies-panel mb-3" aria-labelledby="dependencies-title">
          <div className="mb-3">
            <p className="eyebrow mb-1">{t('operations.dependencies.eyebrow')}</p>
            <h3 id="dependencies-title" className="h5 mb-1">
              {t('operations.dependencies.title')}
            </h3>
            <p className="small text-secondary mb-0">{t('operations.dependencies.description')}</p>
          </div>
          <div className="dependency-list">
            <Dependency
              name={t('operations.dependencies.api')}
              detail={t('operations.dependencies.apiDetail')}
              status={apiHealth}
            />
            <Dependency
              name={t('operations.dependencies.source')}
              detail={t('operations.dependencies.sourceDetail')}
              status={captureHealth}
            />
            <Dependency
              name={t('operations.dependencies.spool')}
              detail={t('operations.dependencies.spoolDetail')}
              status={spoolHealth}
            />
            <Dependency
              name={t('operations.dependencies.gateway')}
              detail={t('operations.dependencies.gatewayDetail')}
              status={gatewayDependency}
            />
            <Dependency
              name={t('operations.dependencies.notConfigured')}
              detail={t('operations.dependencies.notConfiguredDetail')}
              status={{ key: 'operations.dependencies.notConfiguredStatus', state: 'neutral' }}
            />
          </div>
          <p className="operational-note mt-3 mb-0">{t('operations.dependencies.note')}</p>
        </section>
      )}
      {view === 'capture' && (
        <>
          <div className="d-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-3">
            <div>
              <p className="eyebrow mb-1">{t('operations.capture.eyebrow')}</p>
              <h2 className="h4 mb-0">{t('operations.capture.title')}</h2>
            </div>
          </div>
          <section className="row g-3" aria-label={t('operations.capture.aria')}>
            <div className="col-6">
              <article className="panel-card metric-card h-100">
                <p className="eyebrow mb-2">{t('operations.capture.segments')}</p>
                <strong className="metric-value">{count ?? '—'}</strong>
                <span className="metric-caption">
                  {t('operations.capture.segmentsRetained')}
                  {capture?.spool?.segmentLimit !== undefined && (
                    <> {t('operations.capture.limit', { limit: capture.spool.segmentLimit })}</>
                  )}
                </span>
              </article>
            </div>
            <div className="col-6">
              <article className="panel-card metric-card h-100">
                <p className="eyebrow mb-2">{t('operations.capture.gaps')}</p>
                <strong className="metric-value">{capture?.gaps ?? '—'}</strong>
                <span className="metric-caption">{t('operations.capture.gapsDetail')}</span>
              </article>
            </div>
          </section>
          <p className="operational-note mt-4 mb-0">{t('operations.capture.note')}</p>
        </>
      )}
      <span className="visually-hidden" aria-live="polite">
        {playerStatus}
      </span>
    </div>
  );
}

function Detail({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="col-12 col-md-6">
      <div className="detail-item h-100">
        <span className="detail-label">{label}</span>
        <strong>{value}</strong>
        <span className="detail-caption">{caption}</span>
      </div>
    </div>
  );
}

function Dependency({ name, detail, status }: { name: string; detail: string; status: HealthItem }) {
  const { t } = useI18n();
  return (
    <div className="dependency-item">
      <span
        className={`dependency-icon ${status.state === 'neutral' ? 'inactive-icon' : 'active-icon'}`}
        aria-hidden="true"
      >
        {status.state === 'neutral' ? '○' : '●'}
      </span>
      <div>
        <strong>{name}</strong>
        <span>{detail}</span>
      </div>
      <span
        className={`dependency-state ${status.state}${status.state === 'neutral' ? ' neutral-state' : ''}`}
      >
        {t(status.key, status.values)}
      </span>
    </div>
  );
}
