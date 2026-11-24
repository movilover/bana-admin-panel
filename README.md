# BANA Admin Console (stand-alone)

Separate front-end for BANA administrators. It has **no code connection** to the user site: its own repo, its own build,
its own GitHub Pages URL. It talks to the same Firebase project (`bana-a5770`), the same Firestore/Storage rules and the same
Render backend as the user site.

- Stack: React 19 + Vite + Tailwind 4 + Firebase (Auth, Firestore, Storage, Functions)
- Access: Firebase sign-in, then role check (custom claim → verified bootstrapped Super Admin email → `adminRoles/{uid}`).
  Signed-in accounts without a role see an "Access required" screen only.
- Session: ends when the tab closes (`browserSessionPersistence`) and after 30 idle minutes (`VITE_ADMIN_IDLE_MINUTES`).
- Not indexed: `noindex` meta + `robots.txt` Disallow.

```
npm install
cp .env.example .env.local   # fill VITE_BACKEND_URL etc.
npm run dev                  # http://localhost:3001
npm run check                # type-check + production build
```

Deployment steps (Bengali): see `DEPLOY_BN.md`.
