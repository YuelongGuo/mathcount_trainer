# AGENTS

This file tracks notable assistant-driven changes.

## Recent changes
- Switched auth flow to Google sign-in via popup UI and removed email/password messaging.
- Logging now targets Cloud Firestore from the background service worker.
- Updated extension CSP to match Firebase endpoints in use.
- Updated setup docs and `.env.example` for the Firebase configuration.
- Hardened `.gitignore` to avoid committing env files and credentials.
- Reinitialized git history at the project root.
