import { ApiError, getJson, request, useI18n } from 'home-ia-shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { BiometricEnrollmentPanel } from '../biometrics/BiometricEnrollmentPanel';

interface KnownPerson {
  publicId: string;
  displayName: string;
  purpose: string;
  authorizationRecordedAtUtc: string;
  createdAtUtc: string;
  version: number;
}

interface KnownPersonPage {
  items: KnownPerson[];
  page: number;
  pageSize: number;
  total: number;
}

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

type RosterError = '' | 'load' | 'create' | 'remove';
type RegistryError = '' | 'load' | 'select';

const PAGE_SIZE = 25;

export function AdminPeoplePanel() {
  const { t, locale } = useI18n();
  const [roster, setRoster] = useState<KnownPersonPage>();
  const [pageNumber, setPageNumber] = useState(1);
  const [displayName, setDisplayName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState<RosterError>('');
  const [rosterNotice, setRosterNotice] = useState('');
  const [busyPersonId, setBusyPersonId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [registry, setRegistry] = useState<FaceExtractorRegistry>();
  const [registryError, setRegistryError] = useState<RegistryError>('');
  const [registryNotice, setRegistryNotice] = useState('');
  const [selecting, setSelecting] = useState(false);

  const loadRoster = useCallback(async (requestedPage: number, signal?: AbortSignal) => {
    setRosterLoading(true);
    setRosterError('');
    try {
      const result = await getJson<KnownPersonPage>(
        `/api/v1/admin/known-people?page=${requestedPage}&pageSize=${PAGE_SIZE}`,
        signal,
      );
      if (!signal?.aborted) setRoster(result);
    } catch {
      if (!signal?.aborted) setRosterError('load');
    } finally {
      if (!signal?.aborted) setRosterLoading(false);
    }
  }, []);

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
    void loadRoster(pageNumber, controller.signal);
    return () => controller.abort();
  }, [loadRoster, pageNumber]);

  useEffect(() => {
    const controller = new AbortController();
    void loadRegistry(controller.signal);
    return () => controller.abort();
  }, [loadRegistry]);

  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRosterNotice('');
    if (!authorizationConfirmed) {
      setRosterError('create');
      return;
    }
    setCreating(true);
    setRosterError('');
    try {
      const response = await request('/api/v1/admin/known-people', {
        method: 'POST',
        body: JSON.stringify({
          displayName,
          purpose,
          authorizationConfirmed: true,
        }),
      });
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      setDisplayName('');
      setPurpose('');
      setAuthorizationConfirmed(false);
      setRosterNotice(t('people.roster.notice.created'));
      setPageNumber(1);
      await loadRoster(1);
    } catch {
      setRosterError('create');
    } finally {
      setCreating(false);
    }
  }

  async function removePerson(person: KnownPerson) {
    if (!window.confirm(t('people.roster.confirmRemove', { name: person.displayName }))) return;
    setBusyPersonId(person.publicId);
    setRosterError('');
    setRosterNotice('');
    try {
      const response = await request(`/api/v1/admin/known-people/${person.publicId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      setRosterNotice(t('people.roster.notice.removed'));
      await loadRoster(pageNumber);
    } catch {
      setRosterError('remove');
    } finally {
      setBusyPersonId(undefined);
    }
  }

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

  const totalPages = roster ? Math.max(1, Math.ceil(roster.total / roster.pageSize)) : 1;
  return (
    <div className="admin-people">
      <section className="panel-card" aria-labelledby="admin-roster-title">
        <span className="eyebrow">{t('people.eyebrow')}</span>
        <h2 id="admin-roster-title" className="h4 mt-2">
          {t('people.roster.title')}
        </h2>
        <p className="text-secondary">{t('people.roster.help')}</p>

        {rosterLoading && (
          <p role="status" aria-live="polite">
            {t('people.roster.loading')}
          </p>
        )}
        {rosterError && (
          <div className="error-text" role="alert">
            <p>{t(`people.roster.error.${rosterError}`)}</p>
            {rosterError === 'load' && (
              <button
                className="btn btn-outline-light btn-sm"
                type="button"
                onClick={() => void loadRoster(pageNumber)}
              >
                {t('people.retry')}
              </button>
            )}
          </div>
        )}
        {!rosterLoading && !rosterError && roster?.items.length === 0 && (
          <p className="text-secondary" role="status">
            {t('people.roster.empty')}
          </p>
        )}
        {!rosterLoading && roster && roster.items.length > 0 && (
          <>
            <table className="table table-sm align-middle people-table">
              <caption className="visually-hidden">{t('people.roster.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('people.roster.name')}</th>
                  <th scope="col">{t('people.roster.purposeLabel')}</th>
                  <th scope="col">{t('people.roster.authorizedAt')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('people.roster.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {roster.items.map((person) => (
                  <tr key={person.publicId}>
                    <td>{person.displayName}</td>
                    <td className="small text-secondary">{person.purpose}</td>
                    <td className="small text-secondary">
                      {formatDate(person.authorizationRecordedAtUtc, locale)}
                    </td>
                    <td>
                      <button
                        className="btn btn-outline-light btn-sm"
                        type="button"
                        aria-label={t('people.roster.removeLabel', { name: person.displayName })}
                        disabled={busyPersonId === person.publicId}
                        onClick={() => void removePerson(person)}
                      >
                        {busyPersonId === person.publicId
                          ? t('people.roster.removing')
                          : t('people.roster.remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="d-flex align-items-center gap-2 mb-3">
                <button
                  className="btn btn-outline-light btn-sm"
                  type="button"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
                >
                  {t('people.previous')}
                </button>
                <span className="small text-secondary">
                  {t('people.page', { page: pageNumber, total: totalPages })}
                </span>
                <button
                  className="btn btn-outline-light btn-sm"
                  type="button"
                  disabled={pageNumber >= totalPages}
                  onClick={() => setPageNumber((current) => Math.min(totalPages, current + 1))}
                >
                  {t('people.next')}
                </button>
              </div>
            )}
          </>
        )}

        <form className="mt-3" onSubmit={(event) => void createPerson(event)}>
          <h3 className="h6">{t('people.roster.formTitle')}</h3>
          <div className="row g-2">
            <div className="col-12 col-md-5">
              <label className="form-label" htmlFor="known-person-name">
                {t('people.roster.name')}
              </label>
              <input
                id="known-person-name"
                className="form-control"
                type="text"
                maxLength={120}
                value={displayName}
                disabled={creating}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
              />
            </div>
            <div className="col-12 col-md-7">
              <label className="form-label" htmlFor="known-person-purpose">
                {t('people.roster.purposeLabel')}
              </label>
              <input
                id="known-person-purpose"
                className="form-control"
                type="text"
                maxLength={200}
                value={purpose}
                disabled={creating}
                onChange={(event) => setPurpose(event.currentTarget.value)}
              />
            </div>
          </div>
          <div className="form-check mt-3">
            <input
              id="known-person-authorization"
              className="form-check-input"
              type="checkbox"
              checked={authorizationConfirmed}
              disabled={creating}
              onChange={(event) => setAuthorizationConfirmed(event.currentTarget.checked)}
            />
            <label className="form-check-label small" htmlFor="known-person-authorization">
              {t('people.roster.authorization')}
            </label>
          </div>
          {rosterNotice && (
            <p className="admin-notice" role="status" aria-live="polite">
              {rosterNotice}
            </p>
          )}
          <button
            className="btn btn-primary mt-2"
            type="submit"
            disabled={creating || !displayName.trim() || !purpose.trim() || !authorizationConfirmed}
          >
            {creating ? t('people.roster.creating') : t('people.roster.create')}
          </button>
          <p className="small text-secondary mt-2 mb-0">{t('people.roster.limits')}</p>
        </form>
      </section>

      <section className="panel-card mt-3" aria-labelledby="face-extractor-title">
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

      <div className="mt-3">
        <BiometricEnrollmentPanel people={roster?.items ?? []} />
      </div>
    </div>
  );
}

function formatDate(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(locale);
}
