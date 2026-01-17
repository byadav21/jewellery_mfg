import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const Header = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="main-header navbar navbar-expand navbar-white navbar-light">
      {/* Left navbar links */}
      <ul className="navbar-nav">
        <li className="nav-item">
          <a className="nav-link" data-widget="pushmenu" href="#!" role="button">
            <i className="fas fa-bars"></i>
          </a>
        </li>
        <li className="nav-item d-none d-sm-inline-block">
          <span className="nav-link">
            <i className="fas fa-gem mr-2"></i>
            Jewellery Manufacturing Tool
          </span>
        </li>
      </ul>

      {/* Right navbar links */}
      <ul className="navbar-nav ml-auto">
        {/* Notifications Dropdown */}
        <li className="nav-item dropdown">
          <a className="nav-link" data-toggle="dropdown" href="#!">
            <i className="far fa-bell"></i>
            <span className="badge badge-warning navbar-badge">0</span>
          </a>
          <div className="dropdown-menu dropdown-menu-lg dropdown-menu-right">
            <span className="dropdown-item dropdown-header">No new notifications</span>
          </div>
        </li>

        {/* User Dropdown */}
        <li className="nav-item dropdown">
          <a className="nav-link" data-toggle="dropdown" href="#!">
            <i className="far fa-user"></i>
            <span className="ml-2 d-none d-md-inline">{user?.name}</span>
          </a>
          <div className="dropdown-menu dropdown-menu-right">
            <span className="dropdown-item dropdown-header">
              {user?.email}
              <br />
              <small className="text-muted">
                {user?.roles?.map(r => r.displayName).join(', ')}
              </small>
            </span>
            <div className="dropdown-divider"></div>
            <a href="#!" className="dropdown-item" onClick={() => navigate('/profile')}>
              <i className="fas fa-user mr-2"></i> Profile
            </a>
            <div className="dropdown-divider"></div>
            <a href="#!" className="dropdown-item" onClick={handleLogout}>
              <i className="fas fa-sign-out-alt mr-2"></i> Logout
            </a>
          </div>
        </li>

        {/* Fullscreen toggle */}
        <li className="nav-item">
          <a className="nav-link" data-widget="fullscreen" href="#!" role="button">
            <i className="fas fa-expand-arrows-alt"></i>
          </a>
        </li>
      </ul>
    </nav>
  );
};

export default Header;
