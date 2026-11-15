# Creating the first Super Admin (manual, one time)

`super-admin/{uid}` is the authoritative record; the `superAdmin` custom claim is derived from it. **Nothing is hardcoded, no UID or email is invented, and the tooling never creates or edits a super-admin record.** You create the first record; the script only verifies it and sets the claim.

## Prerequisites
* Node 22 and the Firebase project `xploresoweto` open in the Firebase console.
* `gcloud auth application-default login` with a Google account that has Firebase Admin (or Owner) on `xploresoweto`. **No service-account key files**; the script refuses any key path inside this repository and refuses the old project.

## Steps
1. **Create the account.** Sign up in the app (or Console → Authentication → Add user). Use an email you control.
2. **Verify the email** (click the link). Admin powers stay inert until the email is verified. *Documented exception:* if the account was created in the console and is still unverified, the bootstrap is allowed, is flagged `exception: true` in the audit log, and the account gains no powers until it verifies.
3. **Copy the user's UID** (Console → Authentication → Users → "User UID").
4. **Create the record by hand** (Console → Firestore → Start collection `super-admin` → Document ID = the UID) with exactly these fields:
   `uid` (string, same as the document id), `email` (string, same as the Auth email), `displayName` (string), `role` = `super_admin`, `active` = `true` (boolean), `grantedBy` = `manual-bootstrap`, `createdAt` and `updatedAt` (timestamps).
5. **Check state:** `cd functions && npm install && npm run super-admin -- status` (expects your record, `claim=false`).
6. **Activate:** `npm run super-admin -- bootstrap --uid <THE_UID>`. It shows the account and asks you to type its email. It refuses if: the account or record is missing; `uid`/`role`/`active`/`email` don't match; the account is disabled; another active super admin exists (unless `--allow-multiple`).
7. **It then** sets the claim, **reads it back to verify**, and writes an audit entry. Sign out and in (or refresh the token) to receive the claim.
8. **Verify:** `npm run super-admin -- status` shows `active=true claim=true`.

## Adding / removing Super Admins and editors later
An existing active super admin calls `managePlatformRole` (`{action:"add"|"remove", role:"superAdmin"|"editor", uid}`), for example with `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run call -- managePlatformRole '{"action":"add","role":"editor","uid":"…"}'`. The target must exist with a verified email. Removal deactivates the record (history kept), clears the claim and revokes sessions. **The last active super admin cannot be removed, and nobody can remove themselves.** Every change is written to `audit-log`.

## Recovery and repair
* `npm run super-admin -- sync --uid <UID>` aligns the claim with the record (clears it if the record is inactive).
* If every super admin is lost, a project Owner repeats the manual steps above for a new account.
* Editing a `super-admin` document in the console does not change the claim by itself; run `sync`.

## Safety properties (and how they are verified)
* Clients cannot write `super-admin`, `platform-editors` or `audit-log` (rules; emulator tests written, **not yet run**).
* A claim alone, an active record alone, an inactive record, an unverified email, or a record with the wrong role/uid are all refused by the functions (**tested**, including a stale token after revocation).
* The bootstrap library is tested to be read-only for the `super-admin` collection (**tested**).
