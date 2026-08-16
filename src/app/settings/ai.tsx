import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, View } from 'react-native';

import { AppText, Button, Card, Field, Pill, Screen, ScreenHeading, SectionHeading, StatePanel } from '@/components/ui';
import {
  getAiConnectionStatus,
  removePersonalGeminiKey,
  savePersonalGeminiKey,
  type AiConnectionStatus,
} from '@/lib/db';
import { spacing, typography, useJienTheme } from '@/theme';

const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';
const GEMINI_SPEND_URL = 'https://aistudio.google.com/app/billing/spend';

export default function AiSettingsScreen() {
  const { colors } = useJienTheme();
  const [status, setStatus] = useState<AiConnectionStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [acknowledgesFreeTierDataUse, setAcknowledgesFreeTierDataUse] = useState(false);
  const [acknowledgesBillingControl, setAcknowledgesBillingControl] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getAiConnectionStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI connection status is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await savePersonalGeminiKey(apiKey);
      setStatus(next);
      setApiKey('');
      setAcknowledgesBillingControl(false);
      setAcknowledgesFreeTierDataUse(false);
      setMessage('Gemini is connected. The same secured connection now powers meal-photo estimates and contextual wellness guidance.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Gemini key could not be connected.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setStatus(await removePersonalGeminiKey());
      setConfirmRemove(false);
      setMessage('Your personal Gemini key was removed from JIEN. Revoke it in Google AI Studio too if you no longer need it.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Gemini connection could not be removed.');
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
      {error ? <StatePanel title="AI connection needs attention" body={error} actionLabel="Check again" onAction={() => void load()} /> : null}
      {message ? <Card style={{ backgroundColor: colors.successSoft }}><AppText>{message}</AppText></Card> : null}

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
          <AppText style={{ color: colors.textMuted }}>JIEN allowance: {status.limits.photoPerUtcDay} photo analyses and {status.limits.contextPerUtcDay} contextual replies per account per UTC day.</AppText>
        </Card>
      ) : null}

      <SectionHeading title="1. Create a free-tier key" detail="Usually under a minute" />
      <Card>
        <AppText>Open Google AI Studio, sign in, choose or create a project marked <AppText style={styles.strong}>Free</AppText>, then choose <AppText style={styles.strong}>Create API key</AppText> and copy it.</AppText>
        <Button label="Open Google AI Studio" onPress={() => void Linking.openURL(GEMINI_KEY_URL)} />
        <AppText style={[styles.small, { color: colors.textMuted }]}>If you want zero Gemini charges, do not upgrade that project or attach paid billing. A paid project can still charge you under Google’s terms.</AppText>
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
          label="I understand Google controls whether this project is Free or Paid, and JIEN cannot change Google billing settings."
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
          disabled={!apiKey.trim() || !acknowledgesBillingControl || !acknowledgesFreeTierDataUse}
        />
      </Card>

      <SectionHeading title="3. Keep costs bounded" detail="Two independent safeguards" />
      <Card>
        <AppText style={styles.cardTitle}>JIEN request allowance</AppText>
        <AppText style={{ color: colors.textMuted }}>JIEN stops at {status?.limits.photoPerUtcDay ?? 5} photos and {status?.limits.contextPerUtcDay ?? 10} contextual replies per UTC day. This limits JIEN traffic but cannot cap use of the same key outside JIEN.</AppText>
        <AppText style={styles.cardTitle}>Google project spend cap</AppText>
        <AppText style={{ color: colors.textMuted }}>If you ever enable billing, set a project cap in AI Studio too. Google labels project caps experimental and warns billing signals may lag by about ten minutes, so they are not a zero-overage guarantee.</AppText>
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
  flex: { flex: 1 },
});
