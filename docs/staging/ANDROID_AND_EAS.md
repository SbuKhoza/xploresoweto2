# Staging: Android flavors, signing and EAS

## Variants

`android/app/build.gradle` defines two product flavors with **literal** application ids (EAS reads `applicationId` and mis-detects suffixes):

| Flavor | applicationId | Label | Signing of a release |
|---|---|---|---|
| `production` | `com.sbudamalloya.xploresoweto` | xploresoweto | unchanged (see below) |
| `staging` | `com.sbudamalloya.xploresoweto.staging` | XploreSoweto STAGING | never debug: owner keystore or the EAS staging credentials |

They install side by side and have separate app storage. The Firebase project is **not** chosen by the flavor; it comes from the build's
`EXPO_PUBLIC_*` values and must agree with the flavor's application id or the app refuses to start.

**Production signing is unchanged in effect.** `buildTypes.release` used to say `signingConfig signingConfigs.debug`; that line moved to the
`production` flavor so staging can differ. If you build production on EAS, EAS injects its own credentials exactly as before. Existing EAS
production credentials are not touched by anything here, and **no staging credentials have been created** (that needs your approval).

## EAS profiles (one EAS project, `9ca91ae0-7d47-40c4-8299-80b8595e5f27`, unchanged)

| Profile | Environment | Gradle task |
|---|---|---|
| `development` | production | `:app:assembleProductionDebug` |
| `preview` | production | `:app:assembleProductionRelease` |
| `production` | production | `:app:bundleProductionRelease` (still an app bundle) |
| `local` | production | `:app:assembleProductionRelease` |
| `staging` (new) | staging | `:app:assembleStagingRelease` |
| `staging-dev` (new) | staging | `:app:assembleStagingDebug` |

`gradleCommand` is required now: with flavors the default `assembleRelease`/`bundleRelease` would build **every** flavor. EAS documents that
`gradleCommand` overrides `buildType` and `developmentClient`. Each profile's `env` is explicit (no `extends`, because the documentation does
not say how `env` merges). **OTA updates are not enabled** (no `expo-updates`, no channels, updates stay disabled in the manifest).

## Staging signing

Preferred: let EAS create and keep the staging keystore (**needs your approval; not done**):

```powershell
eas credentials --platform android      # choose the staging profile, application id com.sbudamalloya.xploresoweto.staging
```

Do not run it for the `production` profile. EAS stores credentials per application identifier. **[verify]** with `eas credentials` that the
staging identifier shows its own keystore and production's is untouched.

Optional local route: create a keystore **outside the repo** (`scripts\staging\create-local-staging-keystore.ps1 -OutFile C:\keys\xs-staging.p12`),
then in the build shell set `XS_STAGING_STORE_FILE`, `XS_STAGING_STORE_PASSWORD`, `XS_STAGING_KEY_ALIAS`, `XS_STAGING_KEY_PASSWORD`.

Guarantee: a Gradle task-graph guard at the bottom of `build.gradle` throws if a staging **release** would be signed with the debug config,
the tracked `debug.keystore`, no keystore, or a missing file. `stagingDebug` (development client) uses the debug key, as any debug build does.

## Build commands

```powershell
.\scripts\staging\build-android-staging.ps1 -Variant Debug      # local, needs only the staging identifiers
.\scripts\staging\build-android-staging.ps1 -Variant Release    # local, needs the four XS_STAGING_* variables
eas build --profile staging --platform android                  # on EAS (after credentials are set up)
npm run android:staging                                         # run the staging debug app on a device/emulator
```

## Production parity (do this BEFORE merging, on your machine)

The production build configuration changed (flavors, `gradleCommand`, explicit `env`). Prove nothing else did:

1. On `c419086`: build a production APK the way you do today and note `aapt dump badging <apk>` (package, versionName) and `apksigner verify --print-certs`.
2. On this branch: `.\gradlew.bat :app:assembleProductionRelease` with `node scripts\print-env.js production` values exported, then compare
   package name, versionName, permissions and signer. They should be identical.
3. `eas build --profile production --platform android` (or `--local`) must still produce an `.aab`; check the EAS log shows
   `eas-build-pre-install` printing `verify-env: profile "production" -> production: OK`.
4. `.\gradlew.bat signingReport` shows `productionRelease` unchanged and `stagingRelease` with no config until a keystore is supplied.

**Not executed by the author:** Gradle, EAS, any Android build, aapt/apksigner. Only the Groovy syntax of `build.gradle` was parsed and the
configuration was checked by tests.
