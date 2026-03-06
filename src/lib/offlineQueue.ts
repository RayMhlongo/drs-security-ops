import { openDB } from 'idb';
import type { Branch, QueueAction, UserProfile } from '../types/models';

const DB_NAME = 'security_ops';
const STORE = 'queue';
const PROFILE_STORE = 'profile';
const BRANCH_STORE = 'branches';

export const dbPromise = openDB(DB_NAME, 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    }
    if (!db.objectStoreNames.contains(PROFILE_STORE)) {
      db.createObjectStore(PROFILE_STORE);
    }
    if (!db.objectStoreNames.contains(BRANCH_STORE)) {
      db.createObjectStore(BRANCH_STORE);
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

export async function cacheProfile(profile: UserProfile) {
  const db = await dbPromise;
  await db.put(PROFILE_STORE, profile, profile.uid);
}

export async function getCachedProfile(uid: string): Promise<UserProfile | null> {
  const db = await dbPromise;
  return (await db.get(PROFILE_STORE, uid)) ?? null;
}

export async function clearCachedProfile(uid: string) {
  const db = await dbPromise;
  await db.delete(PROFILE_STORE, uid);
}

export async function cacheBranches(branches: Branch[]) {
  const db = await dbPromise;
  await db.put(BRANCH_STORE, branches, 'list');
}

export async function getCachedBranches(): Promise<Branch[]> {
  const db = await dbPromise;
  return (await db.get(BRANCH_STORE, 'list')) ?? [];
}
