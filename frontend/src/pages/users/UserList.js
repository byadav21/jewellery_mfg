import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { userAPI, roleAPI } from '../../services/api';
import DataTable from '../../components/common/DataTable';

const UserList = () => {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: '',
    role: '',
    status: ''
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...filters
      };
      const response = await userAPI.getAll(params);
      const data = response.data.data || response.data;
      const usersList = data.users || data || [];
      setUsers(Array.isArray(usersList) ? usersList : []);
      if (data.pagination) {
        setPagination(prev => ({ ...prev, ...data.pagination }));
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, filters]);

  const fetchRoles = async () => {
    try {
      const response = await roleAPI.getAll();
      const data = response.data.data || response.data;
      setRoles(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching roles:', error);
      setRoles([]);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleStatusToggle = async (user) => {
    try {
      if (user.isActive) {
        await userAPI.deactivate(user._id);
        toast.success('User deactivated successfully');
      } else {
        await userAPI.activate(user._id);
        toast.success('User activated successfully');
      }
      fetchUsers();
    } catch (error) {
      toast.error('Failed to update user status');
    }
  };

  const handleDelete = async (userId) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      try {
        await userAPI.delete(userId);
        toast.success('User deleted successfully');
        fetchUsers();
      } catch (error) {
        toast.error('Failed to delete user');
      }
    }
  };

  const handleResetPassword = async (userId) => {
    const newPassword = window.prompt('Enter new password (min 8 characters):');
    if (newPassword && newPassword.length >= 8) {
      try {
        await userAPI.resetPassword(userId, newPassword);
        toast.success('Password reset successfully');
      } catch (error) {
        toast.error('Failed to reset password');
      }
    } else if (newPassword) {
      toast.error('Password must be at least 8 characters');
    }
  };

  const getRoleBadgeColor = (roleName) => {
    const colors = {
      super_admin: 'danger',
      admin: 'primary',
      designer: 'info',
      manufacturer: 'success'
    };
    return colors[roleName] || 'secondary';
  };

  const columns = [
    {
      key: 'name',
      title: 'Name',
      sortable: true,
      render: (name, user) => (
        <div className="d-flex align-items-center">
          <div className="avatar bg-primary text-white rounded-circle d-flex align-items-center justify-content-center mr-2" style={{ width: '35px', height: '35px' }}>
            {name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div>
            <strong>{name}</strong>
            {user.employeeId && (
              <small className="d-block text-muted">{user.employeeId}</small>
            )}
          </div>
        </div>
      )
    },
    {
      key: 'email',
      title: 'Email',
      sortable: true
    },
    {
      key: 'phone',
      title: 'Phone',
      render: (phone) => phone || '-'
    },
    {
      key: 'roles',
      title: 'Roles',
      render: (roles) => (
        <>
          {roles?.map(role => (
            <span
              key={role._id || role}
              className={`badge badge-${getRoleBadgeColor(role.name || role)} mr-1`}
            >
              {role.displayName || role.name || role}
            </span>
          ))}
        </>
      )
    },
    {
      key: 'isActive',
      title: 'Status',
      sortable: true,
      render: (isActive) => (
        <span className={`badge badge-${isActive ? 'success' : 'danger'}`}>
          {isActive ? 'Active' : 'Inactive'}
        </span>
      )
    },
    {
      key: 'createdAt',
      title: 'Created',
      sortable: true,
      render: (createdAt) => new Date(createdAt).toLocaleDateString()
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_, user) => (
        <div className="btn-group">
          <Link
            to={`/users/${user._id}/edit`}
            className="btn btn-sm btn-info"
            title="Edit"
          >
            <i className="fas fa-edit"></i>
          </Link>
          <button
            className={`btn btn-sm ${user.isActive ? 'btn-warning' : 'btn-success'}`}
            onClick={() => handleStatusToggle(user)}
            title={user.isActive ? 'Deactivate' : 'Activate'}
          >
            <i className={`fas fa-${user.isActive ? 'ban' : 'check'}`}></i>
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => handleResetPassword(user._id)}
            title="Reset Password"
          >
            <i className="fas fa-key"></i>
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => handleDelete(user._id)}
            title="Delete"
          >
            <i className="fas fa-trash"></i>
          </button>
        </div>
      )
    }
  ];

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">User Management</h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item active">Users</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <section className="content">
        <div className="container-fluid">
          {/* Filters */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Filters</h3>
              <div className="card-tools">
                <button type="button" className="btn btn-tool" data-card-widget="collapse">
                  <i className="fas fa-minus"></i>
                </button>
              </div>
            </div>
            <div className="card-body">
              <div className="row">
                <div className="col-md-4">
                  <div className="form-group">
                    <label>Search</label>
                    <input
                      type="text"
                      className="form-control"
                      name="search"
                      placeholder="Name, email, phone..."
                      value={filters.search}
                      onChange={handleFilterChange}
                    />
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="form-group">
                    <label>Role</label>
                    <select
                      className="form-control"
                      name="role"
                      value={filters.role}
                      onChange={handleFilterChange}
                      style={{ backgroundColor: '#fff', color: '#495057' }}
                    >
                      <option value="">All Roles</option>
                      {roles.map(role => (
                        <option key={role._id} value={role.name}>{role.displayName}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="form-group">
                    <label>Status</label>
                    <select
                      className="form-control"
                      name="status"
                      value={filters.status}
                      onChange={handleFilterChange}
                      style={{ backgroundColor: '#fff', color: '#495057' }}
                    >
                      <option value="">All Status</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
                <div className="col-md-2 d-flex align-items-end">
                  <div className="form-group">
                    <button
                      className="btn btn-secondary btn-block"
                      onClick={() => {
                        setFilters({ search: '', role: '', status: '' });
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Users Table */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Users</h3>
              <div className="card-tools">
                <Link to="/users/new" className="btn btn-primary btn-sm">
                  <i className="fas fa-plus mr-1"></i> Add User
                </Link>
              </div>
            </div>
            <div className="card-body">
              <DataTable
                columns={columns}
                data={users}
                pagination={pagination}
                onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
                onLimitChange={(limit) => setPagination(prev => ({ ...prev, limit, page: 1 }))}
                loading={loading}
                emptyMessage="No users found"
                emptyIcon="fas fa-users"
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default UserList;
