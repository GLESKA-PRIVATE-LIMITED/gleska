import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { environment, missingSupabaseConfiguration } from "../config/environment";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (missingSupabaseConfiguration()) {
    throw new Error("Supabase is not configured for this build.");
  }

  if (!client) {
    client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  return client;
}