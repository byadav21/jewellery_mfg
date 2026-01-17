import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { orderAPI, userAPI, docketAPI } from '../../services/api';
import DataTable from '../../components/common/DataTable';

const API_BASE_URL = process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001';

const OrderList = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState({ amazon: false, ebay: false });
  const syncLockRef = useRef({ amazon: false, ebay: false }); // Synchronous lock to prevent duplicate calls
  const [missingSKUsModal, setMissingSKUsModal] = useState({ show: false, skus: [] });
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncResultModal, setSyncResultModal] = useState({ show: false, data: null });
  const [syncDateRange, setSyncDateRange] = useState({
    fromDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    toDate: new Date(Date.now() - 2 * 60 * 1000).toISOString().split('T')[0] // At least 2 minutes in the past
  });
  const [downloading, setDownloading] = useState(false);
  const [filters, setFilters] = useState({
    search: '',
    channel: '',
    status: '',
    cadStatus: '',
    accountCode: '',
    startDate: '',
    endDate: ''
  });
  const [accountCodes, setAccountCodes] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });
  const [sorting, setSorting] = useState({
    field: 'orderDate',
    direction: 'desc'
  });
  const [marketplaceAccounts, setMarketplaceAccounts] = useState([]);
  const [syncAccountCode, setSyncAccountCode] = useState('all');
  const [importAll, setImportAll] = useState(false);
  const [syncType, setSyncType] = useState('amazon'); // 'amazon' or 'ebay'

  // Bulk selection state
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignType, setAssignType] = useState('cadDesigner');
  const [assignUserId, setAssignUserId] = useState('');
  const [availableUsers, setAvailableUsers] = useState([]);
  const [assigning, setAssigning] = useState(false);

  // Bulk status change state
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkStatusNotes, setBulkStatusNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Docket generation state
  const [showDocketModal, setShowDocketModal] = useState(false);
  const [docketManufacturerId, setDocketManufacturerId] = useState('');
  const [docketNotes, setDocketNotes] = useState('');
  const [generatingDocket, setGeneratingDocket] = useState(false);
  const [manufacturers, setManufacturers] = useState([]);

  // Edit order state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [editImages, setEditImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef(null);

  // Inline assignment state
  const [inlineAssignOrderId, setInlineAssignOrderId] = useState(null);
  const [inlineAssignType, setInlineAssignType] = useState('cadDesigner');
  const [inlineAssignUserId, setInlineAssignUserId] = useState('');
  const [inlineUsers, setInlineUsers] = useState([]);
  const [inlineAssigning, setInlineAssigning] = useState(false);

  // Cache for users by role
  const [usersCache, setUsersCache] = useState({
    designer: [],
    manufacturer: [],
    admin: []
  });

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        sortField: sorting.field,
        sortDirection: sorting.direction,
        ...filters
      };
      const response = await orderAPI.getAll(params);
      setOrders(response.data.data?.orders || response.data.orders || []);
      if (response.data.data?.pagination || response.data.pagination) {
        setPagination(prev => ({ ...prev, ...(response.data.data?.pagination || response.data.pagination) }));
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, sorting.field, sorting.direction, filters]);

  // Handle sort change
  const handleSort = (field, direction) => {
    setSorting({ field, direction });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const fetchAccountCodes = async () => {
    try {
      const response = await orderAPI.getAccountCodes();
      setAccountCodes(response.data.data || []);
    } catch (error) {
      console.error('Error fetching account codes:', error);
    }
  };

  const fetchMarketplaceAccounts = async () => {
    try {
      const response = await orderAPI.getAccountCodes(); // Assuming this returns codes
      // For more details we might need a specific API
      setMarketplaceAccounts(response.data.data || []);
    } catch (error) {
      console.error('Error fetching marketplace accounts:', error);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchAccountCodes();
    fetchMarketplaceAccounts();
  }, [fetchOrders]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleOpenSyncModal = (type = 'amazon') => {
    setSyncType(type);
    setShowSyncModal(true);
  };

  const handleSyncMarketplace = async () => {
    const isAmazon = syncType === 'amazon';
    const syncName = isAmazon ? 'Amazon' : 'eBay';
    const syncKey = isAmazon ? 'amazon' : 'ebay';

    // Prevent duplicate calls using synchronous ref (works even with React StrictMode)
    if (syncLockRef.current[syncKey]) {
      console.log(`[DUPLICATE CALL PREVENTED] ${syncName} sync already in progress`);
      return;
    }

    try {
      // Set both the ref (synchronous) and state (for UI)
      syncLockRef.current[syncKey] = true;
      setSyncing(prev => ({ ...prev, [syncKey]: true }));
      setShowSyncModal(false);

      // Ensure toDate is at least 2 minutes in the past to comply with Amazon API requirements
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
      const selectedToDate = new Date(syncDateRange.toDate + 'T23:59:59Z');

      let adjustedToDate = syncDateRange.toDate;
      if (selectedToDate > twoMinutesAgo) {
        adjustedToDate = twoMinutesAgo.toISOString().split('T')[0];
        toast.info(`Adjusted "To Date" to ${adjustedToDate} to comply with Amazon API requirements (must be at least 2 minutes in the past)`);
      }

      const payload = {
        fromDate: syncDateRange.fromDate,
        toDate: adjustedToDate,
        accountCode: syncAccountCode,
        importAll
      };

      const response = isAmazon
        ? await orderAPI.syncAmazon(payload)
        : await orderAPI.syncEbay(payload);

      const data = response.data?.data || response.data || {};

      // Check for account-level errors
      if (data.accountResults && data.accountResults.length > 0) {
        const failedAccounts = data.accountResults.filter(a => !a.success);
        const successAccounts = data.accountResults.filter(a => a.success);

        if (failedAccounts.length > 0) {
          failedAccounts.forEach(account => {
            let errorMsg = `${account.accountCode}: ${account.message}`;
            if (account.troubleshooting && account.troubleshooting.length > 0) {
              errorMsg += '\n\nTroubleshooting:\n• ' + account.troubleshooting.join('\n• ');
            }
            toast.error(errorMsg, { autoClose: 10000 });
          });
        }

        if (successAccounts.length > 0) {
          const totalImported = successAccounts.reduce((sum, a) => sum + (a.stats?.ordersImported || 0), 0);
          toast.success(`Synced ${totalImported} orders from ${successAccounts.length} account(s)`);
        }
      } else {
        setSyncResultModal({ show: true, data });
        if (data.missingSKUs && data.missingSKUs.length > 0) {
          toast.warning(`${data.missingSKUs.length} SKU(s) not found in SKU Master`);
        }
      }
      fetchOrders();
    } catch (error) {
      toast.error(`Failed to sync ${syncName} orders: ` + (error.response?.data?.message || error.message));
    } finally {
      // Reset both the ref (synchronous) and state (for UI)
      syncLockRef.current[syncKey] = false;
      setSyncing(prev => ({ ...prev, [syncKey]: false }));
    }
  };

  const handleSyncAmazon = handleSyncMarketplace;
  const handleSyncEbay = handleSyncMarketplace;

  // Bulk download all files for selected orders
  const handleBulkDownload = async () => {
    if (selectedOrders.length === 0) {
      toast.error('No orders selected');
      return;
    }
    try {
      setDownloading(true);
      const response = await orderAPI.bulkDownload(selectedOrders);

      // Create download link
      const blob = new Blob([response.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Download started');
    } catch (error) {
      toast.error('Failed to download files');
    } finally {
      setDownloading(false);
    }
  };

  const handleGoToSkuMaster = () => {
    // Store missing SKUs in sessionStorage for SKU Master page to pick up
    sessionStorage.setItem('missingSKUs', JSON.stringify(missingSKUsModal.skus));
    setMissingSKUsModal({ show: false, skus: [] });
    navigate('/sku-master');
  };

  const getChannelBadge = (channel) => {
    const colors = {
      amazon: 'warning',
      ebay: 'info',
      manual: 'secondary'
    };
    return colors[channel] || 'secondary';
  };

  const getStatusBadge = (status) => {
    const colors = {
      pending: 'warning',
      processing: 'info',
      completed: 'success',
      cancelled: 'danger',
      shipped: 'primary'
    };
    return colors[status] || 'secondary';
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

  const formatCurrency = (amount, currency = 'INR') => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const getRemainingTime = (deadline) => {
    if (!deadline) return null;
    const now = new Date();
    const end = new Date(deadline);
    const diff = end - now;

    if (diff <= 0) return { text: 'BREACHED', color: 'danger' };

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours < 2) return { text: `${hours}h ${minutes}m`, color: 'warning' };
    return { text: `${hours}h ${minutes}m`, color: 'info' };
  };

  // Bulk selection handlers
  const handleSelectOrder = (orderId) => {
    setSelectedOrders(prev => {
      if (prev.includes(orderId)) {
        return prev.filter(id => id !== orderId);
      } else {
        return [...prev, orderId];
      }
    });
  };

  const isSomeSelected = selectedOrders.length > 0;

  // Open assign modal
  const handleOpenAssignModal = async () => {
    setShowAssignModal(true);
    setAssignType('cadDesigner');
    setAssignUserId('');
    // Fetch users based on default role
    await fetchUsersByRole('designer');
  };

  // Fetch users by role
  const fetchUsersByRole = async (roleName) => {
    try {
      const response = await userAPI.getByRole(roleName);
      setAvailableUsers(response.data.data || response.data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      setAvailableUsers([]);
    }
  };

  // Handle assign type change
  const handleAssignTypeChange = async (e) => {
    const type = e.target.value;
    setAssignType(type);
    setAssignUserId('');

    // Fetch users based on role
    const roleMap = {
      cadDesigner: 'designer',
      manufacturer: 'manufacturer',
      admin: 'admin'
    };
    await fetchUsersByRole(roleMap[type] || 'admin');
  };

  // Edit order handlers
  const handleOpenEditModal = async (order) => {
    try {
      // Fetch full order details
      const response = await orderAPI.getById(order._id);
      const fullOrder = response.data.data || response.data;
      setEditingOrder(fullOrder);
      setEditFormData({
        buyerName: fullOrder.buyerName || '',
        buyerEmail: fullOrder.buyerEmail || '',
        status: fullOrder.status || 'pending',
        totalAmount: fullOrder.totalAmount || '',
        currency: fullOrder.currency || 'USD',
        notes: fullOrder.notes || '',
        shippingAddress: {
          name: fullOrder.shippingAddress?.name || '',
          addressLine1: fullOrder.shippingAddress?.addressLine1 || '',
          addressLine2: fullOrder.shippingAddress?.addressLine2 || '',
          city: fullOrder.shippingAddress?.city || '',
          state: fullOrder.shippingAddress?.state || '',
          postalCode: fullOrder.shippingAddress?.postalCode || '',
          country: fullOrder.shippingAddress?.country || ''
        }
      });
      setEditImages([]);
      setShowEditModal(true);
    } catch (error) {
      toast.error('Failed to load order details');
    }
  };

  const handleEditFormChange = (e) => {
    const { name, value } = e.target;
    if (name.startsWith('shipping_')) {
      const field = name.replace('shipping_', '');
      setEditFormData(prev => ({
        ...prev,
        shippingAddress: { ...prev.shippingAddress, [field]: value }
      }));
    } else {
      setEditFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files);
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    const validFiles = files.filter(file => {
      if (!validTypes.includes(file.type)) {
        toast.error(`${file.name}: Invalid file type`);
        return false;
      }
      if (file.size > maxSize) {
        toast.error(`${file.name}: File too large (max 10MB)`);
        return false;
      }
      return true;
    });

    setEditImages(prev => [...prev, ...validFiles]);
  };

  const removeEditImage = (index) => {
    setEditImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveOrder = async () => {
    try {
      setUploading(true);

      // Update order
      await orderAPI.update(editingOrder._id, editFormData);

      // Upload images if any
      if (editImages.length > 0) {
        const formData = new FormData();
        editImages.forEach(img => formData.append('images', img));
        await orderAPI.uploadImages(editingOrder._id, formData);
      }

      toast.success('Order updated successfully');
      setShowEditModal(false);
      setEditingOrder(null);
      fetchOrders();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update order');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteOrderImage = async (imageId) => {
    if (!window.confirm('Delete this image?')) return;
    try {
      await orderAPI.deleteImage(editingOrder._id, imageId);
      toast.success('Image deleted');
      // Refresh order details
      const response = await orderAPI.getById(editingOrder._id);
      setEditingOrder(response.data.data || response.data);
    } catch (error) {
      toast.error('Failed to delete image');
    }
  };

  // Fetch users by role for inline assignment (with caching)
  const fetchUsersForRole = async (roleName) => {
    if (usersCache[roleName] && usersCache[roleName].length > 0) {
      setInlineUsers(usersCache[roleName]);
      return;
    }
    try {
      const response = await userAPI.getByRole(roleName);
      const users = response.data.data || response.data || [];
      setUsersCache(prev => ({ ...prev, [roleName]: users }));
      setInlineUsers(users);
    } catch (error) {
      console.error('Error fetching users:', error);
      setInlineUsers([]);
    }
  };

  // Open inline assignment dropdown
  const handleOpenInlineAssign = async (orderId, currentAssignments) => {
    setInlineAssignOrderId(orderId);
    setInlineAssignType('cadDesigner');
    // Pre-select current assigned user if exists
    setInlineAssignUserId(currentAssignments?.cadDesigner?._id || '');
    await fetchUsersForRole('designer');
  };

  // Handle inline assign type change
  const handleInlineAssignTypeChange = async (type) => {
    setInlineAssignType(type);
    const order = orders.find(o => o._id === inlineAssignOrderId);
    // Pre-select current assigned user for this type
    setInlineAssignUserId(order?.assignments?.[type]?._id || '');

    const roleMap = {
      cadDesigner: 'designer',
      manufacturer: 'manufacturer',
      admin: 'admin'
    };
    await fetchUsersForRole(roleMap[type] || 'admin');
  };

  // Handle inline assignment submit
  const handleInlineAssign = async () => {
    if (!inlineAssignUserId) {
      toast.error('Please select a user');
      return;
    }

    try {
      setInlineAssigning(true);
      const response = await orderAPI.assignUser(inlineAssignOrderId, {
        assignType: inlineAssignType,
        userId: inlineAssignUserId
      });

      // Update the order in local state with new assignments
      setOrders(prev => prev.map(order => {
        if (order._id === inlineAssignOrderId) {
          return {
            ...order,
            assignments: response.data.data.assignments
          };
        }
        return order;
      }));

      toast.success(`${inlineAssignType === 'cadDesigner' ? 'CAD Designer' : inlineAssignType === 'manufacturer' ? 'Manufacturer' : 'Admin'} assigned successfully`);
      setInlineAssignOrderId(null);
    } catch (error) {
      toast.error('Failed to assign user');
    } finally {
      setInlineAssigning(false);
    }
  };

  // Close inline assignment
  const handleCloseInlineAssign = () => {
    setInlineAssignOrderId(null);
    setInlineAssignUserId('');
  };

  // Handle bulk assignment
  const handleBulkAssign = async () => {
    if (!assignUserId) {
      toast.error('Please select a user to assign');
      return;
    }

    if (selectedOrders.length === 0) {
      toast.error('No orders selected');
      return;
    }

    try {
      setAssigning(true);
      await orderAPI.bulkAssign({
        orderIds: selectedOrders,
        assignType,
        userId: assignUserId
      });
      toast.success(`Successfully assigned ${selectedOrders.length} orders`);
      setShowAssignModal(false);
      setSelectedOrders([]);
      fetchOrders();
    } catch (error) {
      toast.error('Failed to assign orders');
    } finally {
      setAssigning(false);
    }
  };

  // Handle bulk status change
  const handleBulkStatusChange = async () => {
    if (!bulkStatus) {
      toast.error('Please select a status');
      return;
    }

    if (selectedOrders.length === 0) {
      toast.error('No orders selected');
      return;
    }

    try {
      setUpdatingStatus(true);
      const response = await orderAPI.bulkUpdateStatus({
        orderIds: selectedOrders,
        status: bulkStatus,
        notes: bulkStatusNotes
      });
      toast.success(response.data.message || `Updated ${selectedOrders.length} orders to "${bulkStatus}"`);
      setShowBulkStatusModal(false);
      setBulkStatus('');
      setBulkStatusNotes('');
      setSelectedOrders([]);
      fetchOrders();
    } catch (error) {
      toast.error('Failed to update order statuses: ' + (error.response?.data?.message || error.message));
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Open bulk status modal
  const handleOpenBulkStatusModal = () => {
    setBulkStatus('');
    setBulkStatusNotes('');
    setShowBulkStatusModal(true);
  };

  // Open docket modal
  const handleOpenDocketModal = async () => {
    try {
      if (usersCache.manufacturer.length > 0) {
        setManufacturers(usersCache.manufacturer);
      } else {
        const response = await userAPI.getByRole('manufacturer');
        const mfrs = response.data.data || response.data || [];
        setManufacturers(mfrs);
        setUsersCache(prev => ({ ...prev, manufacturer: mfrs }));
      }
      setDocketManufacturerId('');
      setDocketNotes('');
      setShowDocketModal(true);
    } catch (error) {
      toast.error('Failed to load manufacturers');
    }
  };

  // Handle docket generation
  const handleGenerateDocket = async () => {
    if (!docketManufacturerId) {
      toast.error('Please select a manufacturer');
      return;
    }

    try {
      setGeneratingDocket(true);

      // Extract job IDs from selected orders
      const jobIds = [];
      const selectedOrderObjects = orders.filter(o => selectedOrders.includes(o._id));

      selectedOrderObjects.forEach(order => {
        if (order.jobs && order.jobs.length > 0) {
          order.jobs.forEach(job => jobIds.push(job._id));
        }
      });

      if (jobIds.length === 0) {
        toast.error('Selected orders have no jobs created yet. Please assign them first.');
        setGeneratingDocket(false);
        return;
      }

      await docketAPI.create({
        jobIds,
        manufacturerId: docketManufacturerId,
        notes: docketNotes
      });

      toast.success('Docket generated successfully');
      setShowDocketModal(false);
      setSelectedOrders([]);
      fetchOrders();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to generate docket');
    } finally {
      setGeneratingDocket(false);
    }
  };

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">Orders</h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item active">Orders</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <section className="content">
        <div className="container-fluid">
          {/* Sync Buttons */}
          <div className="row mb-3">
            <div className="col-md-12">
              <div className="btn-group">
                <button
                  className="btn btn-warning"
                  onClick={() => handleOpenSyncModal('amazon')}
                  disabled={syncing.amazon}
                >
                  {syncing.amazon ? (
                    <><span className="spinner-border spinner-border-sm mr-1"></span> Syncing...</>
                  ) : (
                    <><i className="fab fa-amazon mr-1"></i> Sync Amazon</>
                  )}
                </button>
                <button
                  className="btn btn-info"
                  onClick={() => handleOpenSyncModal('ebay')}
                  disabled={syncing.ebay}
                >
                  {syncing.ebay ? (
                    <><span className="spinner-border spinner-border-sm mr-1"></span> Syncing...</>
                  ) : (
                    <><i className="fab fa-ebay mr-1"></i> Sync eBay</>
                  )}
                </button>
                <Link to="/orders/new" className="btn btn-success">
                  <i className="fas fa-plus mr-1"></i> Manual Order
                </Link>
              </div>
            </div>
          </div>

          {/* Bulk Action Bar */}
          {isSomeSelected && (
            <div className="alert alert-info d-flex justify-content-between align-items-center mb-3">
              <span>
                <i className="fas fa-check-square mr-2"></i>
                <strong>{selectedOrders.length}</strong> order(s) selected
              </span>
              <div>
                <button
                  className="btn btn-warning btn-sm mr-2"
                  onClick={handleOpenBulkStatusModal}
                >
                  <i className="fas fa-exchange-alt mr-1"></i> Change Status
                </button>
                <button
                  className="btn btn-primary btn-sm mr-2"
                  onClick={handleOpenAssignModal}
                >
                  <i className="fas fa-user-plus mr-1"></i> Assign Users
                </button>
                <button
                  className="btn btn-success btn-sm mr-2"
                  onClick={handleBulkDownload}
                  disabled={downloading}
                >
                  {downloading ? (
                    <><span className="spinner-border spinner-border-sm mr-1"></span> Downloading...</>
                  ) : (
                    <><i className="fas fa-download mr-1"></i> Download Files</>
                  )}
                </button>
                <button
                  className="btn btn-dark btn-sm mr-2"
                  onClick={handleOpenDocketModal}
                >
                  <i className="fas fa-file-invoice mr-1"></i> Generate Docket
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSelectedOrders([])}
                >
                  <i className="fas fa-times mr-1"></i> Clear Selection
                </button>
              </div>
            </div>
          )}

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
                <div className="col-md-3">
                  <div className="form-group">
                    <label>Search</label>
                    <input
                      type="text"
                      className="form-control"
                      name="search"
                      placeholder="Order ID, Customer name..."
                      value={filters.search}
                      onChange={handleFilterChange}
                    />
                  </div>
                </div>
                <div className="col-md-2">
                  <div className="form-group">
                    <label>Channel</label>
                    <select
                      className="form-control"
                      name="channel"
                      value={filters.channel}
                      onChange={handleFilterChange}
                    >
                      <option value="">All Channels</option>
                      <option value="amazon">Amazon</option>
                      <option value="ebay">eBay</option>
                      <option value="manual">Manual</option>
                    </select>
                  </div>
                </div>
                <div className="col-md-2">
                  <div className="form-group">
                    <label>Status</label>
                    <select
                      className="form-control"
                      name="status"
                      value={filters.status}
                      onChange={handleFilterChange}
                    >
                      <option value="">All Status</option>
                      <option value="pending">Pending</option>
                      <option value="processing">Processing</option>
                      <option value="shipped">Shipped</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
                <div className="col-md-2">
                  <div className="form-group">
                    <label>CAD Status</label>
                    <select
                      className="form-control"
                      name="cadStatus"
                      value={filters.cadStatus}
                      onChange={handleFilterChange}
                    >
                      <option value="">All CAD</option>
                      <option value="has_cad">Has CAD (All)</option>
                      <option value="partial">Partial CAD</option>
                      <option value="no_cad">No CAD</option>
                    </select>
                  </div>
                </div>
                {accountCodes.length > 0 && (
                  <div className="col-md-2">
                    <div className="form-group">
                      <label>Account</label>
                      <select
                        className="form-control"
                        name="accountCode"
                        value={filters.accountCode}
                        onChange={handleFilterChange}
                      >
                        <option value="">All Accounts</option>
                        {accountCodes.map(code => (
                          <option key={code} value={code}>{code}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
              <div className="row">
                <div className="col-md-2">
                  <div className="form-group">
                    <label>Start Date</label>
                    <input
                      type="date"
                      className="form-control"
                      name="startDate"
                      value={filters.startDate}
                      onChange={handleFilterChange}
                    />
                  </div>
                </div>
                <div className="col-md-2">
                  <div className="form-group">
                    <label>End Date</label>
                    <input
                      type="date"
                      className="form-control"
                      name="endDate"
                      value={filters.endDate}
                      onChange={handleFilterChange}
                    />
                  </div>
                </div>
                <div className="col-md-2 d-flex align-items-end">
                  <div className="form-group">
                    <button
                      className="btn btn-secondary btn-block"
                      onClick={() => {
                        setFilters({
                          search: '',
                          channel: '',
                          status: '',
                          cadStatus: '',
                          accountCode: '',
                          startDate: '',
                          endDate: ''
                        });
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Orders Table */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">All Orders</h3>
            </div>
            <div className="card-body">
              <DataTable
                columns={[
                  {
                    key: 'orderId',
                    title: 'Order ID',
                    sortable: true,
                    render: (_, order) => (
                      <div>
                        <Link to={`/orders/${order._id}`}>
                          <strong>{order.externalOrderId || order.marketplaceOrderId || order.orderNumber || order._id?.slice(-8).toUpperCase()}</strong>
                        </Link>
                        {order.accountCode && (
                          <small className="d-block text-muted">{order.accountCode}</small>
                        )}
                      </div>
                    )
                  },
                  {
                    key: 'sku',
                    title: 'SKU / CAD',
                    render: (_, order) => {
                      const items = order.items || [];
                      if (items.length === 0) return <span className="text-muted">-</span>;

                      return (
                        <div>
                          {items.map((item, idx) => (
                            <div key={idx} className="mb-1 d-flex align-items-center">
                              <code className={item.hasCadFile ? 'text-success font-weight-bold' : ''}>
                                {item.sku}
                              </code>
                              {item.hasCadFile && (
                                <a
                                  href={`${API_BASE_URL}${item.cadFilePath}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-2 btn btn-xs btn-outline-success p-0 px-1"
                                  title="Download STL"
                                >
                                  <i className="fas fa-cube"></i>
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    }
                  },
                  {
                    key: 'tat',
                    title: 'TAT Left',
                    render: (_, order) => {
                      const jobs = order.jobs || []; // Ensure jobs are populated
                      const cadJob = jobs.find(j => j.status === 'cad_assigned' || j.status === 'cad_in_progress');
                      if (!cadJob || !cadJob.cadDeadline) return <span className="text-muted">-</span>;

                      const remaining = getRemainingTime(cadJob.cadDeadline);
                      return (
                        <span className={`badge badge-${remaining.color}`}>
                          <i className="fas fa-clock mr-1"></i>
                          {remaining.text}
                        </span>
                      );
                    }
                  },
                  {
                    key: 'channel',
                    title: 'Channel',
                    sortable: true,
                    render: (channel) => (
                      <span className={`badge badge-${getChannelBadge(channel)}`}>
                        {channel?.toUpperCase()}
                      </span>
                    )
                  },
                  {
                    key: 'customer',
                    title: 'Customer',
                    sortable: true,
                    render: (_, order) => (
                      <div>
                        <strong>{order.customerName || order.buyerName || '-'}</strong>
                        {order.customerEmail && (
                          <small className="d-block text-muted">{order.customerEmail}</small>
                        )}
                      </div>
                    )
                  },
                  {
                    key: 'items',
                    title: 'Items',
                    render: (_, order) => order.items?.length || order.itemCount || 0
                  },
                  {
                    key: 'cad',
                    title: 'CAD Status',
                    render: (_, order) => {
                      if (!order.cadSummary || order.cadSummary.total === 0) {
                        return <span className="badge badge-secondary">-</span>;
                      }
                      if (order.cadSummary.status === 'all_cad') {
                        return (
                          <span className="badge badge-success" title={`${order.cadSummary.withCad}/${order.cadSummary.total} items have CAD files`}>
                            <i className="fas fa-check mr-1"></i>Yes
                          </span>
                        );
                      }
                      if (order.cadSummary.status === 'partial') {
                        return (
                          <span className="badge badge-warning" title={`${order.cadSummary.withCad}/${order.cadSummary.total} items have CAD files`}>
                            <i className="fas fa-exclamation mr-1"></i>Partial
                          </span>
                        );
                      }
                      if (order.cadSummary.status === 'no_cad') {
                        return (
                          <span className="badge badge-danger" title="No items have CAD files">
                            <i className="fas fa-times mr-1"></i>No
                          </span>
                        );
                      }
                      return <span className="badge badge-secondary">-</span>;
                    }
                  },
                  {
                    key: 'total',
                    title: 'Total',
                    sortable: true,
                    render: (_, order) => formatCurrency(order.totalAmount || order.orderTotal, order.currency)
                  },
                  {
                    key: 'status',
                    title: 'Status',
                    sortable: true,
                    render: (status) => (
                      <span className={`badge badge-${getStatusBadge(status)}`}>
                        {status}
                      </span>
                    )
                  },
                  {
                    key: 'assignedUser',
                    title: 'Assigned To',
                    render: (_, order) => {
                      const isEditing = inlineAssignOrderId === order._id;
                      const assignments = order.assignments || {};

                      if (isEditing) {
                        return (
                          <div className="inline-assign-form" style={{ minWidth: '200px' }}>
                            <select
                              className="form-control form-control-sm mb-1"
                              value={inlineAssignType}
                              onChange={(e) => handleInlineAssignTypeChange(e.target.value)}
                              disabled={inlineAssigning}
                            >
                              <option value="cadDesigner">CAD Designer</option>
                              <option value="manufacturer">Manufacturer</option>
                              <option value="admin">Admin</option>
                            </select>
                            <select
                              className="form-control form-control-sm mb-1"
                              value={inlineAssignUserId}
                              onChange={(e) => setInlineAssignUserId(e.target.value)}
                              disabled={inlineAssigning}
                            >
                              <option value="">-- Select User --</option>
                              {inlineUsers.map(user => (
                                <option key={user._id} value={user._id}>
                                  {user.name}
                                </option>
                              ))}
                            </select>
                            <div className="btn-group btn-group-sm">
                              <button
                                className="btn btn-success btn-xs"
                                onClick={handleInlineAssign}
                                disabled={inlineAssigning || !inlineAssignUserId}
                                title="Save"
                              >
                                {inlineAssigning ? (
                                  <span className="spinner-border spinner-border-sm"></span>
                                ) : (
                                  <i className="fas fa-check"></i>
                                )}
                              </button>
                              <button
                                className="btn btn-secondary btn-xs"
                                onClick={handleCloseInlineAssign}
                                disabled={inlineAssigning}
                                title="Cancel"
                              >
                                <i className="fas fa-times"></i>
                              </button>
                            </div>
                          </div>
                        );
                      }

                      // Display assigned users
                      const hasAssignments = assignments.cadDesigner || assignments.manufacturer || assignments.admin;

                      return (
                        <div style={{ minWidth: '120px' }}>
                          {hasAssignments ? (
                            <div className="d-flex flex-column">
                              {assignments.cadDesigner && (
                                <small className="text-info" title="CAD Designer">
                                  <i className="fas fa-pencil-ruler mr-1"></i>
                                  {assignments.cadDesigner.name}
                                </small>
                              )}
                              {assignments.manufacturer && (
                                <small className="text-success" title="Manufacturer">
                                  <i className="fas fa-industry mr-1"></i>
                                  {assignments.manufacturer.name}
                                </small>
                              )}
                              {assignments.admin && !assignments.cadDesigner && !assignments.manufacturer && (
                                <small className="text-secondary" title="Admin">
                                  <i className="fas fa-user-shield mr-1"></i>
                                  {assignments.admin.name}
                                </small>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted">
                              <i className="fas fa-user-slash mr-1"></i>Unassigned
                            </span>
                          )}
                          <button
                            className="btn btn-xs btn-outline-primary mt-1"
                            onClick={() => handleOpenInlineAssign(order._id, assignments)}
                            title="Assign User"
                          >
                            <i className="fas fa-user-plus mr-1"></i>
                            {hasAssignments ? 'Change' : 'Assign'}
                          </button>
                        </div>
                      );
                    }
                  },
                  {
                    key: 'orderDate',
                    title: 'Order Date',
                    sortable: true,
                    render: (_, order) => formatDate(order.orderDate || order.purchaseDate || order.createdAt)
                  },
                  {
                    key: 'actions',
                    title: 'Actions',
                    render: (_, order) => (
                      <div className="btn-group">
                        <Link
                          to={`/orders/${order._id}`}
                          className="btn btn-sm btn-info"
                          title="View Details"
                        >
                          <i className="fas fa-eye"></i>
                        </Link>
                        <button
                          className="btn btn-sm btn-warning"
                          onClick={() => handleOpenEditModal(order)}
                          title="Edit Order"
                        >
                          <i className="fas fa-edit"></i>
                        </button>
                      </div>
                    )
                  }
                ]}
                data={orders}
                pagination={pagination}
                onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
                onLimitChange={(limit) => setPagination(prev => ({ ...prev, limit, page: 1 }))}
                onSort={handleSort}
                loading={loading}
                emptyMessage="No orders found"
                emptyIcon="fas fa-shopping-cart"
                selectable={true}
                selectedRows={selectedOrders}
                onSelectRow={handleSelectOrder}
                onSelectAll={(checked) => {
                  if (checked) {
                    setSelectedOrders(orders.map(order => order._id));
                  } else {
                    setSelectedOrders([]);
                  }
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Bulk Assign Modal */}
      {showAssignModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="fas fa-user-plus mr-2"></i>
                  Assign Users to {selectedOrders.length} Order(s)
                </h5>
                <button
                  type="button"
                  className="close"
                  onClick={() => setShowAssignModal(false)}
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
                    onChange={handleAssignTypeChange}
                  >
                    <option value="cadDesigner">CAD Designer</option>
                    <option value="manufacturer">Manufacturer</option>
                    <option value="admin">Admin</option>
                  </select>
                  <small className="text-muted">
                    {assignType === 'cadDesigner' && 'Assign a CAD designer to create/manage CAD files for these orders'}
                    {assignType === 'manufacturer' && 'Assign a manufacturer to handle production for these orders'}
                    {assignType === 'admin' && 'Assign an admin to oversee these orders'}
                  </small>
                </div>

                <div className="form-group">
                  <label>Select User</label>
                  <select
                    className="form-control"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
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

                <div className="alert alert-secondary mt-3">
                  <small>
                    <i className="fas fa-info-circle mr-1"></i>
                    This will create or update jobs for all items in the selected {selectedOrders.length} order(s) and assign them to the selected user.
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
                  className="btn btn-primary"
                  onClick={handleBulkAssign}
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

      {/* Bulk Status Change Modal */}
      {showBulkStatusModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-warning">
                <h5 className="modal-title">
                  <i className="fas fa-exchange-alt mr-2"></i>
                  Change Status for {selectedOrders.length} Order(s)
                </h5>
                <button
                  type="button"
                  className="close"
                  onClick={() => setShowBulkStatusModal(false)}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label>New Status <span className="text-danger">*</span></label>
                  <select
                    className="form-control"
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                  >
                    <option value="">-- Select Status --</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="shipped">Shipped</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Notes (Optional)</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    value={bulkStatusNotes}
                    onChange={(e) => setBulkStatusNotes(e.target.value)}
                    placeholder="Add notes about this status change..."
                  />
                </div>

                <div className="alert alert-secondary mt-3 mb-0">
                  <small>
                    <i className="fas fa-info-circle mr-1"></i>
                    This will change the status of all {selectedOrders.length} selected order(s).
                    {bulkStatus === 'cancelled' && (
                      <span className="text-danger d-block mt-1">
                        <i className="fas fa-exclamation-triangle mr-1"></i>
                        Warning: Cancelled orders cannot be easily restored.
                      </span>
                    )}
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowBulkStatusModal(false)}
                  disabled={updatingStatus}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`btn ${bulkStatus === 'cancelled' ? 'btn-danger' : 'btn-warning'}`}
                  onClick={handleBulkStatusChange}
                  disabled={updatingStatus || !bulkStatus}
                >
                  {updatingStatus ? (
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

      {/* Edit Order Modal */}
      {showEditModal && editingOrder && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="fas fa-edit mr-2"></i>
                  Edit Order: {editingOrder.externalOrderId || editingOrder._id?.slice(-8).toUpperCase()}
                </h5>
                <button
                  type="button"
                  className="close"
                  onClick={() => { setShowEditModal(false); setEditingOrder(null); }}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="row">
                  {/* Order Details */}
                  <div className="col-md-6">
                    <h6 className="border-bottom pb-2 mb-3">
                      <i className="fas fa-user mr-2"></i>Customer Information
                    </h6>
                    <div className="form-group">
                      <label>Customer Name</label>
                      <input
                        type="text"
                        className="form-control"
                        name="buyerName"
                        value={editFormData.buyerName}
                        onChange={handleEditFormChange}
                      />
                    </div>
                    <div className="form-group">
                      <label>Customer Email</label>
                      <input
                        type="email"
                        className="form-control"
                        name="buyerEmail"
                        value={editFormData.buyerEmail}
                        onChange={handleEditFormChange}
                      />
                    </div>
                    <div className="row">
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Status</label>
                          <select
                            className="form-control"
                            name="status"
                            value={editFormData.status}
                            onChange={handleEditFormChange}
                          >
                            <option value="pending">Pending</option>
                            <option value="processing">Processing</option>
                            <option value="shipped">Shipped</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Total Amount</label>
                          <div className="input-group">
                            <input
                              type="number"
                              className="form-control"
                              name="totalAmount"
                              value={editFormData.totalAmount}
                              onChange={handleEditFormChange}
                              step="0.01"
                            />
                            <div className="input-group-append">
                              <select
                                className="form-control"
                                name="currency"
                                value={editFormData.currency}
                                onChange={handleEditFormChange}
                              >
                                <option value="USD">USD</option>
                                <option value="INR">INR</option>
                                <option value="EUR">EUR</option>
                                <option value="GBP">GBP</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <h6 className="border-bottom pb-2 mb-3 mt-4">
                      <i className="fas fa-shipping-fast mr-2"></i>Shipping Address
                    </h6>
                    <div className="form-group">
                      <label>Name</label>
                      <input
                        type="text"
                        className="form-control"
                        name="shipping_name"
                        value={editFormData.shippingAddress?.name || ''}
                        onChange={handleEditFormChange}
                      />
                    </div>
                    <div className="form-group">
                      <label>Address Line 1</label>
                      <input
                        type="text"
                        className="form-control"
                        name="shipping_addressLine1"
                        value={editFormData.shippingAddress?.addressLine1 || ''}
                        onChange={handleEditFormChange}
                      />
                    </div>
                    <div className="form-group">
                      <label>Address Line 2</label>
                      <input
                        type="text"
                        className="form-control"
                        name="shipping_addressLine2"
                        value={editFormData.shippingAddress?.addressLine2 || ''}
                        onChange={handleEditFormChange}
                      />
                    </div>
                    <div className="row">
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>City</label>
                          <input
                            type="text"
                            className="form-control"
                            name="shipping_city"
                            value={editFormData.shippingAddress?.city || ''}
                            onChange={handleEditFormChange}
                          />
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>State</label>
                          <input
                            type="text"
                            className="form-control"
                            name="shipping_state"
                            value={editFormData.shippingAddress?.state || ''}
                            onChange={handleEditFormChange}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="row">
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Postal Code</label>
                          <input
                            type="text"
                            className="form-control"
                            name="shipping_postalCode"
                            value={editFormData.shippingAddress?.postalCode || ''}
                            onChange={handleEditFormChange}
                          />
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Country</label>
                          <input
                            type="text"
                            className="form-control"
                            name="shipping_country"
                            value={editFormData.shippingAddress?.country || ''}
                            onChange={handleEditFormChange}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="form-group mt-3">
                      <label>Notes</label>
                      <textarea
                        className="form-control"
                        name="notes"
                        rows="3"
                        value={editFormData.notes}
                        onChange={handleEditFormChange}
                        placeholder="Add any notes about this order..."
                      />
                    </div>
                  </div>

                  {/* Images Section */}
                  <div className="col-md-6">
                    <h6 className="border-bottom pb-2 mb-3">
                      <i className="fas fa-images mr-2"></i>Order Images
                    </h6>

                    {/* Existing Images */}
                    {editingOrder.images && editingOrder.images.length > 0 && (
                      <div className="mb-3">
                        <label className="d-block mb-2">Existing Images</label>
                        <div className="row">
                          {editingOrder.images.map((img, index) => (
                            <div key={img._id || index} className="col-4 mb-2">
                              <div className="position-relative">
                                <img
                                  src={`${API_BASE_URL}${img.filePath}`}
                                  alt={`Order ${index + 1}`}
                                  className="img-fluid img-thumbnail"
                                  style={{ width: '100%', height: '100px', objectFit: 'cover', cursor: 'pointer' }}
                                  onClick={() => window.open(`${API_BASE_URL}${img.filePath}`, '_blank', 'noopener,noreferrer')}
                                />
                                <button
                                  type="button"
                                  className="btn btn-danger btn-xs position-absolute"
                                  style={{ top: '5px', right: '5px', padding: '2px 6px' }}
                                  onClick={() => handleDeleteOrderImage(img._id)}
                                >
                                  <i className="fas fa-trash"></i>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Upload New Images */}
                    <div className="form-group">
                      <label>Upload New Images</label>
                      <div className="custom-file">
                        <input
                          type="file"
                          className="custom-file-input"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          multiple
                          ref={imageInputRef}
                          onChange={handleImageSelect}
                        />
                        <label className="custom-file-label">Choose images...</label>
                      </div>
                      <small className="text-muted">JPG, PNG, GIF, WEBP (max 10MB each)</small>
                    </div>

                    {/* New Images Preview */}
                    {editImages.length > 0 && (
                      <div className="mt-3">
                        <label className="d-block mb-2">New Images to Upload</label>
                        <div className="d-flex flex-wrap">
                          {editImages.map((img, index) => (
                            <div key={index} className="position-relative mr-2 mb-2">
                              <img
                                src={URL.createObjectURL(img)}
                                alt={`New ${index + 1}`}
                                className="img-thumbnail"
                                style={{ width: '80px', height: '80px', objectFit: 'cover' }}
                              />
                              <button
                                type="button"
                                className="btn btn-danger btn-xs position-absolute"
                                style={{ top: '-5px', right: '-5px', padding: '2px 6px', fontSize: '10px' }}
                                onClick={() => removeEditImage(index)}
                              >
                                <i className="fas fa-times"></i>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Order Items Info */}
                    {editingOrder.items && editingOrder.items.length > 0 && (
                      <div className="mt-4">
                        <h6 className="border-bottom pb-2 mb-3">
                          <i className="fas fa-list mr-2"></i>Order Items ({editingOrder.items.length})
                        </h6>
                        <div className="table-responsive">
                          <table className="table table-sm table-striped">
                            <thead>
                              <tr>
                                <th>SKU</th>
                                <th>Product</th>
                                <th>Qty</th>
                                <th>Price</th>
                                <th>CAD</th>
                              </tr>
                            </thead>
                            <tbody>
                              {editingOrder.items.map((item, idx) => (
                                <tr key={item._id || idx}>
                                  <td><small>{item.sku || '-'}</small></td>
                                  <td><small className="text-truncate d-inline-block" style={{ maxWidth: '150px' }}>{item.productName}</small></td>
                                  <td>{item.quantity}</td>
                                  <td>{item.itemPrice ? `$${item.itemPrice}` : '-'}</td>
                                  <td>
                                    {item.hasCadFile ? (
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
                                      <span className="badge badge-secondary" title="No CAD file">
                                        <i className="fas fa-times"></i>
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setShowEditModal(false); setEditingOrder(null); }}
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveOrder}
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <span className="spinner-border spinner-border-sm mr-1"></span>
                      Saving...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-save mr-1"></i>
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sync Amazon Modal with Date Range */}
      {showSyncModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className={`modal-header bg-${syncType === 'amazon' ? 'warning' : 'info'}`}>
                <h5 className="modal-title">
                  <i className={syncType === 'amazon' ? 'fab fa-amazon mr-2' : 'fab fa-ebay mr-2'}></i>
                  Sync {syncType === 'amazon' ? 'Amazon' : 'eBay'} Orders
                </h5>
                <button
                  type="button"
                  className="close"
                  onClick={() => setShowSyncModal(false)}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <p>Select the marketplace and date range to fetch orders:</p>
                <div className="row">
                  <div className="col-md-12">
                    <div className="form-group">
                      <label>Marketplace Account</label>
                      <select
                        className="form-control"
                        value={syncAccountCode}
                        onChange={(e) => setSyncAccountCode(e.target.value)}
                      >
                        <option value="all">All Activated Accounts</option>
                        {marketplaceAccounts.map(account => (
                          <option key={account} value={account}>{account}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="row">
                  <div className="col-md-6">
                    <div className="form-group">
                      <label>From Date</label>
                      <input
                        type="date"
                        className="form-control"
                        value={syncDateRange.fromDate}
                        onChange={(e) => setSyncDateRange(prev => ({ ...prev, fromDate: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="form-group">
                      <label>To Date</label>
                      <input
                        type="date"
                        className="form-control"
                        value={syncDateRange.toDate}
                        onChange={(e) => setSyncDateRange(prev => ({ ...prev, toDate: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
                <div className="row mt-3">
                  <div className="col-md-12">
                    <div className="custom-control custom-checkbox">
                      <input
                        type="checkbox"
                        className="custom-control-input"
                        id="importAllCheckbox"
                        checked={importAll}
                        onChange={(e) => setImportAll(e.target.checked)}
                      />
                      <label className="custom-control-label font-weight-bold" htmlFor="importAllCheckbox">
                        Import All Paid Orders (including FBA & Shipped)
                      </label>
                    </div>
                    <small className="text-muted d-block mt-1">
                      Check this to fetch FBA and already shipped orders for record keeping and reporting.
                    </small>
                  </div>
                </div>
                <div className={`alert mt-3 mb-0 ${importAll ? 'alert-warning' : 'alert-info'}`}>
                  <small>
                    <i className="fas fa-info-circle mr-1"></i>
                    {importAll
                      ? `Fetching ALL ${syncType === 'amazon' ? 'Amazon' : 'eBay'} orders regardless of status or fulfillment channel.`
                      : syncType === 'amazon'
                        ? 'Only Pending, Unshipped, or PartiallyShipped MFN orders will be fetched.'
                        : 'Only Paid eBay orders will be fetched.'}
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowSyncModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`btn btn-${syncType === 'amazon' ? 'warning' : 'info'}`}
                  onClick={syncType === 'amazon' ? handleSyncAmazon : handleSyncEbay}
                  disabled={syncing[syncType]}
                >
                  {syncing[syncType] ? (
                    <><span className="spinner-border spinner-border-sm mr-1"></span> Syncing...</>
                  ) : (
                    <><i className="fas fa-sync mr-1"></i> Sync {syncType === 'amazon' ? 'Amazon' : 'eBay'}</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Missing SKUs Modal */}
      {missingSKUsModal.show && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-warning">
                <h5 className="modal-title">
                  <i className="fas fa-exclamation-triangle mr-2"></i>
                  Missing SKUs in SKU Master
                </h5>
                <button
                  type="button"
                  className="close"
                  onClick={() => setMissingSKUsModal({ show: false, skus: [] })}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <p>The following SKUs from imported orders are not found in SKU Master:</p>
                <div className="table-responsive" style={{ maxHeight: '300px' }}>
                  <table className="table table-sm table-striped">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Product Name</th>
                        <th>ASIN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missingSKUsModal.skus.map((item, idx) => (
                        <tr key={idx}>
                          <td><code>{item.sku}</code></td>
                          <td><small className="text-truncate d-inline-block" style={{ maxWidth: '200px' }}>{item.productName || '-'}</small></td>
                          <td><small>{item.asin || '-'}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="alert alert-info mt-3 mb-0">
                  <small>
                    <i className="fas fa-info-circle mr-1"></i>
                    Add these SKUs to SKU Master to enable CAD file tracking and assignment.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setMissingSKUsModal({ show: false, skus: [] })}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleGoToSkuMaster}
                >
                  <i className="fas fa-arrow-right mr-1"></i>
                  Go to SKU Master
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sync Result Modal */}
      {syncResultModal.show && syncResultModal.data && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-info text-white">
                <h5 className="modal-title">
                  <i className={syncType === 'amazon' ? 'fab fa-amazon mr-2' : 'fab fa-ebay mr-2'}></i>
                  {syncType === 'amazon' ? 'Amazon' : 'eBay'} Sync Results
                </h5>
                <button
                  type="button"
                  className="close text-white"
                  onClick={() => setSyncResultModal({ show: false, data: null })}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                {/* Summary Stats */}
                <div className="row mb-4">
                  <div className="col-md-3">
                    <div className="info-box bg-success mb-0">
                      <span className="info-box-icon"><i className="fas fa-check"></i></span>
                      <div className="info-box-content">
                        <span className="info-box-text">Imported</span>
                        <span className="info-box-number">{syncResultModal.data.imported || 0}</span>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="info-box bg-warning mb-0">
                      <span className="info-box-icon"><i className="fas fa-forward"></i></span>
                      <div className="info-box-content">
                        <span className="info-box-text">Skipped</span>
                        <span className="info-box-number">{syncResultModal.data.skipped || 0}</span>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="info-box bg-primary mb-0">
                      <span className="info-box-icon"><i className="fas fa-briefcase"></i></span>
                      <div className="info-box-content">
                        <span className="info-box-text">Jobs Created</span>
                        <span className="info-box-number">{syncResultModal.data.jobsCreated || 0}</span>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="info-box bg-secondary mb-0">
                      <span className="info-box-icon"><i className="fas fa-database"></i></span>
                      <div className="info-box-content">
                        <span className="info-box-text">Total Found</span>
                        <span className="info-box-number">{syncResultModal.data.stats?.ordersFound || syncResultModal.data.stats?.total_retrieved || syncResultModal.data.total || 0}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Order Breakdown */}
                {syncResultModal.data.stats && (
                  <div className="card mb-3">
                    <div className="card-header bg-light">
                      <h6 className="mb-0">
                        <i className="fas fa-chart-pie mr-2"></i>
                        Order Breakdown from {syncType === 'amazon' ? 'Amazon' : 'eBay'}
                      </h6>
                    </div>
                    <div className="card-body p-0">
                      <table className="table table-striped mb-0">
                        <tbody>
                          {syncType === 'amazon' ? (
                            <>
                              <tr className="table-success">
                                <td><i className="fas fa-truck mr-2"></i>MFN Pending/Unshipped Orders</td>
                                <td className="text-right"><strong>{syncResultModal.data.stats.mfn_pending || 0}</strong></td>
                                <td><span className="badge badge-success">Imported for Manufacturing</span></td>
                              </tr>
                              <tr className="table-secondary">
                                <td><i className="fab fa-amazon mr-2"></i>FBA Orders (Fulfilled by Amazon)</td>
                                <td className="text-right"><strong>{syncResultModal.data.stats.fba_excluded || 0}</strong></td>
                                <td><span className="badge badge-secondary">Excluded - No manufacturing needed</span></td>
                              </tr>
                              <tr className="table-secondary">
                                <td><i className="fas fa-shipping-fast mr-2"></i>Shipped Orders</td>
                                <td className="text-right"><strong>{syncResultModal.data.stats.shipped_excluded || 0}</strong></td>
                                <td><span className="badge badge-secondary">Excluded - Already completed</span></td>
                              </tr>
                              <tr className="table-secondary">
                                <td><i className="fas fa-times-circle mr-2"></i>Other Status Orders</td>
                                <td className="text-right"><strong>{syncResultModal.data.stats.other_excluded || 0}</strong></td>
                                <td><span className="badge badge-secondary">Excluded - Cancelled/Returned</span></td>
                              </tr>
                            </>
                          ) : (
                            <>
                              <tr className="table-success">
                                <td><i className="fas fa-check-circle mr-2"></i>Successfully Imported</td>
                                <td className="text-right"><strong>{syncResultModal.data.stats.ordersImported || 0}</strong></td>
                                <td><span className="badge badge-success">New orders found</span></td>
                              </tr>
                              <tr className="table-warning">
                                <td><i className="fas fa-forward mr-2"></i>Skipped (Already Exists)</td>
                                <td className="text-right"><strong>{syncResultModal.data.stats.ordersSkipped || 0}</strong></td>
                                <td><span className="badge badge-warning">Already in database</span></td>
                              </tr>
                              <tr className="table-info">
                                <td><i className="fas fa-search mr-2"></i>Total Orders Processed</td>
                                <td className="text-right"><strong>{syncResultModal.data.stats.ordersFound || 0}</strong></td>
                                <td><span className="badge badge-info">Scanned by API</span></td>
                              </tr>
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Explanation */}
                {syncResultModal.data.explanation && syncResultModal.data.explanation.length > 0 && (
                  <div className="alert alert-info mb-3">
                    <h6 className="alert-heading">
                      <i className="fas fa-info-circle mr-2"></i>
                      Why some orders are not imported:
                    </h6>
                    <ul className="mb-0 pl-3">
                      {syncResultModal.data.explanation.map((msg, idx) => (
                        <li key={idx}><small>{msg}</small></li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Missing SKUs */}
                {syncResultModal.data.missingSKUs && syncResultModal.data.missingSKUs.length > 0 && (
                  <div className="alert alert-warning mb-0">
                    <h6 className="alert-heading">
                      <i className="fas fa-exclamation-triangle mr-2"></i>
                      {syncResultModal.data.missingSKUs.length} SKU(s) not in SKU Master
                    </h6>
                    <p className="mb-2"><small>These products were imported but don't have CAD files assigned:</small></p>
                    <div className="d-flex flex-wrap">
                      {syncResultModal.data.missingSKUs.slice(0, 5).map((sku, idx) => (
                        <code key={idx} className="mr-2 mb-1">{sku.sku}</code>
                      ))}
                      {syncResultModal.data.missingSKUs.length > 5 && (
                        <span className="text-muted">+{syncResultModal.data.missingSKUs.length - 5} more</span>
                      )}
                    </div>
                    <button
                      className="btn btn-warning btn-sm mt-2"
                      onClick={() => {
                        setMissingSKUsModal({ show: true, skus: syncResultModal.data.missingSKUs });
                        setSyncResultModal({ show: false, data: null });
                      }}
                    >
                      View All & Add to SKU Master
                    </button>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setSyncResultModal({ show: false, data: null })}
                >
                  <i className="fas fa-check mr-1"></i>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Docket Generation Modal */}
      {showDocketModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-dark text-white">
                <h5 className="modal-title">
                  <i className="fas fa-file-invoice mr-2"></i>
                  Generate Docket for {selectedOrders.length} Order(s)
                </h5>
                <button
                  type="button"
                  className="close text-white"
                  onClick={() => setShowDocketModal(false)}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label>Select Manufacturer <span className="text-danger">*</span></label>
                  <select
                    className="form-control"
                    value={docketManufacturerId}
                    onChange={(e) => setDocketManufacturerId(e.target.value)}
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
                  <label>Notes / Instructions</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    value={docketNotes}
                    onChange={(e) => setDocketNotes(e.target.value)}
                    placeholder="Add notes for the manufacturer..."
                  />
                </div>

                <div className="alert alert-info mt-3 mb-0">
                  <small>
                    <i className="fas fa-info-circle mr-1"></i>
                    Generating a docket will group all jobs from selected orders into a single batch for tracking.
                    The docket number will be generated automatically.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDocketModal(false)}
                  disabled={generatingDocket}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-dark"
                  onClick={handleGenerateDocket}
                  disabled={generatingDocket || !docketManufacturerId}
                >
                  {generatingDocket ? (
                    <>
                      <span className="spinner-border spinner-border-sm mr-1"></span>
                      Generating...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-check mr-1"></i>
                      Generate Docket
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

export default OrderList;
