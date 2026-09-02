import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Define protected route prefixes
const WORKER_PROTECTED_PREFIXES = ["/worker/dashboard", "/worker/profile", "/worker/documents", "/worker/onboarding"];
const EMPLOYER_PROTECTED_PREFIXES = ["/employer/dashboard", "/employer/onboarding", "/employer/workers", "/employer/attendance"];

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // If Supabase OAuth redirects to root or any page with ?code=, forward immediately to /auth/callback
  if (searchParams.has("code") && pathname !== "/auth/callback") {
    const callbackUrl = new URL("/auth/callback", request.url);
    callbackUrl.search = request.nextUrl.search;
    return NextResponse.redirect(callbackUrl);
  }

  // Check if current path is a protected worker or employer route
  const isWorkerProtected = WORKER_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isEmployerProtected = EMPLOYER_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!isWorkerProtected && !isEmployerProtected) {
    return NextResponse.next();
  }

  // Inspect cookies for active authentication tokens
  const cookies = request.cookies;
  const hasGoleskaSession = Boolean(cookies.get("goleska_session")?.value);
  const hasGoleskaClientAuth = Boolean(cookies.get("goleska_client_auth")?.value);
  const hasSupabaseAuthToken = Array.from(cookies.getAll()).some(
    (c) => (c.name.startsWith("sb-") && Boolean(c.value)) || c.name === "sb-auth-token"
  );

  const isAuthenticated = hasGoleskaSession || hasGoleskaClientAuth || hasSupabaseAuthToken;

  if (!isAuthenticated) {
    // Redirect unauthenticated request to corresponding auth page
    const targetAuth = isWorkerProtected ? "/worker/auth" : "/employer/auth";
    const redirectUrl = new URL(targetAuth, request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/worker/dashboard/:path*",
    "/worker/profile/:path*",
    "/worker/documents/:path*",
    "/worker/onboarding/:path*",
    "/employer/dashboard/:path*",
    "/employer/onboarding/:path*",
    "/employer/workers/:path*",
    "/employer/attendance/:path*",
  ],
};

