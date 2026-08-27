import { getAccountState } from '@/lib/auth';

const STORE_NAME = 'payloads';
const REFERENCE_PREFIX = 'idb:';

type PayloadRecord = {
  id: string;
  ownerUserId: string;
  base64: string;
  createdAt: string;
};

export async function storeMealPhotoPayload(jobId: string, base64: string): Promise<string> {
  const ownerUserId = await requireOwnerUserId();
  const database = await openPayloadDatabase(ownerUserId);
  try {
    await runRequest(database, 'readwrite', (store) => store.put({
      id: jobId,
      ownerUserId,
      base64,
      createdAt: new Date().toISOString(),
    } satisfies PayloadRecord));
    return `${REFERENCE_PREFIX}${jobId}`;
  } finally {
    database.close();
  }
}

export async function resolveMealPhotoPayload(reference: string): Promise<string | null> {
  if (!reference.startsWith(REFERENCE_PREFIX)) return reference.trim() || null;
  const ownerUserId = await requireOwnerUserId();
  const id = reference.slice(REFERENCE_PREFIX.length);
  const database = await openPayloadDatabase(ownerUserId);
  try {
    const record = await runRequest<PayloadRecord | undefined>(database, 'readonly', (store) => store.get(id));
    return record?.ownerUserId === ownerUserId && typeof record.base64 === 'string'
      ? record.base64
      : null;
  } finally {
    database.close();
  }
}

export async function removeMealPhotoPayload(reference: string): Promise<void> {
  if (!reference.startsWith(REFERENCE_PREFIX)) return;
  const ownerUserId = await requireOwnerUserId();
  const database = await openPayloadDatabase(ownerUserId);
  try {
    await runRequest(database, 'readwrite', (store) => store.delete(reference.slice(REFERENCE_PREFIX.length)));
  } finally {
    database.close();
  }
}

async function requireOwnerUserId(): Promise<string> {
  const account = await getAccountState();
  if (!account.configured || !account.user?.id) throw new Error('Sign in before storing a meal photo.');
  return account.user.id;
}

function openPayloadDatabase(ownerUserId: string): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser cannot retain a meal photo for retry.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`jien-web-photo-payload-v1:${ownerUserId.toLowerCase()}`, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Meal photo storage could not be opened.'));
    request.onblocked = () => reject(new Error('Another tab is updating meal-photo storage. Close it and retry.'));
  });
}

function runRequest<T = IDBValidKey>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve(result!);
    transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Meal photo storage was interrupted.'));
  });
}
