export type RecoverableDatabaseEngine<T> = {
  value: T;
  dispose: () => Promise<void>;
};

export class WebDatabaseReloadRequiredError extends Error {
  readonly code = 'WEB_DATABASE_RELOAD_REQUIRED';

  constructor() {
    super('The unsafe local database image was isolated. Reload the page to rebuild it in a clean engine.');
    this.name = 'WebDatabaseReloadRequiredError';
  }
}

export async function restoreOrCreateDatabaseEngine<T>({
  savedImage,
  createEngine,
  validate,
  quarantine,
}: {
  savedImage: Uint8Array | null;
  createEngine: (savedImage: Uint8Array | null) => Promise<RecoverableDatabaseEngine<T>>;
  validate: (engine: T) => Promise<boolean>;
  quarantine: () => Promise<void>;
}): Promise<RecoverableDatabaseEngine<T>> {
  if (!savedImage) return createEngine(null);

  let candidate: RecoverableDatabaseEngine<T> | null = null;
  let restoredSafely = false;
  try {
    candidate = await createEngine(savedImage);
    restoredSafely = await validate(candidate.value);
  } catch {
    restoredSafely = false;
  }
  if (restoredSafely && candidate) return candidate;

  // A WebAssembly memory trap can leave the complete SQLite module unusable, not
  // just this connection. Mobile Safari may also retain its memory until the page
  // exits, so never allocate a second module inside this page lifecycle.
  await candidate?.dispose().catch(() => undefined);
  await quarantine();
  throw new WebDatabaseReloadRequiredError();
}
