import { ApiError, getJson, request, useI18n } from 'home-ia-shared';
import { useCallback, useEffect, useState } from 'react';

interface FaceExtractorCandidate {
  publicId: string;
  modelId: string;
  modelVersion: string;
  artifactSha256: string;
  sourceUri: string;
  codeLicense: string;
  weightsLicense: string;
  adapterId: string;
  adapterContractVersion: string;
  createdAtUtc: string;
}

interface FaceExtractorRuntime {
  enabled: boolean;
  state: string;
  adapterId: string;
  modelId: string;
  modelVersion: string;
  detectorSha256: string | null;
  recognizerSha256: string | null;
}

interface FaceExtractorRegistry {
  version: number;
  selectedCandidate: FaceExtractorCandidate | null;
  candidates: FaceExtractorCandidate[];
  runtimeEnabled: boolean;
  sampleCollectionEnabled: boolean;
  runtime?: FaceExtractorRuntime;
}

type RegistryError = '' | 'load' | 'select';

export function FaceExtractorPanel() {
  const { t } = useI18n();
  const [registry, setRegistry] = useState<FaceExtractorRegistry>();
  const [registryError, setRegistryError] = useState<RegistryError>('');
  const [registryNotice, setRegistryNotice] = useState('');
  const [selecting, setSelecting] = useState(false);

  const loadRegistry = useCallback(async (signal?: AbortSignal) => {
    setRegistryError('');
    try {
      const result = await getJson<FaceExtractorRegistry>('/api/v1/admin/face-extractor-registry', signal);
      if (!signal?.aborted) setRegistry(result);
    } catch {
      if (!signal?.aborted) setRegistryError('load');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRegistry(controller.signal);
    return () => controller.abort();
  }, [loadRegistry]);

  async function selectCandidate(candidate: FaceExtractorCandidate) {
    if (!registry) return;
    setSelecting(true);
    setRegistryError('');
    setRegistryNotice('');
    try {
      const response = await request('/api/v1/admin/face-extractor-selection', {
        method: 'PUT',
        body: JSON.stringify({ candidatePublicId: candidate.publicId, expectedVersion: registry.version }),
      });
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      setRegistryNotice(t('people.extractor.notice.selected', { model: candidate.modelId }));
      await loadRegistry();
    } catch {
      setRegistryError('select');
    } finally {
      setSelecting(false);
    }
  }

  return (
    <section className="panel-card" aria-labelledby="face-extractor-title">
      <span className="eyebrow">{t('people.extractor.eyebrow')}</span>
      <h2 id="face-extractor-title" className="h4 mt-2">
        {t('people.extractor.title')}
      </h2>
      <p className="text-secondary">{t('people.extractor.help')}</p>
      {registryError && (
        <div className="error-text" role="alert">
          <p>{t(`people.extractor.error.${registryError}`)}</p>
          {registryError === 'load' && (
            <button
              className="btn btn-outline-light btn-sm"
              type="button"
              onClick={() => void loadRegistry()}
            >
              {t('people.retry')}
            </button>
          )}
        </div>
      )}
      {!registryError && !registry && (
        <p role="status" aria-live="polite">
          {t('people.extractor.loading')}
        </p>
      )}
      {registry && (
        <>
          <p className="small text-secondary">
            {t('people.extractor.runtimeState', {
              state: t(
                registry.runtime?.enabled
                  ? 'people.extractor.state.ready'
                  : 'people.extractor.state.unavailable',
              ),
              adapter: registry.runtime?.adapterId ?? '—',
            })}
          </p>
          <p className="small text-secondary">
            {t('people.extractor.flags', {
              runtime: t(
                registry.runtimeEnabled
                  ? 'people.extractor.runtime.enabled'
                  : 'people.extractor.runtime.disabled',
              ),
              collection: t(
                registry.sampleCollectionEnabled
                  ? 'people.extractor.collection.enabled'
                  : 'people.extractor.collection.disabled',
              ),
            })}
          </p>
          {registry.candidates.length === 0 ? (
            <p className="text-secondary" role="status">
              {t('people.extractor.empty')}
            </p>
          ) : (
            <ul className="extractor-list" aria-label={t('people.extractor.listLabel')}>
              {registry.candidates.map((candidate) => {
                const selected = registry.selectedCandidate?.publicId === candidate.publicId;
                return (
                  <li key={candidate.publicId} className="extractor-item">
                    <div className="extractor-item-heading">
                      <strong>
                        {candidate.modelId} · {candidate.modelVersion}
                      </strong>
                      {selected && (
                        <span className="health-pill healthy">{t('people.extractor.selected')}</span>
                      )}
                    </div>
                    <p className="small text-secondary mb-1">
                      {t('people.extractor.adapter', {
                        adapter: candidate.adapterId,
                        contract: candidate.adapterContractVersion,
                      })}
                    </p>
                    <p className="small text-secondary mb-1" title={candidate.artifactSha256}>
                      {t('people.extractor.checksum', {
                        hash: `${candidate.artifactSha256.slice(0, 12)}…`,
                      })}
                    </p>
                    <p className="small text-secondary mb-2">
                      {t('people.extractor.licenses', {
                        code: candidate.codeLicense,
                        weights: candidate.weightsLicense,
                      })}
                    </p>
                    {!selected && (
                      <button
                        className="btn btn-outline-light btn-sm"
                        type="button"
                        disabled={selecting}
                        onClick={() => void selectCandidate(candidate)}
                      >
                        {selecting ? t('people.extractor.selecting') : t('people.extractor.select')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {registryNotice && (
            <p className="admin-notice" role="status" aria-live="polite">
              {registryNotice}
            </p>
          )}
          <p className="small text-secondary mb-0">{t('people.extractor.limits')}</p>
        </>
      )}
    </section>
  );
}
