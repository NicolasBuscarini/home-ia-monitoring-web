import type { CameraStatus, UserRole } from './domain/platform';
import { Dashboard } from './features/monitoring/Dashboard';
import { I18nProvider } from './i18n/i18n';
import type { Locale } from './i18n/messages';

export interface MonitoringModuleProps {
  locale: string;
  cameras: CameraStatus[];
  selectedCameraId?: string;
  onCameraSelect: (cameraId: string) => void;
  userRole: UserRole;
  portalModuleIds?: string[];
}

export default function MonitoringModule({
  locale,
  cameras,
  selectedCameraId,
  onCameraSelect,
  userRole,
  portalModuleIds,
}: MonitoringModuleProps) {
  return (
    <I18nProvider key={locale} initialLocale={locale as Locale}>
      <Dashboard
        cameras={cameras}
        selectedCameraId={selectedCameraId}
        onCameraSelect={onCameraSelect}
        userRole={userRole}
        portalModuleIds={portalModuleIds}
      />
    </I18nProvider>
  );
}
