import type { UserRole } from '../domain/platform';
import { useI18n } from '../i18n/i18n';
import { LOCALES, type Locale } from '../i18n/messages';
import type { ThemeId } from '../theme/theme';
import { ThemeSelector } from './ThemeSelector';

interface AppHeaderProps {
  role?: UserRole;
  username?: string;
  activeClients?: string;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  onLogout: () => void;
  busy?: boolean;
}

const roleMessageKeys = {
  Administrator: 'role.administrator',
  Viewer: 'role.viewer',
  User: 'role.user',
} as const;

export function AppHeader({
  role,
  username,
  activeClients,
  theme,
  onThemeChange,
  onLogout,
  busy = false,
}: AppHeaderProps) {
  const { locale, setLocale, t } = useI18n();
  const roleLabel = role ? t(roleMessageKeys[role]) : '';
  const clientCountLabel =
    activeClients === undefined
      ? ''
      : t(activeClients === '1' ? 'header.clients.one' : 'header.clients.other', {
          count: activeClients,
        });
  return (
    <header className="app-header">
      <div className="header-brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <title>Home IA</title>
            <path
              d="M4 14.2 16 5l12 9.2v12.3a1.5 1.5 0 0 1-1.5 1.5h-21A1.5 1.5 0 0 1 4 26.5V14.2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M10 28v-8h12v8M10 14h.01M16 14h.01M22 14h.01"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div>
          <p className="eyebrow mb-1">
            HOME IA <span className="brand-separator">/</span> {t('app.brand.local')}
          </p>
          <h1 className="h3 mb-0">{t('app.title')}</h1>
        </div>
      </div>
      <div className="header-toolbar">
        <div className="header-preferences">
          <label className="visually-hidden" htmlFor="language-select">
            {t('language.label')}
          </label>
          <select
            id="language-select"
            className="form-select form-select-sm"
            aria-label={t('language.label')}
            value={locale}
            onChange={(event) => setLocale(event.currentTarget.value as Locale)}
          >
            {LOCALES.map((option) => (
              <option key={option} value={option}>
                {t(`language.${option}`)}
              </option>
            ))}
          </select>
          <ThemeSelector value={theme} onChange={onThemeChange} />
        </div>
        <div className="header-session">
          {role && username && (
            <div className="user-identity">
              <span className="user-avatar" aria-hidden="true">
                {username.trim().slice(0, 2).toUpperCase()}
              </span>
              <span className="user-identity-copy">
                <span className="user-identity-name">{username}</span>
                <span className="user-identity-role">{roleLabel}</span>
              </span>
            </div>
          )}
          {activeClients !== undefined && (
            <span className="client-count" role="status" aria-label={clientCountLabel} aria-live="polite">
              <svg className="client-count-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="9" cy="8" r="3" />
                <path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20z" />
                <path d="M16 5.5a3 3 0 0 1 0 5.7M17 14a5 5 0 0 1 3.5 4.8V20" />
              </svg>
              <span className="client-count-value" aria-hidden="true">
                {activeClients}
              </span>
            </span>
          )}
          {role && (
            <button
              className="btn btn-outline-light btn-sm header-logout"
              type="button"
              onClick={onLogout}
              disabled={busy}
            >
              {busy ? t('header.logoutBusy') : t('header.logout')}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
