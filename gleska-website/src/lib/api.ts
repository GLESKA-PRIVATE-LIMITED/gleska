// API client for making requests to the backend.

import axios from "axios";

declare module "axios" {
  interface AxiosRequestConfig {
    skipSupabaseAuth?: boolean;
  }
}

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (process.env.NODE_ENV === "production" ? "https://gleska.onrender.com" : "http://localhost:8000")
).replace(/\/$/, "");

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add auth token to requests
apiClient.interceptors.request.use(async (config) => {
  if (typeof window !== "undefined" && !config.skipSupabaseAuth) {
    const { supabase } = await import("@/lib/supabase");
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }
  }
  return config;
});

// Handle auth errors without forcing a page reload loop.
// Route-level auth guards should decide whether to redirect based on
// the current page and auth state, rather than redirecting the whole app
// to the public landing page on every 401.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Intentionally avoid window.location redirects here. A redirect on
      // a public page such as / causes a full reload loop when the auth
      // bootstrap request is unauthenticated during initial page load.
    }
    return Promise.reject(error);
  }
);

export default apiClient;
