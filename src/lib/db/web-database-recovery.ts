export type RecoverableDatabaseEngine<T> = {
  value: T;
  dispose: () => Promise<void>;
};

export async function restoreOrCreateDatabaseEngine<T>({
  savedImage,
  createEngine,
  restore,
  validate,
  quarantine,
}: {
  savedImage: Uint8Array | null;
  createEngine: () => Promise<RecoverableDatabaseEngine<T>>;
  restore: (engine: T, image: Uint8Array) => Promise<boolean> | boolean;
  validate: (engine: T) => Promise<boolean>;
  quarantine: () => Promise<void>;
}): Promise<RecoverableDatabaseEngine<T>> {
  const candidate = await createEngine();
  if (!savedImage) return candidate;

  let restoredSafely = false;
  try {
    restoredSafely = await restore(candidate.value, savedImage)
      && await validate(candidate.value);
  } catch {
    restoredSafely = false;
  }
  if (restoredSafely) return candidate;

  // A WebAssembly memory trap can leave the complete SQLite module unusable, not
  // just this connection. Never reopen a database in the failed module.
  await candidate.dispose().catch(() => undefined);
  await quarantine();
  return createEngine();
}
