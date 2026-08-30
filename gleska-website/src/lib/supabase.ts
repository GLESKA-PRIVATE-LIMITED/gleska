import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        // Use PKCE flow (default in v2). The redirectTo passed in signInWithOAuth
        // must be present in the Supabase Dashboard → Authentication → URL Configuration
        // → Redirect URLs allowlist for both local and production environments:
        //   http://localhost:3000/auth/callback
        //   https://www.goleska.in/auth/callback
        flowType: 'pkce',
        detectSessionInUrl: true,
    },
});

export type SupabaseClient = typeof supabase;
