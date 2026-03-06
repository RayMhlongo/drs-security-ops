import { useEffect } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { deleteQueuedAction, getQueuedActions } from '../lib/offlineQueue';
import { useOnlineStatus } from './useOnlineStatus';

export function useSyncEngine() {
  const online = useOnlineStatus();

  useEffect(() => {
    if (!online) return;

    const flush = async () => {
      const items = await getQueuedActions();
      for (const item of items) {
        try {
          await addDoc(collection(db, `${String(item.payload.companyCode || 'DRS')}_${item.type}`), item.payload);
          if (item.id) {
            await deleteQueuedAction(item.id);
          }
        } catch {
          break;
        }
      }
    };

    flush();
    const timer = setInterval(flush, 15000);
    return () => clearInterval(timer);
  }, [online]);

  return online;
}
