import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { AppRuntime } from '@/components/app-runtime';
import { WebSQLiteGate } from '@/components/web-sqlite-gate';
import { migrateDatabase } from '@/lib/db';
import { configureNotificationHandling } from '@/lib/notifications';
import { JienThemeProvider, useJienTheme } from '@/theme';

configureNotificationHandling();

function AppNavigator() {
  const { colors, isDark } = useJienTheme();
  return (
    <>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.canvas },
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="workouts/new" options={{ title: 'Log workout', presentation: 'modal' }} />
        <Stack.Screen name="workouts/[id]" options={{ title: 'Workout' }} />
        <Stack.Screen name="meals/new" options={{ title: 'Log meal', presentation: 'modal' }} />
        <Stack.Screen name="settings/macros" options={{ title: 'Macro targets', presentation: 'modal' }} />
        <Stack.Screen name="settings/account" options={{ title: 'Account', presentation: 'modal' }} />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <WebSQLiteGate>
        <Suspense fallback={<View style={styles.boot}><ActivityIndicator color="#71452F" /></View>}>
          <SQLiteProvider databaseName="jien.db" onInit={migrateDatabase} useSuspense>
            <JienThemeProvider>
              <AppRuntime />
              <AppNavigator />
            </JienThemeProvider>
          </SQLiteProvider>
        </Suspense>
      </WebSQLiteGate>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F1E7' },
});
