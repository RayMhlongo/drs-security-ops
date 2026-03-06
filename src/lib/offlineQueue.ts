import { openDB } from 'idb';
import type { QueueAction } from '../types/models';

const DB_NAME = 'security_ops';
const STORE = 'queue';

export const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    }
  }
});

export async function enqueue(action: QueueAction) {
  const db = await dbPromise;
  return db.add(STORE, action);
}

export async function getQueuedActions(): Promise<QueueAction[]> {
  const db = await dbPromise;
  return db.getAll(STORE);
}

export async function deleteQueuedAction(id: number) {
  const db = await dbPromise;
  await db.delete(STORE, id);
}
