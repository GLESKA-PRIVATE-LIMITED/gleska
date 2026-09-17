import type { NextStep } from "@/context/AuthContext";

type Role = "WORKER" | "EMPLOYER" | "ADMIN";

export function getRouteForNextStep(role: Role, nextStep: NextStep | string | null | undefined): string {
  if (role === "WORKER") {
    return nextStep === "DASHBOARD" ? "/worker/dashboard" : "/worker/onboarding";
  }

  if (role === "EMPLOYER") {
    return nextStep === "DASHBOARD" ? "/employer/dashboard" : "/employer/onboarding";
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
  if (!requestedNext || nextStep !== "DASHBOARD") return fallback;

  try {
    const parsed = new URL(requestedNext, window.location.origin);
    if (parsed.origin !== window.location.origin || parsed.pathname.startsWith("//")) return fallback;
    if (
      parsed.pathname.startsWith("/auth") ||
      parsed.pathname.startsWith("/admin") ||
      parsed.pathname === "/worker/auth" ||
      parsed.pathname === "/employer/auth"
    ) return fallback;
    if (role === "WORKER" && !parsed.pathname.startsWith("/worker/")) return fallback;
    if (role === "EMPLOYER" && !parsed.pathname.startsWith("/employer/")) return fallback;
    if (role === "ADMIN") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
