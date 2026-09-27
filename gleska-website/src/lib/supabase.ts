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
        // Supabase Authentication > URL Configuration > Redirect URLs:
        //   http://localhost:3000/auth/callback (website development)
        //   http://localhost:5173/auth/callback (mobile browser development)
        //   https://www.goleska.in/auth/callback
        //   https://goleska.in/auth/callback
        //   com.gleska.app://auth/callback (native Android)
        // Keep the Supabase Site URL set to https://www.goleska.in.
        // Google Console Authorized redirect URI (Google -> Supabase), not an app redirect:
        //   https://mcnpjqshcajndscasbwu.supabase.co/auth/v1/callback
        // App redirectTo values must match the Supabase Redirect URLs allowlist exactly.
        flowType: 'pkce',
        detectSessionInUrl: false,  // ✓ Disabled: callback page handles code exchange
        persistSession: true,
        autoRefreshToken: true,
    },
});

export type SupabaseClient = typeof supabase;
