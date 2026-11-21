import {
  BarChart3,
  CalendarRange,
  ClipboardList,
  Cpu,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
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

const ROUND_BTN =
  'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface text-ink shadow-pill hover:bg-subtle';

// Floating pill navigation: one bar for every screen size (scrolls sideways on very narrow phones).
export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 mx-auto flex w-max max-w-full items-center gap-2.5 overflow-x-auto p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <nav className="flex gap-1 rounded-full bg-surface p-1.5 shadow-pill" aria-label="Головна навігація">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={label}
              aria-label={label}
              className={({ isActive }) =>
                `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                  isActive ? 'bg-subtle text-ink' : 'text-ink-muted hover:bg-subtle hover:text-ink'
                }`
              }
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={toggleTheme}
          className={ROUND_BTN}
          title={theme === 'dark' ? 'Світла тема' : 'Темна тема'}
          aria-label="Перемкнути тему"
        >
          {theme === 'dark' ? (
            <Sun className="h-[18px] w-[18px]" strokeWidth={1.75} />
          ) : (
            <Moon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate('/login');
          }}
          className={ROUND_BTN}
          title={`Вийти (${user?.name ?? 'користувач'}, ${user?.role ?? ''})`}
          aria-label="Вийти"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-4 sm:px-6 lg:pt-8">{children}</main>
    </div>
  );
}
