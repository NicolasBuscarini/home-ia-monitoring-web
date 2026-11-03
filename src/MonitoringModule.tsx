import type { CameraStatus, UserRole } from 'home-ia-shared';
import { Dashboard } from './features/monitoring/Dashboard';

export interface MonitoringModuleProps {
  locale: string;
  cameras: CameraStatus[];
  selectedCameraId?: string;
  onCameraSelect: (cameraId: string) => void;
  userRole: UserRole;
  portalModuleIds?: string[];
  activeView?: string;
}

export default function MonitoringModule({
  cameras,
  selectedCameraId,
  onCameraSelect,
  userRole,
  portalModuleIds,
  activeView,
}: MonitoringModuleProps) {
  return (
    <Dashboard
      cameras={cameras}
      selectedCameraId={selectedCameraId}
      onCameraSelect={onCameraSelect}
      userRole={userRole}
      portalModuleIds={portalModuleIds}
      activeView={activeView}
    />
  );
}
