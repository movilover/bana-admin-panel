# Values that must stay in sync across the three packages

| Item | Where | Rule |
|---|---|---|
| Firebase project id `bana-a5770`, apiKey, authDomain, appId... | User site `src/firebase.ts` + env, Admin `src/firebase.ts` + env, this package `.firebaserc` | identical in both frontends; never create a second project |
| Bootstrapped Super Admin email | both `src/firebase.ts` files and `firestore.rules` | identical in all three |
| Admin role names (`super_admin`, `admin`, `moderator`, `support_staff`, `finance_manager`, `ad_manager`, `content_manager`, `support_manager`) | `firestore.rules`, Admin `AuthContext`/`adminRbac`, `functions/` | a new role needs a rules change here **and** the Admin package |
| Firestore collection / field names | rules + both frontends | change rules first (additive), then frontends; remove old fields last |
| Video-distribution bounds and formulas | User `src/lib/videoDistributionCore.ts`, Admin copy, `firestore.rules` | User package test `video-rules-parity.test.mjs` checks them when this package sits next to it |
| Authorized domains (Firebase Console) | one entry per frontend host | add the Admin host and User host |
| Backend `CORS_ALLOWED_ORIGINS` (Render) | origin of both frontends, no path | add the Admin origin |
| Media broker worker `ALLOWED_ORIGINS` (`workers/bana-media-broker`, Cloudflare var) | origin of both frontends, no path | add the Admin origin (and the User origin if it is not `*.web.app`) |
| Admin copies of shared lib/types (`src/lib`, `src/types`) | Admin package vs User package | duplicated on purpose; if a shared type/formula changes, update both |
