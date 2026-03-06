export type Role = 'owner' | 'management' | 'admin' | 'guard';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  companyCode: 'DRS' | 'BIG5';
  createdAt: string;
}

export interface GeoPointLite {
  lat: number;
  lng: number;
}

export interface QueueAction {
  id?: number;
  type: 'attendance' | 'incident' | 'patrol' | 'panic' | 'location' | 'audit';
  payload: Record<string, unknown>;
  createdAt: string;
}
