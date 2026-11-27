# Staff read access to public content (rules correction)

The public-content rule in `security-rules/firestore.rules` is now:

```
match /{coll}/{docId} {
  allow read: if coll in publicCollections()
    && (isStaff() || resource.data.isActive == true);
  allow create, update, delete: if coll in publicCollections() && isStaff();
}
```

**Why:** the CMS lists whole collections (including inactive and flag-less documents) to show, repair and seed content. Under the previous rule even an active Super Admin could not run an unfiltered query, so the CMS "load sample data" buttons and lists failed with permission errors.

**Unchanged:** ordinary users and anonymous visitors still read active documents only and still must filter on `isActive == true`; `isStaff()` still requires the custom claim AND a verified email AND an active `super-admin/{uid}` / `platform-editors/{uid}` record; private user collections, private Malloya collections (`ai-*`, server-only) and unknown collections stay denied; writes are unchanged.

**Status:** this correction was published manually to the staging project; this patch brings the repository's canonical rules and emulator tests in line. It has NOT been deployed from here. Tests: `security-rules/test/firestore.rules.test.js` ("staff read access to public content"). Run with `npm --prefix security-rules test` (needs the Firebase emulators).
