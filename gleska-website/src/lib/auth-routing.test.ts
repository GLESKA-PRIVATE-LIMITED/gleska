import { describe, expect, it } from "vitest";
import { getRouteForAuthenticatedUser, getRouteForNextStep } from "@/lib/auth-routing";

describe("getRouteForAuthenticatedUser — General Work", () => {
  it("sends onboarded employers to the Hiring dashboard by default", () => {
    expect(getRouteForNextStep("EMPLOYER", "DASHBOARD")).toBe("/employer/dashboard");
    expect(getRouteForAuthenticatedUser("EMPLOYER", "DASHBOARD")).toBe("/employer/dashboard");
  });

  it("sends onboarded employers to the requested General Work page", () => {
    expect(getRouteForAuthenticatedUser("EMPLOYER", "DASHBOARD", "/general-work")).toBe("/general-work");
    expect(getRouteForAuthenticatedUser("EMPLOYER", "DASHBOARD", "/general-work/library")).toBe("/general-work/library");
  });

  it("sends employers who have not finished onboarding through onboarding first", () => {
    expect(getRouteForAuthenticatedUser("EMPLOYER", "EMPLOYER_TYPE_SELECTION", "/general-work")).toBe(
      "/employer/onboarding?next=%2Fgeneral-work",
    );
  });

  it("does not send workers to General Work", () => {
    expect(getRouteForAuthenticatedUser("WORKER", "DASHBOARD", "/general-work")).toBe("/worker/dashboard");
  });
});
