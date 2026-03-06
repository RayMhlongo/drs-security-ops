import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  limit
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import QRCode from 'qrcode';
import toast, { Toaster } from 'react-hot-toast';
import { format } from 'date-fns';
import { auth, db, storage } from './lib/firebase';
import { enqueue } from './lib/offlineQueue';
import { useSyncEngine } from './hooks/useSyncEngine';
import type { Role, UserProfile } from './types/models';

const companyCode = (import.meta.env.VITE_COMPANY_CODE || 'DRS') as 'DRS' | 'BIG5';

const branding = {
  DRS: { name: 'DRS Data Response Security', primary: '#EB623D', accent: 'bg-[#EB623D]' },
  BIG5: { name: 'Big 5 Security', primary: '#1d4ed8', accent: 'bg-blue-700' }
}[companyCode];

type Checkpoint = { id: string; name: string; lat: number; lng: number };

type Activity = { id: string; type: string; createdAt: string; summary: string };

function App() {
  const online = useSyncEngine();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);
      if (!authUser) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const profileRef = doc(db, 'users', authUser.uid);
      const profileSnap = await getDoc(profileRef);
      if (profileSnap.exists()) {
        setProfile(profileSnap.data() as UserProfile);
      }
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-white">Loading...</div>;
  }

  if (!user) {
    return <LoginScreen online={online} />;
  }

  if (!profile) {
    return <RoleOnboarding user={user} onDone={setProfile} />;
  }

  return <AuthedApp profile={profile} online={online} />;
}

function LoginScreen({ online }: { online: boolean }) {
  const login = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      toast.error('Google sign-in failed.');
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen p-6 flex items-center justify-center">
      <div className="w-full max-w-md bg-black/60 border border-white/10 rounded-2xl p-6 space-y-6">
        <h1 className="text-2xl font-bold">{branding.name}</h1>
        <p className="text-sm text-white/80">Security Operations App</p>
        <div className="text-sm">Network: {online ? 'Online' : 'Offline'}</div>
        <button
          onClick={login}
          className="w-full py-4 rounded-xl text-black font-semibold"
          style={{ backgroundColor: branding.primary }}
        >
          Sign in with Google
        </button>
      </div>
      <Toaster position="top-right" />
    </div>
  );
}

function RoleOnboarding({ user, onDone }: { user: User; onDone: (profile: UserProfile) => void }) {
  const [role, setRole] = useState<Role>('guard');

  const save = async () => {
    const profile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || 'Unknown User',
      role,
      companyCode,
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'users', user.uid), profile, { merge: true });
    await addDoc(collection(db, 'auditLogs'), {
      action: 'ROLE_SELECTED',
      uid: user.uid,
      role,
      companyCode,
      createdAt: new Date().toISOString()
    });
    onDone(profile);
  };

  return (
    <div className="min-h-screen p-6 grid place-items-center">
      <div className="w-full max-w-md bg-black/60 border border-white/10 rounded-2xl p-6 space-y-4">
        <h2 className="text-xl font-semibold">Select your role</h2>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="w-full p-3 rounded-lg bg-black border border-white/20"
        >
          <option value="guard">Security Guard</option>
          <option value="admin">Admin</option>
          <option value="management">Management</option>
          <option value="owner">Owner</option>
        </select>
        <button
          onClick={save}
          className="w-full py-3 rounded-xl font-semibold text-black"
          style={{ backgroundColor: branding.primary }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function AuthedApp({ profile, online }: { profile: UserProfile; online: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);

  useEffect(() => {
    const q = query(collection(db, `${companyCode}_activity`), orderBy('createdAt', 'desc'), limit(8));
    const unsub = onSnapshot(q, (snap) => {
      setActivities(
        snap.docs.map((d) => {
          const data = d.data() as Omit<Activity, 'id'>;
          return { id: d.id, ...data };
        })
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, `${companyCode}_checkpoints`));
    const unsub = onSnapshot(q, (snap) => {
      setCheckpoints(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Checkpoint, 'id'>) })));
    });
    return () => unsub();
  }, []);

  const logOut = async () => {
    await signOut(auth);
  };

  const tabs = [
    { path: '/home', label: 'Home' },
    { path: '/patrol', label: 'Patrol' },
    { path: '/incident', label: 'Incident' },
    { path: '/attendance', label: 'Attendance' },
    { path: '/panic', label: 'Panic' },
    { path: '/tools', label: 'Tools' }
  ];

  return (
    <div className="min-h-screen pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/85 backdrop-blur px-4 py-3">
        <div className="flex justify-between items-center gap-3">
          <div>
            <p className="text-xs text-white/70">{branding.name}</p>
            <p className="font-semibold">{profile.displayName}</p>
            <p className="text-xs uppercase text-white/60">{profile.role}</p>
          </div>
          <div className="text-right text-xs">
            <p>{online ? 'Online' : 'Offline'}</p>
            <button className="text-white/80 underline" onClick={logOut}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="p-4">
        <Routes>
          <Route path="/home" element={<HomeView checkpoints={checkpoints} activities={activities} />} />
          <Route path="/patrol" element={<PatrolView profile={profile} checkpoints={checkpoints} online={online} />} />
          <Route path="/incident" element={<IncidentView profile={profile} online={online} />} />
          <Route path="/attendance" element={<AttendanceView profile={profile} online={online} />} />
          <Route path="/panic" element={<PanicView profile={profile} online={online} />} />
          <Route path="/tools" element={<ToolsView profile={profile} checkpoints={checkpoints} />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-black/95 border-t border-white/10 p-2 grid grid-cols-3 gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className={`text-sm rounded-lg px-3 py-3 ${location.pathname === tab.path ? 'text-black font-semibold' : 'bg-white/10 text-white'}`}
            style={location.pathname === tab.path ? { backgroundColor: branding.primary } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <Toaster position="top-right" />
    </div>
  );
}

function HomeView({ checkpoints, activities }: { checkpoints: Checkpoint[]; activities: Activity[] }) {
  return (
    <div className="space-y-4">
      <Card title="Active Shift">Shift Active | Route A-4 | Next check: Gate North</Card>
      <Card title="Today Patrol Route">{checkpoints.length ? checkpoints.map((c) => c.name).join(' -> ') : 'No route assigned yet.'}</Card>
      <Card title="Recent Activity">
        <ul className="space-y-2 text-sm">
          {activities.length === 0 && <li>No activity yet.</li>}
          {activities.map((a) => (
            <li key={a.id} className="border-b border-white/10 pb-2">{a.summary} - {format(new Date(a.createdAt), 'HH:mm')}</li>
          ))}
        </ul>
      </Card>
      <MapPanel checkpoints={checkpoints} />
    </div>
  );
}

function PatrolView({ profile, checkpoints, online }: { profile: UserProfile; checkpoints: Checkpoint[]; online: boolean }) {
  const [checkpointId, setCheckpointId] = useState('');
  const [notes, setNotes] = useState('');

  const submit = async () => {
    const gps = await getGps();
    const payload = {
      companyCode,
      guardUid: profile.uid,
      checkpointId,
      notes,
      gps,
      createdAt: new Date().toISOString()
    };
    await submitWithOffline('patrol', payload, online);
    toast.success('Checkpoint captured');
    setNotes('');
  };

  return (
    <div className="space-y-4">
      <Card title="Patrol Checkpoint Scan">
        <label className="text-sm">Checkpoint ID / QR value</label>
        <input
          value={checkpointId}
          onChange={(e) => setCheckpointId(e.target.value)}
          className="w-full mt-2 p-3 rounded-lg bg-black border border-white/20"
          placeholder="Scan or type checkpoint ID"
        />
        <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
          {checkpoints.map((c) => (
            <button key={c.id} className="bg-white/10 rounded p-2" onClick={() => setCheckpointId(c.id)}>{c.name}</button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full mt-3 p-3 rounded-lg bg-black border border-white/20"
          placeholder="Optional notes"
        />
        <button onClick={submit} className="w-full py-4 rounded-xl mt-3 text-black font-semibold" style={{ backgroundColor: branding.primary }}>
          Record Patrol Scan
        </button>
      </Card>
      <AIAssistant />
    </div>
  );
}

function IncidentView({ profile, online }: { profile: UserProfile; online: boolean }) {
  const [type, setType] = useState('Suspicious activity');
  const [description, setDescription] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string>('');

  const onFile = async (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    const gps = await getGps();
    let photoUrl = '';
    if (online && photoBase64) {
      const fileRef = ref(storage, `${companyCode}/incidents/${profile.uid}_${Date.now()}.jpg`);
      await uploadString(fileRef, photoBase64, 'data_url');
      photoUrl = await getDownloadURL(fileRef);
    }

    const payload = {
      companyCode,
      guardUid: profile.uid,
      type,
      description,
      gps,
      photoUrl,
      photoBase64: !online ? photoBase64 : '',
      createdAt: new Date().toISOString(),
      aiCategory: categorizeIncident(type, description)
    };

    await submitWithOffline('incident', payload, online);
    toast.success('Incident submitted');
    setDescription('');
    setPhotoBase64('');
  };

  return (
    <div className="space-y-4">
      <Card title="Incident Reporting">
        <select value={type} onChange={(e) => setType(e.target.value)} className="w-full p-3 rounded-lg bg-black border border-white/20">
          <option>Suspicious activity</option>
          <option>Break-in</option>
          <option>Fire</option>
          <option>Medical</option>
          <option>Equipment failure</option>
        </select>
        <textarea
          className="w-full mt-3 p-3 rounded-lg bg-black border border-white/20"
          rows={4}
          placeholder="Describe the incident"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input className="w-full mt-3" type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
        <button onClick={submit} className="w-full py-4 rounded-xl mt-3 text-black font-semibold" style={{ backgroundColor: branding.primary }}>
          Submit Incident
        </button>
      </Card>
      <AIAssistant />
    </div>
  );
}

function AttendanceView({ profile, online }: { profile: UserProfile; online: boolean }) {
  const punch = async (mode: 'IN' | 'OUT') => {
    const payload = {
      companyCode,
      guardUid: profile.uid,
      guardName: profile.displayName,
      mode,
      gps: await getGps(),
      createdAt: new Date().toISOString()
    };
    await submitWithOffline('attendance', payload, online);
    await postToSheet(payload);
    toast.success(`Clock-${mode === 'IN' ? 'in' : 'out'} captured`);
  };

  return (
    <div className="space-y-4">
      <Card title="Attendance">
        <div className="grid grid-cols-2 gap-3">
          <button className="py-6 rounded-xl text-lg font-bold text-black" style={{ backgroundColor: branding.primary }} onClick={() => punch('IN')}>
            Clock In
          </button>
          <button className="py-6 rounded-xl text-lg font-bold bg-white text-black" onClick={() => punch('OUT')}>
            Clock Out
          </button>
        </div>
      </Card>
    </div>
  );
}

function PanicView({ profile, online }: { profile: UserProfile; online: boolean }) {
  const trigger = async () => {
    const payload = {
      companyCode,
      guardUid: profile.uid,
      guardName: profile.displayName,
      gps: await getGps(),
      createdAt: new Date().toISOString(),
      severity: 'critical'
    };
    await submitWithOffline('panic', payload, online);
    toast.error('PANIC ALERT SENT');
  };

  return (
    <div className="space-y-4">
      <Card title="Emergency Panic Button">
        <button onClick={trigger} className="w-full py-14 rounded-2xl bg-red-600 text-2xl font-black">PANIC</button>
      </Card>
    </div>
  );
}

function ToolsView({ profile, checkpoints }: { profile: UserProfile; checkpoints: Checkpoint[] }) {
  return (
    <div className="space-y-4">
      {(profile.role === 'admin' || profile.role === 'owner') && <QrGenerator checkpoints={checkpoints} />}
      <ExportPanel />
      <AIAssistant />
    </div>
  );
}

function QrGenerator({ checkpoints }: { checkpoints: Checkpoint[] }) {
  const [value, setValue] = useState('');
  const [img, setImg] = useState('');

  const create = async (raw: string) => {
    setValue(raw);
    const generated = await QRCode.toDataURL(raw, { color: { dark: '#000', light: '#FFF' }, margin: 1, width: 420 });
    setImg(generated);
  };

  return (
    <Card title="QR Generator">
      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
        {checkpoints.map((c) => (
          <button key={c.id} className="p-2 bg-white/10 rounded" onClick={() => create(c.id)}>{c.name}</button>
        ))}
      </div>
      <input value={value} onChange={(e) => setValue(e.target.value)} className="w-full p-3 rounded bg-black border border-white/20" placeholder="Any checkpoint/employee/equipment ID" />
      <button onClick={() => create(value)} className="w-full mt-2 py-3 rounded text-black font-semibold" style={{ backgroundColor: branding.primary }}>Generate</button>
      {img && <img src={img} alt="QR code" className="mt-3 mx-auto bg-white p-3 rounded" />}
      {img && <a href={img} download={`qr_${value || 'code'}.png`} className="underline text-sm">Download Printable QR</a>}
    </Card>
  );
}

function ExportPanel() {
  const exportCsv = async () => {
    const q = query(collection(db, `${companyCode}_attendance`), orderBy('createdAt', 'desc'), limit(500));
    const rows: string[] = ['guardUid,guardName,mode,lat,lng,createdAt'];
    const unsub = onSnapshot(q, (snap) => {
      snap.docs.forEach((d) => {
        const x = d.data();
        rows.push(`${x.guardUid},${x.guardName},${x.mode},${x.gps?.lat ?? ''},${x.gps?.lng ?? ''},${x.createdAt}`);
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${companyCode.toLowerCase()}_attendance_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      unsub();
    });
  };

  return (
    <Card title="Report Export">
      <button className="w-full py-3 rounded bg-white text-black font-semibold" onClick={exportCsv}>Export Attendance CSV</button>
    </Card>
  );
}

function AIAssistant() {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');

  const ask = (e: FormEvent) => {
    e.preventDefault();
    const text = input.toLowerCase();
    if (text.includes('patrol')) {
      setResponse('Priority suggestion: start with high-risk checkpoints and complete perimeter sweep first.');
    } else if (text.includes('incident')) {
      setResponse('Incident assist: include exact location, people involved, and visible evidence before submission.');
    } else {
      setResponse('Use short factual notes. Add who/what/where/when to improve report quality.');
    }
  };

  return (
    <Card title="AI Assistant Module">
      <form onSubmit={ask} className="space-y-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} className="w-full p-3 rounded bg-black border border-white/20" placeholder="Ask for patrol/report help" />
        <button className="w-full py-3 rounded text-black font-semibold" style={{ backgroundColor: branding.primary }}>Get Suggestion</button>
      </form>
      {response && <p className="text-sm mt-3 text-white/90">{response}</p>}
    </Card>
  );
}

function MapPanel({ checkpoints }: { checkpoints: Checkpoint[] }) {
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapRef.current || !import.meta.env.VITE_GOOGLE_MAPS_API_KEY) return;

    const init = async () => {
      await loadGoogleMaps();
      const center = checkpoints.length ? { lat: checkpoints[0].lat, lng: checkpoints[0].lng } : { lat: -26.2041, lng: 28.0473 };
      if (!window.google?.maps) return;
      const map = new window.google.maps.Map(mapRef.current!, { center, zoom: 12, mapTypeControl: false, streetViewControl: false });
      checkpoints.forEach((c) => {
        new window.google!.maps.Marker({ map, position: { lat: c.lat, lng: c.lng }, title: c.name });
      });
    };

    init().catch(console.error);
  }, [checkpoints]);

  return (
    <Card title="Patrol Map">
      <div ref={mapRef} className="h-64 rounded-xl bg-black/60" />
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-black/60 border border-white/10 rounded-2xl p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}

function categorizeIncident(type: string, description: string) {
  const text = `${type} ${description}`.toLowerCase();
  if (text.includes('fire')) return 'Fire Risk';
  if (text.includes('weapon') || text.includes('armed')) return 'Violent Threat';
  if (text.includes('medical')) return 'Medical Emergency';
  return 'General Security';
}

async function getGps() {
  return new Promise<{ lat: number; lng: number }>((resolve) => {
    if (!navigator.geolocation) {
      resolve({ lat: -26.2041, lng: 28.0473 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve({ lat: -26.2041, lng: 28.0473 }),
      { enableHighAccuracy: true, timeout: 9000 }
    );
  });
}

async function submitWithOffline(type: 'attendance' | 'incident' | 'patrol' | 'panic', payload: Record<string, unknown>, online: boolean) {
  try {
    if (!online) throw new Error('offline');
    await addDoc(collection(db, `${companyCode}_${type}`), payload);
    await addDoc(collection(db, `${companyCode}_activity`), {
      type,
      summary: `${type.toUpperCase()} by ${String(payload.guardUid || 'system')}`,
      createdAt: new Date().toISOString()
    });
    await addDoc(collection(db, 'auditLogs'), {
      action: `WRITE_${type.toUpperCase()}`,
      uid: String(payload.guardUid || 'system'),
      companyCode,
      createdAt: new Date().toISOString()
    });
  } catch {
    await enqueue({ type, payload: { ...payload, companyCode }, createdAt: new Date().toISOString() });
    await enqueue({ type: 'audit', payload: { action: `QUEUE_${type.toUpperCase()}`, companyCode, createdAt: new Date().toISOString() }, createdAt: new Date().toISOString() });
  }
}

async function postToSheet(payload: Record<string, unknown>) {
  const url = import.meta.env.VITE_SHEETS_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    // Queue in app DB by reusing attendance queue path.
    await enqueue({ type: 'attendance', payload: { ...payload, sheetSyncPending: true }, createdAt: new Date().toISOString() });
  }
}

async function loadGoogleMaps() {
  if (window.google?.maps) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps=\"1\"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
}

export default App;
declare global {
  interface Window {
    google?: any;
  }
}
