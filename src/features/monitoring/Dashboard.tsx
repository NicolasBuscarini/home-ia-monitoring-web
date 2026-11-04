import type { CameraStatus, TranslationKey, UserRole } from 'home-ia-shared';
import { ModulePage, StatusBadge, useI18n } from 'home-ia-shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminCameraConnectionPanel } from '../admin/AdminCameraConnectionPanel';
import { AdminPeoplePanel } from '../admin/AdminPeoplePanel';
import { ClipsPanel } from '../clips/ClipsPanel';
import { OperationsPanel } from '../operations/OperationsPanel';
import { LivePlayer } from './LivePlayer';

type DashboardView =
  | 'monitor'
  | 'clips'
  | 'clip-settings'
  | 'health'
  | 'dependencies'
  | 'capture'
  | 'cameras'
  | 'people';

const viewLabels: Record<DashboardView, TranslationKey> = {
  monitor: 'dashboard.menu.monitor',
  clips: 'dashboard.menu.clips',
  'clip-settings': 'dashboard.menu.clipSettings',
  health: 'dashboard.menu.health',
  dependencies: 'dashboard.menu.dependencies',
  capture: 'dashboard.menu.capture',
  cameras: 'dashboard.menu.cameras',
  people: 'dashboard.menu.people',
};

const administrationViews: ReadonlySet<DashboardView> = new Set([
  'clip-settings',
  'health',
  'dependencies',
  'capture',
  'cameras',
  'people',
]);

interface DashboardProps {
  cameras: CameraStatus[];
  selectedCameraId?: string;
  onCameraSelect: (cameraId: string) => void;
  userRole: UserRole;
  portalModuleIds?: string[];
  activeView?: string;
  deepLinkParams?: Record<string, string>;
  onDeepLinkParamsChange?: (params: Record<string, string>) => void;
}

export function Dashboard({
  cameras,
  selectedCameraId,
  onCameraSelect,
  userRole,
  portalModuleIds,
  activeView,
  deepLinkParams,
  onDeepLinkParamsChange,
}: DashboardProps) {
  const { t } = useI18n();
  const [playerStatus, setPlayerStatus] = useState(() => t('player.status.notStarted'));
  const playerAnchorRef = useRef<HTMLDivElement>(null);
  const didAutoScrollRef = useRef(false);
  const isAdmin = userRole === 'Administrator';
  const showMonitoring = !portalModuleIds || portalModuleIds.includes('monitoring');
  const showAdministration = !portalModuleIds || portalModuleIds.includes('administration');
  const camera = cameras.find((item) => item.cameraId === selectedCameraId);
  const active = useMemo<DashboardView>(() => {
    const requested = activeView && activeView in viewLabels ? (activeView as DashboardView) : 'monitor';
    if (administrationViews.has(requested) && (!isAdmin || !showAdministration)) return 'monitor';
    if (requested === 'monitor' || requested === 'clips') {
      return showMonitoring ? requested : 'monitor';
    }
    return requested;
  }, [activeView, isAdmin, showAdministration, showMonitoring]);
  useEffect(() => {
    if (didAutoScrollRef.current || active !== 'monitor' || !camera) return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = playerAnchorRef.current;
      if (!anchor) return;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      anchor.scrollIntoView?.({
        block: 'start',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
      didAutoScrollRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, camera]);
  const states = {
    capturing: ['capture.state.capturing', 'healthy'],
    connecting: ['capture.state.connecting', 'pending'],
    starting: ['capture.state.starting', 'pending'],
    reconnecting: ['capture.state.reconnecting', 'degraded'],
    'spool-unavailable': ['capture.state.spoolUnavailable', 'failed'],
    stopped: ['capture.state.stopped', 'failed'],
  } as const;
  return (
    <ModulePage
      titleId="monitoring-module-title"
      eyebrow={t('monitoring.module.eyebrow')}
      title={t('shell.modules.monitoring')}
      description={t('monitoring.module.description')}
    >
      {showMonitoring && active === 'monitor' && (
        <section id="view-monitor" aria-label={t(viewLabels.monitor)}>
          {cameras.length > 0 ? (
            <>
              <section className="camera-collection mb-3" aria-label={t('dashboard.cameras.title')}>
                {cameras.length > 1 && (
                  <div className="camera-collection-heading">
                    <h2 className="h5 mb-0">{t('dashboard.cameras.title')}</h2>
                    <p className="small text-secondary mb-0">{t('dashboard.cameras.hint')}</p>
                  </div>
                )}
                <ul className="camera-card-list">
                  {cameras.map((item) => {
                    const itemStatus = states[item.status as keyof typeof states];
                    const badge = {
                      text: t(itemStatus?.[0] ?? 'capture.state.unknown'),
                      state: itemStatus?.[1] ?? 'pending',
                    };
                    const selected = item.cameraId === selectedCameraId;
                    const content = (
                      <>
                        <span className="camera-card-copy">
                          <span className="eyebrow mb-1">
                            {selected ? t('dashboard.cameras.selected') : t('dashboard.cameras.camera')}
                          </span>
                          <strong>{item.cameraId}</strong>
                        </span>
                        <StatusBadge label={badge.text} state={badge.state} />
                      </>
                    );
                    return (
                      <li className="camera-card-wrap" key={item.cameraId}>
                        {cameras.length > 1 ? (
                          <button
                            className={`camera-card${selected ? ' is-selected' : ''}`}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onCameraSelect(item.cameraId)}
                          >
                            {content}
                          </button>
                        ) : (
                          <article className="camera-card is-selected">{content}</article>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {cameras.length === 1 && (
                  <p className="small text-secondary mb-0 mt-2">{t('header.cameraStatusNote')}</p>
                )}
              </section>
              {camera && (
                <div className="monitor-player-anchor" ref={playerAnchorRef}>
                  <LivePlayer camera={camera} onStatusChange={setPlayerStatus} />
                </div>
              )}
            </>
          ) : (
            <section className="panel-card feedback-panel" role="status" aria-live="polite">
              <span className="eyebrow">{t('dashboard.cameras.emptyEyebrow')}</span>
              <h2 className="h5 mt-2">{t('dashboard.cameras.emptyTitle')}</h2>
              <p className="small text-secondary mb-0">{t('dashboard.cameras.emptyMessage')}</p>
            </section>
          )}
        </section>
      )}
      {showMonitoring && active === 'clips' && (
        <div id="view-clips">
          <ClipsPanel
            cameraId={camera?.cameraId}
            isAdmin={isAdmin}
            deepLinkParams={deepLinkParams}
            onDeepLinkParamsChange={onDeepLinkParamsChange}
          />
        </div>
      )}
      {showMonitoring && active === 'clip-settings' && (
        <section id="view-clip-settings" aria-label={t(viewLabels['clip-settings'])}>
          <ClipsPanel
            cameraId={camera?.cameraId}
            isAdmin={isAdmin}
            view="settings"
            deepLinkParams={deepLinkParams}
            onDeepLinkParamsChange={onDeepLinkParamsChange}
          />
        </section>
      )}
      {showAdministration &&
        isAdmin &&
        camera &&
        (active === 'health' || active === 'dependencies' || active === 'capture') && (
          <section id={`view-${active}`} aria-label={t(viewLabels[active])}>
            <OperationsPanel camera={camera} view={active} playerStatus={playerStatus} />
          </section>
        )}
      {showAdministration && isAdmin && active === 'people' && (
        <section id="view-people" aria-label={t(viewLabels.people)}>
          <AdminPeoplePanel />
        </section>
      )}
      {showAdministration && isAdmin && camera && active === 'cameras' && (
        <section id="view-cameras" aria-label={t(viewLabels.cameras)}>
          <AdminCameraConnectionPanel cameraId={camera.cameraId} />
        </section>
      )}
    </ModulePage>
  );
}
