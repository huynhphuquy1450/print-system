import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, ProtectedRoute } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import AuditPage from './pages/AuditPage.jsx';
import WebhooksPage from './pages/WebhooksPage.jsx';
import StationsPage from './pages/StationsPage.jsx';
import PrintersPage from './pages/PrintersPage.jsx';
import AlertsPage from './pages/AlertsPage.jsx';
import ClientsPage from './pages/ClientsPage.jsx';

function RootRedirect() {
  const { isAuthed } = useAuth();
  return <Navigate to={isAuthed ? '/dashboard' : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/jobs"     element={<JobsPage />} />
        <Route path="/upload"   element={<UploadPage />} />
        <Route path="/audit"    element={<AuditPage />} />
        <Route path="/webhooks" element={<WebhooksPage />} />
        <Route path="/stations" element={<StationsPage />} />
        <Route path="/printers" element={<PrintersPage />} />
        <Route path="/alerts"   element={<AlertsPage />} />
        <Route path="/clients"  element={<ClientsPage />} />
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
