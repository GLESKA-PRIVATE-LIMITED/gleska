import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import EmployerMobileShell from "./EmployerMobileShell";
import "./employer-dashboard.css";

const sectionTitles: Record<string, string> = {
  "/employer/company-profile": "Company Profile",
  "/employer/workers": "Workers",
  "/employer/attendance": "Attendance",
  "/employer/subscription": "Subscription",
  "/employer/security": "Security & Settings",
  "/employer/help": "Help",
  "/financial": "Financial Agent",
  "/procurement/workspaces": "Procurement",
};

export default function EmployerUnavailableScreen() {
  const { user, isLoading, nextStep } = useAuth();
  const { pathname } = useLocation();

  if (isLoading) return null;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (user.role !== "EMPLOYER") return <Navigate to={user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;

  return <EmployerMobileShell name={user.name} employerType={user.employer_type} profilePhotoUrl={user.profile_photo_url}>
    <main className="employer-dashboard">
      <section className="employer-section-card employer-unavailable-card">
        <p className="employer-eyebrow">Employer workspace</p>
        <h1>{sectionTitles[pathname] || "Employer workspace"}</h1>
        <p>This section is listed in the GLESKA website menu but is not available in the mobile app yet.</p>
        <Link className="employer-primary-button" to="/employer/dashboard">Back to Dashboard</Link>
      </section>
    </main>
  </EmployerMobileShell>;
}
