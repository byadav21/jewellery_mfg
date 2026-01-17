import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { jobAPI, cadAPI, userAPI, manufacturingAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const API_BASE_URL = process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001';

const JobDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Status change state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [statusRemarks, setStatusRemarks] = useState('');

  // CAD Assignment state
  const [showCadAssignModal, setShowCadAssignModal] = useState(false);
  const [designers, setDesigners] = useState([]);
  const [selectedDesigner, setSelectedDesigner] = useState('');
  const [cadDeadline, setCadDeadline] = useState('');
  const [cadNotes, setCadNotes] = useState('');

  // Manufacturing Assignment state
  const [showMfgAssignModal, setShowMfgAssignModal] = useState(false);
  const [manufacturers, setManufacturers] = useState([]);
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [mfgDeadline, setMfgDeadline] = useState('');
  const [mfgNotes, setMfgNotes] = useState('');

  // User role check
  const userRoles = user?.roles?.map(r => r.name || r) || [];
  const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');


  const fetchJob = useCallback(async () => {
    try {
      setLoading(true);
      const response = await jobAPI.getById(id);
      if (response.data.success) {
        setJob(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching job:', error);
      toast.error('Failed to load job details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchUsers = useCallback(async () => {
    try {
      const [designerRes, manufacturerRes] = await Promise.all([
        userAPI.getByRole('designer'),
        userAPI.getByRole('manufacturer')
      ]);
      if (designerRes.data.success) {
        setDesigners(designerRes.data.data || []);
      }
      if (manufacturerRes.data.success) {
        setManufacturers(manufacturerRes.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }, []);

  useEffect(() => {
    fetchJob();
  }, [id, fetchJob]);

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin, fetchUsers]);

  const handleSubmitForReview = async () => {
    if (!window.confirm('Submit this job for review?')) return;

    try {
      setSubmitting(true);
      await cadAPI.submitForReview(id);
      toast.success('Submitted for review successfully');
      fetchJob();
    } catch (error) {
      toast.error('Failed to submit for review');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (e) => {
    e.preventDefault();
    if (!newStatus) {
      toast.error('Please select a status');
      return;
    }

    try {
      setSubmitting(true);
      await jobAPI.updateStatus(id, newStatus, statusRemarks);
      toast.success('Status updated successfully');
      setShowStatusModal(false);
      setNewStatus('');
      setStatusRemarks('');
      fetchJob();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update status');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCadAssign = async (e) => {
    e.preventDefault();
    if (!selectedDesigner) {
      toast.error('Please select a designer');
      return;
    }

    try {
      setSubmitting(true);
      await cadAPI.assign(id, {
        designerId: selectedDesigner,
        deadline: cadDeadline || undefined,
        notes: cadNotes || undefined
      });
      toast.success('CAD designer assigned successfully');
      setShowCadAssignModal(false);
      setSelectedDesigner('');
      setCadDeadline('');
      setCadNotes('');
      fetchJob();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to assign CAD designer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfgAssign = async (e) => {
    e.preventDefault();
    if (!selectedManufacturer) {
      toast.error('Please select a manufacturer');
      return;
    }

    try {
      setSubmitting(true);
      await manufacturingAPI.assign(id, {
        manufacturerId: selectedManufacturer,
        deadline: mfgDeadline || undefined,
        notes: mfgNotes || undefined
      });
      toast.success('Manufacturer assigned successfully');
      setShowMfgAssignModal(false);
      setSelectedManufacturer('');
      setMfgDeadline('');
      setMfgNotes('');
      fetchJob();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to assign manufacturer');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (date) => {
    if (!date) return '-';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const getStatusBadge = (status) => {
    const badges = {
      new: 'secondary',
      cad_assigned: 'info',
      cad_in_progress: 'primary',
      cad_submitted: 'warning',
      cad_approved: 'success',
      cad_rejected: 'danger',
      components_issued: 'info',
      manufacturing_assigned: 'info',
      manufacturing_accepted: 'primary',
      manufacturing_in_progress: 'primary',
      manufacturing_ready_qc: 'warning',
      manufacturing_ready_delivery: 'success',
      ready_for_pickup: 'success',
      shipped: 'primary',
      delivered: 'success',
      cancelled: 'danger'
    };
    return badges[status] || 'secondary';
  };

  const getStatusText = (status) => {
    const texts = {
      new: 'New',
      cad_assigned: 'CAD Assigned',
      cad_in_progress: 'CAD In Progress',
      cad_submitted: 'CAD Submitted',
      cad_approved: 'CAD Approved',
      cad_rejected: 'CAD Rejected',
      components_issued: 'Components Issued',
      manufacturing_assigned: 'Manufacturing Assigned',
      manufacturing_accepted: 'Manufacturing Accepted',
      manufacturing_in_progress: 'Manufacturing In Progress',
      manufacturing_ready_qc: 'Ready for QC',
      manufacturing_ready_delivery: 'Ready for Delivery',
      ready_for_pickup: 'Ready for Pickup',
      shipped: 'Shipped',
      delivered: 'Delivered',
      cancelled: 'Cancelled'
    };
    return texts[status] || status?.replace(/_/g, ' ');
  };

  const getPriorityBadge = (priority) => {
    const badges = {
      low: 'secondary',
      medium: 'info',
      high: 'warning',
      urgent: 'danger'
    };
    return badges[priority] || 'secondary';
  };

  const getChannelBadge = (channel) => {
    const badges = {
      amazon: 'warning',
      ebay: 'danger',
      manual: 'info'
    };
    return badges[channel] || 'secondary';
  };

  const isOverdue = (dueDate) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  // All available statuses for dropdown
  const allStatuses = [
    'new',
    'cad_assigned',
    'cad_in_progress',
    'cad_submitted',
    'cad_approved',
    'cad_rejected',
    'components_issued',
    'manufacturing_assigned',
    'manufacturing_accepted',
    'manufacturing_in_progress',
    'manufacturing_ready_qc',
    'manufacturing_ready_delivery',
    'ready_for_pickup',
    'shipped',
    'delivered',
    'cancelled'
  ];

  // CAD statuses that designers can change to
  const designerAllowedStatuses = [
    'cad_in_progress',
    'cad_submitted'
  ];

  // Check if current user is the CAD designer for this job
  const isAssignedDesigner = user && job && job.cadDesigner?._id === user._id;
  const canSubmitForReview = isAssignedDesigner &&
    ['cad_in_progress', 'cad_rejected'].includes(job?.status) &&
    job?.cadFiles?.length > 0;

  // Designers can change status if they are assigned and job is in CAD phase
  const designerCanChangeStatus = isAssignedDesigner &&
    ['cad_assigned', 'cad_in_progress', 'cad_rejected'].includes(job?.status);

  if (loading) {
    return (
      <section className="content">
        <div className="container-fluid">
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status">
              <span className="sr-only">Loading...</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!job) {
    return (
      <section className="content">
        <div className="container-fluid">
          <div className="alert alert-warning">
            <h5><i className="icon fas fa-exclamation-triangle"></i> Job Not Found</h5>
            The requested job could not be found.
            <br />
            <Link to="/jobs" className="btn btn-secondary mt-3">
              <i className="fas fa-arrow-left mr-1"></i> Back to Jobs
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">
                Job: {job.jobCode}
              </h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item"><Link to="/jobs">Jobs</Link></li>
                <li className="breadcrumb-item active">{job.jobCode}</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <section className="content">
        <div className="container-fluid">
          {/* Back Button and Actions */}
          <div className="mb-3 d-flex justify-content-between flex-wrap">
            <button className="btn btn-secondary mb-2" onClick={() => navigate(-1)}>
              <i className="fas fa-arrow-left mr-1"></i> Back
            </button>
            <div className="d-flex flex-wrap">
              {/* Admin actions */}
              {isAdmin && (
                <>
                  <button
                    className="btn btn-warning mr-2 mb-2"
                    onClick={() => setShowStatusModal(true)}
                  >
                    <i className="fas fa-exchange-alt mr-1"></i> Change Status
                  </button>
                  <button
                    className="btn btn-info mr-2 mb-2"
                    onClick={() => setShowCadAssignModal(true)}
                  >
                    <i className="fas fa-pencil-ruler mr-1"></i> Assign CAD Designer
                  </button>
                  <button
                    className="btn btn-success mr-2 mb-2"
                    onClick={() => setShowMfgAssignModal(true)}
                  >
                    <i className="fas fa-industry mr-1"></i> Assign Manufacturer
                  </button>
                </>
              )}
              {/* Designer can change CAD status */}
              {!isAdmin && designerCanChangeStatus && (
                <button
                  className="btn btn-warning mr-2 mb-2"
                  onClick={() => setShowStatusModal(true)}
                >
                  <i className="fas fa-exchange-alt mr-1"></i> Change CAD Status
                </button>
              )}
              {(isAssignedDesigner || isAdmin) && (
                <Link to={`/cad/upload/${job._id}`} className="btn btn-primary mr-2 mb-2">
                  <i className="fas fa-upload mr-1"></i> Upload CAD Files
                </Link>
              )}
              {canSubmitForReview && (
                <button
                  className="btn btn-success mb-2"
                  onClick={handleSubmitForReview}
                  disabled={submitting}
                >
                  {submitting ? (
                    <><span className="spinner-border spinner-border-sm mr-1"></span> Submitting...</>
                  ) : (
                    <><i className="fas fa-paper-plane mr-1"></i> Submit for Review</>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="row">
            {/* Job Information Card */}
            <div className="col-md-6">
              <div className="card card-primary">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-briefcase mr-2"></i>
                    Job Information
                  </h3>
                </div>
                <div className="card-body">
                  <table className="table table-sm table-borderless">
                    <tbody>
                      <tr>
                        <td className="text-muted" style={{ width: '40%' }}>Job Code:</td>
                        <td><strong>{job.jobCode}</strong></td>
                      </tr>
                      <tr>
                        <td className="text-muted">Status:</td>
                        <td>
                          <span className={`badge badge-${getStatusBadge(job.status)}`}>
                            {getStatusText(job.status)}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Priority:</td>
                        <td>
                          <span className={`badge badge-${getPriorityBadge(job.priority)}`}>
                            {job.priority?.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Channel:</td>
                        <td>
                          <span className={`badge badge-${getChannelBadge(job.channel)}`}>
                            {job.channel?.toUpperCase()}
                          </span>
                          {job.accountCode && (
                            <span className="badge badge-light ml-1">{job.accountCode}</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Created:</td>
                        <td>{formatDate(job.createdAt)}</td>
                      </tr>
                      <tr>
                        <td className="text-muted">Due Date:</td>
                        <td>
                          <span className={isOverdue(job.dueDate) && !['delivered', 'cancelled'].includes(job.status) ? 'text-danger font-weight-bold' : ''}>
                            {formatDate(job.dueDate)}
                            {isOverdue(job.dueDate) && !['delivered', 'cancelled'].includes(job.status) && (
                              <i className="fas fa-exclamation-triangle text-danger ml-1"></i>
                            )}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Product Information Card */}
            <div className="col-md-6">
              <div className="card card-info">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-cube mr-2"></i>
                    Product Information
                  </h3>
                </div>
                <div className="card-body">
                  <table className="table table-sm table-borderless">
                    <tbody>
                      <tr>
                        <td className="text-muted" style={{ width: '40%' }}>SKU:</td>
                        <td><code>{job.sku || '-'}</code></td>
                      </tr>
                      <tr>
                        <td className="text-muted">Product Name:</td>
                        <td>{job.productName || '-'}</td>
                      </tr>
                      <tr>
                        <td className="text-muted">Quantity:</td>
                        <td><strong>{job.quantity || 1}</strong></td>
                      </tr>
                      <tr>
                        <td className="text-muted">Customer:</td>
                        <td>{job.customerName || '-'}</td>
                      </tr>
                      {job.customerRequest && (
                        <tr>
                          <td className="text-muted">Customer Request:</td>
                          <td><em>{job.customerRequest}</em></td>
                        </tr>
                      )}
                      <tr>
                        <td className="text-muted">CAD Required:</td>
                        <td>
                          {job.cadRequired ? (
                            <span className="badge badge-warning">Yes</span>
                          ) : (
                            <span className="badge badge-success">No</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Has CAD File:</td>
                        <td>
                          {job.hasCadFile ? (
                            <span className="badge badge-success">Yes</span>
                          ) : (
                            <span className="badge badge-danger">No</span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Assigned Users Card */}
          <div className="row">
            <div className="col-md-6">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-users mr-2"></i>
                    Assigned Team
                  </h3>
                </div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-6">
                      <h6 className="text-muted mb-2">CAD Designer</h6>
                      {job.cadDesigner ? (
                        <div className="d-flex align-items-center">
                          <div className="bg-info text-white rounded-circle d-flex align-items-center justify-content-center mr-2" style={{ width: '40px', height: '40px' }}>
                            <i className="fas fa-pencil-ruler"></i>
                          </div>
                          <div>
                            <strong>{job.cadDesigner.name}</strong>
                            <br />
                            <small className="text-muted">{job.cadDesigner.email}</small>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted">Not assigned</span>
                      )}
                      {job.cadAssignedAt && (
                        <small className="d-block text-muted mt-1">
                          Assigned: {formatDate(job.cadAssignedAt)}
                        </small>
                      )}
                    </div>
                    <div className="col-md-6">
                      <h6 className="text-muted mb-2">Manufacturer</h6>
                      {job.manufacturer ? (
                        <div className="d-flex align-items-center">
                          <div className="bg-success text-white rounded-circle d-flex align-items-center justify-content-center mr-2" style={{ width: '40px', height: '40px' }}>
                            <i className="fas fa-industry"></i>
                          </div>
                          <div>
                            <strong>{job.manufacturer.name}</strong>
                            <br />
                            <small className="text-muted">{job.manufacturer.email}</small>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted">Not assigned</span>
                      )}
                      {job.manufacturingAssignedAt && (
                        <small className="d-block text-muted mt-1">
                          Assigned: {formatDate(job.manufacturingAssignedAt)}
                        </small>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* CAD Status Card */}
            <div className="col-md-6">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-drafting-compass mr-2"></i>
                    CAD Status
                  </h3>
                </div>
                <div className="card-body">
                  <table className="table table-sm table-borderless">
                    <tbody>
                      {job.cadDeadline && (
                        <tr>
                          <td className="text-muted" style={{ width: '40%' }}>CAD Deadline:</td>
                          <td>
                            <span className={isOverdue(job.cadDeadline) && !['cad_approved'].includes(job.status) ? 'text-danger font-weight-bold' : ''}>
                              {formatDate(job.cadDeadline)}
                            </span>
                          </td>
                        </tr>
                      )}
                      {job.cadCompletedAt && (
                        <tr>
                          <td className="text-muted">CAD Completed:</td>
                          <td>{formatDate(job.cadCompletedAt)}</td>
                        </tr>
                      )}
                      {job.cadNotes && (
                        <tr>
                          <td className="text-muted">CAD Notes:</td>
                          <td>{job.cadNotes}</td>
                        </tr>
                      )}
                      {job.cadFilePath && (
                        <tr>
                          <td className="text-muted">CAD File:</td>
                          <td>
                            <a
                              href={`${API_BASE_URL}${job.cadFilePath}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-success btn-sm"
                              download
                            >
                              <i className="fas fa-download mr-1"></i> Download STL
                            </a>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Reference Images */}
          {job.referenceImages && job.referenceImages.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <i className="fas fa-images mr-2"></i>
                  Reference Images ({job.referenceImages.length})
                </h3>
              </div>
              <div className="card-body">
                <div className="row">
                  {job.referenceImages.map((img, index) => (
                    <div key={index} className="col-md-2 col-sm-3 col-4 mb-3">
                      <img
                        src={`${API_BASE_URL}${img}`}
                        alt={`Reference ${index + 1}`}
                        className="img-fluid img-thumbnail"
                        style={{ width: '100%', height: '150px', objectFit: 'cover', cursor: 'pointer' }}
                        onClick={() => window.open(`${API_BASE_URL}${img}`, '_blank')}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Related Order */}
          {job.order && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <i className="fas fa-shopping-cart mr-2"></i>
                  Related Order
                </h3>
              </div>
              <div className="card-body">
                <p>
                  <strong>Order ID:</strong>{' '}
                  <Link to={`/orders/${job.order._id || job.order}`}>
                    {job.order.externalOrderId || job.order._id || job.order}
                  </Link>
                </p>
                {job.order.buyerName && (
                  <p><strong>Customer:</strong> {job.order.buyerName}</p>
                )}
                {job.order.orderDate && (
                  <p><strong>Order Date:</strong> {formatDate(job.order.orderDate)}</p>
                )}
              </div>
            </div>
          )}

          {/* Remarks */}
          {job.remarks && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <i className="fas fa-comment mr-2"></i>
                  Remarks
                </h3>
              </div>
              <div className="card-body">
                <p>{job.remarks}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Status Change Modal */}
      {showStatusModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-warning">
                <h5 className="modal-title">
                  <i className="fas fa-exchange-alt mr-2"></i>
                  {isAdmin ? 'Change Job Status' : 'Change CAD Status'}
                </h5>
                <button type="button" className="close" onClick={() => setShowStatusModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleStatusChange}>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Current Status</label>
                    <p>
                      <span className={`badge badge-${getStatusBadge(job.status)}`}>
                        {getStatusText(job.status)}
                      </span>
                    </p>
                  </div>
                  <div className="form-group">
                    <label>New Status <span className="text-danger">*</span></label>
                    <select
                      className="form-control"
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      required
                    >
                      <option value="">Select Status</option>
                      {/* Admins see all statuses, designers see only CAD statuses */}
                      {(isAdmin ? allStatuses : designerAllowedStatuses)
                        .filter(s => s !== job.status)
                        .map(status => (
                          <option key={status} value={status}>
                            {getStatusText(status)}
                          </option>
                        ))
                      }
                    </select>
                    {!isAdmin && (
                      <small className="text-muted">
                        As a designer, you can change status to "In Progress" or "Submitted"
                      </small>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Remarks</label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="Enter remarks for this status change..."
                      value={statusRemarks}
                      onChange={(e) => setStatusRemarks(e.target.value)}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowStatusModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-warning" disabled={submitting}>
                    {submitting ? (
                      <><span className="spinner-border spinner-border-sm mr-1"></span> Updating...</>
                    ) : (
                      <><i className="fas fa-check mr-1"></i> Update Status</>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* CAD Designer Assignment Modal */}
      {showCadAssignModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-info">
                <h5 className="modal-title text-white">
                  <i className="fas fa-pencil-ruler mr-2"></i>
                  Assign CAD Designer
                </h5>
                <button type="button" className="close text-white" onClick={() => setShowCadAssignModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleCadAssign}>
                <div className="modal-body">
                  {job.cadDesigner && (
                    <div className="alert alert-info">
                      <strong>Currently Assigned:</strong> {job.cadDesigner.name} ({job.cadDesigner.email})
                    </div>
                  )}
                  <div className="form-group">
                    <label>Select Designer <span className="text-danger">*</span></label>
                    <select
                      className="form-control"
                      value={selectedDesigner}
                      onChange={(e) => setSelectedDesigner(e.target.value)}
                      required
                    >
                      <option value="">Select Designer</option>
                      {designers.map(designer => (
                        <option key={designer._id} value={designer._id}>
                          {designer.name} ({designer.email})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Deadline</label>
                    <input
                      type="datetime-local"
                      className="form-control"
                      value={cadDeadline}
                      onChange={(e) => setCadDeadline(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Notes</label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="Enter notes for the designer..."
                      value={cadNotes}
                      onChange={(e) => setCadNotes(e.target.value)}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowCadAssignModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-info" disabled={submitting}>
                    {submitting ? (
                      <><span className="spinner-border spinner-border-sm mr-1"></span> Assigning...</>
                    ) : (
                      <><i className="fas fa-check mr-1"></i> Assign Designer</>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Manufacturing Assignment Modal */}
      {showMfgAssignModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-success">
                <h5 className="modal-title text-white">
                  <i className="fas fa-industry mr-2"></i>
                  Assign Manufacturer
                </h5>
                <button type="button" className="close text-white" onClick={() => setShowMfgAssignModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleMfgAssign}>
                <div className="modal-body">
                  {job.manufacturer && (
                    <div className="alert alert-success">
                      <strong>Currently Assigned:</strong> {job.manufacturer.name} ({job.manufacturer.email})
                    </div>
                  )}
                  <div className="form-group">
                    <label>Select Manufacturer <span className="text-danger">*</span></label>
                    <select
                      className="form-control"
                      value={selectedManufacturer}
                      onChange={(e) => setSelectedManufacturer(e.target.value)}
                      required
                    >
                      <option value="">Select Manufacturer</option>
                      {manufacturers.map(mfg => (
                        <option key={mfg._id} value={mfg._id}>
                          {mfg.name} ({mfg.email})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Deadline</label>
                    <input
                      type="datetime-local"
                      className="form-control"
                      value={mfgDeadline}
                      onChange={(e) => setMfgDeadline(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Notes</label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="Enter notes for the manufacturer..."
                      value={mfgNotes}
                      onChange={(e) => setMfgNotes(e.target.value)}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowMfgAssignModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-success" disabled={submitting}>
                    {submitting ? (
                      <><span className="spinner-border spinner-border-sm mr-1"></span> Assigning...</>
                    ) : (
                      <><i className="fas fa-check mr-1"></i> Assign Manufacturer</>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default JobDetail;
