import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import { getSetting, setSetting } from '@/lib/db';

import { resolveTheme, themes, type ResolvedTheme } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

type ThemeContextValue = ResolvedTheme & {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function JienThemeProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    let active = true;
    getSetting(db, 'theme_preference').then((stored) => {
      if (active && (stored === 'system' || stored === 'light' || stored === 'dark')) {
        setPreference(stored);
      }
    });
    return () => {
      active = false;
    };
  }, [db]);

  const updatePreference = useCallback(
    (next: ThemePreference) => {
      setPreference(next);
      void setSetting(db, 'theme_preference', next);
    },
    [db],
  );

  const value = useMemo<ThemeContextValue>(() => {
    const resolved = preference === 'system' ? resolveTheme(systemScheme) : themes[preference];
    return { ...resolved, preference, setPreference: updatePreference };
  }, [preference, systemScheme, updatePreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useJienTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useJienTheme must be used within JienThemeProvider.');
  }
  return context;
}
