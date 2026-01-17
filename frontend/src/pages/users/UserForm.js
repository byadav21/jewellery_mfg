import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { userAPI, roleAPI } from '../../services/api';

const UserForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [roles, setRoles] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    employeeId: '',
    roles: [],
    isActive: true
  });
  const [errors, setErrors] = useState({});


  const fetchRoles = useCallback(async () => {
    try {
      const response = await roleAPI.getAll();
      const data = response.data.data || response.data;
      setRoles(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching roles:', error);
      setRoles([]);
    }
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      const response = await userAPI.getById(id);
      const user = response.data.data || response.data.user;
      setFormData({
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
        password: '',
        confirmPassword: '',
        employeeId: user.employeeId || '',
        roles: user.roles?.map(r => r._id || r) || [],
        isActive: user.isActive !== false
      });
    } catch (error) {
      toast.error('Failed to fetch user');
      navigate('/users');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchRoles();
    if (isEdit) {
      fetchUser();
    }
  }, [isEdit, fetchRoles, fetchUser]);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (!isEdit && !formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password && formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (formData.password && formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (formData.roles.length === 0) {
      newErrors.roles = 'At least one role is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    // Clear error when field is modified
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const handleRoleChange = (roleId) => {
    setFormData(prev => {
      const newRoles = prev.roles.includes(roleId)
        ? prev.roles.filter(r => r !== roleId)
        : [...prev.roles, roleId];
      return { ...prev, roles: newRoles };
    });
    if (errors.roles) {
      setErrors(prev => ({ ...prev, roles: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }

    try {
      setSubmitting(true);

      // Convert role IDs to role names for the backend
      const selectedRoleNames = formData.roles.map(roleId => {
        const role = roles.find(r => r._id === roleId);
        return role ? role.name : roleId;
      });

      const submitData = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        roles: selectedRoleNames,
        isActive: formData.isActive
      };

      if (formData.password) {
        submitData.password = formData.password;
      }

      if (isEdit) {
        await userAPI.update(id, submitData);
        // Also update roles separately
        await userAPI.assignRoles(id, selectedRoleNames);
        toast.success('User updated successfully');
      } else {
        await userAPI.create(submitData);
        toast.success('User created successfully');
      }

      navigate('/users');
    } catch (error) {
      const message = error.response?.data?.message || 'Operation failed';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <section className="content">
        <div className="container-fluid pt-3">
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status">
              <span className="sr-only">Loading...</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="content">
      <div className="container-fluid pt-3">
        {/* Header */}
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="h3 mb-0">{isEdit ? 'Edit User' : 'Create User'}</h1>
          <Link to="/users" className="btn btn-secondary">
            <i className="fas fa-arrow-left mr-1"></i> Back to Users
          </Link>
        </div>

        {/* Form */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">User Information</h3>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="card-body">
              <div className="row">
                {/* Name */}
                <div className="col-md-6">
                  <div className="form-group">
                    <label htmlFor="name">
                      Full Name <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      className={`form-control ${errors.name ? 'is-invalid' : ''}`}
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      placeholder="Enter full name"
                    />
                    {errors.name && (
                      <div className="invalid-feedback">{errors.name}</div>
                    )}
                  </div>
                </div>

                {/* Email */}
                <div className="col-md-6">
                  <div className="form-group">
                    <label htmlFor="email">
                      Email <span className="text-danger">*</span>
                    </label>
                    <input
                      type="email"
                      className={`form-control ${errors.email ? 'is-invalid' : ''}`}
                      id="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="Enter email address"
                    />
                    {errors.email && (
                      <div className="invalid-feedback">{errors.email}</div>
                    )}
                  </div>
                </div>

                {/* Phone */}
                <div className="col-md-6">
                  <div className="form-group">
                    <label htmlFor="phone">Phone Number</label>
                    <input
                      type="tel"
                      className="form-control"
                      id="phone"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="Enter phone number"
                    />
                  </div>
                </div>

                {/* Employee ID */}
                <div className="col-md-6">
                  <div className="form-group">
                    <label htmlFor="employeeId">Employee ID</label>
                    <input
                      type="text"
                      className="form-control"
                      id="employeeId"
                      name="employeeId"
                      value={formData.employeeId}
                      onChange={handleChange}
                      placeholder="Enter employee ID"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="col-md-6">
                  <div className="form-group">
                    <label htmlFor="password">
                      Password {!isEdit && <span className="text-danger">*</span>}
                    </label>
                    <input
                      type="password"
                      className={`form-control ${errors.password ? 'is-invalid' : ''}`}
                      id="password"
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      placeholder={isEdit ? 'Leave blank to keep current password' : 'Enter password'}
                    />
                    {errors.password && (
                      <div className="invalid-feedback">{errors.password}</div>
                    )}
                    <small className="text-muted">Minimum 8 characters</small>
                  </div>
                </div>

                {/* Confirm Password */}
                <div className="col-md-6">
                  <div className="form-group">
                    <label htmlFor="confirmPassword">
                      Confirm Password {!isEdit && <span className="text-danger">*</span>}
                    </label>
                    <input
                      type="password"
                      className={`form-control ${errors.confirmPassword ? 'is-invalid' : ''}`}
                      id="confirmPassword"
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      placeholder="Confirm password"
                    />
                    {errors.confirmPassword && (
                      <div className="invalid-feedback">{errors.confirmPassword}</div>
                    )}
                  </div>
                </div>

                {/* Roles */}
                <div className="col-md-12">
                  <div className="form-group">
                    <label>
                      Roles <span className="text-danger">*</span>
                    </label>
                    <div className={`${errors.roles ? 'border border-danger rounded p-2' : ''}`}>
                      <div className="row">
                        {roles.map(role => (
                          <div key={role._id} className="col-md-3 col-sm-6">
                            <div className="form-check">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                id={`role-${role._id}`}
                                checked={formData.roles.includes(role._id)}
                                onChange={() => handleRoleChange(role._id)}
                              />
                              <label className="form-check-label" htmlFor={`role-${role._id}`}>
                                {role.displayName}
                                <small className="d-block text-muted">{role.description}</small>
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {errors.roles && (
                      <small className="text-danger">{errors.roles}</small>
                    )}
                    <small className="text-muted d-block mt-1">
                      Users can have multiple roles (dual-role support)
                    </small>
                  </div>
                </div>

                {/* Status */}
                <div className="col-md-12">
                  <div className="form-group">
                    <div className="custom-control custom-switch">
                      <input
                        type="checkbox"
                        className="custom-control-input"
                        id="isActive"
                        name="isActive"
                        checked={formData.isActive}
                        onChange={handleChange}
                      />
                      <label className="custom-control-label" htmlFor="isActive">
                        Active User
                      </label>
                    </div>
                    <small className="text-muted">Inactive users cannot log in to the system</small>
                  </div>
                </div>
              </div>
            </div>

            <div className="card-footer">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="spinner-border spinner-border-sm mr-1" role="status"></span>
                    Saving...
                  </>
                ) : (
                  <>
                    <i className="fas fa-save mr-1"></i>
                    {isEdit ? 'Update User' : 'Create User'}
                  </>
                )}
              </button>
              <Link to="/users" className="btn btn-default ml-2">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
};

export default UserForm;
