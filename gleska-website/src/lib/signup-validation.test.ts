import { describe, expect, it } from "vitest";
import {
  getSignupPasswordRequirements,
  isValidSignupMobile,
  isValidSignupName,
  isValidSignupPassword,
  passwordsMatch,
  sanitizeSignupName,
} from "@/lib/signup-validation";

describe("individual signup validation", () => {
  it.each([
    ["Samiksha", true],
    ["Samiksha Lone", true],
    ["Rahul Kumar", true],
    ["Samiksha123", false],
    ["Samiksha@Lone", false],
    ["John_Doe", false],
    ["John-Doe", false],
    ["12345", false],
    ["@#$%", false],
    [" Samiksha", false],
    ["Samiksha ", false],
  ])("validates signup name %j", (name, valid) => {
    expect(isValidSignupName(name)).toBe(valid);
  });

  it("sanitizes disallowed name characters while retaining spaces", () => {
    expect(sanitizeSignupName("Samiksha@Lone 123")).toBe("SamikshaLone ");
  });

  it.each([
    ["9876543210", true],
    ["987654321", false],
    ["98765432101", false],
    ["98765abc10", false],
    ["98765-43210", false],
    ["98765 43210", false],
    ["+919876543210", false],
  ])("validates signup mobile %j", (mobile, valid) => {
    expect(isValidSignupMobile(mobile)).toBe(valid);
  });

  it("updates password requirements and enforces the complete policy", () => {
    expect(getSignupPasswordRequirements("abc")).toEqual({
      minimumLength: false,
      containsLetter: true,
      containsNumber: false,
      containsSpecialCharacter: false,
    });
    expect(getSignupPasswordRequirements("abcdefgh")).toEqual({
      minimumLength: true,
      containsLetter: true,
      containsNumber: false,
      containsSpecialCharacter: false,
    });
    expect(getSignupPasswordRequirements("abcdefgh1")).toEqual({
      minimumLength: true,
      containsLetter: true,
      containsNumber: true,
      containsSpecialCharacter: false,
    });
    expect(isValidSignupPassword("abcdefgh1@")).toBe(true);
    expect(isValidSignupPassword("a".repeat(129) + "1!")).toBe(false);
  });

  it("rejects mismatching confirmation passwords", () => {
    expect(passwordsMatch("abcdefgh1@", "abcdefgh1@")).toBe(true);
    expect(passwordsMatch("abcdefgh1@", "abcdefgh1")).toBe(false);
  });
});
