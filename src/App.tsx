import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Sites from "./pages/Sites";
import SiteDetail from "./pages/SiteDetail";
import AssetDetail from "./pages/AssetDetail";
import Topology from "./pages/Topology";
import Observability from "./pages/Observability";
import Alerts from "./pages/Alerts";
import Automation from "./pages/Automation";
import Security from "./pages/Security";
import Mobile from "./pages/Mobile";
import CloudPage from "./pages/CloudPage";
import Reports from "./pages/Reports";
import SettingsPage from "./pages/SettingsPage";
import LoginPage from "./pages/LoginPage";
import StatusPage from "./pages/StatusPage";
import UserManagement from "./pages/UserManagement";
import TenantManagement from "./pages/TenantManagement";
import AuditLog from "./pages/AuditLog";
import AgentDeployment from "./pages/AgentDeployment";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <AppLayout />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
            <Route path="/status" element={<StatusPage />} />
            <Route element={<ProtectedRoutes />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sites" element={<Sites />} />
              <Route path="/sites/:siteCode" element={<SiteDetail />} />
              <Route path="/asset/:assetId" element={<AssetDetail />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/topology" element={<Topology />} />
              <Route path="/observability" element={<Observability />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/automation" element={<Automation />} />
              <Route path="/security" element={<Security />} />
              <Route path="/mobile" element={<Mobile />} />
              <Route path="/cloud" element={<CloudPage />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/users" element={<UserManagement />} />
              <Route path="/tenants" element={<TenantManagement />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/agents" element={<AgentDeployment />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
