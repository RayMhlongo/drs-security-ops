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
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  limit,
  where
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import QRCode from 'qrcode';
import toast, { Toaster } from 'react-hot-toast';
import { format } from 'date-fns';
import { auth, db, isFirebaseConfigured, storage } from './lib/firebase';
import { cacheBranches, cacheProfile, clearCachedProfile, enqueue, getCachedBranches, getCachedProfile } from './lib/offlineQueue';
import { useSyncEngine } from './hooks/useSyncEngine';
import type { Branch, Role, UserProfile } from './types/models';

const companyCode = (import.meta.env.VITE_COMPANY_CODE || 'DRS') as 'DRS' | 'BIG5';

const branding = {
  DRS: { name: 'DRS Data Response Security', primary: '#EB623D', accent: 'bg-[#EB623D]' },
  BIG5: { name: 'Big 5 Security', primary: '#1d4ed8', accent: 'bg-blue-700' }
}[companyCode];

type Checkpoint = { id: string; name: string; lat: number; lng: number };

type Activity = { id: string; type: string; createdAt: string; summary: string };

type RolePermissions = {
  canPatrol: boolean;
  canIncident: boolean;
  canAttendance: boolean;
  canPanic: boolean;
  canManageSystem: boolean;
  canMonitor: boolean;
  canExport: boolean;
};

const rolePermissions: Record<Role, RolePermissions> = {
  guard: {
    canPatrol: true,
    canIncident: true,
    canAttendance: true,
    canPanic: true,
    canManageSystem: false,
    canMonitor: false,
    canExport: false
  },
  admin: {
    canPatrol: false,
    canIncident: false,
    canAttendance: false,
    canPanic: false,
    canManageSystem: true,
    canMonitor: true,
    canExport: true
  },
  management: {
    canPatrol: false,
    canIncident: false,
    canAttendance: false,
    canPanic: false,
    canManageSystem: false,
    canMonitor: true,
    canExport: true
  },
  owner: {
    canPatrol: true,
    canIncident: true,
    canAttendance: true,
    canPanic: true,
    canManageSystem: true,
    canMonitor: true,
    canExport: true
  }
};

const fallbackBranches: Branch[] = companyCode === 'DRS'
  ? [
      { id: 'drs-jhb-central', companyCode: 'DRS', name: 'Johannesburg Central', code: 'JHB-CENTRAL', active: true, createdAt: new Date().toISOString() },
      { id: 'drs-pta-east', companyCode: 'DRS', name: 'Pretoria East', code: 'PTA-EAST', active: true, createdAt: new Date().toISOString() }
    ]
  : [
      { id: 'big5-jhb-north', companyCode: 'BIG5', name: 'Johannesburg North', code: 'JHB-NORTH', active: true, createdAt: new Date().toISOString() },
      { id: 'big5-randburg', companyCode: 'BIG5', name: 'Randburg', code: 'RANDBURG', active: true, createdAt: new Date().toISOString() }
    ];

function App() {
  const online = useSyncEngine();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  if (!isFirebaseConfigured) {
    return <ConfigMissingScreen />;
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);
      if (!authUser) {
        if (user?.uid) {
          await clearCachedProfile(user.uid);
        }
        setProfile(null);
        setLoading(false);
        return;
      }
      try {
        const profileSnap = await getDoc(doc(db, 'users', authUser.uid));
        if (profileSnap.exists()) {
          const loaded = profileSnap.data() as UserProfile;
          setProfile(loaded);
          await cacheProfile(loaded);
        } else {
          setProfile(await getCachedProfile(authUser.uid));
        }
      } catch {
        setProfile(await getCachedProfile(authUser.uid));
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

  if (!profile || !profile.onboardingCompleted) {
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
  const [branches, setBranches] = useState<Branch[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(fallbackBranches[0]?.id || '');

  useEffect(() => {
    let mounted = true;
    const loadBranches = async () => {
      try {
        const snap = await getDocs(query(collection(db, `${companyCode}_branches`), where('active', '==', true), limit(100)));
        if (snap.size > 0) {
          const live = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Branch, 'id'>) }));
          if (!mounted) return;
          setBranches(live);
          setBranchId(live[0]?.id || '');
          await cacheBranches(live);
          return;
        }
      } catch {
        // load from IndexedDB fallback below
      }
      const cached = await getCachedBranches();
      if (mounted && cached.length) {
        setBranches(cached);
        setBranchId(cached[0]?.id || '');
      }
    };
    loadBranches();
    return () => {
      mounted = false;
    };
  }, []);

  const save = async () => {
    const selected = branches.find((b) => b.id === branchId);
    if (role !== 'owner' && !selected) {
      toast.error('Select a branch to continue.');
      return;
    }

    const profile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || 'Unknown User',
      role,
      companyCode,
      branchId: role === 'owner' ? 'ALL' : selected!.id,
      branchName: role === 'owner' ? 'All Branches' : selected!.name,
      onboardingCompleted: true,
      createdAt: new Date().toISOString()
    };
    try {
      await setDoc(doc(db, 'users', user.uid), profile, { merge: true });
      await addDoc(collection(db, 'auditLogs'), {
        action: 'ROLE_BRANCH_SELECTED',
        uid: user.uid,
        role,
        companyCode,
        branchId: profile.branchId,
        createdAt: new Date().toISOString()
      });
    } catch {
      await enqueue({ type: 'profile', payload: { ...profile }, createdAt: new Date().toISOString() });
      await enqueue({
        type: 'audit',
        payload: {
          action: 'QUEUE_ROLE_BRANCH_SELECTED',
          uid: user.uid,
          role,
          companyCode,
          branchId: profile.branchId,
          createdAt: new Date().toISOString()
        },
        createdAt: new Date().toISOString()
      });
    }
    await cacheProfile(profile);
    onDone(profile);
  };

  return (
    <div className="min-h-screen p-6 grid place-items-center">
      <div className="w-full max-w-md bg-black/60 border border-white/10 rounded-2xl p-6 space-y-4">
        <h2 className="text-xl font-semibold">First Login Setup</h2>
        <p className="text-sm text-white/75">Select role and branch assignment.</p>
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
        {role !== 'owner' && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-full p-3 rounded-lg bg-black border border-white/20"
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        )}
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
  const [branches, setBranches] = useState<Branch[]>(fallbackBranches);
  const [activeBranchId, setActiveBranchId] = useState(profile.branchId || 'ALL');
  const permissions = rolePermissions[profile.role];

  useEffect(() => {
    const q = scopedQuery(`${companyCode}_activity`, profile, activeBranchId, [orderBy('createdAt', 'desc'), limit(12)]);
    const unsub = onSnapshot(q, (snap) => {
      setActivities(
        snap.docs.map((d) => {
          const data = d.data() as Omit<Activity, 'id'>;
          return { id: d.id, ...data };
        })
      );
    });
    return () => unsub();
  }, [profile, activeBranchId]);

  useEffect(() => {
    const q = scopedQuery(`${companyCode}_checkpoints`, profile, activeBranchId, [limit(300)]);
    const unsub = onSnapshot(q, (snap) => {
      setCheckpoints(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Checkpoint, 'id'>) })));
    });
    return () => unsub();
  }, [profile, activeBranchId]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, `${companyCode}_branches`), where('active', '==', true), limit(200)), async (snap) => {
      if (snap.size > 0) {
        const live = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Branch, 'id'>) }));
        setBranches(live);
        await cacheBranches(live);
      }
    });
    return () => unsub();
  }, []);

  const logOut = async () => {
    await signOut(auth);
  };

  const activeBranchName = activeBranchId === 'ALL' ? 'All Branches' : branches.find((b) => b.id === activeBranchId)?.name || profile.branchName;

  const tabs = [
    { path: '/home', label: 'Home', show: true },
    { path: '/patrol', label: 'Patrol', show: permissions.canPatrol || permissions.canMonitor },
    { path: '/incident', label: 'Incident', show: permissions.canIncident || permissions.canMonitor },
    { path: '/attendance', label: 'Attendance', show: permissions.canAttendance || permissions.canMonitor },
    { path: '/panic', label: 'Panic', show: permissions.canPanic || permissions.canMonitor },
    { path: '/tools', label: 'Tools', show: permissions.canManageSystem || permissions.canExport }
  ].filter((tab) => tab.show);

  return (
    <div className="min-h-[100dvh] pb-[calc(6rem+env(safe-area-inset-bottom))] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/85 backdrop-blur px-4 py-3">
        <div className="flex justify-between items-center gap-3">
          <div>
            <p className="text-xs text-white/70">{branding.name}</p>
            <p className="font-semibold">{profile.displayName}</p>
            <p className="text-xs uppercase text-white/60">{profile.role}</p>
            <p className="text-xs text-white/70">Branch: {activeBranchName}</p>
          </div>
          <div className="text-right text-xs space-y-1">
            <p>{online ? 'Online' : 'Offline'}</p>
            {profile.role === 'owner' && (
              <select
                value={activeBranchId}
                onChange={(e) => setActiveBranchId(e.target.value)}
                className="bg-black border border-white/20 rounded p-1 text-[11px]"
              >
                <option value="ALL">All</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            )}
            <button className="text-white/80 underline" onClick={logOut}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="p-4">
        <Routes>
          <Route path="/home" element={<HomeView checkpoints={checkpoints} activities={activities} branchName={activeBranchName} />} />
          <Route path="/patrol" element={<PatrolView profile={profile} checkpoints={checkpoints} online={online} activeBranchId={activeBranchId} activeBranchName={activeBranchName} permissions={permissions} />} />
          <Route path="/incident" element={<IncidentView profile={profile} online={online} activeBranchId={activeBranchId} activeBranchName={activeBranchName} permissions={permissions} />} />
          <Route path="/attendance" element={<AttendanceView profile={profile} online={online} activeBranchId={activeBranchId} activeBranchName={activeBranchName} permissions={permissions} />} />
          <Route path="/panic" element={<PanicView profile={profile} online={online} activeBranchId={activeBranchId} activeBranchName={activeBranchName} permissions={permissions} />} />
          <Route path="/tools" element={<ToolsView profile={profile} checkpoints={checkpoints} branches={branches} online={online} activeBranchId={activeBranchId} permissions={permissions} />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-black/95 border-t border-white/10 p-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] grid grid-cols-3 gap-2">
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

function HomeView({ checkpoints, activities, branchName }: { checkpoints: Checkpoint[]; activities: Activity[]; branchName: string }) {
  return (
    <div className="space-y-4">
      <Card title="Active Shift">{`Branch: ${branchName} | Shift Active | Route Ready`}</Card>
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

function PatrolView({
  profile,
  checkpoints,
  online,
  activeBranchId,
  activeBranchName,
  permissions
}: {
  profile: UserProfile;
  checkpoints: Checkpoint[];
  online: boolean;
  activeBranchId: string;
  activeBranchName: string;
  permissions: RolePermissions;
}) {
  const [checkpointId, setCheckpointId] = useState('');
  const [notes, setNotes] = useState('');

  const submit = async () => {
    if (!permissions.canPatrol) {
      toast.error('Role restriction: patrol submission not allowed.');
      return;
    }
    if (activeBranchId === 'ALL') {
      toast.error('Select a specific branch before submitting field data.');
      return;
    }
    const payload = {
      companyCode,
      branchId: activeBranchId,
      branchName: activeBranchName,
      guardUid: profile.uid,
      checkpointId,
      notes,
      gps: await getGps(),
      createdAt: new Date().toISOString()
    };
    await submitWithOffline('patrol', payload, online);
    toast.success('Checkpoint captured');
    setNotes('');
  };

  return (
    <div className="space-y-4">
      {!permissions.canPatrol && <ReadOnlyNotice text="Read-only patrol view: this role cannot submit patrol scans." />}
      <Card title="Patrol Checkpoint Scan">
        <label className="text-sm">Checkpoint ID / QR value</label>
        <input
          value={checkpointId}
          onChange={(e) => setCheckpointId(e.target.value)}
          className="w-full mt-2 p-3 rounded-lg bg-black border border-white/20"
          placeholder="Scan or type checkpoint ID"
          disabled={!permissions.canPatrol}
        />
        <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
          {checkpoints.map((c) => (
            <button key={c.id} className="bg-white/10 rounded p-2 disabled:opacity-40" onClick={() => setCheckpointId(c.id)} disabled={!permissions.canPatrol}>{c.name}</button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full mt-3 p-3 rounded-lg bg-black border border-white/20"
          placeholder="Optional notes"
          disabled={!permissions.canPatrol}
        />
        <button onClick={submit} className="w-full py-4 rounded-xl mt-3 text-black font-semibold disabled:opacity-40" style={{ backgroundColor: branding.primary }} disabled={!permissions.canPatrol}>
          Record Patrol Scan
        </button>
      </Card>
      <AIAssistant />
    </div>
  );
}

function IncidentView({
  profile,
  online,
  activeBranchId,
  activeBranchName,
  permissions
}: {
  profile: UserProfile;
  online: boolean;
  activeBranchId: string;
  activeBranchName: string;
  permissions: RolePermissions;
}) {
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
    if (!permissions.canIncident) {
      toast.error('Role restriction: incident submission not allowed.');
      return;
    }
    if (activeBranchId === 'ALL') {
      toast.error('Select a specific branch before submitting field data.');
      return;
    }

    let photoUrl = '';
    if (online && photoBase64) {
      const fileRef = ref(storage, `${companyCode}/incidents/${profile.uid}_${Date.now()}.jpg`);
      await uploadString(fileRef, photoBase64, 'data_url');
      photoUrl = await getDownloadURL(fileRef);
    }

    const payload = {
      companyCode,
      branchId: activeBranchId,
      branchName: activeBranchName,
      guardUid: profile.uid,
      type,
      description,
      gps: await getGps(),
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
      {!permissions.canIncident && <ReadOnlyNotice text="Read-only incident view: this role cannot submit incidents." />}
      <Card title="Incident Reporting">
        <select value={type} onChange={(e) => setType(e.target.value)} className="w-full p-3 rounded-lg bg-black border border-white/20" disabled={!permissions.canIncident}>
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
          disabled={!permissions.canIncident}
        />
        <input className="w-full mt-3" type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} disabled={!permissions.canIncident} />
        <button onClick={submit} className="w-full py-4 rounded-xl mt-3 text-black font-semibold disabled:opacity-40" style={{ backgroundColor: branding.primary }} disabled={!permissions.canIncident}>
          Submit Incident
        </button>
      </Card>
      <AIAssistant />
    </div>
  );
}

function AttendanceView({
  profile,
  online,
  activeBranchId,
  activeBranchName,
  permissions
}: {
  profile: UserProfile;
  online: boolean;
  activeBranchId: string;
  activeBranchName: string;
  permissions: RolePermissions;
}) {
  const punch = async (mode: 'IN' | 'OUT') => {
    if (!permissions.canAttendance) {
      toast.error('Role restriction: attendance clocking not allowed.');
      return;
    }
    if (activeBranchId === 'ALL') {
      toast.error('Select a specific branch before submitting field data.');
      return;
    }
    const payload = {
      companyCode,
      branchId: activeBranchId,
      branchName: activeBranchName,
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
      {!permissions.canAttendance && <ReadOnlyNotice text="Read-only attendance view: this role cannot clock in/out." />}
      <Card title="Attendance">
        <div className="grid grid-cols-2 gap-3">
          <button className="py-6 rounded-xl text-lg font-bold text-black disabled:opacity-40" style={{ backgroundColor: branding.primary }} onClick={() => punch('IN')} disabled={!permissions.canAttendance}>
            Clock In
          </button>
          <button className="py-6 rounded-xl text-lg font-bold bg-white text-black disabled:opacity-40" onClick={() => punch('OUT')} disabled={!permissions.canAttendance}>
            Clock Out
          </button>
        </div>
      </Card>
    </div>
  );
}

function PanicView({
  profile,
  online,
  activeBranchId,
  activeBranchName,
  permissions
}: {
  profile: UserProfile;
  online: boolean;
  activeBranchId: string;
  activeBranchName: string;
  permissions: RolePermissions;
}) {
  const trigger = async () => {
    if (!permissions.canPanic) {
      toast.error('Role restriction: panic trigger not allowed.');
      return;
    }
    if (activeBranchId === 'ALL') {
      toast.error('Select a specific branch before submitting field data.');
      return;
    }
    const payload = {
      companyCode,
      branchId: activeBranchId,
      branchName: activeBranchName,
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
      {!permissions.canPanic && <ReadOnlyNotice text="Read-only panic view: this role cannot trigger panic alerts." />}
      <Card title="Emergency Panic Button">
        <button onClick={trigger} className="w-full py-14 rounded-2xl bg-red-600 text-2xl font-black disabled:opacity-40" disabled={!permissions.canPanic}>PANIC</button>
      </Card>
    </div>
  );
}

function ConfigMissingScreen() {
  return (
    <div className="min-h-[100dvh] p-6 grid place-items-center text-white">
      <div className="w-full max-w-xl rounded-2xl border border-red-500/40 bg-black/70 p-6 space-y-3">
        <h1 className="text-xl font-semibold">Configuration Required</h1>
        <p className="text-sm text-white/80">
          Firebase environment values are missing in this build. Add Vite Firebase variables, rebuild, and reinstall the APK.
        </p>
        <p className="text-xs text-white/60">
          Required: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
        </p>
      </div>
    </div>
  );
}

function ToolsView({
  profile,
  checkpoints,
  branches,
  online,
  activeBranchId,
  permissions
}: {
  profile: UserProfile;
  checkpoints: Checkpoint[];
  branches: Branch[];
  online: boolean;
  activeBranchId: string;
  permissions: RolePermissions;
}) {
  return (
    <div className="space-y-4">
      {permissions.canManageSystem && <BranchAdmin branches={branches} profile={profile} online={online} />}
      {permissions.canManageSystem && <UserManagement profile={profile} activeBranchId={activeBranchId} />}
      {permissions.canManageSystem && <QrGenerator checkpoints={checkpoints} />}
      {permissions.canExport && <ExportPanel profile={profile} activeBranchId={activeBranchId} />}
      <AIAssistant />
    </div>
  );
}

function BranchAdmin({ branches, profile, online }: { branches: Branch[]; profile: UserProfile; online: boolean }) {
  const [name, setName] = useState('');
  const createBranch = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const payload = {
      companyCode,
      name: trimmed,
      code: trimmed.toUpperCase().replace(/\s+/g, '-'),
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: profile.uid
    };
    try {
      if (!online) throw new Error('offline');
      await addDoc(collection(db, `${companyCode}_branches`), payload);
      await addDoc(collection(db, 'auditLogs'), {
        action: 'CREATE_BRANCH',
        uid: profile.uid,
        companyCode,
        branchCode: payload.code,
        createdAt: new Date().toISOString()
      });
      setName('');
      toast.success('Branch created');
    } catch {
      await enqueue({ type: 'branch', payload, createdAt: new Date().toISOString() });
      toast('Branch queued for sync.');
    }
  };
  return (
    <Card title="Branch Configuration">
      <p className="text-xs text-white/80 mb-2">Active branches: {branches.map((b) => b.name).join(', ')}</p>
      <input value={name} onChange={(e) => setName(e.target.value)} className="w-full p-3 rounded bg-black border border-white/20" placeholder="New branch name" />
      <button onClick={createBranch} className="w-full mt-2 py-3 rounded text-black font-semibold" style={{ backgroundColor: branding.primary }}>Add Branch</button>
    </Card>
  );
}

function UserManagement({ profile, activeBranchId }: { profile: UserProfile; activeBranchId: string }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  useEffect(() => {
    const constraints: any[] = [where('companyCode', '==', companyCode), limit(200)];
    if (profile.role !== 'owner' && activeBranchId !== 'ALL') {
      constraints.push(where('branchId', '==', activeBranchId));
    }
    const unsub = onSnapshot(query(collection(db, 'users'), ...constraints), (snap) => {
      setUsers(snap.docs.map((d) => d.data() as UserProfile));
    });
    return () => unsub();
  }, [profile.role, activeBranchId]);

  return (
    <Card title="User Access Monitor">
      <ul className="space-y-1 text-sm max-h-48 overflow-auto">
        {users.map((u) => (
          <li key={u.uid} className="border-b border-white/10 pb-1">{u.displayName} - {u.role} - {u.branchName}</li>
        ))}
      </ul>
    </Card>
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

function ExportPanel({ profile, activeBranchId }: { profile: UserProfile; activeBranchId: string }) {
  const exportCsv = async () => {
    const q = scopedQuery(`${companyCode}_attendance`, profile, activeBranchId, [orderBy('createdAt', 'desc'), limit(1000)]);
    const rows: string[] = ['guardUid,guardName,branchId,mode,lat,lng,createdAt'];
    const unsub = onSnapshot(q, (snap) => {
      snap.docs.forEach((d) => {
        const x = d.data();
        rows.push(`${x.guardUid},${x.guardName},${x.branchId ?? ''},${x.mode},${x.gps?.lat ?? ''},${x.gps?.lng ?? ''},${x.createdAt}`);
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

function ReadOnlyNotice({ text }: { text: string }) {
  return <div className="rounded-xl border border-yellow-400/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">{text}</div>;
}

function categorizeIncident(type: string, description: string) {
  const text = `${type} ${description}`.toLowerCase();
  if (text.includes('fire')) return 'Fire Risk';
  if (text.includes('weapon') || text.includes('armed')) return 'Violent Threat';
  if (text.includes('medical')) return 'Medical Emergency';
  return 'General Security';
}

function scopedQuery(path: string, profile: UserProfile, activeBranchId: string, constraints: any[]) {
  const scoped = [...constraints];
  const branch = profile.role === 'owner' ? activeBranchId : profile.branchId;
  if (branch !== 'ALL') {
    scoped.unshift(where('branchId', '==', branch));
  }
  return query(collection(db, path), ...scoped);
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
      branchId: payload.branchId,
      summary: `${type.toUpperCase()} by ${String(payload.guardUid || 'system')}`,
      createdAt: new Date().toISOString()
    });
    await addDoc(collection(db, 'auditLogs'), {
      action: `WRITE_${type.toUpperCase()}`,
      uid: String(payload.guardUid || 'system'),
      companyCode,
      branchId: String(payload.branchId || ''),
      createdAt: new Date().toISOString()
    });
  } catch {
    await enqueue({ type, payload: { ...payload, companyCode }, createdAt: new Date().toISOString() });
    await enqueue({
      type: 'audit',
      payload: {
        action: `QUEUE_${type.toUpperCase()}`,
        companyCode,
        branchId: String(payload.branchId || ''),
        createdAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString()
    });
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
