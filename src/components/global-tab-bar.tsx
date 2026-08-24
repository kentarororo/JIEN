import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radii, spacing, typography, useJienTheme } from '@/theme';

import { AppText } from './ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ITEMS: Array<{
  label: string;
  href: '/today' | '/train' | '/food' | '/wellness' | '/settings';
  icon: IconName;
  activeIcon: IconName;
  matches: (path: string) => boolean;
}> = [
  { label: 'Today', href: '/today', icon: 'today-outline', activeIcon: 'today', matches: (path) => path === '/' || path === '/today' },
  { label: 'Train', href: '/train', icon: 'barbell-outline', activeIcon: 'barbell', matches: (path) => path === '/train' || path.startsWith('/workouts') || path.startsWith('/exercises') },
  { label: 'Food', href: '/food', icon: 'restaurant-outline', activeIcon: 'restaurant', matches: (path) => path === '/food' || path.startsWith('/meals') || path === '/settings/macros' },
  { label: 'Wellness', href: '/wellness', icon: 'heart-outline', activeIcon: 'heart', matches: (path) => path === '/wellness' || path.startsWith('/wellness/') },
  { label: 'Settings', href: '/settings', icon: 'settings-outline', activeIcon: 'settings', matches: (path) => path === '/settings' || path.startsWith('/settings/') },
];

export function GlobalTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { colors } = useJienTheme();
  const [focusedHref, setFocusedHref] = useState<string | null>(null);
  if (pathname === '/' || pathname === '/onboarding' || pathname.startsWith('/auth/')) return null;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      <View style={styles.row}>
        {ITEMS.map((item) => {
          const active = item.matches(pathname);
          const color = active ? colors.accent : colors.textMuted;
          return (
            <Pressable
              key={item.href}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              onPress={() => router.navigate(item.href as Href)}
              onFocus={() => setFocusedHref(item.href)}
              onBlur={() => setFocusedHref((current) => current === item.href ? null : current)}
              style={({ pressed }) => [styles.item, { borderColor: focusedHref === item.href ? colors.accent : 'transparent' }, active && { backgroundColor: colors.accentSoft }, pressed && styles.pressed]}
            >
              <Ionicons name={active ? item.activeIcon : item.icon} size={21} color={color} />
              <AppText style={[styles.label, { color }]}>{item.label}</AppText>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { width: '100%', maxWidth: 760, alignSelf: 'center', flexDirection: 'row', paddingHorizontal: spacing.xs, paddingTop: spacing.xs, gap: spacing.xxs },
  item: { flex: 1, minHeight: 48, borderWidth: 2, borderRadius: radii.control, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: spacing.xxs },
  label: { ...typography.caption, fontWeight: '700' },
  pressed: { opacity: 0.68 },
});
