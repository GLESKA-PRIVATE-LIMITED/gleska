import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { LanguageProvider } from "./features/auth/LanguageContext";
import {
  AuthenticatedBoundary,
  EmployerOnboardingNotAvailableScreen,
  ForgotPasswordScreen,
  LoadingScreen,
  OAuthCallbackScreen,
  ResetPasswordScreen,
  RoleAuthScreen,
  SignInSelectionScreen,
} from "./features/auth/AuthScreens";
import WorkerDashboardScreen from "./features/worker/WorkerDashboardScreen";
import WorkerMobileShell from "./features/worker/WorkerMobileShell";
import WorkerProfileScreen from "./features/worker/WorkerProfileScreen";
import { workerNavigation } from "./features/worker/workerNavigation";
import { routeForAuthState } from "./types/auth";

function RootRoute() {
  const { user, nextStep, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (user?.role === "WORKER") return <Navigate to="/worker/dashboard" replace />;
  if (user && nextStep) return <Navigate to={routeForAuthState(user.role, nextStep)} replace />;
  return <Navigate to="/auth/signin" replace />;
}

function DashboardRoute({ role }: { role: "WORKER" | "EMPLOYER" | "ADMIN" }) {
  const { user, nextStep, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/auth/signin" replace />;
  if (role === "WORKER") {
    if (user.role !== "WORKER") return <Navigate to={nextStep ? routeForAuthState(user.role, nextStep) : "/auth/signin"} replace />;
    return <WorkerDashboardScreen />;
  }
  if (!nextStep) return <Navigate to="/auth/signin" replace />;
  if (user.role !== role || nextStep !== "DASHBOARD") {
    return <Navigate to={routeForAuthState(user.role, nextStep)} replace />;
  }
  return <AuthenticatedBoundary expectedRole={role} />;
}

function WorkerProfileRoute() {
  const { user, nextStep, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/auth/signin" replace />;
  if (user.role !== "WORKER") return <Navigate to={nextStep ? routeForAuthState(user.role, nextStep) : "/auth/signin"} replace />;
  return <WorkerProfileScreen />;
}

function WorkerRouteUnavailable({ label }: { label: string }) {
  const { user, nextStep, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/auth/signin" replace />;
  if (user.role !== "WORKER") return <Navigate to={nextStep ? routeForAuthState(user.role, nextStep) : "/auth/signin"} replace />;

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

function EmployerOnboardingRoute() {
  const { user, nextStep, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user || !nextStep) return <Navigate to="/auth/signin" replace />;
  if (user.role !== "EMPLOYER") return <Navigate to={routeForAuthState(user.role, nextStep)} replace />;
  if (nextStep === "DASHBOARD") return <Navigate to="/employer/dashboard" replace />;
  return <EmployerOnboardingNotAvailableScreen />;
}

function AppRoutes() {
  const workerRoutes = workerNavigation.map(({ href, label, screen }) => {
    if (screen === "dashboard") return <Route key={href} path={href} element={<DashboardRoute role="WORKER" />} />;
    if (screen === "profile") return <Route key={href} path={href} element={<WorkerProfileRoute />} />;
    return <Route key={href} path={href} element={<WorkerRouteUnavailable label={label} />} />;
  });

  return <Routes>
    <Route path="/" element={<RootRoute />} />
    <Route path="/auth/signin" element={<SignInSelectionScreen />} />
    <Route path="/worker/auth" element={<RoleAuthScreen role="WORKER" />} />
    <Route path="/employer/auth" element={<RoleAuthScreen role="EMPLOYER" />} />
    <Route path="/auth/forgot-password" element={<ForgotPasswordScreen />} />
    <Route path="/auth/reset-password" element={<ResetPasswordScreen />} />
    <Route path="/auth/callback" element={<OAuthCallbackScreen />} />
    <Route path="/worker/onboarding" element={<Navigate to="/worker/dashboard" replace />} />
    {workerRoutes}
    <Route path="/employer/onboarding" element={<EmployerOnboardingRoute />} />
    <Route path="/employer/dashboard" element={<DashboardRoute role="EMPLOYER" />} />
    <Route path="/admin" element={<DashboardRoute role="ADMIN" />} />
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