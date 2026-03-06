import { useEffect } from 'react';
import { addDoc, collection, doc, setDoc } from 'firebase/firestore';
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
          const companyCode = String(item.payload.companyCode || 'DRS');
          if (item.type === 'profile') {
            const uid = String(item.payload.uid || '');
            if (!uid) continue;
            await setDoc(doc(db, 'users', uid), item.payload, { merge: true });
          } else if (item.type === 'branch') {
            await addDoc(collection(db, `${companyCode}_branches`), item.payload);
          } else {
            await addDoc(collection(db, `${companyCode}_${item.type}`), item.payload);
          }
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
