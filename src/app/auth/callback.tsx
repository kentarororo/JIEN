import { useLocalSearchParams } from 'expo-router';

import { OAuthCallbackCompletion } from '@/components/oauth-callback-completion';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();
  return <OAuthCallbackCompletion request={{
    code: params.code ?? null,
    errorCode: params.error ?? null,
    errorDescription: params.error_description ?? null,
  }} />;
}
