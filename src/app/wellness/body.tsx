import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from '@/lib/db/database-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import { useScreenData } from '@/hooks/use-screen-data';
import { listBodyMeasurements, saveBodyMeasurement } from '@/lib/db';
import { formatShortDate, localTimestampForDate, toLocalDateKey } from '@/lib/time';
import { buildBodyWeightTrend } from '@/lib/wellness/body-trend';
import { radii, spacing, typography, useJienTheme } from '@/theme';

export default function BodyMeasurementsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const { colors } = useJienTheme();
  const { width } = useWindowDimensions();
  const selectedDate = normalizeDate(firstParam(params.date));
  const loader = useCallback(() => listBodyMeasurements(db, 90), [db]);
  const { data, error, loading, reload } = useScreenData(loader);
  const initialized = useRef(false);
  const [heightCm, setHeightCm] = useState('');
  const [bodyWeightKg, setBodyWeightKg] = useState('');
  const [bodyFatPercent, setBodyFatPercent] = useState('');
  const [bodyFatIsEstimated, setBodyFatIsEstimated] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const history = data ?? [];
  const trend = useMemo(() => buildBodyWeightTrend(history), [history]);

  useEffect(() => {
    if (initialized.current || loading) return;
    initialized.current = true;
    const latest = history[0];
    if (!latest) return;
    setHeightCm(String(latest.heightCm));
    setBodyWeightKg(String(latest.bodyWeightKg));
    setBodyFatPercent(latest.bodyFatPercent == null ? '' : String(latest.bodyFatPercent));
    setBodyFatIsEstimated(latest.bodyFatIsEstimated ?? true);
  }, [history, loading]);

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const bodyFat = bodyFatPercent.trim() ? Number(bodyFatPercent) : null;
      await saveBodyMeasurement(db, {
        heightCm: Number(heightCm),
        bodyWeightKg: Number(bodyWeightKg),
        bodyFatPercent: bodyFat,
        bodyFatIsEstimated: bodyFat == null ? null : bodyFatIsEstimated,
      }, localTimestampForDate(selectedDate));
      setNotice('Measurement saved on this device and queued for sync.');
      await reload();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The measurement could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Screen><StatePanel title="Loading body history" body="Reading your private measurements from this device." loading /></Screen>;
  if (error) return <Screen><StatePanel title="Body history is unavailable" body={error} actionLabel="Try again" onAction={() => void reload()} /></Screen>;

  const chartPoints = trend.points.slice(width >= 700 ? -14 : -8);
  const chartWeights = chartPoints.map((point) => point.bodyWeightKg);
  const chartMin = chartWeights.length ? Math.min(...chartWeights) : 0;
  const chartMax = chartWeights.length ? Math.max(...chartWeights) : 0;
  const chartRange = Math.max(0.5, chartMax - chartMin);

  return (
    <Screen contentContainerStyle={styles.content}>
      <ScreenHeading eyebrow="Body trend" title="Log a useful signal." />
      <Card>
        <AppText style={{ color: colors.textMuted }}>
          Weight can change from day to day. Raw entries remain unchanged, and averages appear only after enough consistent measurements. Targets never change automatically.
        </AppText>
      </Card>

      <Card>
        <SectionHeading title="New measurement" detail={formatSelectedDate(selectedDate)} />
        <View style={styles.fieldRow}>
          <Field label="Weight (kg)" value={bodyWeightKg} onChangeText={setBodyWeightKg} inputMode="decimal" placeholder="72.5" containerStyle={styles.flexField} />
          <Field label="Height (cm)" value={heightCm} onChangeText={setHeightCm} inputMode="decimal" placeholder="175" containerStyle={styles.flexField} />
        </View>
        <Field label="Body fat % (optional)" value={bodyFatPercent} onChangeText={setBodyFatPercent} inputMode="decimal" placeholder="18" hint="Keep this blank if the estimate would not be useful." />
        {bodyFatPercent.trim() ? (
          <View style={styles.pillRow}>
            <Pill label="Estimated" active={bodyFatIsEstimated} onPress={() => setBodyFatIsEstimated(true)} />
            <Pill label="Measured" active={!bodyFatIsEstimated} onPress={() => setBodyFatIsEstimated(false)} />
          </View>
        ) : null}
        <Button label="Save measurement" onPress={() => void save()} busy={busy} />
        {notice ? <AppText accessibilityRole="alert" style={{ color: notice.startsWith('Measurement saved') ? colors.success : colors.warning }}>{notice}</AppText> : null}
      </Card>

      <SectionHeading title="Weight trend" detail={trend.points.length ? `${trend.points.length} logged day${trend.points.length === 1 ? '' : 's'} across ${trend.spanDays} days` : 'A baseline starts with one entry'} />
      {chartPoints.length ? (
        <Card>
          <View style={styles.metricRow}>
            <Metric label="Latest" value={`${formatKg(trend.latestKg)} kg`} />
            <Metric label="Last 7 logged days" value={`${formatKg(trend.recentAverageKg)} kg`} />
            <Metric label={trend.averageChangeKg == null ? 'Previous entry' : 'Average change'} value={formatChange(trend.averageChangeKg ?? trend.latestChangeKg)} />
          </View>
          <View accessibilityLabel="Recent logged weight trend" style={styles.chart}>
            {chartPoints.map((point, index) => {
              const ratio = (point.bodyWeightKg - chartMin) / chartRange;
              return (
                <View key={point.id} style={styles.chartColumn}>
                  <AppText style={[styles.chartValue, { color: colors.textMuted }]}>{point.bodyWeightKg.toFixed(1)}</AppText>
                  <View style={[styles.chartTrack, { backgroundColor: colors.surfaceMuted }]}>
                    <View style={[styles.chartBar, { backgroundColor: colors.wood, height: `${Math.max(12, 18 + ratio * 82)}%` }]} />
                  </View>
                  <AppText style={[styles.chartDate, { color: colors.textMuted }]}>{index === 0 || index === chartPoints.length - 1 ? formatShortDate(point.loggedAt) : '·'}</AppText>
                </View>
              );
            })}
          </View>
        </Card>
      ) : <StatePanel title="No body measurements yet" body="Add a weight entry to start a trend. Averages appear after enough measurements are available." />}

      {history.length ? (
        <>
          <SectionHeading title="Recent entries" />
          <Card>
            {history.slice(0, 12).map((measurement) => (
              <View key={measurement.id} style={[styles.historyRow, { borderBottomColor: colors.border }]}>
                <View style={styles.flex}><AppText style={styles.historyWeight}>{measurement.bodyWeightKg.toFixed(1)} kg</AppText><AppText style={{ color: colors.textMuted }}>{formatShortDate(measurement.loggedAt)}</AppText></View>
                {measurement.bodyFatPercent != null ? <AppText style={{ color: colors.textMuted }}>{measurement.bodyFatPercent}% {measurement.bodyFatIsEstimated ? 'estimated' : 'measured'}</AppText> : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Button label="Back to wellness" onPress={() => router.back()} variant="quiet" />
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { colors } = useJienTheme();
  return <View style={styles.metric}><AppText style={styles.metricValue}>{value}</AppText><AppText style={{ color: colors.textMuted }}>{label}</AppText></View>;
}

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeDate(value: string | null): string {
  const today = toLocalDateKey();
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return today;
  try {
    localTimestampForDate(value);
    return value;
  } catch {
    return today;
  }
}

function formatSelectedDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function formatKg(value: number | null): string {
  return value == null ? '—' : value.toFixed(1);
}

function formatChange(value: number | null): string {
  if (value == null) return 'Baseline';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} kg`;
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 900, alignSelf: 'center' },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  flexField: { flex: 1, minWidth: 180 },
  flex: { flex: 1 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metric: { flex: 1, minWidth: 130 },
  metricValue: { ...typography.section, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chart: { height: 180, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xxs, paddingTop: spacing.sm },
  chartColumn: { flex: 1, height: '100%', minWidth: 18, alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  chartValue: { ...typography.caption, fontVariant: ['tabular-nums'] },
  chartTrack: { width: '72%', flex: 1, borderRadius: radii.compact, justifyContent: 'flex-end', overflow: 'hidden' },
  chartBar: { width: '100%', minHeight: 8, borderRadius: radii.compact },
  chartDate: { ...typography.caption, minHeight: 16 },
  historyRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  historyWeight: { ...typography.bodyLarge, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
