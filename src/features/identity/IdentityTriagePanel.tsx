import { ApiError, getJson, request, type TranslationKey, useI18n } from 'home-ia-shared';
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react';

interface KnownPersonPage {
  items: Array<{ publicId: string; displayName: string }>;
}

interface IdentityObservationSummary {
  publicId: string;
  cameraPublicId: string | null;
  clipPublicId: string | null;
  observedAtUtc: string;
  ingestedAtUtc: string;
  matchStatus: string;
  bestPersonPublicId: string | null;
  bestScore: number | null;
  margin: number | null;
  policyVersion: string;
  candidateCount: number;
  reviewStatus: 'pending' | 'reviewed' | 'notRequired';
  resolvedPersonPublicId: string | null;
  latestReviewPublicId: string | null;
}

interface IdentityObservationPage {
  items: IdentityObservationSummary[];
  page: number;
  pageSize: number;
  total: number;
}

interface IdentityObservationDetail {
  summary: IdentityObservationSummary;
  candidates: Array<{ personPublicId: string; score: number }>;
  reviews: Array<{
    publicId: string;
    decision: string;
    selectedPersonPublicId: string | null;
    note: string | null;
    reviewerPublicId: string;
    createdAtUtc: string;
  }>;
}

type Decision = 'confirmed' | 'associated' | 'rejected' | 'inconclusive';
type ReviewFilter = 'pending' | 'reviewed' | 'notRequired' | '';
type MatchFilter = 'suggested' | 'ambiguous' | 'unknown' | 'noEnrollment' | '';
type SubmitError = '' | 'conflict' | 'submit';

const PAGE_SIZE = 25;

const matchLabelKeys: Record<string, TranslationKey> = {
  suggested: 'people.identity.match.suggested',
  ambiguous: 'people.identity.match.ambiguous',
  unknown: 'people.identity.match.unknown',
  noEnrollment: 'people.identity.match.noEnrollment',
};

const reviewLabelKeys: Record<IdentityObservationSummary['reviewStatus'], TranslationKey> = {
  pending: 'people.identity.status.pending',
  reviewed: 'people.identity.status.reviewed',
  notRequired: 'people.identity.status.notRequired',
};

const decisionLabelKeys: Record<Decision, TranslationKey> = {
  confirmed: 'people.identity.decision.confirmed',
  associated: 'people.identity.decision.associated',
  rejected: 'people.identity.decision.rejected',
  inconclusive: 'people.identity.decision.inconclusive',
};

export function IdentityTriagePanel() {
  const { t, locale } = useI18n();
  const reviewFilterId = useId();
  const matchFilterId = useId();
  const decisionId = useId();
  const personId = useId();
  const noteId = useId();
  const [observations, setObservations] = useState<IdentityObservationPage>();
  const [people, setPeople] = useState<Array<{ publicId: string; displayName: string }>>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('pending');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<IdentityObservationDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [decision, setDecision] = useState<Decision>('inconclusive');
  const [selectedPerson, setSelectedPerson] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError>('');
  const [notice, setNotice] = useState('');

  const loadObservations = useCallback(
    async (requestedPage: number, signal?: AbortSignal) => {
      setLoading(true);
      setLoadError('');
      try {
        const query = new URLSearchParams({
          page: String(requestedPage),
          pageSize: String(PAGE_SIZE),
        });
        if (reviewFilter) query.set('reviewStatus', reviewFilter);
        if (matchFilter) query.set('matchStatus', matchFilter);
        const result = await getJson<IdentityObservationPage>(
          `/api/v1/admin/identity-observations?${query.toString()}`,
          signal,
        );
        if (!signal?.aborted) setObservations(result);
      } catch {
        if (!signal?.aborted) setLoadError('load');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [matchFilter, reviewFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadObservations(pageNumber, controller.signal);
    return () => controller.abort();
  }, [loadObservations, pageNumber]);

  useEffect(() => {
    const controller = new AbortController();
    void getJson<KnownPersonPage>('/api/v1/admin/known-people?page=1&pageSize=100', controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPeople(result.items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPeople([]);
      });
    return () => controller.abort();
  }, []);

  const personName = useCallback(
    (publicId: string | null) =>
      publicId
        ? (people.find((person) => person.publicId === publicId)?.displayName ?? publicId)
        : t('people.identity.noPerson'),
    [people, t],
  );

  async function openObservation(summary: IdentityObservationSummary) {
    setSelectedId(summary.publicId);
    setDetail(undefined);
    setDetailError('');
    setSubmitError('');
    setNotice('');
    setDecision(summary.matchStatus === 'suggested' ? 'confirmed' : 'inconclusive');
    setSelectedPerson(summary.bestPersonPublicId ?? '');
    setNote('');
    setDetailLoading(true);
    try {
      const result = await getJson<IdentityObservationDetail>(
        `/api/v1/admin/identity-observations/${summary.publicId}`,
      );
      setDetail(result);
      setDecision(result.summary.matchStatus === 'suggested' ? 'confirmed' : 'inconclusive');
      setSelectedPerson(result.summary.bestPersonPublicId ?? '');
    } catch {
      setDetailError('load');
    } finally {
      setDetailLoading(false);
    }
  }

  function changeFilter(kind: 'review' | 'match', value: string) {
    setPageNumber(1);
    setSelectedId(undefined);
    setDetail(undefined);
    if (kind === 'review') setReviewFilter(value as ReviewFilter);
    else setMatchFilter(value as MatchFilter);
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const needsPerson = decision === 'confirmed' || decision === 'associated';
    if (needsPerson && !selectedPerson) return;
    setSubmitting(true);
    setSubmitError('');
    setNotice('');
    try {
      const response = await request(`/api/v1/admin/identity-observations/${selectedId}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          personPublicId: needsPerson ? selectedPerson : null,
          note: note.trim() || null,
        }),
      });
      if (!response.ok) {
        setSubmitError(response.status === 409 ? 'conflict' : 'submit');
        return;
      }
      setNotice(t('people.identity.review.success'));
      setSelectedId(undefined);
      setDetail(undefined);
      setNote('');
      await loadObservations(pageNumber);
    } catch (error) {
      setSubmitError(error instanceof ApiError && error.status === 409 ? 'conflict' : 'submit');
    } finally {
      setSubmitting(false);
    }
  }

  const totalPages = observations ? Math.max(1, Math.ceil(observations.total / observations.pageSize)) : 1;
  const personOptions =
    decision === 'confirmed'
      ? (detail?.candidates ?? []).map((candidate) => ({
          publicId: candidate.personPublicId,
          score: candidate.score,
        }))
      : people;
  const canSubmit =
    !!detail &&
    detail.summary.reviewStatus === 'pending' &&
    !submitting &&
    (decision === 'rejected' || decision === 'inconclusive' || !!selectedPerson);

  return (
    <section className="panel-card mt-3" aria-labelledby="identity-triage-title">
      <span className="eyebrow">{t('people.identity.eyebrow')}</span>
      <h2 id="identity-triage-title" className="h4 mt-2">
        {t('people.identity.title')}
      </h2>
      <p className="text-secondary">{t('people.identity.help')}</p>

      <div className="row g-2 align-items-end mb-3">
        <div className="col-12 col-md-4">
          <label className="form-label" htmlFor={reviewFilterId}>
            {t('people.identity.filter.review')}
          </label>
          <select
            id={reviewFilterId}
            className="form-select"
            value={reviewFilter}
            onChange={(event) => changeFilter('review', event.currentTarget.value)}
          >
            <option value="pending">{t('people.identity.filter.review.pending')}</option>
            <option value="reviewed">{t('people.identity.filter.review.reviewed')}</option>
            <option value="notRequired">{t('people.identity.filter.review.notRequired')}</option>
            <option value="">{t('people.identity.filter.all')}</option>
          </select>
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label" htmlFor={matchFilterId}>
            {t('people.identity.filter.match')}
          </label>
          <select
            id={matchFilterId}
            className="form-select"
            value={matchFilter}
            onChange={(event) => changeFilter('match', event.currentTarget.value)}
          >
            <option value="">{t('people.identity.filter.all')}</option>
            <option value="suggested">{t('people.identity.match.suggested')}</option>
            <option value="ambiguous">{t('people.identity.match.ambiguous')}</option>
            <option value="unknown">{t('people.identity.match.unknown')}</option>
            <option value="noEnrollment">{t('people.identity.match.noEnrollment')}</option>
          </select>
        </div>
      </div>

      {loading && (
        <p role="status" aria-live="polite">
          {t('people.identity.loading')}
        </p>
      )}
      {loadError && (
        <div className="error-text" role="alert">
          <p>{t('people.identity.loadError')}</p>
          <button
            className="btn btn-outline-light btn-sm"
            type="button"
            onClick={() => void loadObservations(pageNumber)}
          >
            {t('people.identity.retry')}
          </button>
        </div>
      )}
      {!loading && !loadError && observations?.items.length === 0 && (
        <p className="text-secondary" role="status">
          {t('people.identity.empty')}
        </p>
      )}
      {!loading && observations && observations.items.length > 0 && (
        <>
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <caption className="visually-hidden">{t('people.identity.listLabel')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('people.identity.column.observed')}</th>
                  <th scope="col">{t('people.identity.column.reference')}</th>
                  <th scope="col">{t('people.identity.column.match')}</th>
                  <th scope="col">{t('people.identity.column.best')}</th>
                  <th scope="col">{t('people.identity.column.review')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('people.identity.column.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {observations.items.map((item) => (
                  <tr key={item.publicId}>
                    <td className="small text-secondary">{formatDateTime(item.observedAtUtc, locale)}</td>
                    <td className="small text-secondary">
                      {item.cameraPublicId ?? t('people.identity.noCamera')}
                      {item.clipPublicId ? ` · ${item.clipPublicId}` : ''}
                    </td>
                    <td>
                      <span
                        className={`health-pill ${item.matchStatus === 'ambiguous' ? 'degraded' : 'pending'}`}
                      >
                        {t(matchLabelKeys[item.matchStatus] ?? 'people.identity.match.unknown')}
                      </span>
                      <span className="small text-secondary d-block">
                        {t('people.identity.candidates', { count: item.candidateCount })} ·{' '}
                        {item.policyVersion}
                      </span>
                    </td>
                    <td className="small">
                      {item.bestPersonPublicId
                        ? personName(item.bestPersonPublicId)
                        : t('people.identity.noPerson')}
                      {item.bestScore !== null && (
                        <span className="text-secondary d-block">
                          {t('people.identity.score', { score: item.bestScore.toFixed(3) })}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="small">{t(reviewLabelKeys[item.reviewStatus])}</span>
                    </td>
                    <td>
                      <button
                        className="btn btn-outline-light btn-sm"
                        type="button"
                        aria-label={t('people.identity.openLabel', { id: item.publicId })}
                        aria-expanded={selectedId === item.publicId}
                        onClick={() => void openObservation(item)}
                      >
                        {item.reviewStatus === 'pending'
                          ? t('people.identity.open')
                          : t('people.identity.details')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {notice && (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {selectedId && (
        <section className="identity-review mt-3" aria-labelledby="identity-review-title">
          <h3 id="identity-review-title" className="h5">
            {t('people.identity.review.title', { id: selectedId })}
          </h3>
          {detailLoading && (
            <p role="status" aria-live="polite">
              {t('people.identity.review.loading')}
            </p>
          )}
          {detailError && (
            <div className="error-text" role="alert">
              <p>{t('people.identity.review.loadError')}</p>
            </div>
          )}
          {detail && (
            <>
              <p className="small text-secondary">
                {t('people.identity.review.original', {
                  status: t(matchLabelKeys[detail.summary.matchStatus] ?? 'people.identity.match.unknown'),
                  policy: detail.summary.policyVersion,
                  margin: detail.summary.margin === null ? '—' : detail.summary.margin.toFixed(3),
                })}
              </p>
              <h4 className="h6">{t('people.identity.candidatesTitle')}</h4>
              {detail.candidates.length === 0 ? (
                <p className="small text-secondary">{t('people.identity.candidatesEmpty')}</p>
              ) : (
                <ul className="small" aria-label={t('people.identity.candidatesTitle')}>
                  {detail.candidates.map((candidate) => (
                    <li key={candidate.personPublicId}>
                      {personName(candidate.personPublicId)} · {candidate.score.toFixed(3)}
                    </li>
                  ))}
                </ul>
              )}

              <h4 className="h6 mt-3">{t('people.identity.review.history')}</h4>
              {detail.reviews.length === 0 ? (
                <p className="small text-secondary">{t('people.identity.review.noHistory')}</p>
              ) : (
                <ul className="small" aria-label={t('people.identity.review.history')}>
                  {detail.reviews.map((review) => (
                    <li key={review.publicId}>
                      {t(
                        decisionLabelKeys[review.decision as Decision] ??
                          'people.identity.decision.inconclusive',
                      )}
                      {review.selectedPersonPublicId ? ` · ${personName(review.selectedPersonPublicId)}` : ''}
                      {' — '}
                      {t('people.identity.review.reviewedBy', {
                        reviewer: review.reviewerPublicId,
                        date: formatDateTime(review.createdAtUtc, locale),
                      })}
                      {review.note ? ` · ${review.note}` : ''}
                    </li>
                  ))}
                </ul>
              )}

              {detail.summary.reviewStatus === 'pending' ? (
                <form className="mt-3" onSubmit={(event) => void submitReview(event)}>
                  <fieldset>
                    <legend className="h6">{t('people.identity.review.decisionLabel')}</legend>
                    <div className="d-flex flex-column gap-1">
                      {(Object.keys(decisionLabelKeys) as Decision[]).map((value) => (
                        <div className="form-check" key={value}>
                          <input
                            id={`${decisionId}-${value}`}
                            className="form-check-input"
                            type="radio"
                            name={decisionId}
                            value={value}
                            checked={decision === value}
                            onChange={() => {
                              setDecision(value);
                              setSubmitError('');
                            }}
                          />
                          <label className="form-check-label" htmlFor={`${decisionId}-${value}`}>
                            {t(decisionLabelKeys[value])}
                          </label>
                        </div>
                      ))}
                    </div>
                  </fieldset>

                  {(decision === 'confirmed' || decision === 'associated') && (
                    <div className="mt-3">
                      <label className="form-label" htmlFor={personId}>
                        {t('people.identity.review.personLabel')}
                      </label>
                      <select
                        id={personId}
                        className="form-select"
                        value={selectedPerson}
                        onChange={(event) => setSelectedPerson(event.currentTarget.value)}
                      >
                        <option value="">{t('people.identity.review.personPlaceholder')}</option>
                        {personOptions.map((person) => (
                          <option key={person.publicId} value={person.publicId}>
                            {personName(person.publicId)}
                            {'score' in person ? ` · ${person.score.toFixed(3)}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="mt-3">
                    <label className="form-label" htmlFor={noteId}>
                      {t('people.identity.review.noteLabel')}
                    </label>
                    <input
                      id={noteId}
                      className="form-control"
                      type="text"
                      maxLength={500}
                      value={note}
                      onChange={(event) => setNote(event.currentTarget.value)}
                    />
                    <p className="small text-secondary mt-1 mb-0">{t('people.identity.review.noteHelp')}</p>
                  </div>

                  {submitError && (
                    <p className="error-text" role="alert">
                      {submitError === 'conflict'
                        ? t('people.identity.review.error.conflict')
                        : t('people.identity.review.error.submit')}
                    </p>
                  )}
                  <button className="btn btn-primary mt-3" type="submit" disabled={!canSubmit}>
                    {submitting ? t('people.identity.review.submitting') : t('people.identity.review.submit')}
                  </button>
                </form>
              ) : (
                <p className="small text-secondary" role="status">
                  {t('people.identity.review.notPending')}
                </p>
              )}
            </>
          )}
        </section>
      )}

      <p className="small text-secondary mt-3 mb-0">{t('people.identity.limits')}</p>
    </section>
  );
}

function formatDateTime(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}
