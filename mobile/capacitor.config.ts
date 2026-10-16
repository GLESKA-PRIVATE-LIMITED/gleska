import type { CapacitorConfig } from '@capacitor/cli';

const employerTarget = process.env.CAPACITOR_APP_TARGET === "employer";
const config: CapacitorConfig = {
  appId: employerTarget ? "com.gleska.employer" : "com.gleska.worker",
  appName: employerTarget ? "GLESKA Employer" : "GLESKA Worker",
  webDir: 'dist'
};

export default config;
