export type Role = 'owner' | 'management' | 'admin' | 'guard';
export type CompanyCode = 'DRS' | 'BIG5';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  companyCode: CompanyCode;
  branchId: string;
  branchName: string;
  onboardingCompleted: boolean;
  createdAt: string;
}

export interface Branch {
  id: string;
  companyCode: CompanyCode;
  name: string;
  code: string;
  active: boolean;
  createdAt: string;
}

export interface GeoPointLite {
  lat: number;
  lng: number;
}

export interface QueueAction {
  id?: number;
  type: 'attendance' | 'incident' | 'patrol' | 'panic' | 'location' | 'audit' | 'profile' | 'branch';
  payload: Record<string, unknown>;
  createdAt: string;
}
