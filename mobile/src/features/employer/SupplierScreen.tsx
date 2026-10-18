import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { LoadingScreen } from "../auth/AuthScreens";
import ProcurementSupplierScreen, { type SupplierSection } from "./ProcurementSupplierScreen";
import SupplierMobileShell from "./SupplierMobileShell";

export default function SupplierScreen({ section }: { section: SupplierSection }) {
  const { user, isLoading, nextStep } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (user.role !== "EMPLOYER") {
    return <Navigate to={user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  }
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;

  return (
    <SupplierMobileShell>
      <ProcurementSupplierScreen section={section} />
    </SupplierMobileShell>
  );
}
