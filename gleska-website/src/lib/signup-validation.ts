export function sanitizeSignupName(value: string): string {
  return value.replace(/[^A-Za-z ]/g, "").replace(/ {2,}/g, " ").replace(/^ /, "");
}

export function isValidSignupName(value: string): boolean {
  return /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(value);
}

export function isValidSignupMobile(value: string): boolean {
  return /^\d{10}$/.test(value);
}

export function getSignupPasswordRequirements(password: string) {
  return {
    minimumLength: password.length >= 8,
    containsLetter: /[A-Za-z]/.test(password),
    containsNumber: /\d/.test(password),
    containsSpecialCharacter: /[^A-Za-z0-9\s]/.test(password),
  };
}

export function isValidSignupPassword(password: string): boolean {
  const requirements = getSignupPasswordRequirements(password);
  return password.length <= 128 && Object.values(requirements).every(Boolean);
}

export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password === confirmPassword;
}
