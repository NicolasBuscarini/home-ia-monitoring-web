import { type FormEvent, useState } from 'react';
import { useI18n } from '../../i18n/i18n';
import { postJson, safeApiMessage } from '../../services/http';

type AuthMode = 'login' | 'register';

interface AuthenticationPanelProps {
  onAuthenticated: (username: string) => Promise<void>;
}

export function AuthenticationPanel({ onAuthenticated }: AuthenticationPanelProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>('login');
  const [busy, setBusy] = useState(false);
  const [loginMessage, setLoginMessage] = useState('');
  const [loginError, setLoginError] = useState('');
  const [registerMessage, setRegisterMessage] = useState('');
  const [registrationComplete, setRegistrationComplete] = useState('');

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get('username') ?? '');
    const password = String(data.get('password') ?? '');
    setLoginError('');
    setLoginMessage('');
    setBusy(true);
    try {
      const response = await postJson('/api/v1/auth/login', { username, password });
      if (!response.ok) {
        setLoginError(t('auth.login.denied'));
        return;
      }
      form.reset();
      await onAuthenticated(username);
    } catch {
      setLoginError(t('auth.serviceUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get('username') ?? '');
    setRegisterMessage('');
    setBusy(true);
    try {
      const response = await postJson('/api/v1/auth/register', {
        username,
        password: String(data.get('password') ?? ''),
        confirmPassword: String(data.get('confirmPassword') ?? ''),
      });
      if (response.status === 202) {
        form.reset();
        setRegistrationComplete(username);
        setLoginMessage(t('auth.register.processed'));
        setMode('login');
        return;
      }
      setRegisterMessage(
        response.status === 400
          ? t('auth.register.invalid')
          : response.status === 403
            ? t('auth.register.localOnly')
            : response.status === 429
              ? t('auth.register.rateLimited')
              : safeApiMessage(new Error(`HTTP ${response.status}`), t('auth.register.failed')),
      );
    } catch {
      setRegisterMessage(t('auth.serviceUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'register') {
    return (
      <section className="panel-card login-panel mx-auto" aria-labelledby="register-title">
        <div className="login-heading mb-4">
          <span className="eyebrow">{t('auth.register.eyebrow')}</span>
          <h2 id="register-title" className="h4 mt-2 mb-2">
            {t('auth.register.title')}
          </h2>
          <p className="text-secondary mb-0">{t('auth.register.description')}</p>
        </div>
        <form onSubmit={submitRegistration}>
          <div className="mb-3">
            <label className="form-label" htmlFor="register-username">
              {t('auth.username')}
            </label>
            <input
              id="register-username"
              className="form-control"
              name="username"
              autoComplete="username"
              required
              minLength={3}
              maxLength={64}
              pattern="[A-Za-z0-9._@+-]+"
              aria-describedby="register-username-help"
            />
            <div id="register-username-help" className="form-text">
              {t('auth.register.usernameHelp')}
            </div>
          </div>
          <div className="mb-3">
            <label className="form-label" htmlFor="register-password">
              {t('auth.password')}
            </label>
            <input
              id="register-password"
              className="form-control"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              maxLength={256}
              aria-describedby="register-password-help"
            />
            <div id="register-password-help" className="form-text">
              {t('auth.register.passwordHelp')}
            </div>
          </div>
          <div className="mb-3">
            <label className="form-label" htmlFor="register-confirm-password">
              {t('auth.register.confirmPassword')}
            </label>
            <input
              id="register-confirm-password"
              className="form-control"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              maxLength={256}
            />
          </div>
          <button className="btn btn-primary w-100" type="submit" disabled={busy}>
            {busy ? t('auth.register.submitting') : t('auth.register.submit')}
          </button>
          <button
            className="btn btn-link w-100 mt-2"
            type="button"
            onClick={() => {
              setMode('login');
              setRegisterMessage('');
            }}
          >
            {t('auth.register.back')}
          </button>
          <p className="feedback error-text mt-3 mb-0" role="status" aria-live="polite">
            {registerMessage}
          </p>
        </form>
      </section>
    );
  }

  return (
    <section className="panel-card login-panel mx-auto" aria-labelledby="login-title">
      <div className="login-heading mb-4">
        <span className="eyebrow">{t('auth.login.eyebrow')}</span>
        <h2 id="login-title" className="h4 mt-2 mb-2">
          {t('auth.login.title')}
        </h2>
        <p className="text-secondary mb-0">{t('auth.login.description')}</p>
      </div>
      <form onSubmit={submitLogin}>
        <div className="mb-3">
          <label className="form-label" htmlFor="username">
            {t('auth.username')}
          </label>
          <input
            id="username"
            className="form-control"
            name="username"
            autoComplete="username"
            required
            maxLength={64}
            defaultValue={registrationComplete}
          />
        </div>
        <div className="mb-4">
          <label className="form-label" htmlFor="password">
            {t('auth.password')}
          </label>
          <input
            id="password"
            className="form-control"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
          />
        </div>
        <button className="btn btn-primary w-100" type="submit" disabled={busy}>
          {busy ? t('auth.login.submitting') : t('auth.login.submit')}
        </button>
        <button
          className="btn btn-link w-100 mt-2"
          type="button"
          onClick={() => {
            setMode('register');
            setRegisterMessage('');
            setLoginError('');
          }}
        >
          {t('auth.login.register')}
        </button>
        <p className="feedback error-text mt-3 mb-0" role="status" aria-live="polite">
          {loginError}
        </p>
        <p className="feedback mt-2 mb-0" role="status" aria-live="polite">
          {loginMessage}
        </p>
      </form>
    </section>
  );
}
