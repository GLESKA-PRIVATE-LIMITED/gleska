import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
import WorkerOnboardingScreen from "./features/worker/WorkerOnboardingScreen";
import { routeForAuthState } from "./types/auth";

function RootRoute() {
  const { user, nextStep, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (user && nextStep) return <Navigate to={routeForAuthState(user.role, nextStep)} replace />;
  return <Navigate to="/auth/signin" replace />;
}

function DashboardRoute({ role }: { role: "WORKER" | "EMPLOYER" | "ADMIN" }) {
  const { user, nextStep, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user || !nextStep) return <Navigate to="/auth/signin" replace />;
  if (user.role !== role || nextStep !== "DASHBOARD") {
    return <Navigate to={routeForAuthState(user.role, nextStep)} replace />;
  }
  return <AuthenticatedBoundary expectedRole={role} />;
}

function WorkerOnboardingRoute() {
  const { user, nextStep, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user || !nextStep) return <Navigate to="/auth/signin" replace />;
  if (user.role !== "WORKER") return <Navigate to={routeForAuthState(user.role, nextStep)} replace />;
  if (nextStep === "DASHBOARD") return <Navigate to="/worker/dashboard" replace />;
  return <WorkerOnboardingScreen />;
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
  return <Routes>
    <Route path="/" element={<RootRoute />} />
    <Route path="/auth/signin" element={<SignInSelectionScreen />} />
    <Route path="/worker/auth" element={<RoleAuthScreen role="WORKER" />} />
    <Route path="/employer/auth" element={<RoleAuthScreen role="EMPLOYER" />} />
    <Route path="/auth/forgot-password" element={<ForgotPasswordScreen />} />
    <Route path="/auth/reset-password" element={<ResetPasswordScreen />} />
    <Route path="/auth/callback" element={<OAuthCallbackScreen />} />
    <Route path="/worker/onboarding" element={<WorkerOnboardingRoute />} />
    <Route path="/worker/dashboard" element={<DashboardRoute role="WORKER" />} />
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