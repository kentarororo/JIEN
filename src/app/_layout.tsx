import { Stack, useGlobalSearchParams, usePathname } from 'expo-router';
import { SQLiteProvider } from '@/lib/db/database-context';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { AppRuntime } from '@/components/app-runtime';
import { GlobalTabBar } from '@/components/global-tab-bar';
import { OAuthCallbackCompletion } from '@/components/oauth-callback-completion';
import { WebAuthGate } from '@/components/web-auth-gate';
import { WebCloudHydrationGate } from '@/components/web-cloud-hydration-gate';
import {
  reportWebSQLiteProviderError,
  WebSQLiteDatabaseLifecycle,
  WebSQLiteGate,
  WebSQLiteProviderErrorBoundary,
} from '@/components/web-sqlite-gate';
import {
  isNativeOAuthCallbackPath,
  parseWebOAuthCallbackUrl,
  type OAuthCallbackRequest,
} from '@/lib/auth/oauth';
import { migrateDatabase } from '@/lib/db';
import { configureNotificationHandling } from '@/lib/notifications';
import { JienThemeProvider, useJienTheme } from '@/theme';

configureNotificationHandling();

function AppNavigator() {
  const { colors, isDark } = useJienTheme();
  return (
    <View style={[styles.app, { backgroundColor: colors.canvas }]}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.canvas },
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="workouts/new" options={{ title: 'Log workout', presentation: 'modal' }} />
        <Stack.Screen name="workouts/plan" options={{ title: 'Plan workout', presentation: 'modal' }} />
        <Stack.Screen name="workouts/[id]" options={{ title: 'Workout' }} />
        <Stack.Screen name="meals/new" options={{ title: 'Log meal', presentation: 'modal' }} />
        <Stack.Screen name="meals/[id]" options={{ title: 'Meal' }} />
        <Stack.Screen name="wellness/body" options={{ title: 'Body measurements', presentation: 'modal' }} />
        <Stack.Screen name="settings/macros" options={{ title: 'Macro targets', presentation: 'modal' }} />
        <Stack.Screen name="settings/account" options={{ title: 'Account', presentation: 'modal' }} />
      </Stack>
      <GlobalTabBar />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </View>
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function DatabaseApp() {
  const database = (
    <SQLiteProvider
      databaseName={Platform.OS === 'web' ? ':memory:' : 'jien.db'}
      onError={Platform.OS === 'web' ? reportWebSQLiteProviderError : undefined}
      onInit={migrateDatabase}
    >
      <JienThemeProvider>
        <WebSQLiteDatabaseLifecycle />
        <WebCloudHydrationGate>
          <AppRuntime />
          <AppNavigator />
        </WebCloudHydrationGate>
      </JienThemeProvider>
    </SQLiteProvider>
  );

  return (
    <WebSQLiteGate>
      {Platform.OS === 'web'
        ? <WebSQLiteProviderErrorBoundary>{database}</WebSQLiteProviderErrorBoundary>
        : database}
    </WebSQLiteGate>
  );
}

export default function RootLayout() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{
    code?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
  }>();
  // Match the static server render on web and, critically, do not let SQLite
  // begin loading until the browser URL has been checked for an OAuth return.
  const [webUrlReady, setWebUrlReady] = useState(Platform.OS !== 'web');

  useEffect(() => {
    if (Platform.OS === 'web') setWebUrlReady(true);
  }, []);

  if (!webUrlReady) {
    return <View style={styles.boot}><ActivityIndicator color="#71452F" /></View>;
  }

  let callbackRequest: OAuthCallbackRequest | null = null;
  if (Platform.OS === 'web' && typeof globalThis.location !== 'undefined') {
    callbackRequest = parseWebOAuthCallbackUrl(globalThis.location.href);
  }
  if (!callbackRequest && isNativeOAuthCallbackPath(pathname)) {
    callbackRequest = {
      code: firstParam(params.code),
      errorCode: firstParam(params.error),
      errorDescription: firstParam(params.error_description),
    };
  }

  return (
    <AppErrorBoundary>
      {callbackRequest
        ? <OAuthCallbackCompletion request={callbackRequest} />
        : <WebAuthGate><DatabaseApp /></WebAuthGate>}
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F1E7' },
});
