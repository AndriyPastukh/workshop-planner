import { useIsFetching } from '@tanstack/react-query';
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
  SlidersHorizontal,
  Sun,
  Users,
} from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Огляд', icon: LayoutDashboard },
  { to: '/orders', label: 'Замовлення', icon: ClipboardList },
  { to: '/planner', label: 'Планувальник', icon: CalendarRange },
  { to: '/what-if', label: 'Що якщо?', icon: SlidersHorizontal },
  { to: '/machines', label: 'Верстати', icon: Cpu },
  { to: '/materials', label: 'Матеріали', icon: Package },
  { to: '/customers', label: 'Клієнти', icon: Users },
  { to: '/analytics', label: 'Аналітика', icon: BarChart3 },
  { to: '/settings', label: 'Налаштування', icon: Settings },
];

const ROUND_BTN =
  'inline-flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full bg-surface text-ink shadow-pill transition-[background-color,transform] duration-150 hover:bg-subtle active:scale-95';

// Floating pill navigation: one bar for every screen size (scrolls sideways on very narrow phones).
export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isFetching = useIsFetching();

  const itemRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  const activePath =
    NAV_ITEMS.find((item) =>
      item.to === '/'
        ? location.pathname === '/'
        : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    )?.to ?? '';

  const updateIndicator = useCallback(() => {
    const el = itemRefs.current[activePath];
    if (!el) {
      setIndicator((prev) => ({ ...prev, ready: false }));
      return;
    }
    setIndicator({
      left: el.offsetLeft,
      width: el.offsetWidth,
      ready: true,
    });
  }, [activePath]);

  useLayoutEffect(() => {
    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-ink">
      {/* Subtle non-blocking top progress bar during background queries */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
        {isFetching > 0 ? <div className="h-full wp-topbar-active" /> : null}
      </div>

      <header className="sticky top-0 z-30 w-full px-2.5 py-3 sm:px-5 sm:py-5 print:hidden">
        <div className="mx-auto flex w-full max-w-full items-center justify-start gap-1.5 overflow-x-auto py-1 sm:w-max sm:justify-center sm:gap-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <nav
            className="relative flex shrink-0 gap-0.5 sm:gap-1 rounded-full bg-surface p-1 sm:p-1.5 shadow-pill"
            aria-label="Головна навігація"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-1 sm:top-1.5 z-0 h-9 sm:h-11 rounded-full bg-subtle transition-[transform,width,opacity] duration-200 ease-out"
              style={{
                width: indicator.width,
                transform: `translateX(${indicator.left}px)`,
                opacity: indicator.ready ? 1 : 0,
              }}
            />

            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                ref={(el) => {
                  if (el) {
                    itemRefs.current[to] = el;
                  }
                }}
                title={label}
                aria-label={label}
                className={({ isActive }) =>
                  `relative z-10 inline-flex h-9 w-9 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ${
                    isActive ? 'text-ink' : 'text-ink-muted hover:bg-subtle/60 hover:text-ink'
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
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-4 sm:px-6 lg:pt-8">
        <div key={location.pathname} className="wp-page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
