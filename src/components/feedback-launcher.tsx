import Constants from 'expo-constants';
import * as Network from 'expo-network';
import type { RefObject } from 'react';
import { useState } from 'react';
import { Image, Modal, Platform, ScrollView, StyleSheet, Switch, useWindowDimensions, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { feedbackContextLines, MAX_FEEDBACK_MESSAGE_LENGTH, type FeedbackContext, type FeedbackType } from '@/lib/feedback-context';
import { queueFeedback, syncPendingChanges } from '@/lib/db';
import { useSQLiteContext } from '@/lib/db/database-context';
import { radii, spacing, useJienTheme } from '@/theme';

import { AppText, Button, Card, Field, Pill, SectionHeading } from './ui';

export function FeedbackLauncher({
  screenName,
  captureTarget,
  direct = false,
}: {
  screenName: string;
  captureTarget: RefObject<View | null>;
  direct?: boolean;
}) {
  const db = useSQLiteContext();
  const { colors } = useJienTheme();
  const viewport = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(false);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [context, setContext] = useState<FeedbackContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const openFeedback = async () => {
    setMenuOpen(false);
    setError(null);
    setResult(null);
    const network = await Network.getNetworkStateAsync().catch(() => null);
    setContext({
      screen: screenName,
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      build: String(Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? 'development'),
      platform: `${Platform.OS} ${String(Platform.Version)}`,
      viewport: `${Math.round(viewport.width)}×${Math.round(viewport.height)}`,
      connection: network?.isConnected && network.isInternetReachable !== false ? 'online' : 'offline',
    });
    setFeedbackOpen(true);
  };

  const close = () => {
    if (busy) return;
    setFeedbackOpen(false);
    setResult(null);
  };

  const toggleScreenshot = async (enabled: boolean) => {
    setIncludeScreenshot(enabled);
    setScreenshotBase64(null);
    setError(null);
    if (!enabled) return;
    if (!captureTarget.current) {
      setIncludeScreenshot(false);
      setError('The current screen could not be captured.');
      return;
    }
    setCapturing(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const captured = await captureRef(captureTarget, { format: 'jpg', quality: 0.45, result: 'base64' });
      setScreenshotBase64(captured.replace(/^data:image\/[^;]+;base64,/, ''));
    } catch {
      setIncludeScreenshot(false);
      setError('The current screen could not be captured.');
    } finally {
      setCapturing(false);
    }
  };

  const submit = async () => {
    if (!context) return;
    setBusy(true);
    setError(null);
    try {
      await queueFeedback(db, { type, message, context, screenshotBase64 });
      const sync = await syncPendingChanges(db, { trigger: 'manual' });
      setResult(sync.state === 'synced'
        ? 'Feedback sent. The report contains only your message, the details shown above, and the optional screenshot.'
        : 'Feedback saved on this device. It will send after you are online and signed in.');
      setMessage('');
      setIncludeScreenshot(false);
      setScreenshotBase64(null);
    } catch (cause) {
      setCapturing(false);
      setError(cause instanceof Error ? cause.message : 'Feedback could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        label={direct ? 'Send feedback' : 'More'}
        accessibilityLabel={direct ? 'Send feedback' : `${screenName} menu`}
        icon={direct ? 'chatbox-ellipses-outline' : 'ellipsis-horizontal'}
        onPress={() => direct ? void openFeedback() : setMenuOpen(true)}
        variant="quiet"
      />

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <Card style={styles.menuCard} accessibilityRole="menu">
            <Button label="Send feedback" accessibilityLabel="Send feedback" icon="chatbox-ellipses-outline" onPress={() => void openFeedback()} variant="secondary" />
            <Button label="Close" onPress={() => setMenuOpen(false)} variant="quiet" />
          </Card>
        </View>
      </Modal>

      <Modal visible={feedbackOpen && !capturing} transparent animationType="fade" onRequestClose={close}>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <Card style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <View style={styles.headingRow}>
                <SectionHeading title="Send feedback" detail="Report a bug, idea, or confusing part" />
                <Button label="Close" onPress={close} disabled={busy} variant="quiet" />
              </View>
              {result ? (
                <>
                  <AppText accessibilityLiveRegion="polite">{result}</AppText>
                  <Button label="Done" onPress={close} />
                </>
              ) : (
                <>
                  <View accessibilityRole="radiogroup" style={styles.types}>
                    {(['bug', 'idea', 'confusing'] as const).map((option) => (
                      <Pill key={option} label={option[0]!.toUpperCase() + option.slice(1)} active={type === option} accessibilityRole="radio" onPress={() => setType(option)} />
                    ))}
                  </View>
                  <Field
                    label="What happened or what would help?"
                    value={message}
                    onChangeText={setMessage}
                    multiline
                    maxLength={MAX_FEEDBACK_MESSAGE_LENGTH}
                    placeholder="Include the steps you took and what you expected."
                  />
                  <View style={styles.screenshotRow}>
                    <View style={styles.copy}>
                      <AppText style={styles.label}>Include a screenshot</AppText>
                      <AppText style={{ color: colors.textMuted }}>Off by default. The screenshot may contain information visible on this screen.</AppText>
                    </View>
                    <Switch
                      accessibilityLabel="Include a screenshot"
                      value={includeScreenshot}
                      onValueChange={(value) => void toggleScreenshot(value)}
                      disabled={busy || capturing}
                      trackColor={{ false: colors.surfaceMuted, true: colors.wood }}
                      thumbColor={colors.surfaceRaised}
                    />
                  </View>
                  {includeScreenshot && screenshotBase64 ? <Image accessibilityLabel="Screenshot attached to feedback" source={{ uri: `data:image/jpeg;base64,${screenshotBase64}` }} resizeMode="contain" style={[styles.screenshot, { backgroundColor: colors.surfaceMuted }]} /> : null}
                  <Card style={{ backgroundColor: colors.surfaceMuted }}>
                    <AppText style={styles.label}>Attached device details</AppText>
                    {context ? feedbackContextLines(context).map((line) => <AppText key={line} style={{ color: colors.textMuted }}>{line}</AppText>) : <AppText style={{ color: colors.textMuted }}>Reading device details…</AppText>}
                    <AppText style={{ color: colors.textMuted }}>No food logs, weights, names, or email addresses are attached automatically.</AppText>
                  </Card>
                  <AppText>Your message and the device details shown are sent to the JIEN team.</AppText>
                  {error ? <AppText accessibilityRole="alert" style={{ color: colors.danger }}>{error}</AppText> : null}
                  <Button label="Send feedback" onPress={() => void submit()} busy={busy} disabled={!context || !message.trim()} />
                </>
              )}
            </ScrollView>
          </Card>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, padding: spacing.md, alignItems: 'center', justifyContent: 'center' },
  menuCard: { width: '100%', maxWidth: 360 },
  sheet: { width: '100%', maxWidth: 640, maxHeight: '94%', borderRadius: radii.sheet, padding: 0, overflow: 'hidden' },
  sheetContent: { padding: spacing.md, gap: spacing.md },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  screenshotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  screenshot: { width: '100%', height: 180, borderRadius: radii.control },
  copy: { flex: 1, gap: spacing.xxs },
  label: { fontWeight: '700' },
});
