# GLESKA mobile apps

The mobile source is shared where appropriate, but Android produces two independent apps:

- **GLESKA Worker** (`com.gleska.worker`) has worker-only authentication, navigation, dashboards, and workflows.
- **GLESKA Employer** (`com.gleska.employer`) has employer-only authentication, navigation, dashboards, and workflows.

Each app build selects its own route tree and app-specific OAuth callback. Both use the same configured GLESKA API, Supabase authentication, database, and persisted records. The mobile clients use the authenticated backend API; they do not bypass backend authorization or Supabase RLS.

## Configure

Copy `.env.example` to `.env` and configure the same reachable backend URL, Supabase URL/public anon key, and MSG91 public widget settings used by the website. Do not put service-role credentials in the mobile environment. If `VITE_ANDROID_OAUTH_REDIRECT_URL` is left empty, the build selects the redirect URI for its target.

Add both callback URIs to the Supabase Auth redirect allow-list:

```text
com.gleska.worker://auth/callback
com.gleska.employer://auth/callback
```

For a physical Android device, `VITE_API_BASE_URL` must be reachable from the device; the Android emulator's `localhost` API hostname is mapped to `10.0.2.2`.

## Run and build

```bash
npm run dev:worker
npm run dev:employer
npm run build:worker
npm run build:employer
```

Build and sync the web assets for the selected Android app before building its matching Gradle flavor:

```bash
npm run sync:worker
cd android
.\gradlew.bat assembleWorkerDebug
```

```bash
npm run sync:employer
cd android
.\gradlew.bat assembleEmployerDebug
```

The target-specific Capacitor sync and Gradle product flavors assign distinct Android application IDs, launcher names, and OAuth schemes. Build and sync one target at a time because both target builds write their respective web assets to `dist`.

## Release signing

Debug builds (`assembleWorkerDebug`, `assembleEmployerDebug`) use the Android debug keystore and need no signing setup.

Release builds are signed with the upload key. Its credentials are never committed: `android/app/release-signing.gradle` reads each value from an environment variable first, then from the untracked file `android/keystore.properties`.

| `keystore.properties` key | Environment variable |
| --- | --- |
| `storeFile` | `GLESKA_UPLOAD_STORE_FILE` |
| `storePassword` | `GLESKA_UPLOAD_STORE_PASSWORD` |
| `keyAlias` | `GLESKA_UPLOAD_KEY_ALIAS` |
| `keyPassword` | `GLESKA_UPLOAD_KEY_PASSWORD` |

For a local release build, copy `android/keystore.properties.example` to `android/keystore.properties` and fill it in. Keep the keystore outside the repository and use an absolute `storeFile` path; relative paths resolve against `android/app`. On CI, set the environment variables from the CI secret store and write the keystore to a temporary path. Never echo the values in logs.

```bash
npm run sync:worker
cd android
.\gradlew.bat bundleWorkerRelease
```

Any release task fails at `verifyReleaseSigning` with a list of the missing values, or the missing keystore path, when the configuration is incomplete. The passwords are never printed. `keystore.properties`, `*.jks`, `*.keystore`, `*.p12`, `*.pfx` and `*.pepk` are git-ignored; do not force-add them.

Keep an offline, encrypted backup of the upload keystore and its passwords (for example in the company password manager). Losing the key, or a password leak, means requesting an upload key reset in the Google Play Console. It does not mean generating a new key and changing the build.

## Validation

```bash
npm run lint
npm run build:worker
npm run build:employer
```
