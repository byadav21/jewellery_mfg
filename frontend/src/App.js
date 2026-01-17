import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

// Layout
import MainLayout from './components/layout/MainLayout';

// Auth Pages
import Login from './pages/auth/Login';

// Dashboard
import Dashboard from './pages/dashboard/Dashboard';

// User Management
import UserList from './pages/users/UserList';
import UserForm from './pages/users/UserForm';

// Jobs
import JobList from './pages/jobs/JobList';
import JobDetail from './pages/jobs/JobDetail';
import JobForm from './pages/jobs/JobForm';

// Orders
import OrderList from './pages/orders/OrderList';
import OrderDetail from './pages/orders/OrderDetail';
import ManualOrderForm from './pages/orders/ManualOrderForm';

// CAD
import CADTaskList from './pages/cad/CADTaskList';
import CADReviewList from './pages/cad/CADReviewList';
import CADUpload from './pages/cad/CADUpload';

// Manufacturing
import ManufacturingJobList from './pages/manufacturing/ManufacturingJobList';
import ManufacturingDetail from './pages/manufacturing/ManufacturingDetail';

// Delivery
import DeliveryList from './pages/delivery/DeliveryList';
import DeliveryForm from './pages/delivery/DeliveryForm';

// Dockets
import DocketList from './pages/dockets/DocketList';
import DocketDetails from './pages/dockets/DocketDetails';

// Settings
import Settings from './pages/settings/Settings';

// Notifications
import NotificationLogs from './pages/notifications/NotificationLogs';

// SKU Master
import SkuMasterList from './pages/sku-master/SkuMasterList';

// Marketplace Accounts
import MarketplaceAccountList from './pages/marketplace-accounts/MarketplaceAccountList';

// Activity Logs
import ActivityLogs from './pages/logs/ActivityLogs';

// Loading component
const Loading = () => (
  <div className="spinner-wrapper">
    <div className="spinner-border text-primary" role="status">
      <span className="sr-only">Loading...</span>
    </div>
  </div>
);

// Protected Route component
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { isAuthenticated, loading, hasAnyRole } = useAuth();

  if (loading) {
    return <Loading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !hasAnyRole(allowedRoles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function App() {
  const { loading } = useAuth();

  if (loading) {
    return <Loading />;
  }

  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />

        {/* Protected Routes */}
        <Route path="/" element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }>
          {/* Dashboard */}
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />

          {/* Jobs */}
          <Route path="jobs" element={<JobList />} />
          <Route path="jobs/new" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
              <JobForm />
            </ProtectedRoute>
          } />
          <Route path="jobs/:id" element={<JobDetail />} />

          {/* Orders */}
          <Route path="orders" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
              <OrderList />
            </ProtectedRoute>
          } />
          <Route path="orders/new" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
              <ManualOrderForm />
            </ProtectedRoute>
          } />
          <Route path="orders/:id" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
              <OrderDetail />
            </ProtectedRoute>
          } />

          {/* CAD */}
          <Route path="cad/my-tasks" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin', 'designer']}>
              <CADTaskList />
            </ProtectedRoute>
          } />
          <Route path="cad/reviews" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
              <CADReviewList />
            </ProtectedRoute>
          } />
          <Route path="cad/upload/:jobId" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin', 'designer']}>
              <CADUpload />
            </ProtectedRoute>
          } />

          {/* Manufacturing */}
          <Route path="manufacturing" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin', 'manufacturer']}>
              <ManufacturingJobList />
            </ProtectedRoute>
          } />
          <Route path="manufacturing/:jobId" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin', 'manufacturer']}>
              <ManufacturingDetail />
            </ProtectedRoute>
          } />

          {/* Delivery */}
          <Route path="delivery" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
              <DeliveryList />
            </ProtectedRoute>
          } />
          <Route path="delivery/:jobId" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
              <DeliveryForm />
            </ProtectedRoute>
          } />

          {/* Dockets */}
          <Route path="dockets" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin', 'manufacturer']}>
              <DocketList />
            </ProtectedRoute>
          } />
          <Route path="dockets/:id" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin', 'manufacturer']}>
              <DocketDetails />
            </ProtectedRoute>
          } />

          {/* Users */}
          <Route path="users" element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <UserList />
            </ProtectedRoute>
          } />
          <Route path="users/new" element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <UserForm />
            </ProtectedRoute>
          } />
          <Route path="users/:id/edit" element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <UserForm />
            </ProtectedRoute>
          } />

          {/* Settings */}
          <Route path="settings" element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <Settings />
            </ProtectedRoute>
          } />

          {/* Notifications */}
          <Route path="notifications" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
              <NotificationLogs />
            </ProtectedRoute>
          } />

          {/* SKU Master */}
          <Route path="sku-master" element={
            <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
              <SkuMasterList />
            </ProtectedRoute>
          } />

          {/* Marketplace Accounts */}
          <Route path="marketplace-accounts" element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <MarketplaceAccountList />
            </ProtectedRoute>
          } />

          {/* Activity Logs */}
          <Route path="activity-logs" element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <ActivityLogs />
            </ProtectedRoute>
          } />
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
