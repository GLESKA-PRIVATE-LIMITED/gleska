import { useEffect, useRef } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { LanguageProvider } from "./features/auth/LanguageContext";
import {
  ForgotPasswordScreen,
  LoadingScreen,
  OAuthCallbackScreen,
  ResetPasswordScreen,
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
import { workerNavigation } from "./features/worker/workerNavigation";

function RootRoute() {
  const { user, isLoading, logout } = useAuth();
  const isClearingNonWorker = useRef(false);
  useEffect(() => {
    if (user && user.role !== "WORKER" && !isClearingNonWorker.current) {
      isClearingNonWorker.current = true;
      void logout();
    }
  }, [user, logout]);
  if (isLoading) return <LoadingScreen />;
  if (user?.role === "WORKER") return <Navigate to="/worker/dashboard" replace />;
  if (user) return <LoadingScreen />;
  return <WelcomeScreen />;
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
  const workerRoutes = workerNavigation.map(({ href, label, screen }) => {
    if (screen === "dashboard") return <Route key={href} path={href} element={<DashboardRoute />} />;
    if (screen === "profile") return <Route key={href} path={href} element={<WorkerProfileRoute />} />;
    if (screen === "attendance") return <Route key={href} path={href} element={<WorkerAttendanceRoute />} />;
    if (screen === "companies-worked") return <Route key={href} path={href} element={<WorkerCompaniesWorkedRoute />} />;
    if (screen === "documents") return <Route key={href} path={href} element={<WorkerDocumentsRoute />} />;
    if (screen === "subscription") return <Route key={href} path={href} element={<WorkerSubscriptionRoute />} />;
    if (screen === "settings-security") return <Route key={href} path={href} element={<WorkerSettingsSecurityRoute />} />;
    if (screen === "help") return <Route key={href} path={href} element={<WorkerHelpRoute />} />;
    return <Route key={href} path={href} element={<WorkerRouteUnavailable label={label} />} />;
  });

  return <Routes>
    <Route path="/" element={<RootRoute />} />
    <Route path="/worker/auth" element={<RoleAuthScreen role="WORKER" />} />
    <Route path="/auth/signin" element={<RoleAuthScreen role="WORKER" />} />
    <Route path="/auth/forgot-password" element={<ForgotPasswordScreen />} />
    <Route path="/auth/reset-password" element={<ResetPasswordScreen />} />
    <Route path="/auth/callback" element={<OAuthCallbackScreen />} />
    <Route path="/worker/onboarding" element={<Navigate to="/worker/dashboard" replace />} />
    <Route path="/worker/settings" element={<Navigate to="/worker/settings-security" replace />} />
    <Route path="/worker/security" element={<Navigate to="/worker/settings-security" replace />} />
    {workerRoutes}
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