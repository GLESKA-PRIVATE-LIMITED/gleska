import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { LanguageProvider } from "./features/auth/LanguageContext";
import { appRole } from "./config/environment";
import EmployerOnboardingScreen from "./features/employer/EmployerOnboardingScreen";
import EmployerDashboardScreen from "./features/employer/EmployerDashboardScreen";
import EmployerHelpScreen from "./features/employer/EmployerHelpScreen";
import EmployerUnavailableScreen from "./features/employer/EmployerUnavailableScreen";
import EmployerProfileScreen from "./features/employer/EmployerProfileScreen";
import EmployerDirectorProfileScreen from "./features/employer/EmployerDirectorProfileScreen";
import EmployerAttendanceScreen from "./features/employer/EmployerAttendanceScreen";
import EmployerSubscriptionScreen from "./features/employer/EmployerSubscriptionScreen";
import EmployerSecurityScreen from "./features/employer/EmployerSecurityScreen";
import EmployerWorkersScreen from "./features/employer/EmployerWorkersScreen";
import {
  ForgotPasswordScreen,
  LoadingScreen,
  OAuthCallbackScreen,
  ResetPasswordScreen,
  RoleSelectionScreen,
  RoleAuthScreen,
  WelcomeScreen,
} from "./features/auth/AuthScreens";
import WorkerAttendanceScreen from "./features/worker/WorkerAttendanceScreen";
import WorkerCompaniesWorkedScreen from "./features/worker/WorkerCompaniesWorkedScreen";
import WorkerDashboardScreen from "./features/worker/WorkerDashboardScreen";
import WorkerDocumentsScreen from "./features/worker/WorkerDocumentsScreen";
import WorkerMobileShell from "./features/worker/WorkerMobileShell";
import WorkerProfileScreen from "./features/worker/WorkerProfileScreen";
import WorkerSubscriptionScreen from "./features/worker/WorkerSubscriptionScreen";
import WorkerSettingsSecurityScreen from "./features/worker/WorkerSettingsSecurityScreen";
import WorkerHelpScreen from "./features/worker/WorkerHelpScreen";
import WorkerJobsScreen from "./features/worker/WorkerJobsScreen";
import WorkerJobDetailsScreen from "./features/worker/WorkerJobDetailsScreen";
import { workerNavigation } from "./features/worker/workerNavigation";
import { routeForAuthState, type NextStep } from "./types/auth";

function authDestination(role: "WORKER" | "EMPLOYER" | "ADMIN", nextStep: NextStep | null) {
  return routeForAuthState(role, nextStep ?? (role === "EMPLOYER" ? "EMPLOYER_TYPE_SELECTION" : "DASHBOARD"));
}

function RootRoute() {
  const { user, isLoading, nextStep } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (user) return <Navigate to={authDestination(user.role, nextStep)} replace />;
  return <WelcomeScreen />;
}

function EmployerDashboardRoute() {
  const { user, isLoading, nextStep } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  const target = authDestination(user.role, nextStep);
  if (user.role !== "EMPLOYER") return <Navigate to={target} replace />;
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;
  return <EmployerDashboardScreen />;
}

function DashboardRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user || user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerDashboardScreen />;
}

function WorkerProfileRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerProfileScreen />;
}

function WorkerAttendanceRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerAttendanceScreen />;
}

function WorkerCompaniesWorkedRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerCompaniesWorkedScreen />;
}

function WorkerDocumentsRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerDocumentsScreen />;
}

function WorkerSubscriptionRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerSubscriptionScreen />;
}

function WorkerSettingsSecurityRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerSettingsSecurityScreen />;
}

function WorkerHelpRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerHelpScreen />;
}

function WorkerJobsRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user || user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerJobsScreen />;
}

function WorkerJobDetailsRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user || user.role !== "WORKER") return <Navigate to="/" replace />;
  return <WorkerJobDetailsScreen />;
}

function WorkerRouteUnavailable({ label }: { label: string }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user || user.role !== "WORKER") return <Navigate to="/" replace />;

  return <WorkerMobileShell>
    <main className="auth-content">
      <section className="auth-card auth-status-card">
        <p className="auth-eyebrow">Worker</p>
        <h1>{label}</h1>
        <p className="auth-description">This section is not available in the mobile app yet.</p>
        <Link className="auth-secondary auth-link-button" to="/worker/dashboard">Back to Dashboard</Link>
      </section>
    </main>
  </WorkerMobileShell>;
}

function AppRoutes() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const workerRoutes = workerNavigation.map(({ href, label, screen }) => {
    if (screen === "dashboard") return <Route key={href} path={href} element={<DashboardRoute />} />;
    if (screen === "jobs") return <Route key={href} path={href} element={<WorkerJobsRoute />} />;
    if (screen === "profile") return <Route key={href} path={href} element={<WorkerProfileRoute />} />;
    if (screen === "attendance") return <Route key={href} path={href} element={<WorkerAttendanceRoute />} />;
    if (screen === "companies-worked") return <Route key={href} path={href} element={<WorkerCompaniesWorkedRoute />} />;
    if (screen === "documents") return <Route key={href} path={href} element={<WorkerDocumentsRoute />} />;
    if (screen === "subscription") return <Route key={href} path={href} element={<WorkerSubscriptionRoute />} />;
    if (screen === "settings-security") return <Route key={href} path={href} element={<WorkerSettingsSecurityRoute />} />;
    if (screen === "help") return <Route key={href} path={href} element={<WorkerHelpRoute />} />;
    return <Route key={href} path={href} element={<WorkerRouteUnavailable label={label} />} />;
  });

  if (isLoading) return <LoadingScreen />;
  if (user && user.role !== appRole) {
    const expectedLabel = appRole === "WORKER" ? "Worker" : "Employer";
    const accountLabel = user.role === "WORKER" ? "worker" : user.role === "EMPLOYER" ? "employer" : "admin";
    return <main className="auth-content">
      <section className="auth-card auth-status-card">
        <p className="auth-eyebrow">{expectedLabel} app</p>
        <h1>Use the {accountLabel} app for this account</h1>
        <p className="auth-description">Worker and employer accounts use separate GLESKA mobile apps. Sign out here and open the app for your account.</p>
        <button className="auth-secondary logout-button" type="button" onClick={() => {
          void logout().then(() => navigate("/", { replace: true }));
        }}>Log out</button>
      </section>
    </main>;
  }

  return <Routes>
    <Route path="/" element={<RootRoute />} />
    <Route path="/auth/role-selection" element={<RoleSelectionScreen />} />
    <Route path="/auth/signin" element={<RoleAuthScreen role={appRole} />} />
    <Route path="/auth/forgot-password" element={<ForgotPasswordScreen />} />
    <Route path="/auth/reset-password" element={<ResetPasswordScreen />} />
    <Route path="/auth/callback" element={<OAuthCallbackScreen />} />
    {appRole === "WORKER" && <>
      <Route path="/worker/auth" element={<RoleAuthScreen role="WORKER" />} />
      <Route path="/worker/jobs/:jobId" element={<WorkerJobDetailsRoute />} />
      <Route path="/worker/settings" element={<Navigate to="/worker/settings-security" replace />} />
      <Route path="/worker/security" element={<Navigate to="/worker/settings-security" replace />} />
      {workerRoutes}
    </>}
    {appRole === "EMPLOYER" && <>
      <Route path="/employer/auth" element={<RoleAuthScreen role="EMPLOYER" />} />
      <Route path="/employer/dashboard" element={<EmployerDashboardRoute />} />
      <Route path="/employer/attendance" element={<EmployerAttendanceScreen />} />
      <Route path="/employer/subscription" element={<EmployerSubscriptionScreen />} />
      <Route path="/employer/security" element={<EmployerSecurityScreen />} />
      <Route path="/employer/help" element={<EmployerHelpScreen />} />
      <Route path="/employer/profile" element={<Navigate to="/employer/company-profile" replace />} />
      <Route path="/employer/company-profile" element={<EmployerProfileScreen />} />
      <Route path="/employer/director-profile" element={<EmployerDirectorProfileScreen />} />
      <Route path="/employer/workers" element={<EmployerWorkersScreen />} />
      <Route path="/employer/onboarding" element={<EmployerOnboardingScreen />} />
      <Route path="/employer/*" element={<EmployerUnavailableScreen />} />
      <Route path="/financial" element={<EmployerUnavailableScreen />} />
      <Route path="/procurement/*" element={<EmployerUnavailableScreen />} />
    </>}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

export default function App() {
  return <AuthProvider>
    <LanguageProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </LanguageProvider>
  </AuthProvider>;
}