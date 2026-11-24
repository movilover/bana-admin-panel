# Super Admin: bootstrap retirement and recovery

**Current state (default):** the e-mail in `firestore.rules` (`isBootstrappedSuperAdmin`), `src/firebase.ts` and `functions/src/index.ts`
is still a Super Admin as long as its e-mail is verified and the kill-switch `adminBootstrap/state` is absent or `disabled: false`.
Nothing has been removed.

## Safe retirement (recommended once, then keep the safeguards)
1. Sign in as the bootstrap Super Admin → Admin → Roles → **Super Admin bootstrap** → "Create my Super Admin record"
   (creates `adminRoles/<your uid>` with `role: super_admin`).
2. Create a **second** Super Admin (another trusted person/account) with Assign Admin Role. Recommended so one lost account is not fatal.
3. Click "Disable bootstrap access". Rules only allow this if your own durable record exists (`adminBootstrap/state` = `{disabled:true}`).
4. Verify in a private window: the e-mail alone no longer opens privileged tabs, your delegated record does.
5. Optional later cleanup: remove the e-mail constants from rules/client/functions in a separate, tested change.

Rules also forbid a Super Admin from demoting or deleting **their own** `adminRoles` record, and role records are schema-locked
(`uid`, `email`, `role`, `assignedBy`, `createdAt`, `updatedAt`), so ordinary users and other roles cannot escalate themselves.

## Emergency recovery (all Super Admins locked out)
Firebase Console → Firestore (console access bypasses rules, free on Spark):
- **Fastest:** delete the document `adminBootstrap/state` → the bootstrap e-mail works again immediately (it must be verified in Firebase Auth).
- **Or** create `adminRoles/<uid>` manually: `{ uid, email, role: "super_admin", assignedBy: "<uid>", createdAt: <timestamp> }`.
- Cloud Functions (if you ever deploy them on Blaze) read `SUPER_ADMIN_EMAILS`/the constant separately; keep it in sync.
After recovery, repeat the retirement steps with two Super Admins.

## Never
- Do not delete the last delegated `super_admin` record while the bootstrap is disabled.
- Do not put a real service-account key or admin password in the repo.
