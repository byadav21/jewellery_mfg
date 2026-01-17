import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { jobAPI, manufacturingAPI, userAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const API_BASE_URL = process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001';

// Manufacturing workflow stages
const MFG_STAGES = [
  { key: 'components_issued', label: 'Components Issued', icon: 'fas fa-boxes', color: 'info' },
  { key: 'manufacturing_assigned', label: 'Assigned', icon: 'fas fa-user-check', color: 'primary' },
  { key: 'manufacturing_accepted', label: 'Accepted', icon: 'fas fa-thumbs-up', color: 'primary' },
  { key: 'manufacturing_in_progress', label: 'In Progress', icon: 'fas fa-cogs', color: 'warning' },
  { key: 'manufacturing_ready_qc', label: 'Ready for QC', icon: 'fas fa-clipboard-check', color: 'info' },
  { key: 'manufacturing_ready_delivery', label: 'Ready for Delivery', icon: 'fas fa-truck-loading', color: 'success' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup', icon: 'fas fa-box', color: 'success' },
  { key: 'shipped', label: 'Shipped', icon: 'fas fa-shipping-fast', color: 'primary' },
  { key: 'delivered', label: 'Delivered', icon: 'fas fa-check-double', color: 'success' }
];

const ManufacturingDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusHistory, setStatusHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [manufacturingFiles, setManufacturingFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Status change state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [statusRemarks, setStatusRemarks] = useState('');

  // Assignment state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [manufacturers, setManufacturers] = useState([]);
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [assignDeadline, setAssignDeadline] = useState('');
  const [assignNotes, setAssignNotes] = useState('');

  // File upload state
  const [uploading, setUploading] = useState(false);

  // User role check
  const userRoles = user?.roles?.map(r => r.name || r) || [];
  const isSuperAdmin = userRoles.includes('super_admin') || userRoles.includes('admin');
  const isAssignedManufacturer = user && job && job.manufacturer?._id === user._id;


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

  const fetchStatusHistory = useCallback(async () => {
    try {
      setLoadingHistory(true);
      const response = await jobAPI.getHistory(id);
      setStatusHistory(response.data.data || []);
    } catch (error) {
      console.error('Error fetching status history:', error);
    } finally {
      setLoadingHistory(false);
    }
  }, [id]);

  const fetchManufacturingFiles = useCallback(async () => {
    try {
      setLoadingFiles(true);
      const response = await manufacturingAPI.getFiles(id);
      setManufacturingFiles(response.data.data || response.data.files || []);
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoadingFiles(false);
    }
  }, [id]);

  const fetchManufacturers = useCallback(async () => {
    try {
      const response = await userAPI.getByRole('manufacturer');
      setManufacturers(response.data.data || response.data || []);
    } catch (error) {
      console.error('Error fetching manufacturers:', error);
    }
  }, []);

  useEffect(() => {
    fetchJob();
  }, [id, fetchJob]);

  useEffect(() => {
    if (job) {
      fetchStatusHistory();
      fetchManufacturingFiles();
    }
  }, [job?._id, fetchStatusHistory, fetchManufacturingFiles, job]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetchManufacturers();
    }
  }, [isSuperAdmin, fetchManufacturers]);

  // Handle manufacturing actions
  const handleAccept = async () => {
    if (!window.confirm('Accept this manufacturing job?')) return;

    try {
      setSubmitting(true);
      await manufacturingAPI.accept(id);
      toast.success('Job accepted successfully');
      fetchJob();
      fetchStatusHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to accept job');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStart = async () => {
    if (!window.confirm('Start manufacturing for this job?')) return;

    try {
      setSubmitting(true);
      await manufacturingAPI.start(id);
      toast.success('Manufacturing started');
      fetchJob();
      fetchStatusHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to start manufacturing');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReadyForQC = async () => {
    const remarks = window.prompt('Enter any QC notes (optional):');

    try {
      setSubmitting(true);
      await manufacturingAPI.readyForQC(id, remarks);
      toast.success('Marked ready for QC');
      fetchJob();
      fetchStatusHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update status');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReadyForDelivery = async () => {
    const remarks = window.prompt('Enter any delivery notes (optional):');

    try {
      setSubmitting(true);
      await manufacturingAPI.readyForDelivery(id, remarks);
      toast.success('Marked ready for delivery');
      fetchJob();
      fetchStatusHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update status');
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
      fetchStatusHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update status');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssign = async (e) => {
    e.preventDefault();
    if (!selectedManufacturer) {
      toast.error('Please select a manufacturer');
      return;
    }

    try {
      setSubmitting(true);
      await manufacturingAPI.assign(id, {
        manufacturerId: selectedManufacturer,
        deadline: assignDeadline || undefined,
        notes: assignNotes || undefined
      });
      toast.success('Manufacturer assigned successfully');
      setShowAssignModal(false);
      setSelectedManufacturer('');
      setAssignDeadline('');
      setAssignNotes('');
      fetchJob();
      fetchStatusHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to assign manufacturer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      setUploading(true);

      await manufacturingAPI.uploadFiles(id, formData);
      toast.success(`${files.length} file(s) uploaded successfully`);
      fetchManufacturingFiles();
      fetchJob();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to upload files');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Helper functions
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

  const formatShortDate = (date) => {
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
      manufacturing_assigned: 'primary',
      manufacturing_accepted: 'primary',
      manufacturing_in_progress: 'warning',
      manufacturing_ready_qc: 'info',
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

  const isOverdue = (dueDate) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  const checkTATBreach = () => {
    if (!job) return false;
    const now = new Date();

    // Check manufacturing deadline
    if (job.manufacturingDeadline && now > new Date(job.manufacturingDeadline)) {
      if (!['manufacturing_ready_qc', 'manufacturing_ready_delivery', 'ready_for_pickup', 'shipped', 'delivered'].includes(job.status)) {
        return true;
      }
    }

    // Check overall due date
    if (job.dueDate && now > new Date(job.dueDate) && !['delivered', 'cancelled'].includes(job.status)) {
      return true;
    }

    return false;
  };

  // Get passed stages for funnel
  const getPassedStages = () => {
    const passedStatuses = new Set();

    // Add all statuses from history
    statusHistory.forEach(h => {
      if (h.statusFrom) passedStatuses.add(h.statusFrom);
      if (h.statusTo) passedStatuses.add(h.statusTo);
    });

    // Add current status
    if (job?.status) passedStatuses.add(job.status);

    return passedStatuses;
  };

  // Available statuses for dropdown
  const allManufacturingStatuses = [
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

  // Statuses manufacturer can change to
  const manufacturerAllowedStatuses = [
    'manufacturing_accepted',
    'manufacturing_in_progress',
    'manufacturing_ready_qc'
  ];



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

  if (!job) {
    return (
      <section className="content">
        <div className="container-fluid pt-3">
          <div className="alert alert-warning">
            <h5><i className="icon fas fa-exclamation-triangle"></i> Job Not Found</h5>
            The requested manufacturing job could not be found.
            <br />
            <Link to="/manufacturing" className="btn btn-secondary mt-3">
              <i className="fas fa-arrow-left mr-1"></i> Back to Manufacturing
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const passedStages = getPassedStages();
  const hasTATBreach = checkTATBreach();

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">
                <i className="fas fa-industry mr-2"></i>
                Manufacturing: {job.jobCode}
                {hasTATBreach && (
                  <span className="badge badge-danger ml-2">
                    <i className="fas fa-exclamation-triangle mr-1"></i>
                    TAT Breach
                  </span>
                )}
              </h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item"><Link to="/manufacturing">Manufacturing</Link></li>
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
              {isSuperAdmin && (
                <>
                  <button
                    className="btn btn-warning mr-2 mb-2"
                    onClick={() => setShowStatusModal(true)}
                  >
                    <i className="fas fa-exchange-alt mr-1"></i> Change Status
                  </button>
                  <button
                    className="btn btn-primary mr-2 mb-2"
                    onClick={() => setShowAssignModal(true)}
                  >
                    <i className="fas fa-user-plus mr-1"></i> Assign Manufacturer
                  </button>
                </>
              )}

              {/* Manufacturer actions based on current status */}
              {(isAssignedManufacturer || isSuperAdmin) && (
                <>
                  {job.status === 'manufacturing_assigned' && (
                    <button
                      className="btn btn-success mr-2 mb-2"
                      onClick={handleAccept}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <><span className="spinner-border spinner-border-sm mr-1"></span> Accepting...</>
                      ) : (
                        <><i className="fas fa-check mr-1"></i> Accept Job</>
                      )}
                    </button>
                  )}

                  {job.status === 'manufacturing_accepted' && (
                    <button
                      className="btn btn-warning mr-2 mb-2"
                      onClick={handleStart}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <><span className="spinner-border spinner-border-sm mr-1"></span> Starting...</>
                      ) : (
                        <><i className="fas fa-play mr-1"></i> Start Manufacturing</>
                      )}
                    </button>
                  )}

                  {job.status === 'manufacturing_in_progress' && (
                    <button
                      className="btn btn-info mr-2 mb-2"
                      onClick={handleReadyForQC}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <><span className="spinner-border spinner-border-sm mr-1"></span> Updating...</>
                      ) : (
                        <><i className="fas fa-clipboard-check mr-1"></i> Ready for QC</>
                      )}
                    </button>
                  )}

                  {['manufacturing_ready_qc', 'ready_for_qc'].includes(job.status) && (
                    <button
                      className="btn btn-success mr-2 mb-2"
                      onClick={handleReadyForDelivery}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <><span className="spinner-border spinner-border-sm mr-1"></span> Updating...</>
                      ) : (
                        <><i className="fas fa-truck mr-1"></i> Ready for Delivery</>
                      )}
                    </button>
                  )}
                </>
              )}

              {/* View Job Details */}
              <Link to={`/jobs/${job._id}`} className="btn btn-info mb-2">
                <i className="fas fa-eye mr-1"></i> View Full Job
              </Link>
            </div>
          </div>

          {/* Workflow Funnel */}
          <div className="card card-outline card-primary">
            <div className="card-header">
              <h3 className="card-title">
                <i className="fas fa-filter mr-2"></i>
                Manufacturing Workflow
              </h3>
              <div className="card-tools">
                <span className="badge badge-success mr-2">
                  <i className="fas fa-circle mr-1" style={{ fontSize: '8px' }}></i> Completed
                </span>
                <span className="badge badge-primary mr-2">
                  <i className="fas fa-circle mr-1" style={{ fontSize: '8px' }}></i> Current
                </span>
                <span className="badge badge-danger">
                  <i className="fas fa-circle mr-1" style={{ fontSize: '8px' }}></i> TAT Breach
                </span>
              </div>
            </div>
            <div className="card-body">
              <div className="workflow-funnel d-flex flex-wrap align-items-center" style={{ gap: '4px' }}>
                {MFG_STAGES.map((stage, idx) => {
                  const isPassed = passedStages.has(stage.key);
                  const isCurrent = stage.key === job.status;
                  const hasBreach = hasTATBreach && isCurrent;

                  return (
                    <div
                      key={stage.key}
                      className={`funnel-stage d-flex align-items-center px-3 py-2 rounded ${isCurrent ? (hasBreach ? 'bg-danger text-white' : 'bg-primary text-white') :
                        isPassed ? 'bg-success text-white' : 'bg-light text-muted'
                        }`}
                      style={{ fontSize: '13px' }}
                    >
                      <i className={`${stage.icon} mr-2`}></i>
                      <span>{stage.label}</span>
                      {hasBreach && isCurrent && (
                        <i className="fas fa-exclamation-circle ml-2" title="TAT Breach"></i>
                      )}
                      {idx < MFG_STAGES.length - 1 && (
                        <i className="fas fa-chevron-right ml-2 text-muted" style={{ opacity: 0.5 }}></i>
                      )}
                    </div>
                  );
                })}
              </div>
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
                        <td className="text-muted">Product:</td>
                        <td>{job.productName || '-'}</td>
                      </tr>
                      <tr>
                        <td className="text-muted">SKU:</td>
                        <td><code>{job.sku || '-'}</code></td>
                      </tr>
                      <tr>
                        <td className="text-muted">Quantity:</td>
                        <td><strong>{job.quantity || 1}</strong></td>
                      </tr>
                      {job.customerName && (
                        <tr>
                          <td className="text-muted">Customer:</td>
                          <td>{job.customerName}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Manufacturing Status Card */}
            <div className="col-md-6">
              <div className={`card ${hasTATBreach ? 'card-danger' : 'card-success'}`}>
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-industry mr-2"></i>
                    Manufacturing Status
                  </h3>
                </div>
                <div className="card-body">
                  <table className="table table-sm table-borderless">
                    <tbody>
                      <tr>
                        <td className="text-muted" style={{ width: '40%' }}>Assigned To:</td>
                        <td>
                          {job.manufacturer ? (
                            <div>
                              <strong>{job.manufacturer.name}</strong>
                              <br />
                              <small className="text-muted">{job.manufacturer.email}</small>
                            </div>
                          ) : (
                            <span className="text-muted">Not assigned</span>
                          )}
                        </td>
                      </tr>
                      {job.manufacturingAssignedAt && (
                        <tr>
                          <td className="text-muted">Assigned At:</td>
                          <td>{formatDate(job.manufacturingAssignedAt)}</td>
                        </tr>
                      )}
                      <tr>
                        <td className="text-muted">Manufacturing Deadline:</td>
                        <td>
                          {job.manufacturingDeadline ? (
                            <span className={isOverdue(job.manufacturingDeadline) && !['manufacturing_ready_delivery', 'ready_for_pickup', 'shipped', 'delivered'].includes(job.status) ? 'text-danger font-weight-bold' : ''}>
                              {formatDate(job.manufacturingDeadline)}
                              {isOverdue(job.manufacturingDeadline) && !['manufacturing_ready_delivery', 'ready_for_pickup', 'shipped', 'delivered'].includes(job.status) && (
                                <i className="fas fa-exclamation-triangle text-danger ml-1"></i>
                              )}
                            </span>
                          ) : '-'}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Overall Due Date:</td>
                        <td>
                          <span className={isOverdue(job.dueDate) && !['delivered', 'cancelled'].includes(job.status) ? 'text-danger font-weight-bold' : ''}>
                            {formatDate(job.dueDate)}
                            {isOverdue(job.dueDate) && !['delivered', 'cancelled'].includes(job.status) && (
                              <i className="fas fa-exclamation-triangle text-danger ml-1"></i>
                            )}
                          </span>
                        </td>
                      </tr>
                      {job.manufacturingNotes && (
                        <tr>
                          <td className="text-muted">Notes:</td>
                          <td>{job.manufacturingNotes}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* CAD Files Card - if available */}
          {(job.cadFilePath || job.cadFiles?.length > 0) && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <i className="fas fa-cube mr-2"></i>
                  CAD Files
                </h3>
              </div>
              <div className="card-body">
                {job.cadFilePath && (
                  <a
                    href={`${API_BASE_URL}${job.cadFilePath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-success mr-2 mb-2"
                    download
                  >
                    <i className="fas fa-download mr-1"></i>
                    Download STL File
                  </a>
                )}
                {job.cadFiles?.map((file, idx) => (
                  <a
                    key={idx}
                    href={`${API_BASE_URL}${file.path || file}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-success mr-2 mb-2"
                    download
                  >
                    <i className="fas fa-file mr-1"></i>
                    {file.filename || file.name || `CAD File ${idx + 1}`}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Manufacturing Files Card */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <i className="fas fa-file-upload mr-2"></i>
                Manufacturing Files ({manufacturingFiles.length})
              </h3>
              <div className="card-tools">
                {(isAssignedManufacturer || isSuperAdmin) && ['manufacturing_in_progress', 'manufacturing_ready_qc', 'ready_for_qc'].includes(job.status) && (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      multiple
                      className="d-none"
                      accept=".jpg,.jpeg,.png,.pdf,.stl,.obj,.zip"
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <>
                          <span className="spinner-border spinner-border-sm mr-1"></span>
                          Uploading...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-upload mr-1"></i>
                          Upload Files
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="card-body">
              {loadingFiles ? (
                <div className="text-center py-3">
                  <div className="spinner-border spinner-border-sm text-primary"></div>
                </div>
              ) : manufacturingFiles.length === 0 ? (
                <div className="text-center text-muted py-4">
                  <i className="fas fa-folder-open fa-2x mb-2"></i>
                  <p>No manufacturing files uploaded yet</p>
                  {(isAssignedManufacturer || isSuperAdmin) && ['manufacturing_in_progress', 'manufacturing_ready_qc', 'ready_for_qc'].includes(job.status) && (
                    <button
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      <i className="fas fa-upload mr-1"></i>
                      Upload Files
                    </button>
                  )}
                </div>
              ) : (
                <div className="row">
                  {manufacturingFiles.map((file, idx) => (
                    <div key={idx} className="col-md-3 col-sm-4 col-6 mb-3">
                      <div className="card h-100">
                        <div className="card-body text-center p-2">
                          {file.mimetype?.startsWith('image/') ? (
                            <img
                              src={`${API_BASE_URL}${file.path}`}
                              alt={file.filename}
                              className="img-fluid img-thumbnail mb-2"
                              style={{ maxHeight: '100px', objectFit: 'cover', cursor: 'pointer' }}
                              onClick={() => window.open(`${API_BASE_URL}${file.path}`, '_blank')}
                            />
                          ) : (
                            <div className="py-3">
                              <i className={`fas ${file.mimetype?.includes('pdf') ? 'fa-file-pdf text-danger' : 'fa-file'} fa-3x`}></i>
                            </div>
                          )}
                          <p className="small text-truncate mb-1" title={file.filename}>
                            {file.filename || file.originalname}
                          </p>
                          <a
                            href={`${API_BASE_URL}${file.path}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-sm btn-outline-primary"
                            download
                          >
                            <i className="fas fa-download"></i>
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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

          {/* Status History */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <i className="fas fa-history mr-2"></i>
                Status History
              </h3>
            </div>
            <div className="card-body">
              {loadingHistory ? (
                <div className="text-center py-3">
                  <div className="spinner-border spinner-border-sm text-primary"></div>
                </div>
              ) : statusHistory.length === 0 ? (
                <div className="text-center text-muted py-3">
                  <i className="fas fa-history fa-2x mb-2"></i>
                  <p>No status changes recorded</p>
                </div>
              ) : (
                <div className="timeline">
                  {statusHistory.map((history, idx) => (
                    <div key={idx} className="time-label">
                      <div className="d-flex align-items-center mb-2">
                        <span className={`badge badge-${getStatusBadge(history.statusFrom)} mr-2`}>
                          {getStatusText(history.statusFrom)}
                        </span>
                        <i className="fas fa-arrow-right text-muted mx-2"></i>
                        <span className={`badge badge-${getStatusBadge(history.statusTo)}`}>
                          {getStatusText(history.statusTo)}
                        </span>
                        <small className="text-muted ml-3">
                          {formatShortDate(history.changedAt)}
                        </small>
                        {history.changedBy && (
                          <small className="text-muted ml-2">
                            by {history.changedBy.name || 'System'}
                          </small>
                        )}
                      </div>
                      {history.remarks && (
                        <p className="text-muted mb-0 ml-4">
                          <i className="fas fa-comment mr-1"></i>
                          {history.remarks}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

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
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Status Change Modal */}
      {showStatusModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-warning">
                <h5 className="modal-title">
                  <i className="fas fa-exchange-alt mr-2"></i>
                  Change Status
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
                      {(isSuperAdmin ? allManufacturingStatuses : manufacturerAllowedStatuses)
                        .filter(s => s !== job.status)
                        .map(status => (
                          <option key={status} value={status}>
                            {getStatusText(status)}
                          </option>
                        ))
                      }
                    </select>
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
                <button type="button" className="close text-white" onClick={() => setShowAssignModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleAssign}>
                <div className="modal-body">
                  {job.manufacturer && (
                    <div className="alert alert-info">
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
                      type="datetime-local"
                      className="form-control"
                      value={assignDeadline}
                      onChange={(e) => setAssignDeadline(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Notes</label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="Any special instructions..."
                      value={assignNotes}
                      onChange={(e) => setAssignNotes(e.target.value)}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAssignModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? (
                      <><span className="spinner-border spinner-border-sm mr-1"></span> Assigning...</>
                    ) : (
                      <><i className="fas fa-check mr-1"></i> Assign</>
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

export default ManufacturingDetail;
