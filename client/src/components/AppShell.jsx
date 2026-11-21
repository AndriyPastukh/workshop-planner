import {
  BarChart3,
  CalendarRange,
  ClipboardList,
  Cpu,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Огляд', icon: LayoutDashboard },
  { to: '/orders', label: 'Замовлення', icon: ClipboardList },
  { to: '/planner', label: 'Планувальник', icon: CalendarRange },
  { to: '/machines', label: 'Верстати', icon: Cpu },
  { to: '/materials', label: 'Матеріали', icon: Package },
  { to: '/customers', label: 'Клієнти', icon: Users },
  { to: '/analytics', label: 'Аналітика', icon: BarChart3 },
  { to: '/settings', label: 'Налаштування', icon: Settings },
];

export function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navContent = (onNavigate) => (
    <div className="flex h-full flex-col justify-between">
      <div>
        <div className="flex h-12 items-center justify-between border-b border-line px-3.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded border border-line-strong bg-surface font-mono text-[11px] font-semibold text-accent">
              WP
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink">Workshop</span>
          </div>
          <span className="font-mono text-[10px] text-ink-muted">v1.0</span>
        </div>

        <nav className="mt-2 space-y-0.5 px-2" aria-label="Головна навігація">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                  isActive
                    ? 'border-l-2 border-accent bg-surface font-medium text-ink'
                    : 'text-ink-secondary hover:bg-surface/60 hover:text-ink'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="space-y-2 border-t border-line p-3">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center justify-between rounded border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink"
          aria-label="Перемкнути тему"
        >
          <span>{theme === 'dark' ? 'Темна тема' : 'Світла тема'}</span>
          {theme === 'dark' ? (
            <Sun className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} />
          ) : (
            <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>

        <div className="flex items-center justify-between gap-2 rounded border border-line bg-surface px-2.5 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-ink">{user?.name || 'Користувач'}</div>
            <div className="font-mono text-[10px] uppercase text-ink-muted">{user?.role}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded p-1 text-ink-muted hover:bg-subtle hover:text-ink"
            title="Вийти"
            aria-label="Вийти"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink lg:flex">
      {/* Desktop fixed sidebar */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[208px] lg:shrink-0 lg:flex-col lg:border-r lg:border-line lg:bg-subtle">
        {navContent(undefined)}
      </aside>

      {/* Mobile compact top bar */}
      <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-subtle px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-ink"
          aria-label="Відкрити меню"
        >
          <Menu className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold text-accent">WP</span>
          <span className="text-sm font-semibold text-ink">Workshop Planner</span>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-ink"
          aria-label="Перемкнути тему"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4 text-accent" strokeWidth={1.75} />
          ) : (
            <Moon className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/45" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 flex w-64 max-w-[80vw] flex-col border-r border-line bg-subtle">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-2.5 top-2.5 rounded p-1 text-ink-muted hover:bg-surface hover:text-ink"
              aria-label="Закрити меню"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
            {navContent(() => setMobileOpen(false))}
          </div>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 px-3 py-4 sm:px-4 lg:px-5 lg:py-5">{children}</main>
    </div>
  );
}
