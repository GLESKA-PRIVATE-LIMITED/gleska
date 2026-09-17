import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Define protected route prefixes
const WORKER_PROTECTED_PREFIXES = [
  "/worker/dashboard",
  "/worker/jobs",
  "/worker/attendance",
  "/worker/companies-worked",
  "/worker/profile",
  "/worker/documents",
  "/worker/onboarding",
  "/worker/subscription",
  "/worker/security",
  "/worker/settings",
  "/worker/help",
];
const EMPLOYER_PROTECTED_PREFIXES = ["/employer/dashboard", "/employer/onboarding", "/employer/company-profile", "/employer/director-profile", "/employer/security", "/employer/workers", "/employer/attendance", "/employer/subscription"];
const ADMIN_PROTECTED_PREFIXES = ["/admin"];

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // If Supabase OAuth redirects to root or any page with ?code=, forward immediately to /auth/callback
  if (searchParams.has("code") && pathname !== "/auth/callback") {
    const callbackUrl = new URL("/auth/callback", request.url);
    callbackUrl.search = request.nextUrl.search;
    return NextResponse.redirect(callbackUrl);
  }

  // Check if current path is a protected worker, employer, or admin route
  const isWorkerProtected = WORKER_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isEmployerProtected = EMPLOYER_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isAdminProtected = ADMIN_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  // Exclude /admin/login from protection (it's a public login page for unauthenticated users)
  const isAdminLoginPage = pathname === "/admin/login";

  if (!isWorkerProtected && !isEmployerProtected && !isAdminProtected) {
    return NextResponse.next();
  }

  // Allow /admin/login to be accessed by unauthenticated users
  if (isAdminLoginPage) {
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
    const targetAuth = isAdminProtected ? "/admin/login" : "/auth/signin";
    const redirectUrl = new URL(targetAuth, request.url);
    if (!isAdminProtected) redirectUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/worker/dashboard/:path*",
    "/worker/jobs/:path*",
    "/worker/attendance/:path*",
    "/worker/companies-worked/:path*",
    "/worker/profile/:path*",
    "/worker/documents/:path*",
    "/worker/onboarding/:path*",
    "/worker/subscription/:path*",
    "/worker/security/:path*",
    "/worker/settings/:path*",
    "/worker/help/:path*",
    "/employer/dashboard/:path*",
    "/employer/onboarding/:path*",
    "/employer/company-profile/:path*",
    "/employer/director-profile/:path*",
    "/employer/security/:path*",
    "/employer/workers/:path*",
    "/employer/attendance/:path*",
    "/employer/subscription/:path*",
    "/admin/:path*",
  ],
};

