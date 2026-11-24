import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ThemeMode, MessengerThemeMode } from '@/src/types/bana';

interface ThemeContextValue {
  themeMode: ThemeMode;
  messengerTheme: MessengerThemeMode;
  resolvedTheme: 'light' | 'dark';
  resolvedMessengerTheme: 'light' | 'dark';
  setThemeMode: (mode: ThemeMode) => void;
  setMessengerTheme: (mode: MessengerThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('bana_admin_theme_mode');
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'light';
  });

  const [messengerTheme, setMessengerThemeState] = useState<MessengerThemeMode>(() => {
    const saved = localStorage.getItem('bana_admin_messenger_theme');
    return saved === 'light' || saved === 'dark' || saved === 'match' ? saved : 'match';
  });

  const [systemPref, setSystemPref] = useState<'light' | 'dark'>(getSystemTheme);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPref(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedTheme: 'light' | 'dark' = themeMode === 'system' ? systemPref : themeMode;
  const resolvedMessengerTheme: 'light' | 'dark' =
    messengerTheme === 'match' ? resolvedTheme : messengerTheme;

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [resolvedTheme]);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    localStorage.setItem('bana_admin_theme_mode', mode);
  };

  const setMessengerTheme = (mode: MessengerThemeMode) => {
    setMessengerThemeState(mode);
    localStorage.setItem('bana_admin_messenger_theme', mode);
  };

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        messengerTheme,
        resolvedTheme,
        resolvedMessengerTheme,
        setThemeMode,
        setMessengerTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
