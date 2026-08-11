import type { ColorSchemeName, TextStyle, ViewStyle } from 'react-native';

const lightColors = {
  canvas: '#F7F1E7',
  surface: '#FFFBF5',
  surfaceRaised: '#FFFDF9',
  surfaceMuted: '#F1E5D8',
  text: '#2B211B',
  textMuted: '#6E6056',
  textOnAccent: '#FFF9F3',
  border: '#E4D7C8',
  accent: '#71452F',
  accentPressed: '#593523',
  accentSoft: '#E8D3C2',
  wood: '#B98462',
  success: '#5F735E',
  successSoft: '#DFE8DC',
  warning: '#996827',
  warningSoft: '#F4E2BF',
  danger: '#9D493C',
  dangerSoft: '#F2D9D3',
  overlay: 'rgba(43, 33, 27, 0.42)',
} as const;

const darkColors = {
  canvas: '#17120F',
  surface: '#211A16',
  surfaceRaised: '#2A211B',
  surfaceMuted: '#35271F',
  text: '#F7EFE4',
  textMuted: '#BDAEA1',
  textOnAccent: '#2A1B14',
  border: '#49392F',
  accent: '#D7A47E',
  accentPressed: '#E6B991',
  accentSoft: '#4A352A',
  wood: '#AA7554',
  success: '#9EB49A',
  successSoft: '#2D3A2C',
  warning: '#D8AA64',
  warningSoft: '#45351E',
  danger: '#DF9182',
  dangerSoft: '#472A25',
  overlay: 'rgba(0, 0, 0, 0.62)',
} as const;

export type ThemeColors = { [Key in keyof typeof lightColors]: string };

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  jumbo: 48,
} as const;

export const radii = {
  compact: 8,
  control: 12,
  card: 16,
  sheet: 24,
  pill: 999,
} as const;

export const typography = {
  caption: { fontSize: 12, lineHeight: 16 } satisfies TextStyle,
  label: { fontSize: 14, lineHeight: 20 } satisfies TextStyle,
  body: { fontSize: 16, lineHeight: 24 } satisfies TextStyle,
  bodyLarge: { fontSize: 18, lineHeight: 24 } satisfies TextStyle,
  section: { fontSize: 22, lineHeight: 28 } satisfies TextStyle,
  title: { fontSize: 28, lineHeight: 34 } satisfies TextStyle,
  display: { fontSize: 36, lineHeight: 42 } satisfies TextStyle,
} as const;

export const elevation = {
  floating: {
    shadowColor: '#2B211B',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  } satisfies ViewStyle,
} as const;

export type ResolvedTheme = {
  isDark: boolean;
  colors: ThemeColors;
};

export function resolveTheme(colorScheme: ColorSchemeName): ResolvedTheme {
  const isDark = colorScheme === 'dark';
  return { isDark, colors: isDark ? darkColors : lightColors };
}

export const themes = {
  light: { isDark: false, colors: lightColors },
  dark: { isDark: true, colors: darkColors },
} satisfies Record<'light' | 'dark', ResolvedTheme>;
