import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n/i18n';
import type { TranslationKey } from '../../i18n/messages';
import { ApiError, getJson, request } from '../../services/http';

interface AccessRequestSummary {
  publicId: string;
  userPublicId: string;
  username: string;
  purpose: 'live_monitoring' | 'camera_access';
  status: 'pending' | 'reviewed';
  createdAtUtc: string;
}

interface AccessRequestPage {
  items: AccessRequestSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
}

const purposeLabels: Record<AccessRequestSummary['purpose'], TranslationKey> = {
  live_monitoring: 'accessRequest.purpose.live',
  camera_access: 'accessRequest.purpose.camera',
};
const statusLabels: Record<AccessRequestSummary['status'], TranslationKey> = {
  pending: 'admin.accessRequests.status.pending',
  reviewed: 'admin.accessRequests.status.reviewed',
};

interface AdminAccessRequestsPanelProps {
  onManageUser: (userId: string) => void;
}

export function AdminAccessRequestsPanel({ onManageUser }: AdminAccessRequestsPanelProps) {
  const { t, locale } = useI18n();
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<AccessRequestPage>();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AccessRequestSummary['status']>('all');
  const [purposeFilter, setPurposeFilter] = useState<'all' | AccessRequestSummary['purpose']>('all');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError('');
      try {
        const result = await getJson<AccessRequestPage>(
          `/api/v1/admin/access-requests?page=${pageNumber}&pageSize=25`,
          signal,
        );
        if (!signal?.aborted) setPage(result);
      } catch (failure) {
        if (!signal?.aborted) {
          setError(
            failure instanceof ApiError && failure.status === 403
              ? t('admin.accessRequests.error.forbidden')
              : t('admin.accessRequests.error.load'),
          );
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [pageNumber, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function review(item: AccessRequestSummary) {
    setBusyId(item.publicId);
    setError('');
    setNotice('');
    try {
      const response = await request(`/api/v1/admin/access-requests/${item.publicId}/review`, {
        method: 'POST',
      });
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      setPage(
        (current) =>
          current && {
            ...current,
            items: current.items.map((requestItem) =>
              requestItem.publicId === item.publicId ? { ...requestItem, status: 'reviewed' } : requestItem,
            ),
          },
      );
      setNotice(t('admin.accessRequests.notice.reviewed'));
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 403
          ? t('admin.accessRequests.error.forbidden')
          : t('admin.accessRequests.error.review'),
      );
    } finally {
      setBusyId(undefined);
    }
  }

  const totalPages = page ? Math.max(1, Math.ceil(page.totalCount / page.pageSize)) : 1;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtersActive = normalizedQuery.length > 0 || statusFilter !== 'all' || purposeFilter !== 'all';
  const visibleRequests =
    page?.items.filter(
      (item) =>
        (!normalizedQuery || item.username.toLocaleLowerCase().includes(normalizedQuery)) &&
        (statusFilter === 'all' || item.status === statusFilter) &&
        (purposeFilter === 'all' || item.purpose === purposeFilter),
    ) ?? [];

  function clearFilters() {
    setQuery('');
    setStatusFilter('all');
    setPurposeFilter('all');
  }

  return (
    <section className="panel-card" aria-labelledby="admin-access-requests-title">
      <span className="eyebrow">{t('admin.accessRequests.eyebrow')}</span>
      <h2 id="admin-access-requests-title" className="h4 mt-2">
        {t('admin.accessRequests.title')}
      </h2>
      <p className="text-secondary">{t('admin.accessRequests.description')}</p>

      <search className="filter-bar" aria-label={t('admin.accessRequests.filterRegion')}>
        <div className="filter-field">
          <label className="form-label" htmlFor="access-requests-filter">
            {t('admin.accessRequests.filter')}
          </label>
          <input
            id="access-requests-filter"
            className="form-control"
            type="search"
            value={query}
            placeholder={t('admin.accessRequests.filterPlaceholder')}
            aria-describedby="access-requests-filter-hint"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div className="filter-field filter-field-compact">
          <label className="form-label" htmlFor="access-requests-status">
            {t('admin.accessRequests.filterStatus')}
          </label>
          <select
            id="access-requests-status"
            className="form-select"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.currentTarget.value as 'all' | AccessRequestSummary['status'])
            }
          >
            <option value="all">{t('admin.accessRequests.filterAllStatuses')}</option>
            {(['pending', 'reviewed'] as const).map((status) => (
              <option key={status} value={status}>
                {t(statusLabels[status])}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field filter-field-compact">
          <label className="form-label" htmlFor="access-requests-purpose">
            {t('admin.accessRequests.filterPurpose')}
          </label>
          <select
            id="access-requests-purpose"
            className="form-select"
            value={purposeFilter}
            onChange={(event) =>
              setPurposeFilter(event.currentTarget.value as 'all' | AccessRequestSummary['purpose'])
            }
          >
            <option value="all">{t('admin.accessRequests.filterAllPurposes')}</option>
            {(['live_monitoring', 'camera_access'] as const).map((purpose) => (
              <option key={purpose} value={purpose}>
                {t(purposeLabels[purpose])}
              </option>
            ))}
          </select>
        </div>
        {filtersActive && (
          <>
            <p className="filter-count mb-0" role="status" aria-live="polite">
              {t('admin.accessRequests.filterCount', {
                shown: visibleRequests.length,
                total: page?.items.length ?? 0,
              })}
            </p>
            <button className="btn btn-outline-light btn-sm" type="button" onClick={clearFilters}>
              {t('admin.accessRequests.clearSearch')}
            </button>
          </>
        )}
      </search>
      <p id="access-requests-filter-hint" className="filter-hint small text-secondary">
        {t('admin.accessRequests.filterHint')}
      </p>

      {error && (
        <div className="error-text" role="alert">
          <p>{error}</p>
          <button className="btn btn-outline-light btn-sm" type="button" onClick={() => void load()}>
            {t('admin.accessRequests.retry')}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">{t('admin.accessRequests.loading')}</p>
      ) : page?.items.length === 0 ? (
        <p role="status">{t('admin.accessRequests.empty')}</p>
      ) : (
        <>
          {visibleRequests.length === 0 ? (
            <p className="small text-secondary" role="status">
              {t('admin.accessRequests.noFilterMatches')}
            </p>
          ) : (
            <ul className="admin-grant-list">
              {visibleRequests.map((item) => (
                <li key={item.publicId}>
                  <div>
                    <strong>{item.username}</strong>
                    <p className="small mb-1">{t(purposeLabels[item.purpose])}</p>
                    <p className="small text-secondary mb-0">
                      {t(statusLabels[item.status])} · {new Date(item.createdAtUtc).toLocaleString(locale)}
                    </p>
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    <button
                      className="btn btn-outline-light btn-sm"
                      type="button"
                      onClick={() => onManageUser(item.userPublicId)}
                    >
                      {t('admin.accessRequests.manageUser')}
                    </button>
                    {item.status === 'pending' && (
                      <button
                        className="btn btn-outline-light btn-sm"
                        type="button"
                        disabled={!!busyId}
                        onClick={() => void review(item)}
                      >
                        {busyId === item.publicId
                          ? t('admin.accessRequests.reviewing')
                          : t('admin.accessRequests.review')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {totalPages > 1 && (
            <nav className="admin-pagination mt-3" aria-label={t('admin.accessRequests.pagination')}>
              <button
                className="btn btn-outline-light btn-sm"
                type="button"
                disabled={loading || pageNumber <= 1}
                onClick={() => setPageNumber((value) => value - 1)}
              >
                {t('admin.accessRequests.previous')}
              </button>
              <span>{t('admin.accessRequests.page', { current: pageNumber, total: totalPages })}</span>
              <button
                className="btn btn-outline-light btn-sm"
                type="button"
                disabled={loading || pageNumber >= totalPages}
                onClick={() => setPageNumber((value) => value + 1)}
              >
                {t('admin.accessRequests.next')}
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
