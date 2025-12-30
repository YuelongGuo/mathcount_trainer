# MathCounts Trainer Error Logger (Chrome Extension)

A Chrome extension that authenticates users with Firebase and logs incorrect answers from the AoPS MathCounts Trainer to Cloud Firestore. Built with Vite + React + TypeScript.

## Architecture

- **Popup UI** (`index.html`, `src/App.tsx`): Google sign-in/out, status, queue count
- **Content script** (`src/contentScript.ts`): observes the trainer page and sends wrong-answer events
- **Background service worker** (`src/background.ts`): owns Firebase auth, queues logs offline, writes to Cloud Firestore

## Firebase setup

1. Create a Firebase project and a Cloud Firestore database (production or test mode).
2. Enable **Google** sign-in in Firebase Authentication.
3. Add a Web App and copy its config values.
4. In Firebase Authentication > Settings > Authorized domains, add your extension origin
   (`chrome-extension://<extension-id>`). You can find the ID at `chrome://extensions`.
5. Create a `.env` file from the example below (or `cp .env.example .env`).
6. Apply the Cloud Firestore rules from the section below.

`.env` (do not commit):
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## Security notes

- Firebase web config values are bundled into the extension at build time; assume they are public.
- Security comes from Authentication + Firestore rules, not hidden config.
- Keep `.env` files out of git.

## Install and build

```bash
npm install
npm run build
```

Then load `dist/` as an unpacked extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `dist/`

## Usage

1. Open the extension popup and sign in with Google.
2. Go to https://artofproblemsolving.com/mathcounts_trainer
3. Incorrect answers are recorded in Cloud Firestore under:
   `users/{uid}/wrongProblems/{docId}`

## Cloud Firestore rules (example)

Use per-user rules so data stays private:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/wrongProblems/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Customizing problem detection

The content script uses heuristic selectors to find problems and incorrect results. If the trainer UI changes, update selectors in:

- `src/contentScript.ts`

## Notes

- Logs are queued locally when signed out or offline and flushed on next sign-in.
- The Firebase config is required at build time; missing values will throw.
