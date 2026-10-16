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

## Validation

```bash
npm run lint
npm run build:worker
npm run build:employer
```
