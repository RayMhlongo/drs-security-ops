# DRS Security Ops

Production-ready PWA + Capacitor Android operations app for DRS Data Response Security (South Africa).

## Features
- Google authentication + first-login role selection (`owner`, `management`, `admin`, `guard`)
- Guard dashboard, patrol QR check-ins, incident reporting with photo evidence
- Attendance clock-in/out with Google Sheets webhook sync
- Emergency panic button with immediate command-center feed
- Offline-first queue (IndexedDB) with auto-sync when connectivity returns
- Firebase Storage photo uploads, Firestore audit logs, role-aware access controls
- Google Maps visualization for patrol checkpoints
- AI assistant module for report guidance and patrol priority suggestions
- PWA installable on Android + Capacitor Android build support

## Stack
- React + Vite + TypeScript
- TailwindCSS
- Firebase (Auth, Firestore, Storage)
- IndexedDB (`idb`)
- Google Maps JavaScript API
- QR code generator (`qrcode`)

## Local Setup
1. Install dependencies:
   - `npm install`
2. Create `.env` from `.env.example` and fill values.
3. Run locally:
   - `npm run dev`
4. Production build:
   - `npm run build`

## Firebase Setup
1. Create Firebase project (Spark free tier).
2. Enable Google Authentication.
3. Create Firestore database (production mode).
4. Create Storage bucket.
5. Deploy rules/indexes:
   - `firebase deploy --only firestore:rules,firestore:indexes`
6. Deploy hosting:
   - `firebase deploy --only hosting`

## Firestore Collections
- `users`
- `DRS_attendance`
- `DRS_patrol`
- `DRS_incident`
- `DRS_panic`
- `DRS_activity`
- `DRS_checkpoints`
- `auditLogs`

## Google Sheets Integration
- Configure `VITE_SHEETS_WEBHOOK_URL` with a Google Apps Script Web App endpoint.
- Attendance events are sent in JSON payload format.

## Android Build (Capacitor)
1. Build web app:
   - `npm run build`
2. Initialize Android project (first time):
   - `npx cap add android`
3. Sync web assets:
   - `npm run android:sync`
4. Open Android Studio:
   - `npm run android:open`
5. Build signed APK in Android Studio (`Build > Generate Signed Bundle / APK`).

## GitHub Deployment
1. Push repo to `https://github.com/RayMhlongo/drs-security-ops`.
2. Add repository secrets/environment for Firebase CLI if using CI deployment.
3. Deploy from local or GitHub Action.

## Security Notes
- Enforce least-privilege roles via `firestore.rules`.
- Restrict API keys by app and domain in Google Cloud Console.
- Store no secrets in client repository.
