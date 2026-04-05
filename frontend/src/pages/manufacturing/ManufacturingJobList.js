import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { manufacturingAPI, userAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import useDebounce from '../../hooks/useDebounce';

const ManufacturingJobList = () => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [manufacturers, setManufacturers] = useState([]);
  const [filters, setFilters] = useState({
    status: '',
    search: '',
    priority: ''
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });
  const [actionLoading, setActionLoading] = useState(null);
  const { isAdmin, isManufacturer } = useAuth();

  // Bulk selection state
  const [selectedJobs, setSelectedJobs] = useState([]);

  // Bulk status change modal state
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkRemarks, setBulkRemarks] = useState('');
  const [bulkUpdating, setBulkUpdating] = useState(false);

  // Assignment modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignJobId, setAssignJobId] = useState(null);
  const [assignManufacturerId, setAssignManufacturerId] = useState('');
  const [assignDeadline, setAssignDeadline] = useState('');
  const [assignNotes, setAssignNotes] = useState('');

  // Debounce search input
  const debouncedSearch = useDebounce(filters.search, 300);

  // Create effective filters with debounced search
  const effectiveFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch
  }), [filters.status, filters.priority, debouncedSearch]);

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...effectiveFilters
      };

      let response;
      if (isManufacturer() && !isAdmin()) {
        response = await manufacturingAPI.getMyJobs(params);
      } else {
        response = await manufacturingAPI.getPendingAssignment();
      }

      setJobs(response.data.data?.jobs || response.data.jobs || response.data.data || []);
      if (response.data.pagination || response.data.data?.pagination) {
        setPagination(prev => ({ ...prev, ...(response.data.pagination || response.data.data?.pagination) }));
      }
    } catch (error) {
      console.error('Error fetching manufacturing jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, effectiveFilters, isAdmin, isManufacturer]);

  const fetchManufacturers = async () => {
    try {
      const response = await userAPI.getByRole('manufacturer');
      setManufacturers(response.data.data?.users || response.data.users || response.data.data || []);
    } catch (error) {
      console.error('Error fetching manufacturers:', error);
    }
  };

  useEffect(() => {
    fetchJobs();
    if (isAdmin()) {
      fetchManufacturers();
    }
  }, [fetchJobs, isAdmin]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({ status: '', search: '', priority: '' });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Selection handlers
  const handleSelectJob = (jobId) => {
    setSelectedJobs(prev =>
      prev.includes(jobId)
        ? prev.filter(id => id !== jobId)
        : [...prev, jobId]
    );
  };

  const handleSelectAll = () => {
    if (selectedJobs.length === jobs.length) {
      setSelectedJobs([]);
    } else {
      setSelectedJobs(jobs.map(j => j._id));
    }
  };

  // Open assign modal
  const handleOpenAssignModal = (jobId) => {
    setAssignJobId(jobId);
    setAssignManufacturerId('');
    setAssignDeadline('');
    setAssignNotes('');
    setShowAssignModal(true);
  };

  // Handle assignment submit
  const handleAssign = async () => {
    if (!assignManufacturerId) {
      toast.error('Please select a manufacturer');
      return;
    }

    try {
      setActionLoading(assignJobId);
      await manufacturingAPI.assign(assignJobId, {
        manufacturerId: assignManufacturerId,
        deadline: assignDeadline || undefined,
        notes: assignNotes || undefined
      });
      toast.success('Job assigned successfully');
      setShowAssignModal(false);
      fetchJobs();
    } catch (error) {
      toast.error('Failed to assign job');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAccept = async (jobId) => {
    try {
      setActionLoading(jobId);
      await manufacturingAPI.accept(jobId);
      toast.success('Job accepted successfully');
      fetchJobs();
    } catch (error) {
      toast.error('Failed to accept job');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStart = async (jobId) => {
    try {
      setActionLoading(jobId);
      await manufacturingAPI.start(jobId);
      toast.success('Manufacturing started');
      fetchJobs();
    } catch (error) {
      toast.error('Failed to start manufacturing');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReadyForQC = async (jobId) => {
    const remarks = window.prompt('Enter any QC notes (optional):');
    try {
      setActionLoading(jobId);
      await manufacturingAPI.readyForQC(jobId, remarks);
      toast.success('Marked ready for QC');
      fetchJobs();
    } catch (error) {
      toast.error('Failed to update status');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReadyForDelivery = async (jobId) => {
    const remarks = window.prompt('Enter any delivery notes (optional):');
    try {
      setActionLoading(jobId);
      await manufacturingAPI.readyForDelivery(jobId, remarks);
      toast.success('Marked ready for delivery');
      fetchJobs();
    } catch (error) {
      toast.error('Failed to update status');
    } finally {
      setActionLoading(null);
    }
  };

  // Bulk status change
  const handleBulkStatusChange = async () => {
    if (!bulkStatus) {
      toast.error('Please select a status');
      return;
    }

    if (selectedJobs.length === 0) {
      toast.error('No jobs selected');
      return;
    }

    setBulkUpdating(true);
    let successCount = 0;
    let failCount = 0;

    for (const jobId of selectedJobs) {
      try {
        const job = jobs.find(j => j._id === jobId);
        if (!job) continue;

        // Call appropriate API based on status change
        switch (bulkStatus) {
          case 'manufacturing_accepted':
            await manufacturingAPI.accept(jobId);
            break;
          case 'manufacturing_in_progress':
            await manufacturingAPI.start(jobId);
            break;
          case 'manufacturing_ready_qc':
            await manufacturingAPI.readyForQC(jobId, bulkRemarks);
            break;
          case 'manufacturing_ready_delivery':
            await manufacturingAPI.readyForDelivery(jobId, bulkRemarks);
            break;
          default:
            continue;
        }
        successCount++;
      } catch (error) {
        console.error(`Failed to update job ${jobId}:`, error);
        failCount++;
      }
    }

    setBulkUpdating(false);
    setShowBulkStatusModal(false);
    setSelectedJobs([]);
    setBulkStatus('');
    setBulkRemarks('');

    if (successCount > 0) {
      toast.success(`Successfully updated ${successCount} job(s)`);
    }
    if (failCount > 0) {
      toast.warning(`Failed to update ${failCount} job(s)`);
    }

    fetchJobs();
  };

  // Get available status options based on role
  const getAvailableStatusOptions = () => {
    if (isAdmin()) {
      return [
        { value: 'manufacturing_accepted', label: 'Accept Jobs' },
        { value: 'manufacturing_in_progress', label: 'Start Manufacturing' },
        { value: 'manufacturing_ready_qc', label: 'Ready for QC' },
        { value: 'manufacturing_ready_delivery', label: 'Ready for Delivery' }
      ];
    }
    if (isManufacturer()) {
      return [
        { value: 'manufacturing_accepted', label: 'Accept Jobs' },
        { value: 'manufacturing_in_progress', label: 'Start Manufacturing' },
        { value: 'manufacturing_ready_qc', label: 'Ready for QC' }
      ];
    }
    return [];
  };

  const getStatusBadge = (status) => {
    const colors = {
      components_issued: 'info',
      manufacturing_assigned: 'primary',
      manufacturing_accepted: 'primary',
      manufacturing_in_progress: 'warning',
      manufacturing_ready_qc: 'info',
      manufacturing_ready_delivery: 'success',
      ready_for_qc: 'info',
      ready_for_delivery: 'success',
      delivered: 'success'
    };
    return colors[status] || 'secondary';
  };

  const getStatusText = (status) => {
    const texts = {
      components_issued: 'Components Issued',
      manufacturing_assigned: 'Assigned',
      manufacturing_accepted: 'Accepted',
      manufacturing_in_progress: 'In Progress',
      manufacturing_ready_qc: 'Ready for QC',
      manufacturing_ready_delivery: 'Ready for Delivery',
      ready_for_qc: 'Ready for QC',
      ready_for_delivery: 'Ready for Delivery',
      delivered: 'Delivered'
    };
    return texts[status] || status?.replace(/_/g, ' ');
  };

  const getPriorityBadge = (priority) => {
    const colors = {
      low: 'secondary',
      medium: 'info',
      high: 'warning',
      urgent: 'danger'
    };
    return colors[priority] || 'secondary';
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const isOverdue = (dueDate) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  const statistics = {
    pending: jobs.filter(j => j.status === 'components_issued').length,
    assigned: jobs.filter(j => ['manufacturing_assigned', 'manufacturing_accepted'].includes(j.status)).length,
    inProgress: jobs.filter(j => j.status === 'manufacturing_in_progress').length,
    completed: jobs.filter(j => ['manufacturing_ready_qc', 'manufacturing_ready_delivery', 'ready_for_qc', 'ready_for_delivery'].includes(j.status)).length
  };

  return (
    <section className="content">
      <div className="container-fluid pt-3">
        {/* Header */}
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="h3 mb-0">
            {isManufacturer() && !isAdmin() ? 'My Manufacturing Jobs' : 'Manufacturing Management'}
          </h1>
          {selectedJobs.length > 0 && (
            <div className="btn-group">
              <button
                className="btn btn-warning"
                onClick={() => setShowBulkStatusModal(true)}
              >
                <i className="fas fa-exchange-alt mr-1"></i>
                Change Status ({selectedJobs.length})
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedJobs([])}
              >
                <i className="fas fa-times mr-1"></i>
                Clear Selection
              </button>
            </div>
          )}
        </div>

        {/* Statistics Cards */}
        <div className="row">
          <div className="col-lg-3 col-6">
            <div className="small-box bg-info">
              <div className="inner">
                <h3>{statistics.pending}</h3>
                <p>Pending Assignment</p>
              </div>
              <div className="icon">
                <i className="fas fa-inbox"></i>
              </div>
            </div>
          </div>
          <div className="col-lg-3 col-6">
            <div className="small-box bg-primary">
              <div className="inner">
                <h3>{statistics.assigned}</h3>
                <p>Assigned</p>
              </div>
              <div className="icon">
                <i className="fas fa-user-check"></i>
              </div>
            </div>
          </div>
          <div className="col-lg-3 col-6">
            <div className="small-box bg-warning">
              <div className="inner">
                <h3>{statistics.inProgress}</h3>
                <p>In Progress</p>
              </div>
              <div className="icon">
                <i className="fas fa-industry"></i>
              </div>
            </div>
          </div>
          <div className="col-lg-3 col-6">
            <div className="small-box bg-success">
              <div className="inner">
                <h3>{statistics.completed}</h3>
                <p>Completed</p>
              </div>
              <div className="icon">
                <i className="fas fa-check-circle"></i>
              </div>
            </div>
          </div>
        </div>

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
                    placeholder="Job Code, SKU, Product, Customer..."
                    value={filters.search}
                    onChange={handleFilterChange}
                  />
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
                  >
                    <option value="">All Status</option>
                    <option value="components_issued">Pending Assignment</option>
                    <option value="manufacturing_assigned">Assigned</option>
                    <option value="manufacturing_accepted">Accepted</option>
                    <option value="manufacturing_in_progress">In Progress</option>
                    <option value="manufacturing_ready_qc">Ready for QC</option>
                    <option value="manufacturing_ready_delivery">Ready for Delivery</option>
                  </select>
                </div>
              </div>
              <div className="col-md-3">
                <div className="form-group">
                  <label>Priority</label>
                  <select
                    className="form-control"
                    name="priority"
                    value={filters.priority}
                    onChange={handleFilterChange}
                  >
                    <option value="">All Priorities</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div className="col-md-2 d-flex align-items-end">
                <div className="form-group w-100">
                  <button
                    className="btn btn-secondary btn-block"
                    onClick={clearFilters}
                  >
                    <i className="fas fa-times mr-1"></i>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Jobs Table */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              Manufacturing Jobs ({pagination.total || jobs.length})
              {selectedJobs.length > 0 && (
                <span className="badge badge-primary ml-2">{selectedJobs.length} selected</span>
              )}
            </h3>
          </div>
          <div className="card-body table-responsive p-0">
            {loading ? (
              <div className="text-center py-5">
                <div className="spinner-border text-primary" role="status">
                  <span className="sr-only">Loading...</span>
                </div>
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-5 text-muted">
                <i className="fas fa-industry fa-3x mb-3"></i>
                <p>No manufacturing jobs found</p>
              </div>
            ) : (
              <table className="table table-hover text-nowrap">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>
                      <div className="custom-control custom-checkbox">
                        <input
                          type="checkbox"
                          className="custom-control-input"
                          id="selectAll"
                          checked={selectedJobs.length === jobs.length && jobs.length > 0}
                          onChange={handleSelectAll}
                        />
                        <label className="custom-control-label" htmlFor="selectAll"></label>
                      </div>
                    </th>
                    <th>Job Code</th>
                    <th>Product</th>
                    <th>Priority</th>
                    <th>Status</th>
                    {isAdmin() && <th>Manufacturer</th>}
                    <th>Due Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(job => (
                    <tr
                      key={job._id}
                      className={`${isOverdue(job.manufacturingDeadline || job.dueDate) && !['manufacturing_ready_delivery', 'ready_for_delivery', 'delivered'].includes(job.status) ? 'table-danger' : ''} ${selectedJobs.includes(job._id) ? 'table-active' : ''}`}
                    >
                      <td>
                        <div className="custom-control custom-checkbox">
                          <input
                            type="checkbox"
                            className="custom-control-input"
                            id={`select-${job._id}`}
                            checked={selectedJobs.includes(job._id)}
                            onChange={() => handleSelectJob(job._id)}
                          />
                          <label className="custom-control-label" htmlFor={`select-${job._id}`}></label>
                        </div>
                      </td>
                      <td>
                        <Link to={`/manufacturing/${job._id}`}>
                          <strong>{job.jobCode}</strong>
                        </Link>
                      </td>
                      <td>
                        <div>
                          <strong>{job.productName}</strong>
                          {job.sku && <small className="d-block text-muted">{job.sku}</small>}
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-${getPriorityBadge(job.priority)}`}>
                          {job.priority?.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-${getStatusBadge(job.status)}`}>
                          {getStatusText(job.status)}
                        </span>
                      </td>
                      {isAdmin() && (
                        <td>
                          {job.manufacturer ? (
                            <span>{job.manufacturer.name}</span>
                          ) : (
                            <span className="text-muted">Not Assigned</span>
                          )}
                        </td>
                      )}
                      <td>
                        <span className={isOverdue(job.manufacturingDeadline || job.dueDate) && !['manufacturing_ready_delivery', 'ready_for_delivery', 'delivered'].includes(job.status) ? 'text-danger font-weight-bold' : ''}>
                          {formatDate(job.manufacturingDeadline || job.dueDate)}
                          {isOverdue(job.manufacturingDeadline || job.dueDate) && !['manufacturing_ready_delivery', 'ready_for_delivery', 'delivered'].includes(job.status) && (
                            <i className="fas fa-exclamation-triangle text-danger ml-1"></i>
                          )}
                        </span>
                      </td>
                      <td>
                        <div className="btn-group">
                          <Link
                            to={`/manufacturing/${job._id}`}
                            className="btn btn-sm btn-info"
                            title="View Details"
                          >
                            <i className="fas fa-eye"></i>
                          </Link>

                          {/* Admin: Assign job */}
                          {isAdmin() && job.status === 'components_issued' && (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => handleOpenAssignModal(job._id)}
                              disabled={actionLoading === job._id}
                              title="Assign Manufacturer"
                            >
                              {actionLoading === job._id ? (
                                <span className="spinner-border spinner-border-sm"></span>
                              ) : (
                                <i className="fas fa-user-plus"></i>
                              )}
                            </button>
                          )}

                          {/* Manufacturer: Accept job */}
                          {isManufacturer() && job.status === 'manufacturing_assigned' && (
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => handleAccept(job._id)}
                              disabled={actionLoading === job._id}
                              title="Accept Job"
                            >
                              {actionLoading === job._id ? (
                                <span className="spinner-border spinner-border-sm"></span>
                              ) : (
                                <i className="fas fa-check"></i>
                              )}
                            </button>
                          )}

                          {/* Manufacturer: Start work */}
                          {isManufacturer() && job.status === 'manufacturing_accepted' && (
                            <button
                              className="btn btn-sm btn-warning"
                              onClick={() => handleStart(job._id)}
                              disabled={actionLoading === job._id}
                              title="Start Manufacturing"
                            >
                              {actionLoading === job._id ? (
                                <span className="spinner-border spinner-border-sm"></span>
                              ) : (
                                <i className="fas fa-play"></i>
                              )}
                            </button>
                          )}

                          {/* Manufacturer: Ready for QC */}
                          {isManufacturer() && job.status === 'manufacturing_in_progress' && (
                            <button
                              className="btn btn-sm btn-info"
                              onClick={() => handleReadyForQC(job._id)}
                              disabled={actionLoading === job._id}
                              title="Mark Ready for QC"
                            >
                              {actionLoading === job._id ? (
                                <span className="spinner-border spinner-border-sm"></span>
                              ) : (
                                <i className="fas fa-clipboard-check"></i>
                              )}
                            </button>
                          )}

                          {/* Admin/Manufacturer: Ready for delivery */}
                          {['manufacturing_ready_qc', 'ready_for_qc'].includes(job.status) && (
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => handleReadyForDelivery(job._id)}
                              disabled={actionLoading === job._id}
                              title="Mark Ready for Delivery"
                            >
                              {actionLoading === job._id ? (
                                <span className="spinner-border spinner-border-sm"></span>
                              ) : (
                                <i className="fas fa-truck"></i>
                              )}
                            </button>
                          )}

                          {/* Upload production files */}
                          {isManufacturer() && ['manufacturing_in_progress', 'manufacturing_ready_qc', 'ready_for_qc'].includes(job.status) && (
                            <Link
                              to={`/manufacturing/${job._id}`}
                              className="btn btn-sm btn-secondary"
                              title="Upload Files"
                            >
                              <i className="fas fa-upload"></i>
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {pagination.pages > 1 && (
            <div className="card-footer clearfix">
              <ul className="pagination pagination-sm m-0 float-right">
                <li className={`page-item ${pagination.page === 1 ? 'disabled' : ''}`}>
                  <button
                    className="page-link"
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                    disabled={pagination.page === 1}
                  >
                    &laquo;
                  </button>
                </li>
                {[...Array(Math.min(pagination.pages, 5))].map((_, i) => {
                  const pageNum = i + 1;
                  return (
                    <li key={pageNum} className={`page-item ${pagination.page === pageNum ? 'active' : ''}`}>
                      <button
                        className="page-link"
                        onClick={() => setPagination(prev => ({ ...prev, page: pageNum }))}
                      >
                        {pageNum}
                      </button>
                    </li>
                  );
                })}
                <li className={`page-item ${pagination.page === pagination.pages ? 'disabled' : ''}`}>
                  <button
                    className="page-link"
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                    disabled={pagination.page === pagination.pages}
                  >
                    &raquo;
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Bulk Status Change Modal */}
      {showBulkStatusModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-warning">
                <h5 className="modal-title">
                  <i className="fas fa-exchange-alt mr-2"></i>
                  Bulk Status Change
                </h5>
                <button
                  type="button"
                  className="close"
                  onClick={() => setShowBulkStatusModal(false)}
                  disabled={bulkUpdating}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="alert alert-info mb-3">
                  <i className="fas fa-info-circle mr-1"></i>
                  {selectedJobs.length} job(s) selected
                </div>

                <div className="mb-3">
                  <strong>Selected Jobs:</strong>
                  <div className="d-flex flex-wrap mt-2" style={{ gap: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                    {selectedJobs.map(jobId => {
                      const job = jobs.find(j => j._id === jobId);
                      return job ? (
                        <span key={jobId} className="badge badge-secondary">
                          {job.jobCode}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label>New Status</label>
                  <select
                    className="form-control"
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    disabled={bulkUpdating}
                  >
                    <option value="">-- Select Status --</option>
                    {getAvailableStatusOptions().map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Remarks (optional)</label>
                  <textarea
                    className="form-control"
                    rows="2"
                    placeholder="Add any notes..."
                    value={bulkRemarks}
                    onChange={(e) => setBulkRemarks(e.target.value)}
                    disabled={bulkUpdating}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowBulkStatusModal(false)}
                  disabled={bulkUpdating}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={handleBulkStatusChange}
                  disabled={bulkUpdating || !bulkStatus}
                >
                  {bulkUpdating ? (
                    <>
                      <span className="spinner-border spinner-border-sm mr-1"></span>
                      Updating...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-check mr-1"></i>
                      Update Status
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Manufacturer Modal */}
      {showAssignModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-primary text-white">
                <h5 className="modal-title">
                  <i className="fas fa-user-plus mr-2"></i>
                  Assign Manufacturer
                </h5>
                <button
                  type="button"
                  className="close text-white"
                  onClick={() => setShowAssignModal(false)}
                  disabled={actionLoading}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label>Select Manufacturer <span className="text-danger">*</span></label>
                  <select
                    className="form-control"
                    value={assignManufacturerId}
                    onChange={(e) => setAssignManufacturerId(e.target.value)}
                    disabled={actionLoading}
                  >
                    <option value="">-- Select Manufacturer --</option>
                    {manufacturers.map(m => (
                      <option key={m._id} value={m._id}>
                        {m.name} ({m.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Deadline</label>
                  <input
                    type="date"
                    className="form-control"
                    value={assignDeadline}
                    onChange={(e) => setAssignDeadline(e.target.value)}
                    disabled={actionLoading}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>

                <div className="form-group">
                  <label>Notes</label>
                  <textarea
                    className="form-control"
                    rows="2"
                    placeholder="Any special instructions..."
                    value={assignNotes}
                    onChange={(e) => setAssignNotes(e.target.value)}
                    disabled={actionLoading}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAssignModal(false)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAssign}
                  disabled={actionLoading || !assignManufacturerId}
                >
                  {actionLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm mr-1"></span>
                      Assigning...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-check mr-1"></i>
                      Assign
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default ManufacturingJobList;
