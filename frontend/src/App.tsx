import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';

// Pages
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminProjects from './pages/admin/AdminProjects';
import AdminUsers from './pages/admin/AdminUsers';
import AdminPermissions from './pages/admin/AdminPermissions';
import AdminProjectStatus from './pages/admin/AdminProjectStatus';
import AdminRfi from './pages/admin/AdminRfi';
import AdminSettings from './pages/admin/AdminSettings';
import AdminReports from './pages/admin/AdminReports';
import AdminClients from './pages/admin/AdminClients';
import AdminWeeklyProgress from './pages/admin/AdminWeeklyProgress';
import AdminRfiReport from './pages/admin/AdminRfiReport';
import AdminErrorLog from './pages/admin/AdminErrorLog';
import UserDashboard from './pages/user/UserDashboard';
import UserProjects from './pages/user/UserProjects';
import UserRfi from './pages/user/UserRfi';
import UserSettings from './pages/user/UserSettings';
import ProjectView from './pages/shared/ProjectView';
import NotificationsPage from './pages/dashboard/NotificationsPage';

import { SettingsProvider } from './context/SettingsContext';
import { MessageProvider } from './context/MessageContext';

export default function App() {
  return (
    <SettingsProvider>
      <MessageProvider>
        <AuthProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />

              {/* Admin routes */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requiredRole="admin">
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<AdminDashboard />} />
                <Route path="projects" element={<AdminProjects />} />
                <Route path="status" element={<AdminProjectStatus />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="permissions" element={<AdminPermissions />} />
                <Route path="clients" element={<AdminClients />} />
                <Route path="rfi" element={<AdminRfi />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="reports" element={<AdminReports />} />
                <Route path="weekly-progress" element={<AdminWeeklyProgress />} />
                <Route path="weekly-progress/:projectId/view" element={<AdminWeeklyProgress />} />
                <Route path="weekly-progress/:projectId/edit" element={<AdminWeeklyProgress />} />
                <Route path="rfi-report" element={<AdminRfiReport />} />
                <Route path="rfi-report/:projectId/view" element={<AdminRfiReport />} />
                <Route path="rfi-report/:projectId/edit" element={<AdminRfiReport />} />
                <Route path="error-log" element={<AdminErrorLog />} />
                <Route path="projects/:id" element={<ProjectView />} />
              </Route>

              {/* User routes */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<UserDashboard />} />
                <Route path="projects" element={<UserProjects />} />
                <Route path="rfi" element={<UserRfi />} />
                <Route path="settings" element={<UserSettings />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="projects/:id" element={<ProjectView />} />
              </Route>

              {/* Default redirect */}
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </MessageProvider>
    </SettingsProvider>
  );
}
