import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, Switch, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import {
  describeAiConnectionIssue,
  getAiConnectionStatus,
  removePersonalGeminiKey,
  savePersonalGeminiKey,
  type AiConnectionIssue,
  type AiConnectionStatus,
} from '@/lib/db';
import { radii, spacing, typography, useJienTheme } from '@/theme';

const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';
const GEMINI_SPEND_URL = 'https://aistudio.google.com/app/billing/spend';

export default function AiSettingsScreen() {
  const { colors } = useJienTheme();
  const router = useRouter();
  const [status, setStatus] = useState<AiConnectionStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [acknowledgesFreeTierDataUse, setAcknowledgesFreeTierDataUse] = useState(false);
  const [acknowledgesBillingControl, setAcknowledgesBillingControl] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [loadIssue, setLoadIssue] = useState<AiConnectionIssue | null>(null);
  const [actionIssue, setActionIssue] = useState<AiConnectionIssue | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadIssue(null);
    try {
      setStatus(await getAiConnectionStatus());
    } catch (cause) {
      setLoadIssue(describeAiConnectionIssue(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setActionIssue(null);
    setActionMessage(null);
    if (!apiKey.trim()) {
      setActionIssue({
        code: 'AI_KEY_REQUIRED',
        title: 'Paste your Gemini key first',
        message: 'Create or copy the key in Google AI Studio, then paste the full key above.',
        requestId: null,
        retryable: false,
      });
      return;
    }
    if (!acknowledgesBillingControl || !acknowledgesFreeTierDataUse) {
      setActionIssue({
        code: 'ACKNOWLEDGEMENT_REQUIRED',
        title: 'Confirm both notes first',
        message: 'Turn on both switches above so JIEN can verify and store the key.',
        requestId: null,
        retryable: false,
      });
      return;
    }
    setBusy(true);
    try {
      const next = await savePersonalGeminiKey(apiKey);
      setStatus(next);
      setApiKey('');
      setAcknowledgesBillingControl(false);
      setAcknowledgesFreeTierDataUse(false);
      setLoadIssue(null);
      setActionMessage('Connected. Gemini now powers meal-photo estimates and contextual wellness guidance.');
    } catch (cause) {
      setActionIssue(describeAiConnectionIssue(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setActionIssue(null);
    setActionMessage(null);
    try {
      setStatus(await removePersonalGeminiKey());
      setConfirmRemove(false);
      setActionMessage('Your personal Gemini key was removed from JIEN. Revoke it in Google AI Studio too if you no longer need it.');
    } catch (cause) {
      setActionIssue(describeAiConnectionIssue(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHeading eyebrow="Private AI setup" title="Connect Gemini" />
      <Card style={{ backgroundColor: colors.accentSoft }}>
        <AppText style={styles.cardTitle}>One connection, both AI features</AppText>
        <AppText style={{ color: colors.textMuted }}>Your Gemini key powers meal-photo estimates and JIEN’s contextual wellness explanations. Training progression remains deterministic and works without AI.</AppText>
      </Card>

      {loading ? <StatePanel title="Checking AI connection" body="Reading only your secure connection status—not the key itself." loading /> : null}
      {loadIssue ? (
        <StatePanel
          title={loadIssue.title}
          body={issueBody(loadIssue)}
          actionLabel="Check again"
          onAction={() => void load()}
        />
      ) : null}

      {status ? (
        <Card>
          <View style={styles.statusRow}>
            <View style={styles.flex}>
              <AppText style={styles.cardTitle}>{status.configured ? 'Gemini ready' : 'No AI key connected'}</AppText>
              <AppText style={{ color: colors.textMuted }}>
                {status.credentialSource === 'personal'
                  ? 'Your personal key is encrypted in Supabase Vault.'
                  : status.credentialSource === 'app'
                    ? 'This test deployment currently supplies Gemini for you.'
                    : 'Connect a personal free-tier key to enable AI features.'}
              </AppText>
            </View>
            <Pill label={status.configured ? 'Connected' : 'Off'} active={status.configured} />
          </View>
          <AppText style={{ color: colors.textMuted }}>{status.usagePolicy === 'provider_managed'
            ? 'No JIEN daily request cap. Gemini’s project quota, rate limits, and billing settings apply.'
            : `This deployment still limits JIEN to ${status.limits?.photoPerUtcDay ?? 5} photos and ${status.limits?.contextPerUtcDay ?? 10} contextual replies per UTC day.`}</AppText>
          {status.configured ? (
            <Button label="Test with a meal photo" onPress={() => router.push('/meals/new')} variant="secondary" />
          ) : null}
        </Card>
      ) : null}

      <SectionHeading title="1. Create a free-tier key" detail="Usually under a minute" />
      <Card>
        <AppText>Open Google AI Studio, sign in, choose or create a project marked <AppText style={styles.strong}>Free</AppText>, then choose <AppText style={styles.strong}>Create API key</AppText> and copy it.</AppText>
        <Button label="Open Google AI Studio" onPress={() => void Linking.openURL(GEMINI_KEY_URL)} />
        <AppText style={[styles.small, { color: colors.textMuted }]}>For $0 usage, keep the project on Gemini’s Free tier and do not attach paid billing. If you use a paid project, review its spend settings before connecting the key.</AppText>
      </Card>

      <SectionHeading title="2. Connect it securely" detail="The key is verified before storage" />
      <Card>
        <Field
          label="Gemini API key"
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="Paste your key"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          textContentType="password"
          editable={!busy}
          hint="Sent once over HTTPS to JIEN’s Edge Function, then encrypted in Supabase Vault. It is never saved in this browser or returned to the app."
        />
        <Acknowledgement
          label="I understand JIEN does not cap requests; Google controls this project’s quota and billing. I will keep it Free or set the lowest available project spend cap before use."
          value={acknowledgesBillingControl}
          onValueChange={setAcknowledgesBillingControl}
        />
        <Acknowledgement
          label="I understand Google says free-tier prompts and images may be used to improve its products; paid-tier content is treated differently."
          value={acknowledgesFreeTierDataUse}
          onValueChange={setAcknowledgesFreeTierDataUse}
        />
        <Button
          label={status?.credentialSource === 'personal' ? 'Verify and replace key' : 'Verify and connect key'}
          onPress={() => void save()}
          busy={busy}
        />
        <View accessibilityLiveRegion="polite">
          {busy ? <AppText style={{ color: colors.textMuted }}>Checking the key with Gemini and securing it to your JIEN account…</AppText> : null}
          {actionIssue ? (
            <View style={[styles.inlineResult, { backgroundColor: colors.dangerSoft }]}>
              <AppText style={styles.cardTitle}>{actionIssue.title}</AppText>
              <AppText>{issueBody(actionIssue)}</AppText>
            </View>
          ) : null}
          {actionMessage ? (
            <View style={[styles.inlineResult, { backgroundColor: colors.successSoft }]}>
              <AppText style={styles.cardTitle}>Gemini is ready</AppText>
              <AppText>{actionMessage}</AppText>
            </View>
          ) : null}
        </View>
      </Card>

      <SectionHeading title="3. Control Gemini spend" detail="Google owns the usage boundary" />
      <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
        <AppText style={styles.cardTitle}>No JIEN daily cap</AppText>
        <AppText style={{ color: colors.textMuted }}>Meal-photo analyses and contextual replies continue until Gemini applies the project’s own quota, rate limit, or billing boundary. JIEN still uses finite timeouts and bounded retries.</AppText>
        <AppText style={styles.cardTitle}>Recommended: keep the effective limit at $0</AppText>
        <AppText style={{ color: colors.textMuted }}>The safest option is a Free project with no paid billing attached. If AI Studio offers a project spend cap for your paid project, set it to $0 or the lowest value Google accepts. Google describes spend caps as experimental and says billing can lag by about ten minutes, so a cap is not a strict zero-overage guarantee.</AppText>
        <Button label="Open Gemini spend settings" onPress={() => void Linking.openURL(GEMINI_SPEND_URL)} variant="secondary" />
      </Card>

      {status?.credentialSource === 'personal' ? (
        <Card>
          <AppText style={styles.cardTitle}>Disconnect personal key</AppText>
          <AppText style={{ color: colors.textMuted }}>Removing it disables your personal connection in JIEN. It does not revoke the key in Google AI Studio.</AppText>
          {confirmRemove ? (
            <View style={styles.actions}>
              <Button label="Remove from JIEN" onPress={() => void remove()} busy={busy} variant="danger" />
              <Button label="Keep connected" onPress={() => setConfirmRemove(false)} disabled={busy} variant="quiet" />
            </View>
          ) : <Button label="Disconnect personal key" onPress={() => setConfirmRemove(true)} variant="quiet" />}
        </Card>
      ) : null}
    </Screen>
  );
}

function issueBody(issue: AiConnectionIssue) {
  return issue.requestId
    ? `${issue.message} Reference: ${issue.requestId}`
    : issue.message;
}

function Acknowledgement({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  const { colors } = useJienTheme();
  return (
    <View style={styles.ackRow}>
      <AppText style={styles.flex}>{label}</AppText>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceMuted, true: colors.wood }}
        thumbColor={colors.surfaceRaised}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cardTitle: { ...typography.bodyLarge, fontWeight: '700' },
  strong: { fontWeight: '800' },
  small: { ...typography.caption },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 },
  actions: { gap: spacing.sm },
  inlineResult: { borderRadius: radii.control, padding: spacing.md, gap: spacing.xs },
  flex: { flex: 1 },
});
