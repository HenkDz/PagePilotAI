import { logger } from '../core/logger';

export type StoreName = 'tempScripts' | 'settings';

const DB_NAME = 'pagepilot-ai';
const DB_VERSION = 1;

const stores: Record<StoreName, IDBObjectStoreParameters> = {
  tempScripts: { keyPath: 'id' },
  settings: { keyPath: 'key' },
};

let dbPromise: Promise<IDBDatabase> | null = null;

const log = logger.child('indexed-db');

const openDatabase = async (): Promise<IDBDatabase> => {
  if (!('indexedDB' in globalThis)) {
    throw new Error('IndexedDB is not available in this environment.');
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      Object.entries(stores).forEach(([storeName, options]) => {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, options);
        }
      });
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
      };
      resolve(database);
    };

    request.onerror = () => {
      const error = request.error ?? new Error('Failed to open IndexedDB.');
      reject(error);
    };

    request.onblocked = () => {
      log.warn('IndexedDB upgrade blocked by another open tab.');
    };
  });
};

export const getDatabase = (): Promise<IDBDatabase> => {
  if (!dbPromise) {
    dbPromise = openDatabase().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
};

export const withStore = async <TReturn>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<TReturn> | TReturn,
): Promise<TReturn> => {
  const database = await getDatabase();

  const transaction = database.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);

  let handlerResult: Promise<TReturn>;

  try {
    handlerResult = Promise.resolve(handler(store));
  } catch (error) {
    transaction.abort();
    throw error;
  }

  return new Promise<TReturn>((resolve, reject) => {
    transaction.onabort = () => {
      const error = transaction.error ?? new Error('IndexedDB transaction aborted.');
      reject(error);
    };

    transaction.onerror = () => {
      const error = transaction.error ?? new Error('IndexedDB transaction error.');
      reject(error);
    };

    transaction.oncomplete = () => {
      handlerResult.then(resolve).catch(reject);
    };

    handlerResult.catch((error) => {
      try {
        transaction.abort();
      } catch (abortError) {
        log.warn('Failed to abort IndexedDB transaction after handler error.', {
          abortError,
        });
      }
      reject(error);
    });
  });
};

export const clearDatabase = async () => {
  if (!('indexedDB' in globalThis)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
    deleteRequest.onsuccess = () => resolve();
    deleteRequest.onerror = () => reject(deleteRequest.error);
    deleteRequest.onblocked = () => {
      log.warn('Unable to delete IndexedDB because another tab is still open.');
    };
  });

  dbPromise = null;
};
