import { Platform } from 'react-native';

export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

type TokenResponse = {
  access_token?: string;
  error?: string;
};

type TokenClient = {
  requestAccessToken(options?: { prompt?: string }): void;
};

type GoogleIdentityServices = {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback(response: TokenResponse): void;
        error_callback?(error: { type?: string }): void;
      }): TokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

let scriptPromise: Promise<void> | null = null;
let consentRequested = false;

export class GoogleDriveAuthorizationError extends Error {
  readonly code: 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'CANCELLED' | 'FAILED';

  constructor(code: 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'CANCELLED' | 'FAILED', message: string) {
    super(message);
    this.name = 'GoogleDriveAuthorizationError';
    this.code = code;
  }
}

export function prepareGoogleDriveAuthorization(): Promise<void> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new GoogleDriveAuthorizationError('UNAVAILABLE', 'Google Sheets export is available in the web app.'));
  }
  if (window.google?.accounts.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-jien-google-identity]');
    const script = existing ?? document.createElement('script');
    const finish = () => window.google?.accounts.oauth2
      ? resolve()
      : reject(new GoogleDriveAuthorizationError('UNAVAILABLE', 'Google consent could not load. Check the connection and try again.'));
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new GoogleDriveAuthorizationError('UNAVAILABLE', 'Google consent could not load. Check the connection and try again.')), { once: true });
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.jienGoogleIdentity = 'true';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

export async function requestGoogleDriveAccessToken(): Promise<string> {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new GoogleDriveAuthorizationError('NOT_CONFIGURED', 'Google Sheets export is not configured for this app yet.');
  }
  await prepareGoogleDriveAuthorization();
  const oauth = window.google?.accounts.oauth2;
  if (!oauth) throw new GoogleDriveAuthorizationError('UNAVAILABLE', 'Google consent could not load. Check the connection and try again.');

  return new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new GoogleDriveAuthorizationError(
            response.error === 'access_denied' ? 'CANCELLED' : 'FAILED',
            response.error === 'access_denied'
              ? 'Google Drive access was cancelled. No spreadsheet was changed.'
              : 'Google did not grant Drive access. Try the export again.',
          ));
          return;
        }
        consentRequested = true;
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new GoogleDriveAuthorizationError(
        error.type === 'popup_closed' ? 'CANCELLED' : 'FAILED',
        error.type === 'popup_closed'
          ? 'Google Drive access was cancelled. No spreadsheet was changed.'
          : 'Google consent could not finish. Try the export again.',
      )),
    });
    client.requestAccessToken({ prompt: consentRequested ? '' : 'consent' });
  });
}
