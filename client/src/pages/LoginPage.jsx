import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { FormField } from '../components/FormField.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.jsx';

export default function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [email, setEmail] = useState('owner@workshop.ua');
  const [password, setPassword] = useState('Owner123!');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/orders" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/orders', { replace: true });
    } catch (err) {
      setError(err.message || 'Не вдалося виконати вхід');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-between bg-canvas px-4 py-6 text-ink">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} />
              <span>Світла тема</span>
            </>
          ) : (
            <>
              <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Темна тема</span>
            </>
          )}
        </button>
      </div>

      <div className="mx-auto w-full max-w-[360px]">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-surface font-mono text-xs font-semibold text-accent">
            WP
          </span>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-ink">Workshop Planner</h1>
            <p className="text-xs text-ink-muted">Собівартість та планування черги виробництва</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-3.5 rounded-md border border-line bg-surface p-5"
        >
          <FormField label="Електронна пошта" htmlFor="login-email" required>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 w-full rounded border border-line-strong bg-canvas px-3 text-sm text-ink outline-none focus:border-accent"
            />
          </FormField>

          <FormField label="Пароль" htmlFor="login-password" required>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 w-full rounded border border-line-strong bg-canvas px-3 text-sm text-ink outline-none focus:border-accent"
            />
          </FormField>

          {error ? (
            <div
              role="alert"
              style={{
                backgroundColor: 'var(--st-danger-bg)',
                color: 'var(--st-danger-fg)',
                borderColor: 'var(--st-danger-bd)',
              }}
              className="rounded border px-3 py-2 text-xs"
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="h-9 w-full rounded bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? 'Перевірка...' : 'Увійти'}
          </button>
        </form>

        <div className="mt-3 rounded border border-line bg-subtle px-3 py-2 text-xs text-ink-secondary">
          <div className="font-medium text-ink">Локальні демо-обліковки:</div>
          <div className="mt-1 font-mono text-[11px] leading-relaxed">
            <div>Власник: owner@workshop.ua / Owner123!</div>
            <div>Оператор: operator@workshop.ua / Operator123!</div>
          </div>
        </div>
      </div>

      <footer className="text-center font-mono text-[11px] text-ink-muted">
        НУ «Львівська політехніка» · ОІ-31 · 2026
      </footer>
    </div>
  );
}
