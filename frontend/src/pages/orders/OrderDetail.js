import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { orderAPI, auditLogAPI, userAPI, jobAPI } from '../../services/api';

const API_BASE_URL = process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001';

// Job workflow stages for funnel visualization
const JOB_STAGES = [
  { key: 'new', label: 'New', icon: 'fas fa-plus-circle', color: 'secondary' },
  { key: 'cad_assigned', label: 'CAD Assigned', icon: 'fas fa-user-check', color: 'info' },
  { key: 'cad_in_progress', label: 'CAD In Progress', icon: 'fas fa-pencil-ruler', color: 'primary' },
  { key: 'cad_submitted', label: 'CAD Submitted', icon: 'fas fa-paper-plane', color: 'info' },
  { key: 'cad_approved', label: 'CAD Approved', icon: 'fas fa-check-circle', color: 'success' },
  { key: 'cad_rejected', label: 'CAD Rejected', icon: 'fas fa-times-circle', color: 'danger' },
  { key: 'components_issued', label: 'Components Issued', icon: 'fas fa-boxes', color: 'warning' },
  { key: 'manufacturing_assigned', label: 'Mfg Assigned', icon: 'fas fa-industry', color: 'info' },
  { key: 'manufacturing_accepted', label: 'Mfg Accepted', icon: 'fas fa-thumbs-up', color: 'primary' },
  { key: 'manufacturing_in_progress', label: 'Mfg In Progress', icon: 'fas fa-cogs', color: 'primary' },
  { key: 'manufacturing_ready_qc', label: 'Ready for QC', icon: 'fas fa-clipboard-check', color: 'warning' },
  { key: 'manufacturing_ready_delivery', label: 'Ready for Delivery', icon: 'fas fa-truck-loading', color: 'info' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup', icon: 'fas fa-box', color: 'success' },
  { key: 'shipped', label: 'Shipped', icon: 'fas fa-shipping-fast', color: 'primary' },
  { key: 'delivered', label: 'Delivered', icon: 'fas fa-check-double', color: 'success' },
  { key: 'cancelled', label: 'Cancelled', icon: 'fas fa-ban', color: 'danger' }
];

const OrderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [fetchingImages, setFetchingImages] = useState({});

  // Job status history for funnel
  const [jobHistories, setJobHistories] = useState({});
  const [loadingHistories, setLoadingHistories] = useState(false);

  // Assignment state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignType, setAssignType] = useState('cadDesigner');
  const [assignUserId, setAssignUserId] = useState('');
  const [availableUsers, setAvailableUsers] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [usersCache, setUsersCache] = useState({
    designer: [],
    manufacturer: [],
    admin: []
  });


  const fetchOrder = useCallback(async () => {
    try {
      setLoading(true);
      const response = await orderAPI.getById(id);
      if (response.data.success) {
        setOrder(response.data.data.order);
        setItems(response.data.data.items || []);
        setJobs(response.data.data.jobs || []);
      }
    } catch (error) {
      console.error('Error fetching order:', error);
      toast.error('Failed to load order details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchActivityLogs = useCallback(async () => {
    try {
      setLoadingLogs(true);
      const response = await auditLogAPI.getEntityLogs('order', id, { limit: 50 });
      setActivityLogs(response.data.data?.logs || []);
    } catch (error) {
      console.error('Error fetching activity logs:', error);
    } finally {
      setLoadingLogs(false);
    }
  }, [id]);

  // Fetch job status histories for funnel visualization
  const fetchJobHistories = useCallback(async (jobList) => {
    if (!jobList || jobList.length === 0) return;

    setLoadingHistories(true);
    const histories = {};

    for (const job of jobList) {
      try {
        const response = await jobAPI.getHistory(job._id);
        histories[job._id] = response.data.data || [];
      } catch (error) {
        console.error(`Error fetching history for job ${job._id}:`, error);
        histories[job._id] = [];
      }
    }

    setJobHistories(histories);
    setLoadingHistories(false);
  }, []);

  // Fetch job histories when jobs are loaded
  useEffect(() => {
    if (jobs.length > 0) {
      fetchJobHistories(jobs);
    }
  }, [jobs, fetchJobHistories]);

  useEffect(() => {
    fetchOrder();
    fetchActivityLogs();
  }, [id, fetchOrder, fetchActivityLogs]);

  // Check if a job has TAT breach for a specific stage
  const checkTATBreach = (job, stage) => {
    const now = new Date();

    // Check CAD deadline breach
    if (['cad_assigned', 'cad_in_progress'].includes(stage) && job.cadDeadline) {
      if (now > new Date(job.cadDeadline) && !['cad_submitted', 'cad_approved', 'cad_rejected'].includes(job.status)) {
        return true;
      }
    }

    // Check Manufacturing deadline breach
    if (['manufacturing_assigned', 'manufacturing_accepted', 'manufacturing_in_progress'].includes(stage) && job.manufacturingDeadline) {
      if (now > new Date(job.manufacturingDeadline) && !['manufacturing_ready_qc', 'manufacturing_ready_delivery', 'ready_for_pickup', 'shipped', 'delivered'].includes(job.status)) {
        return true;
      }
    }

    // Check overall due date breach
    if (job.dueDate && now > new Date(job.dueDate) && !['delivered', 'cancelled'].includes(job.status)) {
      return true;
    }

    // Check stored TAT breaches
    if (job.tatBreaches && job.tatBreaches.length > 0) {
      return job.tatBreaches.some(b => b.stage === stage);
    }

    return false;
  };

  // Get stage info for a status
  const getStageInfo = (status) => {
    return JOB_STAGES.find(s => s.key === status) || { label: status, icon: 'fas fa-circle', color: 'secondary' };
  };

  // Get all stages a job has passed through
  const getJobPassedStages = (job) => {
    const history = jobHistories[job._id] || [];
    const passedStatuses = new Set(['new']); // Always starts with new

    // Add all statuses from history
    history.forEach(h => {
      if (h.statusFrom) passedStatuses.add(h.statusFrom);
      if (h.statusTo) passedStatuses.add(h.statusTo);
    });

    // Add current status
    passedStatuses.add(job.status);

    return passedStatuses;
  };

  const handleFetchImages = async (asin, sku, itemId) => {
    if (!asin) {
      toast.error('ASIN is required to fetch images');
      return;
    }

    try {
      setFetchingImages(prev => ({ ...prev, [itemId]: true }));
      // Pass the order's account code for proper Amazon API authentication
      const response = await orderAPI.fetchProductImages(asin, sku, order?.accountCode);

      if (response.data.success) {
        toast.success(`Downloaded ${response.data.data.downloadedCount} images`);
        // Refresh order data to show new images
        fetchOrder();
      } else {
        toast.error(response.data.message || 'Failed to fetch images');
      }
    } catch (error) {
      console.error('Error fetching images:', error);
      toast.error('Failed to fetch product images from Amazon');
    } finally {
      setFetchingImages(prev => ({ ...prev, [itemId]: false }));
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

  const formatCurrency = (amount, currency = 'USD') => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: 'warning',
      processing: 'info',
      shipped: 'primary',
      delivered: 'success',
      cancelled: 'danger'
    };
    return badges[status] || 'secondary';
  };

  const getChannelBadge = (channel) => {
    const badges = {
      amazon: 'warning',
      ebay: 'danger',
      manual: 'info'
    };
    return badges[channel] || 'secondary';
  };

  const getJobStatusBadge = (status) => {
    const badges = {
      new: 'secondary',
      cad_pending: 'warning',
      cad_in_progress: 'info',
      cad_review: 'primary',
      cad_approved: 'success',
      manufacturing: 'info',
      quality_check: 'warning',
      ready_to_ship: 'primary',
      completed: 'success',
      cancelled: 'danger'
    };
    return badges[status] || 'secondary';
  };

  const getCadStatusBadge = (cadSummary) => {
    if (!cadSummary || cadSummary.status === 'unknown') {
      return <span className="badge badge-secondary">Unknown</span>;
    }

    switch (cadSummary.status) {
      case 'all_cad':
        return (
          <span className="badge badge-success" title={`${cadSummary.withCad}/${cadSummary.total} with CAD`}>
            <i className="fas fa-check mr-1"></i>All CAD Available ({cadSummary.withCad}/{cadSummary.total})
          </span>
        );
      case 'partial':
        return (
          <span className="badge badge-warning" title={`${cadSummary.withCad}/${cadSummary.total} with CAD`}>
            <i className="fas fa-exclamation mr-1"></i>Partial ({cadSummary.withCad}/{cadSummary.total})
          </span>
        );
      case 'no_cad':
        return (
          <span className="badge badge-danger" title="No items have CAD files">
            <i className="fas fa-times mr-1"></i>No CAD
          </span>
        );
      default:
        return <span className="badge badge-secondary">-</span>;
    }
  };

  // Fetch users by role for assignment
  const fetchUsersByRole = async (roleName) => {
    if (usersCache[roleName] && usersCache[roleName].length > 0) {
      setAvailableUsers(usersCache[roleName]);
      return;
    }
    try {
      const response = await userAPI.getByRole(roleName);
      const users = response.data.data || response.data || [];
      setUsersCache(prev => ({ ...prev, [roleName]: users }));
      setAvailableUsers(users);
    } catch (error) {
      console.error('Error fetching users:', error);
      setAvailableUsers([]);
    }
  };

  // Open assign modal
  const handleOpenAssignModal = async () => {
    setShowAssignModal(true);
    setAssignType('cadDesigner');
    // Get current assignment from jobs
    const currentCadDesigner = jobs.find(j => j.cadDesigner)?.cadDesigner?._id || '';
    setAssignUserId(currentCadDesigner);
    await fetchUsersByRole('designer');
  };

  // Handle assign type change
  const handleAssignTypeChange = async (type) => {
    setAssignType(type);
    // Pre-select current assigned user for this type
    let currentUser = '';
    if (type === 'cadDesigner') {
      currentUser = jobs.find(j => j.cadDesigner)?.cadDesigner?._id || '';
    } else if (type === 'manufacturer') {
      currentUser = jobs.find(j => j.manufacturer)?.manufacturer?._id || '';
    }
    setAssignUserId(currentUser);

    const roleMap = {
      cadDesigner: 'designer',
      manufacturer: 'manufacturer',
      admin: 'admin'
    };
    await fetchUsersByRole(roleMap[type] || 'admin');
  };

  // Handle assignment submit
  const handleAssign = async () => {
    if (!assignUserId) {
      toast.error('Please select a user');
      return;
    }

    try {
      setAssigning(true);
      await orderAPI.assignUser(id, {
        assignType,
        userId: assignUserId
      });

      toast.success(`${assignType === 'cadDesigner' ? 'CAD Designer' : assignType === 'manufacturer' ? 'Manufacturer' : 'Admin'} assigned successfully`);
      setShowAssignModal(false);
      // Refresh order data to get updated jobs
      fetchOrder();
      fetchActivityLogs();
    } catch (error) {
      toast.error('Failed to assign user');
    } finally {
      setAssigning(false);
    }
  };

  // Get current assignments from jobs
  const getCurrentAssignments = () => {
    const assignments = {
      cadDesigner: null,
      manufacturer: null,
      admin: null
    };
    if (jobs.length > 0) {
      const cadDesigner = jobs.find(j => j.cadDesigner)?.cadDesigner;
      const manufacturer = jobs.find(j => j.manufacturer)?.manufacturer;
      if (cadDesigner) assignments.cadDesigner = cadDesigner;
      if (manufacturer) assignments.manufacturer = manufacturer;
    }
    return assignments;
  };

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

  if (!order) {
    return (
      <section className="content">
        <div className="container-fluid">
          <div className="alert alert-warning">
            <h5><i className="icon fas fa-exclamation-triangle"></i> Order Not Found</h5>
            The requested order could not be found.
            <br />
            <Link to="/orders" className="btn btn-secondary mt-3">
              <i className="fas fa-arrow-left mr-1"></i> Back to Orders
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
                Order: {order.externalOrderId}
              </h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item"><Link to="/orders">Orders</Link></li>
                <li className="breadcrumb-item active">{order.externalOrderId}</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <section className="content">
        <div className="container-fluid">
          {/* Back Button */}
          <div className="mb-3">
            <button className="btn btn-secondary" onClick={() => navigate('/orders')}>
              <i className="fas fa-arrow-left mr-1"></i> Back to Orders
            </button>
          </div>

          <div className="row">
            {/* Order Information Card */}
            <div className="col-md-6">
              <div className="card card-primary">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-info-circle mr-2"></i>
                    Order Information
                  </h3>
                </div>
                <div className="card-body">
                  <table className="table table-sm table-borderless">
                    <tbody>
                      <tr>
                        <td className="text-muted" style={{ width: '40%' }}>Order ID:</td>
                        <td><strong>{order.externalOrderId}</strong></td>
                      </tr>
                      <tr>
                        <td className="text-muted">Channel:</td>
                        <td>
                          <span className={`badge badge-${getChannelBadge(order.channel)}`}>
                            {order.channel?.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                      {order.accountCode && (
                        <tr>
                          <td className="text-muted">Account:</td>
                          <td><span className="badge badge-info">{order.accountCode}</span></td>
                        </tr>
                      )}
                      <tr>
                        <td className="text-muted">Status:</td>
                        <td>
                          <span className={`badge badge-${getStatusBadge(order.status)}`}>
                            {order.status}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Order Date:</td>
                        <td>{formatDate(order.orderDate)}</td>
                      </tr>
                      {order.promisedDate && (
                        <tr>
                          <td className="text-muted">Promised Date:</td>
                          <td>{formatDate(order.promisedDate)}</td>
                        </tr>
                      )}
                      <tr>
                        <td className="text-muted">Total Amount:</td>
                        <td><strong>{formatCurrency(order.totalAmount, order.currency)}</strong></td>
                      </tr>
                      <tr>
                        <td className="text-muted">CAD Status:</td>
                        <td>{getCadStatusBadge(order.cadSummary)}</td>
                      </tr>
                      <tr>
                        <td className="text-muted">Last Synced:</td>
                        <td>{formatDate(order.syncedAt)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Assignment Card */}
              <div className="card card-warning">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-user-tag mr-2"></i>
                    Assigned Users
                  </h3>
                  <div className="card-tools">
                    <button
                      className="btn btn-tool"
                      onClick={handleOpenAssignModal}
                      title="Assign User"
                    >
                      <i className="fas fa-user-plus"></i>
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  {(() => {
                    const assignments = getCurrentAssignments();
                    const hasAssignments = assignments.cadDesigner || assignments.manufacturer;

                    if (!hasAssignments) {
                      return (
                        <div className="text-center text-muted py-3">
                          <i className="fas fa-user-slash fa-2x mb-2"></i>
                          <p className="mb-2">No users assigned yet</p>
                          <button
                            className="btn btn-sm btn-warning"
                            onClick={handleOpenAssignModal}
                          >
                            <i className="fas fa-user-plus mr-1"></i>
                            Assign User
                          </button>
                        </div>
                      );
                    }

                    return (
                      <table className="table table-sm table-borderless mb-0">
                        <tbody>
                          {assignments.cadDesigner && (
                            <tr>
                              <td className="text-muted" style={{ width: '40%' }}>
                                <i className="fas fa-pencil-ruler mr-1"></i>CAD Designer:
                              </td>
                              <td>
                                <strong>{assignments.cadDesigner.name}</strong>
                                {assignments.cadDesigner.email && (
                                  <small className="d-block text-muted">{assignments.cadDesigner.email}</small>
                                )}
                              </td>
                            </tr>
                          )}
                          {assignments.manufacturer && (
                            <tr>
                              <td className="text-muted">
                                <i className="fas fa-industry mr-1"></i>Manufacturer:
                              </td>
                              <td>
                                <strong>{assignments.manufacturer.name}</strong>
                                {assignments.manufacturer.email && (
                                  <small className="d-block text-muted">{assignments.manufacturer.email}</small>
                                )}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Customer Information Card */}
            <div className="col-md-6">
              <div className="card card-info">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-user mr-2"></i>
                    Customer Information
                  </h3>
                </div>
                <div className="card-body">
                  <table className="table table-sm table-borderless">
                    <tbody>
                      <tr>
                        <td className="text-muted" style={{ width: '40%' }}>Name:</td>
                        <td><strong>{order.buyerName || '-'}</strong></td>
                      </tr>
                      <tr>
                        <td className="text-muted">Email:</td>
                        <td>
                          {order.buyerEmail ? (
                            <a href={`mailto:${order.buyerEmail}`}>{order.buyerEmail}</a>
                          ) : '-'}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">Phone:</td>
                        <td>
                          {order.buyerPhone ? (
                            <a href={`tel:${order.buyerPhone}`}>{order.buyerPhone}</a>
                          ) : '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {order.shippingAddress && (
                    <>
                      <hr />
                      <h6><i className="fas fa-map-marker-alt mr-2"></i>Shipping Address</h6>
                      <address className="mb-0">
                        {order.shippingAddress.name && <strong>{order.shippingAddress.name}<br /></strong>}
                        {order.shippingAddress.addressLine1 && <>{order.shippingAddress.addressLine1}<br /></>}
                        {order.shippingAddress.addressLine2 && <>{order.shippingAddress.addressLine2}<br /></>}
                        {order.shippingAddress.city && <>{order.shippingAddress.city}, </>}
                        {order.shippingAddress.state && <>{order.shippingAddress.state} </>}
                        {order.shippingAddress.postalCode && <>{order.shippingAddress.postalCode}<br /></>}
                        {order.shippingAddress.country && <>{order.shippingAddress.country}</>}
                      </address>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Order Items Card */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <i className="fas fa-list mr-2"></i>
                Order Items ({items.length})
              </h3>
            </div>
            <div className="card-body table-responsive p-0">
              {items.length === 0 ? (
                <div className="text-center py-4 text-muted">
                  <i className="fas fa-inbox fa-2x mb-2"></i>
                  <p>No items in this order</p>
                </div>
              ) : (
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>#</th>
                      <th>SKU</th>
                      <th>ASIN</th>
                      <th>Product Name</th>
                      <th className="text-center">Qty</th>
                      <th className="text-right">Price</th>
                      <th className="text-center">CAD</th>
                      <th className="text-center">Images</th>
                      <th className="text-center">Job</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={item._id}>
                        <td>{index + 1}</td>
                        <td><code>{item.sku || '-'}</code></td>
                        <td><small className="text-muted">{item.asinOrItemId || '-'}</small></td>
                        <td style={{ maxWidth: '200px' }}>
                          <span className="text-truncate d-inline-block" style={{ maxWidth: '200px' }} title={item.productName || item.title}>
                            {item.productName || item.title || '-'}
                          </span>
                        </td>
                        <td className="text-center">{item.quantity || 1}</td>
                        <td className="text-right">{formatCurrency(item.itemPrice, order.currency)}</td>
                        <td className="text-center">
                          {item.hasCadFile && item.cadFilePath ? (
                            <a
                              href={`${API_BASE_URL}${item.cadFilePath}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-success btn-xs"
                              title={`Download ${item.cadFileName || 'CAD file'}`}
                            >
                              <i className="fas fa-cube mr-1"></i>STL
                            </a>
                          ) : (
                            <span className="badge badge-danger" title="No CAD file">
                              <i className="fas fa-times"></i>
                            </span>
                          )}
                        </td>
                        <td className="text-center">
                          {order.channel === 'amazon' && item.asinOrItemId ? (
                            <button
                              className="btn btn-info btn-xs"
                              onClick={() => handleFetchImages(item.asinOrItemId, item.sku, item._id)}
                              disabled={fetchingImages[item._id]}
                              title="Fetch images from Amazon"
                            >
                              {fetchingImages[item._id] ? (
                                <span className="spinner-border spinner-border-sm"></span>
                              ) : (
                                <i className="fas fa-image"></i>
                              )}
                            </button>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td className="text-center">
                          {item.isJobCreated ? (
                            <span className="badge badge-success">Yes</span>
                          ) : (
                            <span className="badge badge-secondary">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-light">
                      <td colSpan="4"><strong>Total</strong></td>
                      <td className="text-center">
                        <strong>{items.reduce((sum, item) => sum + (item.quantity || 1), 0)}</strong>
                      </td>
                      <td className="text-right">
                        <strong>{formatCurrency(order.totalAmount, order.currency)}</strong>
                      </td>
                      <td colSpan="3"></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>

          {/* Related Jobs Card */}
          {jobs.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <i className="fas fa-briefcase mr-2"></i>
                  Related Jobs ({jobs.length})
                </h3>
              </div>
              <div className="card-body table-responsive p-0">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Job ID</th>
                      <th>SKU</th>
                      <th>Product</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th className="text-center">CAD File</th>
                      <th>CAD Designer</th>
                      <th>Due Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map(job => (
                      <tr key={job._id}>
                        <td>
                          <Link to={`/jobs/${job._id}`}>
                            <strong>{job._id.slice(-8).toUpperCase()}</strong>
                          </Link>
                        </td>
                        <td><code>{job.sku || '-'}</code></td>
                        <td>{job.productName || '-'}</td>
                        <td>
                          <span className={`badge badge-${getJobStatusBadge(job.status)}`}>
                            {job.status?.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>
                          <span className={`badge badge-${job.priority === 'high' ? 'danger' : job.priority === 'medium' ? 'warning' : 'secondary'}`}>
                            {job.priority}
                          </span>
                        </td>
                        <td className="text-center">
                          {job.hasCadFile && job.cadFilePath ? (
                            <a
                              href={`${API_BASE_URL}${job.cadFilePath}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-success btn-xs"
                              title="Download CAD/STL file"
                            >
                              <i className="fas fa-cube mr-1"></i>STL
                            </a>
                          ) : job.hasCadFile ? (
                            <span className="badge badge-success" title="CAD available">
                              <i className="fas fa-check"></i> Yes
                            </span>
                          ) : (
                            <span className="badge badge-warning" title="CAD required">
                              <i className="fas fa-exclamation-triangle"></i> Required
                            </span>
                          )}
                        </td>
                        <td>{job.cadDesigner?.name || '-'}</td>
                        <td>{formatDate(job.dueDate)}</td>
                        <td>
                          <Link to={`/jobs/${job._id}`} className="btn btn-sm btn-info">
                            <i className="fas fa-eye"></i>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Job Workflow Funnel */}
          {jobs.length > 0 && (
            <div className="card card-outline card-primary">
              <div className="card-header">
                <h3 className="card-title">
                  <i className="fas fa-filter mr-2"></i>
                  Job Workflow Funnel
                </h3>
                <div className="card-tools">
                  <span className="badge badge-success mr-2">
                    <i className="fas fa-circle mr-1" style={{ fontSize: '8px' }}></i> On Track
                  </span>
                  <span className="badge badge-danger">
                    <i className="fas fa-circle mr-1" style={{ fontSize: '8px' }}></i> TAT Breach
                  </span>
                </div>
              </div>
              <div className="card-body">
                {loadingHistories ? (
                  <div className="text-center py-4">
                    <div className="spinner-border text-primary" role="status">
                      <span className="sr-only">Loading...</span>
                    </div>
                    <p className="mt-2 text-muted">Loading workflow history...</p>
                  </div>
                ) : (
                  jobs.map(job => {
                    const passedStages = getJobPassedStages(job);
                    const history = jobHistories[job._id] || [];
                    const currentStageInfo = getStageInfo(job.status);
                    const hasOverallBreach = job.dueDate && new Date() > new Date(job.dueDate) && !['delivered', 'cancelled'].includes(job.status);

                    return (
                      <div key={job._id} className="mb-4 pb-3 border-bottom">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                          <div>
                            <Link to={`/jobs/${job._id}`} className="font-weight-bold">
                              {job.jobCode || job._id.slice(-8).toUpperCase()}
                            </Link>
                            <span className="text-muted ml-2">- {job.productName || job.sku || 'N/A'}</span>
                          </div>
                          <div>
                            <span className={`badge badge-${currentStageInfo.color} mr-2`}>
                              <i className={`${currentStageInfo.icon} mr-1`}></i>
                              {currentStageInfo.label}
                            </span>
                            {hasOverallBreach && (
                              <span className="badge badge-danger">
                                <i className="fas fa-exclamation-triangle mr-1"></i>
                                Overdue
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Funnel Timeline */}
                        <div className="workflow-funnel d-flex flex-wrap align-items-center" style={{ gap: '4px' }}>
                          {JOB_STAGES.filter(stage =>
                            // Show stages that job has passed or is currently at
                            passedStages.has(stage.key) || stage.key === job.status
                          ).map((stage, idx, arr) => {
                            const isPassed = passedStages.has(stage.key);
                            const isCurrent = stage.key === job.status;
                            const hasBreach = checkTATBreach(job, stage.key);
                            const historyEntry = history.find(h => h.statusTo === stage.key);

                            return (
                              <div
                                key={stage.key}
                                className={`funnel-stage d-flex align-items-center px-2 py-1 rounded ${isCurrent ? 'bg-primary text-white' :
                                  hasBreach ? 'bg-danger text-white' :
                                    isPassed ? 'bg-success text-white' : 'bg-light'
                                  }`}
                                style={{ fontSize: '12px' }}
                                title={historyEntry ? `Changed at ${new Date(historyEntry.changedAt).toLocaleString()} by ${historyEntry.changedBy?.name || 'System'}` : stage.label}
                              >
                                <i className={`${stage.icon} mr-1`}></i>
                                <span>{stage.label}</span>
                                {hasBreach && !isCurrent && (
                                  <i className="fas fa-exclamation-circle ml-1" title="TAT Breach"></i>
                                )}
                                {idx < arr.length - 1 && (
                                  <i className="fas fa-chevron-right mx-1 text-muted" style={{ opacity: 0.5 }}></i>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Job Details Row */}
                        <div className="row mt-3">
                          <div className="col-md-3">
                            <small className="text-muted d-block">CAD Designer</small>
                            <span>{job.cadDesigner?.name || '-'}</span>
                            {job.cadDeadline && (
                              <small className={`d-block ${new Date() > new Date(job.cadDeadline) ? 'text-danger' : 'text-muted'}`}>
                                <i className="far fa-clock mr-1"></i>
                                Due: {new Date(job.cadDeadline).toLocaleDateString()}
                              </small>
                            )}
                          </div>
                          <div className="col-md-3">
                            <small className="text-muted d-block">Manufacturer</small>
                            <span>{job.manufacturer?.name || '-'}</span>
                            {job.manufacturingDeadline && (
                              <small className={`d-block ${new Date() > new Date(job.manufacturingDeadline) ? 'text-danger' : 'text-muted'}`}>
                                <i className="far fa-clock mr-1"></i>
                                Due: {new Date(job.manufacturingDeadline).toLocaleDateString()}
                              </small>
                            )}
                          </div>
                          <div className="col-md-3">
                            <small className="text-muted d-block">Priority</small>
                            <span className={`badge badge-${job.priority === 'urgent' ? 'danger' : job.priority === 'high' ? 'warning' : job.priority === 'medium' ? 'info' : 'secondary'}`}>
                              {job.priority}
                            </span>
                          </div>
                          <div className="col-md-3">
                            <small className="text-muted d-block">Overall Due Date</small>
                            {job.dueDate ? (
                              <span className={hasOverallBreach ? 'text-danger font-weight-bold' : ''}>
                                {new Date(job.dueDate).toLocaleDateString()}
                                {hasOverallBreach && <i className="fas fa-exclamation-triangle ml-1"></i>}
                              </span>
                            ) : '-'}
                          </div>
                        </div>

                        {/* Status History Timeline */}
                        {history.length > 0 && (
                          <div className="mt-3">
                            <small className="text-muted d-block mb-2">
                              <i className="fas fa-history mr-1"></i> Status History ({history.length} changes)
                            </small>
                            <div className="d-flex flex-wrap" style={{ gap: '8px' }}>
                              {history.slice(0, 5).map((h, idx) => (
                                <div key={idx} className="d-flex align-items-center bg-light rounded px-2 py-1" style={{ fontSize: '11px' }}>
                                  <span className="badge badge-secondary mr-1">{h.statusFrom?.replace(/_/g, ' ') || 'new'}</span>
                                  <i className="fas fa-arrow-right mx-1 text-muted"></i>
                                  <span className="badge badge-primary">{h.statusTo?.replace(/_/g, ' ')}</span>
                                  <small className="text-muted ml-2">
                                    {new Date(h.changedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </small>
                                </div>
                              ))}
                              {history.length > 5 && (
                                <Link to={`/jobs/${job._id}`} className="btn btn-xs btn-outline-secondary">
                                  +{history.length - 5} more
                                </Link>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Reference Images Preview */}
          {jobs.some(job => job.referenceImages && job.referenceImages.length > 0) && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <i className="fas fa-images mr-2"></i>
                  Reference Images
                </h3>
              </div>
              <div className="card-body">
                <div className="row">
                  {jobs.map(job =>
                    job.referenceImages && job.referenceImages.map((img, index) => (
                      <div key={`${job._id}-${index}`} className="col-md-2 col-sm-3 col-4 mb-3">
                        <div className="position-relative">
                          <img
                            src={`${API_BASE_URL}${img}`}
                            alt={`Reference ${index + 1}`}
                            className="img-fluid img-thumbnail"
                            style={{ width: '100%', height: '150px', objectFit: 'cover', cursor: 'pointer' }}
                            onClick={() => window.open(`${API_BASE_URL}${img}`, '_blank')}
                          />
                          <small className="d-block text-muted text-truncate mt-1">
                            Job: {job._id.slice(-6)}
                          </small>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Order Activity History */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <i className="fas fa-history mr-2"></i>
                Order History
              </h3>
            </div>
            <div className="card-body">
              {loadingLogs ? (
                <div className="text-center py-3">
                  <div className="spinner-border spinner-border-sm text-primary" role="status">
                    <span className="sr-only">Loading...</span>
                  </div>
                </div>
              ) : activityLogs.length === 0 ? (
                <div className="text-center py-3 text-muted">
                  <i className="fas fa-history fa-2x mb-2"></i>
                  <p>No activity history available</p>
                </div>
              ) : (
                <div className="timeline">
                  {activityLogs.map((log, index) => (
                    <div key={log._id} className="timeline-item">
                      <div className="timeline-item-marker">
                        <div className={`timeline-item-marker-indicator bg-${log.action?.includes('create') ? 'success' :
                          log.action?.includes('update') ? 'info' :
                            log.action?.includes('delete') ? 'danger' :
                              log.action?.includes('sync') ? 'primary' :
                                log.action?.includes('assign') ? 'warning' :
                                  'secondary'
                          }`}></div>
                      </div>
                      <div className="timeline-item-content pt-0">
                        <div className="d-flex justify-content-between">
                          <span className="fw-bold">
                            {log.action?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </span>
                          <small className="text-muted">
                            {new Date(log.performedAt).toLocaleString()}
                          </small>
                        </div>
                        <p className="mb-1">{log.description}</p>
                        <small className="text-muted">
                          By: {log.user?.name || 'System'}
                          {log.user?.email && ` (${log.user.email})`}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Assign User Modal */}
      {showAssignModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-warning">
                <h5 className="modal-title">
                  <i className="fas fa-user-plus mr-2"></i>
                  Assign User to Order
                </h5>
                <button
                  type="button"
                  className="close"
                  onClick={() => setShowAssignModal(false)}
                  disabled={assigning}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label>Assignment Type</label>
                  <select
                    className="form-control"
                    value={assignType}
                    onChange={(e) => handleAssignTypeChange(e.target.value)}
                    disabled={assigning}
                  >
                    <option value="cadDesigner">CAD Designer</option>
                    <option value="manufacturer">Manufacturer</option>
                    <option value="admin">Admin</option>
                  </select>
                  <small className="text-muted">
                    {assignType === 'cadDesigner' && 'Assign a CAD designer to create/manage CAD files for this order'}
                    {assignType === 'manufacturer' && 'Assign a manufacturer to handle production for this order'}
                    {assignType === 'admin' && 'Assign an admin to oversee this order'}
                  </small>
                </div>

                <div className="form-group">
                  <label>Select User</label>
                  <select
                    className="form-control"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    disabled={assigning}
                  >
                    <option value="">-- Select User --</option>
                    {availableUsers.map(user => (
                      <option key={user._id} value={user._id}>
                        {user.name} ({user.email})
                      </option>
                    ))}
                  </select>
                  {availableUsers.length === 0 && (
                    <small className="text-warning">
                      <i className="fas fa-exclamation-triangle mr-1"></i>
                      No users found with the selected role
                    </small>
                  )}
                </div>

                <div className="alert alert-secondary mt-3 mb-0">
                  <small>
                    <i className="fas fa-info-circle mr-1"></i>
                    This will create or update jobs for all items in this order and assign them to the selected user.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAssignModal(false)}
                  disabled={assigning}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={handleAssign}
                  disabled={assigning || !assignUserId}
                >
                  {assigning ? (
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
    </>
  );
};

export default OrderDetail;
