import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const Sidebar = () => {
  const { user, isSuperAdmin, isAdmin, isDesigner, isManufacturer } = useAuth();
  const location = useLocation();

  // Track which menus are open
  const [openMenus, setOpenMenus] = useState({});

  // Toggle menu open/close
  const toggleMenu = (menuName) => {
    setOpenMenus(prev => ({
      ...prev,
      [menuName]: !prev[menuName]
    }));
  };

  // Check if a menu should be open based on current path
  const isMenuActive = (paths) => {
    return paths.some(path => location.pathname.startsWith(path));
  };

  // Get menu open state (either manually opened or active based on path)
  const isMenuOpen = (menuName, paths) => {
    if (openMenus[menuName] !== undefined) {
      return openMenus[menuName];
    }
    return isMenuActive(paths);
  };

  return (
    <aside className="main-sidebar sidebar-dark-primary elevation-4">
      {/* Brand Logo */}
      <a href="/" className="brand-link">
        <i className="fas fa-gem brand-image ml-3" style={{ fontSize: '1.5rem' }}></i>
        <span className="brand-text font-weight-light ml-2">JM Tool</span>
      </a>

      {/* Sidebar */}
      <div className="sidebar">
        {/* User panel */}
        <div className="user-panel mt-3 pb-3 mb-3 d-flex">
          <div className="image">
            <i className="fas fa-user-circle text-light" style={{ fontSize: '2rem' }}></i>
          </div>
          <div className="info">
            <span className="d-block text-light">{user?.name}</span>
            <small className="text-muted">
              {user?.roles?.map(r => r.displayName || r.name).join(', ')}
            </small>
          </div>
        </div>

        {/* Sidebar Menu */}
        <nav className="mt-2">
          <ul className="nav nav-pills nav-sidebar flex-column" role="menu">

            {/* Dashboard */}
            <li className="nav-item">
              <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <i className="nav-icon fas fa-tachometer-alt"></i>
                <p>Dashboard</p>
              </NavLink>
            </li>

            {/* Jobs */}
            <li className="nav-item">
              <NavLink to="/jobs" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <i className="nav-icon fas fa-briefcase"></i>
                <p>Jobs</p>
              </NavLink>
            </li>

            {/* Orders - Admin only */}
            {isAdmin() && (
              <li className={`nav-item ${isMenuOpen('orders', ['/orders']) ? 'menu-open' : ''}`}>
                <a
                  href="#!"
                  className={`nav-link ${isMenuActive(['/orders']) ? 'active' : ''}`}
                  onClick={(e) => { e.preventDefault(); toggleMenu('orders'); }}
                >
                  <i className="nav-icon fas fa-shopping-cart"></i>
                  <p>
                    Orders
                    <i className={`right fas fa-angle-${isMenuOpen('orders', ['/orders']) ? 'down' : 'left'}`}></i>
                  </p>
                </a>
                <ul className="nav nav-treeview" style={{ display: isMenuOpen('orders', ['/orders']) ? 'block' : 'none' }}>
                  <li className="nav-item">
                    <NavLink to="/orders" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>All Orders</p>
                    </NavLink>
                  </li>
                  <li className="nav-item">
                    <NavLink to="/orders/new" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>Manual Order</p>
                    </NavLink>
                  </li>
                </ul>
              </li>
            )}

            {/* CAD - Designer or Admin */}
            {isDesigner() && (
              <li className={`nav-item ${isMenuOpen('cad', ['/cad']) ? 'menu-open' : ''}`}>
                <a
                  href="#!"
                  className={`nav-link ${isMenuActive(['/cad']) ? 'active' : ''}`}
                  onClick={(e) => { e.preventDefault(); toggleMenu('cad'); }}
                >
                  <i className="nav-icon fas fa-pencil-ruler"></i>
                  <p>
                    CAD Design
                    <i className={`right fas fa-angle-${isMenuOpen('cad', ['/cad']) ? 'down' : 'left'}`}></i>
                  </p>
                </a>
                <ul className="nav nav-treeview" style={{ display: isMenuOpen('cad', ['/cad']) ? 'block' : 'none' }}>
                  <li className="nav-item">
                    <NavLink to="/cad/my-tasks" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>My Tasks</p>
                    </NavLink>
                  </li>
                  {isAdmin() && (
                    <li className="nav-item">
                      <NavLink to="/cad/reviews" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                        <i className="far fa-circle nav-icon"></i>
                        <p>Pending Reviews</p>
                      </NavLink>
                    </li>
                  )}
                </ul>
              </li>
            )}

            {/* Manufacturing - Manufacturer or Admin */}
            {(isManufacturer() || isAdmin()) && (
              <li className={`nav-item ${isMenuOpen('manufacturing', ['/manufacturing', '/dockets']) ? 'menu-open' : ''}`}>
                <a
                  href="#!"
                  className={`nav-link ${isMenuActive(['/manufacturing', '/dockets']) ? 'active' : ''}`}
                  onClick={(e) => { e.preventDefault(); toggleMenu('manufacturing'); }}
                >
                  <i className="nav-icon fas fa-industry"></i>
                  <p>
                    Manufacturing
                    <i className={`right fas fa-angle-${isMenuOpen('manufacturing', ['/manufacturing', '/dockets']) ? 'down' : 'left'}`}></i>
                  </p>
                </a>
                <ul className="nav nav-treeview" style={{ display: isMenuOpen('manufacturing', ['/manufacturing', '/dockets']) ? 'block' : 'none' }}>
                  <li className="nav-item">
                    <NavLink to="/manufacturing" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>My Jobs</p>
                    </NavLink>
                  </li>
                  <li className="nav-item">
                    <NavLink to="/dockets" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>Dockets / Challans</p>
                    </NavLink>
                  </li>
                </ul>
              </li>
            )}

            {/* Delivery - Admin only */}
            {isAdmin() && (
              <li className="nav-item">
                <NavLink to="/delivery" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <i className="nav-icon fas fa-truck"></i>
                  <p>Delivery</p>
                </NavLink>
              </li>
            )}

            {/* Notifications - Admin only */}
            {isAdmin() && (
              <li className="nav-item">
                <NavLink to="/notifications" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <i className="nav-icon fas fa-bell"></i>
                  <p>Notifications</p>
                </NavLink>
              </li>
            )}

            {/* SKU Master - Admin only */}
            {isAdmin() && (
              <li className="nav-item">
                <NavLink to="/sku-master" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <i className="nav-icon fas fa-barcode"></i>
                  <p>SKU Master</p>
                </NavLink>
              </li>
            )}

            {/* Users - Super Admin only */}
            {isSuperAdmin() && (
              <li className={`nav-item ${isMenuOpen('users', ['/users']) ? 'menu-open' : ''}`}>
                <a
                  href="#!"
                  className={`nav-link ${isMenuActive(['/users']) ? 'active' : ''}`}
                  onClick={(e) => { e.preventDefault(); toggleMenu('users'); }}
                >
                  <i className="nav-icon fas fa-users"></i>
                  <p>
                    Users
                    <i className={`right fas fa-angle-${isMenuOpen('users', ['/users']) ? 'down' : 'left'}`}></i>
                  </p>
                </a>
                <ul className="nav nav-treeview" style={{ display: isMenuOpen('users', ['/users']) ? 'block' : 'none' }}>
                  <li className="nav-item">
                    <NavLink to="/users" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>All Users</p>
                    </NavLink>
                  </li>
                  <li className="nav-item">
                    <NavLink to="/users/new" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>Add User</p>
                    </NavLink>
                  </li>
                </ul>
              </li>
            )}

            {/* Settings - Super Admin only */}
            {isSuperAdmin() && (
              <li className={`nav-item ${isMenuOpen('settings', ['/settings', '/marketplace-accounts', '/activity-logs']) ? 'menu-open' : ''}`}>
                <a
                  href="#!"
                  className={`nav-link ${isMenuActive(['/settings', '/marketplace-accounts', '/activity-logs']) ? 'active' : ''}`}
                  onClick={(e) => { e.preventDefault(); toggleMenu('settings'); }}
                >
                  <i className="nav-icon fas fa-cog"></i>
                  <p>
                    Settings
                    <i className={`right fas fa-angle-${isMenuOpen('settings', ['/settings', '/marketplace-accounts', '/activity-logs']) ? 'down' : 'left'}`}></i>
                  </p>
                </a>
                <ul className="nav nav-treeview" style={{ display: isMenuOpen('settings', ['/settings', '/marketplace-accounts', '/activity-logs']) ? 'block' : 'none' }}>
                  <li className="nav-item">
                    <NavLink to="/settings" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>General Settings</p>
                    </NavLink>
                  </li>
                  <li className="nav-item">
                    <NavLink to="/marketplace-accounts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>Marketplace Accounts</p>
                    </NavLink>
                  </li>
                  <li className="nav-item">
                    <NavLink to="/activity-logs" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <i className="far fa-circle nav-icon"></i>
                      <p>Activity Logs</p>
                    </NavLink>
                  </li>
                </ul>
              </li>
            )}

          </ul>
        </nav>
      </div>
    </aside>
  );
};

export default Sidebar;
