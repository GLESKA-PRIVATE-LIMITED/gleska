import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { LoadingScreen } from "../auth/AuthScreens";
import ProcurementMobileShell from "./ProcurementMobileShell";
import ProcurementBuyerScreen, { type BuyerSection } from "./ProcurementBuyerScreen";
import ProcurementOverviewScreen from "./ProcurementOverviewScreen";

export type ProcurementDestination =
  | "overview"
  | BuyerSection;

export default function ProcurementScreen({
  destination = "overview",
}: {
  destination?: ProcurementDestination;
}) {
  const { user, isLoading, nextStep } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (user.role !== "EMPLOYER") {
    return <Navigate to={user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  }
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;

  return (
    <ProcurementMobileShell>
      {destination === "overview"
        ? <ProcurementOverviewScreen />
        : <ProcurementBuyerScreen section={destination as BuyerSection} />}
    </ProcurementMobileShell>
  );
}
