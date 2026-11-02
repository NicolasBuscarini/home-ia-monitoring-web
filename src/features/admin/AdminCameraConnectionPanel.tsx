import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n/i18n';
import { ApiError, getJson, request } from '../../services/http';

interface CatalogCamera {
  cameraId: string;
  contextId: string;
  name: string;
  isEnabled: boolean;
  version: number;
}

interface CameraConnection {
  cameraPublicId: string;
  address: string;
  isCaptureCamera: boolean;
}

interface Props {
  cameraId: string;
}

export function AdminCameraConnectionPanel({ cameraId }: Props) {
  const { t } = useI18n();
  const [camera, setCamera] = useState<CatalogCamera>();
  const [connection, setConnection] = useState<CameraConnection>();
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingAddress, setSavingAddress] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalog, result] = await Promise.allSettled([
        getJson<{ items: CatalogCamera[] }>('/api/v1/admin/cameras?page=1&pageSize=100'),
        getJson<CameraConnection>(`/api/v1/admin/cameras/${cameraId}/connection`),
      ]);
      if (catalog.status === 'rejected') throw catalog.reason;
      const item = catalog.value.items.find((entry) => entry.cameraId === cameraId);
      if (!item) throw new ApiError('Camera not found', 404);
      setCamera(item);
      setName(item.name);
      if (result.status === 'fulfilled') {
        setConnection(result.value);
        setAddress(result.value.address);
        setConnectionUnavailable(false);
      } else {
        setConnection(undefined);
        setConnectionUnavailable(
          result.reason instanceof ApiError && [409, 503].includes(result.reason.status),
        );
        setError(
          result.reason instanceof ApiError && result.reason.status === 404
            ? t('admin.cameras.error.notActive')
            : t('admin.cameras.error.loadConnection'),
        );
      }
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 404
          ? t('admin.cameras.error.notFound')
          : t('admin.cameras.error.load'),
      );
    } finally {
      setLoading(false);
    }
  }, [cameraId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveName() {
    if (!camera || !name.trim() || name.trim() === camera.name) return;
    setSavingName(true);
    setError('');
    setNotice('');
    try {
      const response = await request(`/api/v1/admin/cameras/${camera.cameraId}`, {
        method: 'PUT',
        body: JSON.stringify({
          version: camera.version,
          contextId: camera.contextId,
          name: name.trim(),
          isEnabled: camera.isEnabled,
        }),
      });
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      const updated = (await response.json()) as CatalogCamera;
      setCamera(updated);
      setName(updated.name);
      setNotice(t('admin.cameras.notice.nameSaved'));
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? t('admin.cameras.error.nameConflict')
          : t('admin.cameras.error.saveName'),
      );
    } finally {
      setSavingName(false);
    }
  }

  async function saveAddress() {
    if (!connection || !address.trim() || address.trim() === connection.address) return;
    if (!window.confirm(t('admin.cameras.confirmAddress'))) return;
    setSavingAddress(true);
    setError('');
    setNotice('');
    try {
      const response = await request(`/api/v1/admin/cameras/${cameraId}/connection`, {
        method: 'PUT',
        body: JSON.stringify({ expectedAddress: connection.address, address: address.trim() }),
      });
      if (response.status === 409) {
        await load();
        setError(t('admin.cameras.error.addressConflict'));
        return;
      }
      if (response.status === 503) throw new ApiError('Unavailable', 503);
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      const updated = (await response.json()) as CameraConnection;
      setConnection(updated);
      setAddress(updated.address);
      setNotice(t('admin.cameras.notice.addressSaved'));
    } catch {
      setError(t('admin.cameras.error.saveAddress'));
    } finally {
      setSavingAddress(false);
    }
  }

  return (
    <section className="panel-card" aria-labelledby="admin-cameras-title">
      <span className="eyebrow">{t('admin.cameras.eyebrow')}</span>
      <h2 id="admin-cameras-title" className="h4 mt-2">
        {t('admin.cameras.title')}
      </h2>
      <p className="text-secondary">{t('admin.cameras.description')}</p>
      {loading ? (
        <p role="status" aria-live="polite">
          {t('admin.cameras.loading')}
        </p>
      ) : (
        <>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="feedback" role="status" aria-live="polite">
              {notice}
            </p>
          )}
          {camera && (
            <div className="mb-4">
              <label className="form-label" htmlFor="active-camera-name">
                {t('admin.cameras.name')}
              </label>
              <div className="d-flex flex-wrap gap-2">
                <input
                  id="active-camera-name"
                  className="form-control"
                  value={name}
                  maxLength={128}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
                <button
                  className="btn btn-outline-primary"
                  type="button"
                  onClick={() => void saveName()}
                  disabled={savingName || !name.trim() || name.trim() === camera.name}
                >
                  {savingName ? t('admin.cameras.saving') : t('admin.cameras.saveName')}
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="form-label" htmlFor="active-camera-address">
              {t('admin.cameras.address')}
            </label>
            <p className="small text-secondary">{t('admin.cameras.addressHelp')}</p>
            <div className="d-flex flex-wrap gap-2">
              <input
                id="active-camera-address"
                className="form-control"
                value={address}
                autoComplete="off"
                inputMode="url"
                maxLength={253}
                onChange={(event) => setAddress(event.currentTarget.value)}
                disabled={!connection || savingAddress}
              />
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void saveAddress()}
                disabled={
                  !connection || savingAddress || !address.trim() || address.trim() === connection?.address
                }
              >
                {savingAddress ? t('admin.cameras.applying') : t('admin.cameras.applyAddress')}
              </button>
            </div>
            {connectionUnavailable && (
              <p className="small text-secondary mt-2">{t('admin.cameras.connectionUnavailable')}</p>
            )}
          </div>
        </>
      )}
      <p className="small text-secondary mt-4 mb-0">{t('admin.cameras.scopeNotice')}</p>
      {!loading && (
        <button className="btn btn-link px-0 mt-2" type="button" onClick={() => void load()}>
          {t('admin.cameras.retry')}
        </button>
      )}
    </section>
  );
}
