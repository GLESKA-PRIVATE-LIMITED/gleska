import type { NextStep } from "@/context/AuthContext";

type Role = "WORKER" | "EMPLOYER" | "ADMIN";

export function getRouteForNextStep(role: Role, nextStep: NextStep | string | null | undefined): string {
  if (role === "WORKER") {
    return nextStep === "DASHBOARD" ? "/worker/dashboard" : "/worker/onboarding";
  }

  if (role === "EMPLOYER") {
    return nextStep === "DASHBOARD" ? "/employer/dashboard" : "/employer/onboarding";
  }

  return "/";
}
