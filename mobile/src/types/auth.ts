export type UserRole = "WORKER" | "EMPLOYER" | "ADMIN";
export type AccountType = "BUSINESS" | "INDIVIDUAL";
export type EmployerType = "INDIVIDUAL" | "REGISTERED_BUSINESS" | "REGISTERED_INDUSTRY" | "UNREGISTERED_BUSINESS";

export type NextStep =
  | "DASHBOARD"
  | "EMPLOYER_TYPE_SELECTION"
  | "REGISTERED_INDUSTRY_DETAILS"
  | "REGISTERED_BUSINESS_DETAILS"
  | "UNREGISTERED_BUSINESS_DETAILS"
  | "INDIVIDUAL_DETAILS";

export interface AuthUser {
  id: string;
  name: string;
  mobile?: string | null;
  email?: string | null;
  role: UserRole;
  onboarding_status?: string | null;
  employer_type?: EmployerType | null;
  profile_completed?: boolean;
  is_mobile_verified: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  subscription_valid_until?: string | null;
  profile_photo_url?: string | null;
}

export interface AuthStateResponse {
  success?: boolean;
  user: AuthUser;
  next_step: NextStep;
}

export function routeForAuthState(role: UserRole, nextStep: NextStep): string {
  if (role === "ADMIN") return "/admin";
  if (role === "WORKER") return "/worker/dashboard";
  return nextStep === "DASHBOARD" ? "/employer/dashboard" : "/employer/onboarding";
}