export function isSubscriptionActive(value?: string | null): boolean {
  return Boolean(value && new Date(value).getTime() > Date.now());
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
