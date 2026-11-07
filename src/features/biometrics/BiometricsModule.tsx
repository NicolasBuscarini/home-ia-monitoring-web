import { getJson, ModulePage, type UserRole, useI18n } from 'home-ia-shared';
import { useEffect, useState } from 'react';
import { IdentityCalibrationPanel } from '../identity/IdentityCalibrationPanel';
import { IdentityTriagePanel } from '../identity/IdentityTriagePanel';
import { BiometricEnrollmentPanel } from './BiometricEnrollmentPanel';
import { FaceExtractorPanel } from './FaceExtractorPanel';

interface RosterPersonOption {
  publicId: string;
  displayName: string;
}

interface KnownPersonPage {
  items: RosterPersonOption[];
}

export type BiometricsView = 'enrollments' | 'observations' | 'calibration' | 'model';

const views: ReadonlySet<string> = new Set<BiometricsView>([
  'enrollments',
  'observations',
  'calibration',
  'model',
]);

export interface BiometricsModuleProps {
  locale: string;
  userRole: UserRole;
  portalModuleIds?: string[];
  activeView?: string;
}

export default function BiometricsModule({ userRole, portalModuleIds, activeView }: BiometricsModuleProps) {
  const { t } = useI18n();
  const [people, setPeople] = useState<RosterPersonOption[]>([]);
  const showBiometrics = !portalModuleIds || portalModuleIds.includes('biometrics');
  const view: BiometricsView =
    activeView && views.has(activeView) ? (activeView as BiometricsView) : 'enrollments';

  useEffect(() => {
    if (!showBiometrics || !userRole) return;
    const controller = new AbortController();
    void getJson<KnownPersonPage>('/api/v1/admin/known-people?page=1&pageSize=100', controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPeople(result.items);
      })
      .catch(() => {
        // The enrollment panel still works for existing records; linking shows its empty state.
      });
    return () => controller.abort();
  }, [showBiometrics, userRole]);

  if (!showBiometrics) return null;

  return (
    <ModulePage
      titleId="biometrics-module-title"
      eyebrow={t('biometrics.module.eyebrow')}
      title={t('shell.modules.biometrics')}
      description={t('biometrics.module.description')}
    >
      <div className="biometrics-module">
        {view === 'enrollments' && <BiometricEnrollmentPanel people={people} />}
        {view === 'observations' && <IdentityTriagePanel />}
        {view === 'calibration' && <IdentityCalibrationPanel />}
        {view === 'model' && <FaceExtractorPanel />}
      </div>
    </ModulePage>
  );
}
