import { createContext, useContext, useEffect, useRef, useState } from 'react';

const ThemeContext = createContext(null);
const THEME_KEY = 'wp_theme';

export function ThemeProvider({ children }) {
  const isFirstMount = useRef(true);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    let rafId = null;

    if (!isFirstMount.current) {
      root.classList.add('theme-switching');
    }

    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore storage errors
    }

    if (!isFirstMount.current) {
      void root.offsetHeight;
      if (typeof window.requestAnimationFrame === 'function') {
        rafId = window.requestAnimationFrame(() => root.classList.remove('theme-switching'));
      } else {
        root.classList.remove('theme-switching');
      }
    } else {
      isFirstMount.current = false;
    }

    return () => {
      if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
      }
      root.classList.remove('theme-switching');
    };
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
}
