let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerOfflineAppShell(): Promise<ServiceWorkerRegistration | null> {
  if (process.env.NODE_ENV !== 'production'
    || typeof navigator === 'undefined'
    || !('serviceWorker' in navigator)) return Promise.resolve(null);
  registrationPromise ??= navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .catch((error) => {
      registrationPromise = null;
      console.warn('Offline app shell is unavailable', error);
      return null;
    });
  return registrationPromise;
}
