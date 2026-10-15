import type { NextStep } from "@/context/AuthContext";

type Role = "WORKER" | "EMPLOYER" | "ADMIN";

const EMPLOYER_AGENT_ROUTES = new Set([
  "/logistics",
  "/tender-filing",
  "/procurement",
  "/procurement/workspaces",
  "/financial",
  "/tender-tracking",
]);

function isRouteOrChild(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function getRouteForNextStep(role: Role, nextStep: NextStep | string | null | undefined): string {
  if (role === "WORKER") {
    return "/worker/dashboard";
  }

  if (role === "EMPLOYER") {
    return nextStep === "DASHBOARD" ? "/" : "/employer/onboarding";
  }

  if (role === "ADMIN") {
    return "/admin";
  }

  return "/";
}

export function getRouteForAuthenticatedUser(
  role: Role,
  nextStep: NextStep | string | null | undefined,
  requestedNext?: string | null,
): string {
  const fallback = getRouteForNextStep(role, nextStep);
  if (!requestedNext) return fallback;

  try {
    if (
      !requestedNext.startsWith("/")
      || requestedNext.startsWith("//")
      || requestedNext.includes("\\")
      || /[\u0000-\u0020\u007f]/.test(requestedNext)
    ) return fallback;

    const parsed = new URL(requestedNext, window.location.origin);
    if (
      parsed.origin !== window.location.origin
      || parsed.username
      || parsed.password
      || parsed.pathname.startsWith("//")
      || parsed.pathname.startsWith("/auth")
      || parsed.pathname.startsWith("/admin")
      || parsed.pathname === "/worker/auth"
      || parsed.pathname === "/employer/auth"
    ) return fallback;

    if (
      role !== "ADMIN"
      && (
        isRouteOrChild(parsed.pathname, "/supplier")
        || isRouteOrChild(parsed.pathname, "/procurement/workspaces")
      )
    ) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (
      role === "EMPLOYER"
      && (
        isRouteOrChild(parsed.pathname, "/procurement")
        || isRouteOrChild(parsed.pathname, "/financial")
      )
    ) {
      return nextStep === "DASHBOARD"
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : `/employer/onboarding?next=${encodeURIComponent(`${parsed.pathname}${parsed.search}${parsed.hash}`)}`;
    }
    if (nextStep !== "DASHBOARD") return fallback;
    if (role === "WORKER" && !parsed.pathname.startsWith("/worker/")) return fallback;
    const isEmployerPage = parsed.pathname.startsWith("/employer/")
      && !isRouteOrChild(parsed.pathname, "/employer/onboarding");
    const isEmployerAgent = [...EMPLOYER_AGENT_ROUTES].some(
      (route) => isRouteOrChild(parsed.pathname, route),
    );
    if (role === "EMPLOYER" && !isEmployerPage && !isEmployerAgent) return fallback;
    if (role === "ADMIN") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
