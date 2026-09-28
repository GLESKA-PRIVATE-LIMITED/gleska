export function isSubscriptionActive(value?: string | null): boolean {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

export function isTrialActive(value?: string | null): boolean {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

export function getTrialDaysRemaining(value?: string | null): number {
  if (!value) return 0;
  const ms = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function subscriptionStatus(value?: string | null): "ACTIVE" | "EXPIRED" {
  return isSubscriptionActive(value) ? "ACTIVE" : "EXPIRED";
}

export function formatSubscriptionExpiry(value?: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export function formatTrialLabel(value?: string | null): string {
  if (!value) return "Trial unavailable";
  return isTrialActive(value) ? "1 Month Free Trial Active" : "1 Month Free Trial Expired";
}
