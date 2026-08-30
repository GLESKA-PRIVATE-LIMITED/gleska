import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        // PKCE flow: Authorization Code + Code Verifier exchange for security
        // The callback page (/auth/callback) is the ONLY place that exchanges the code.
        // detectSessionInUrl is DISABLED to avoid competing code exchange attempts.
        //
        // Required Supabase configuration:
        // Authentication → URL Configuration → Redirect URLs:
        //   http://localhost:3000/auth/callback
        //   https://www.goleska.in/auth/callback
        //   https://goleska.in/auth/callback
        //
        // Google OAuth requires redirectTo to match Supabase allowlist exactly.
        flowType: 'pkce',
        detectSessionInUrl: false,  // ✓ Disabled: callback page handles code exchange
        persistSession: true,
        autoRefreshToken: true,
    },
});

export type SupabaseClient = typeof supabase;
