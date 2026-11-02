import type { CameraStatus, TranslationKey, UserRole } from 'home-ia-shared';
import { StatusBadge, useI18n } from 'home-ia-shared';
import { useEffect, useRef, useState } from 'react';
import { DashboardMenu, type DashboardView } from '../../components/DashboardMenu';
import { AdminAccessRequestsPanel } from '../admin/AdminAccessRequestsPanel';
import { AdminCameraConnectionPanel } from '../admin/AdminCameraConnectionPanel';
import { AdminPeoplePanel } from '../admin/AdminPeoplePanel';
import { AdminProfilesPanel } from '../admin/AdminProfilesPanel';
import { AdminUsersPanel } from '../admin/AdminUsersPanel';
import { ClipsPanel } from '../clips/ClipsPanel';
import { OperationsPanel } from '../operations/OperationsPanel';
import { LivePlayer } from './LivePlayer';

const systemViewLabels: Partial<Record<DashboardView, TranslationKey>> = {
  health: 'dashboard.menu.health',
  dependencies: 'dashboard.menu.dependencies',
  capture: 'dashboard.menu.capture',
};

interface DashboardProps {
  cameras: CameraStatus[];
  selectedCameraId?: string;
  onCameraSelect: (cameraId: string) => void;
  userRole: UserRole;
  portalModuleIds?: string[];
}

export function Dashboard({
  cameras,
  selectedCameraId,
  onCameraSelect,
  userRole,
  portalModuleIds,
}: DashboardProps) {
  const { t } = useI18n();
  const [active, setActive] = useState<DashboardView>('monitor');
  const [userIdFilter, setUserIdFilter] = useState<string>();
  const [playerStatus, setPlayerStatus] = useState(() => t('player.status.notStarted'));
  const playerAnchorRef = useRef<HTMLDivElement>(null);
  const didAutoScrollRef = useRef(false);
  const isAdmin = userRole === 'Administrator';
  const showMonitoring = !portalModuleIds || portalModuleIds.includes('monitoring');
  const showAdministration = !portalModuleIds || portalModuleIds.includes('administration');
  const camera = cameras.find((item) => item.cameraId === selectedCameraId);
  function manageRequestedUser(userId: string) {
    setUserIdFilter(userId);
    setActive('users');
  }
  useEffect(() => {
    if (!showMonitoring && showAdministration && active === 'monitor') setActive('health');
  }, [showMonitoring, showAdministration, active]);
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
    <section aria-label={t('dashboard.aria.garageState')}>
      <DashboardMenu
        active={active}
        isAdmin={isAdmin}
        portalModuleIds={portalModuleIds}
        onChange={setActive}
      />
      {showMonitoring && (
        <section id="view-monitor" aria-labelledby="tab-monitor" hidden={active !== 'monitor'}>
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
        <section id="view-clips" aria-label={t('dashboard.menu.clips')}>
          <ClipsPanel cameraId={camera?.cameraId} isAdmin={isAdmin} />
        </section>
      )}
      {showAdministration &&
        isAdmin &&
        camera &&
        (active === 'health' || active === 'dependencies' || active === 'capture') && (
          <section id={`view-${active}`} aria-label={t(systemViewLabels[active] ?? 'dashboard.menu.system')}>
            <OperationsPanel camera={camera} view={active} playerStatus={playerStatus} />
          </section>
        )}
      {showAdministration && isAdmin && active === 'users' && (
        <section id="view-users" aria-label={t('dashboard.menu.users')}>
          <AdminUsersPanel initialUserId={userIdFilter} />
        </section>
      )}
      {showAdministration && isAdmin && active === 'profiles' && (
        <section id="view-profiles" aria-label={t('dashboard.menu.profiles')}>
          <AdminProfilesPanel />
        </section>
      )}
      {showAdministration && isAdmin && active === 'requests' && (
        <section id="view-requests" aria-label={t('dashboard.menu.accessRequests')}>
          <AdminAccessRequestsPanel onManageUser={manageRequestedUser} />
        </section>
      )}
      {showAdministration && isAdmin && active === 'people' && (
        <section id="view-people" aria-label={t('dashboard.menu.people')}>
          <AdminPeoplePanel />
        </section>
      )}
      {showAdministration && isAdmin && camera && active === 'cameras' && (
        <section id="view-cameras" aria-label={t('dashboard.menu.cameras')}>
          <AdminCameraConnectionPanel cameraId={camera.cameraId} />
        </section>
      )}
    </section>
  );
}
