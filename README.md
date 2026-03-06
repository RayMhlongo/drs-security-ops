# DRS Security Ops

Production-ready Android-first PWA + Capacitor app for DRS guard operations.

## New Final Update: First Login Role + Branch Workflow
- On first Google login, user must select role (`Security Guard`, `Admin`, `Management`, `Owner`).
- Non-owner users must select a branch.
- Owner is automatically assigned `All Branches`.
- Selection is persisted to:
  - Firebase `users` document
  - IndexedDB local cache (`profile` store)
- If offline during first login, profile is queued and auto-synced when online.

## Role-Based Access Control
- `Security Guard`: patrol, incident, attendance, panic field actions.
- `Admin`: branch configuration, user monitoring, QR/admin tools, exports.
- `Management`: monitoring dashboards and exports (read-only field modules).
- `Owner`: full access with branch scope selector.

## Branch-Aware Operations
All modules are branch-scoped and write branch metadata:
- Patrol (`DRS_patrol`)
- Incidents (`DRS_incident`)
- Attendance (`DRS_attendance`)
- Panic (`DRS_panic`)
- Activity feed (`DRS_activity`)

## Core Features (retained)
- Offline IndexedDB queue + background sync
- Google Maps checkpoint map
- QR generator for checkpoint/employee/equipment IDs
- Incident photo upload to Firebase Storage
- Attendance webhook to Google Sheets
- CSV export
- AI assistant module
- Audit logging

## Mobile Display/UX Hardening
- Safe-area support (`viewport-fit=cover`, `env(safe-area-inset-bottom)`)
- Consistent system font stack (no first-load font anomalies)
- Large touch targets for low-end Android devices

## Setup
1. `npm install`
2. Copy `.env.example` to `.env`
3. Fill Firebase + Maps + Sheets values
4. `npm run dev`
5. `npm run build`

## Firebase Setup
1. Enable Google Auth
2. Create Firestore + Storage
3. Deploy rules/indexes:
   - `firebase deploy --only firestore:rules,firestore:indexes`
4. Deploy hosting:
   - `firebase deploy --only hosting`

## Android APK Build
1. `npm run build`
2. `npm run android:sync`
3. `npm run android:open`
4. Build signed APK from Android Studio

## Stress Test
- Run `npm run stress:test`
- Simulates high-volume in-memory operational aggregation for hundreds of guards.

## GitHub
- https://github.com/RayMhlongo/drs-security-ops
