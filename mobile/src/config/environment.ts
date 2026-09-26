const trimTrailingSlash = (value: string | undefined) => value?.trim().replace(/\/+$/, "") || "";

export const environment = {
  apiBaseUrl: trimTrailingSlash(import.meta.env.VITE_API_BASE_URL),
  supabaseUrl: trimTrailingSlash(import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || "",
  msg91WidgetId: import.meta.env.VITE_MSG91_WIDGET_ID?.trim() || "",
  msg91Token: import.meta.env.VITE_MSG91_TOKEN?.trim() || "",
  oauthRedirectUrl: import.meta.env.VITE_ANDROID_OAUTH_REDIRECT_URL?.trim() || "com.gleska.app://auth/callback",
};

export function missingBackendConfiguration() {
  return !environment.apiBaseUrl;
}

export function missingSupabaseConfiguration() {
  return !environment.supabaseUrl || !environment.supabaseAnonKey;
}

export function missingMsg91Configuration() {
  return !environment.msg91WidgetId || !environment.msg91Token;
}