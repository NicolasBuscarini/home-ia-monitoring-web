import type { TranslationKey } from 'home-ia-shared';
import { useI18n } from 'home-ia-shared';
import { useEffect, useRef, useState } from 'react';

export type DashboardView =
  | 'monitor'
  | 'clips'
  | 'health'
  | 'dependencies'
  | 'capture'
  | 'cameras'
  | 'people';
type MenuGroup = 'system' | 'management';

const viewLabels: Record<DashboardView, TranslationKey> = {
  monitor: 'dashboard.menu.monitor',
  clips: 'dashboard.menu.clips',
  health: 'dashboard.menu.health',
  dependencies: 'dashboard.menu.dependencies',
  capture: 'dashboard.menu.capture',
  cameras: 'dashboard.menu.cameras',
  people: 'dashboard.menu.people',
};

interface DashboardMenuProps {
  active: DashboardView;
  isAdmin: boolean;
  portalModuleIds?: string[];
  onChange: (view: DashboardView) => void;
}

export function DashboardMenu({ active, isAdmin, portalModuleIds, onChange }: DashboardMenuProps) {
  const { t } = useI18n();
  const showMonitoring = !portalModuleIds || portalModuleIds.includes('monitoring');
  const showAdministration = !portalModuleIds || portalModuleIds.includes('administration');
  const [openGroup, setOpenGroup] = useState<MenuGroup | null>(null);
  const menuRef = useRef<HTMLElement>(null);
  const systemButtonRef = useRef<HTMLButtonElement>(null);
  const managementButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!openGroup) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpenGroup(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpenGroup(null);
      (openGroup === 'system' ? systemButtonRef : managementButtonRef).current?.focus();
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openGroup]);

  function choose(view: DashboardView) {
    onChange(view);
    setOpenGroup(null);
  }

  return (
    <nav className="dashboard-menu mb-3" aria-label={t('dashboard.menu.label')} ref={menuRef}>
      {showMonitoring && (
        <>
          <button
            className="view-tab"
            type="button"
            id="tab-monitor"
            aria-current={active === 'monitor' ? 'page' : undefined}
            onClick={() => choose('monitor')}
          >
            {t('dashboard.menu.monitor')}
          </button>
          <button
            className="view-tab"
            type="button"
            id="tab-clips"
            aria-current={active === 'clips' ? 'page' : undefined}
            onClick={() => choose('clips')}
          >
            {t('dashboard.menu.clips')}
          </button>
        </>
      )}
      {isAdmin && showAdministration && (
        <>
          <div className="dashboard-menu-group">
            <button
              ref={systemButtonRef}
              className="view-tab"
              type="button"
              aria-expanded={openGroup === 'system'}
              aria-haspopup="true"
              aria-controls="dashboard-submenu-system"
              onClick={() => setOpenGroup((current) => (current === 'system' ? null : 'system'))}
            >
              {t('dashboard.menu.system')}
              <span className="menu-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {openGroup === 'system' && (
              <div className="dashboard-submenu" id="dashboard-submenu-system">
                {(['health', 'dependencies', 'capture'] as const).map((view) => (
                  <button
                    key={view}
                    className="dashboard-submenu-item"
                    type="button"
                    aria-current={active === view ? 'page' : undefined}
                    onClick={() => choose(view)}
                  >
                    {t(viewLabels[view])}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="dashboard-menu-group">
            <button
              ref={managementButtonRef}
              className="view-tab"
              type="button"
              aria-expanded={openGroup === 'management'}
              aria-haspopup="true"
              aria-controls="dashboard-submenu-management"
              onClick={() => setOpenGroup((current) => (current === 'management' ? null : 'management'))}
            >
              {t('dashboard.menu.management')}
              <span className="menu-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {openGroup === 'management' && (
              <div className="dashboard-submenu" id="dashboard-submenu-management">
                {(['cameras', 'people'] as const).map((view) => (
                  <button
                    key={view}
                    className="dashboard-submenu-item"
                    type="button"
                    aria-current={active === view ? 'page' : undefined}
                    onClick={() => choose(view)}
                  >
                    {t(viewLabels[view])}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </nav>
  );
}
