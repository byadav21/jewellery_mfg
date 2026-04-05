import axios from 'axios';
import { toast } from 'react-toastify';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5002/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const { response } = error;

    if (response) {
      switch (response.status) {
        case 401:
          // Unauthorized - redirect to login
          localStorage.removeItem('token');
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
          break;
        case 403:
          toast.error('You do not have permission to perform this action');
          break;
        case 404:
          toast.error('Resource not found');
          break;
        case 422:
          // Validation error
          if (response.data.errors) {
            response.data.errors.forEach(err => {
              toast.error(`${err.field}: ${err.message}`);
            });
          }
          break;
        case 500:
          toast.error('Server error. Please try again later.');
          break;
        default:
          if (response.data.message) {
            toast.error(response.data.message);
          }
      }
    } else {
      toast.error('Network error. Please check your connection.');
    }

    return Promise.reject(error);
  }
);

export default api;

// API service functions
export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  changePassword: (data) => api.put('/auth/change-password', data),
  updateProfile: (data) => api.put('/auth/profile', data)
};

export const userAPI = {
  getAll: (params) => api.get('/users', { params }),
  getById: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  assignRoles: (id, roles) => api.put(`/users/${id}/roles`, { roles }),
  activate: (id) => api.put(`/users/${id}/activate`),
  deactivate: (id) => api.put(`/users/${id}/deactivate`),
  resetPassword: (id, newPassword) => api.put(`/users/${id}/reset-password`, { newPassword }),
  getByRole: (roleName) => api.get(`/users/role/${roleName}`)
};

export const roleAPI = {
  getAll: () => api.get('/roles'),
  getById: (id) => api.get(`/roles/${id}`)
};

export const jobAPI = {
  getAll: (params) => api.get('/jobs', { params }),
  getById: (id) => api.get(`/jobs/${id}`),
  create: (data) => api.post('/jobs', data),
  update: (id, data) => api.put(`/jobs/${id}`, data),
  updateStatus: (id, status, remarks) => api.put(`/jobs/${id}/status`, { status, remarks }),
  cancel: (id, reason) => api.put(`/jobs/${id}/cancel`, { reason }),
  getHistory: (id) => api.get(`/jobs/${id}/history`),
  getStatistics: () => api.get('/jobs/statistics'),
  downloadImagesZip: (id, type) => api.get(`/jobs/${id}/download-images`, { params: { type }, responseType: 'blob' }),
  getSubStatusOptions: () => api.get('/jobs/sub-status-options'),
  updateSubStatus: (id, subStatus, remarks) => api.put(`/jobs/${id}/sub-status`, { subStatus, remarks })
};

export const orderAPI = {
  getAll: (params) => api.get('/orders', { params }),
  getById: (id) => api.get(`/orders/${id}`),
  update: (id, data) => api.put(`/orders/${id}`, data),
  syncAmazon: (dateRange) => api.post('/orders/sync/amazon', dateRange),
  syncEbay: (dateRange) => api.post('/orders/sync/ebay', dateRange),
  testAmazon: () => api.get('/orders/test/amazon'),
  testEbay: () => api.get('/orders/test/ebay'),
  createManual: (data) => api.post('/orders/manual', data),
  getStatistics: () => api.get('/orders/statistics'),
  getAccountCodes: () => api.get('/orders/account-codes'),
  refreshCadStatus: () => api.post('/orders/refresh-cad-status'),
  bulkAssign: (data) => api.post('/orders/bulk-assign', data),
  assignUser: (id, data) => api.post(`/orders/${id}/assign`, data),
  bulkUpdateStatus: (data) => api.post('/orders/bulk-status', data),
  triggerSync: (syncType) => api.post('/orders/sync/trigger', { syncType }),
  bulkDownload: (orderIds) => api.post('/orders/bulk-download', { orderIds }, { responseType: 'blob' }),
  fetchProductImages: (params) => api.post('/orders/fetch-images', params), // params: { asin, sku, accountCode, channel, itemId }
  uploadImages: (id, formData) => api.post(`/orders/${id}/images`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  deleteImage: (id, imageId) => api.delete(`/orders/${id}/images/${imageId}`),
  delete: (id, deleteType = 'soft') => api.delete(`/orders/${id}?deleteType=${deleteType}`),
  downloadImagesZip: (id) => api.get(`/orders/${id}/download-images`, { responseType: 'blob' })
};

export const cadAPI = {
  getMyTasks: (params) => api.get('/cad/my-tasks', { params }),
  getPendingReviews: () => api.get('/cad/pending-reviews'),
  assign: (jobId, data) => api.post(`/cad/${jobId}/assign`, data),
  getFiles: (jobId) => api.get(`/cad/${jobId}/files`),
  uploadFiles: (jobId, formData) => api.post(`/cad/${jobId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  submitForReview: (jobId) => api.post(`/cad/${jobId}/submit`),
  approve: (jobId, comments) => api.post(`/cad/${jobId}/approve`, { comments }),
  reject: (jobId, reason) => api.post(`/cad/${jobId}/reject`, { reason }),
  bulkUpdateStatus: (jobIds, status, remarks) => api.post('/cad/bulk-status', { jobIds, status, remarks })
};

export const manufacturingAPI = {
  getMyJobs: (params) => api.get('/manufacturing/my-jobs', { params }),
  getPendingAssignment: () => api.get('/manufacturing/pending-assignment'),
  assign: (jobId, data) => api.post(`/manufacturing/${jobId}/assign`, data),
  accept: (jobId) => api.post(`/manufacturing/${jobId}/accept`),
  start: (jobId) => api.post(`/manufacturing/${jobId}/start`),
  readyForQC: (jobId, remarks) => api.post(`/manufacturing/${jobId}/ready-qc`, { remarks }),
  readyForDelivery: (jobId, remarks) => api.post(`/manufacturing/${jobId}/ready-delivery`, { remarks }),
  getFiles: (jobId) => api.get(`/manufacturing/${jobId}/files`),
  uploadFiles: (jobId, formData) => api.post(`/manufacturing/${jobId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
};

export const deliveryAPI = {
  getPending: () => api.get('/delivery/pending'),
  getDelivered: (params) => api.get('/delivery/delivered', { params }),
  getOverdue: () => api.get('/delivery/overdue'),
  getDetails: (jobId) => api.get(`/delivery/${jobId}`),
  create: (jobId, data) => api.post(`/delivery/${jobId}`, data),
  markDelivered: (jobId, data) => api.post(`/delivery/${jobId}/delivered`, data)
};

export const notificationAPI = {
  getLogs: (params) => api.get('/notifications/logs', { params }),
  getStatistics: () => api.get('/notifications/statistics'),
  getFailed: () => api.get('/notifications/failed'),
  retry: (id) => api.post(`/notifications/${id}/retry`)
};

export const settingsAPI = {
  getAll: (params) => api.get('/settings', { params }),
  getByCategory: (category) => api.get(`/settings/category/${category}`),
  get: (key) => api.get(`/settings/${key}`),
  update: (key, value) => api.put(`/settings/${key}`, { value }),
  updateBulk: (settings) => api.put('/settings', { settings }),
  saveAPICredentials: (platform, credentials) => api.post(`/settings/api/${platform}`, credentials)
};

export const dashboardAPI = {
  getStatistics: () => api.get('/dashboard/statistics'),
  getActivities: (params) => api.get('/dashboard/activities', { params }),
  getTrends: () => api.get('/dashboard/trends'),
  getUrgent: () => api.get('/dashboard/urgent')
};

export const skuMasterAPI = {
  getAll: (params) => api.get('/sku-master', { params }),
  getBySku: (sku) => api.get(`/sku-master/${sku}`),
  create: (data) => api.post('/sku-master', data),
  update: (sku, data) => api.put(`/sku-master/${sku}`, data),
  delete: (sku) => api.delete(`/sku-master/${sku}`),
  search: (params) => api.get('/sku-master/search', { params }),
  checkCadStatus: (sku) => api.get(`/sku-master/check/${sku}`),
  getStatistics: () => api.get('/sku-master/statistics'),
  exportCsv: () => api.get('/sku-master/export', { responseType: 'blob' }),
  uploadCadFile: (sku, formData) => api.post(`/sku-master/${sku}/cad`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  deleteCadFile: (sku) => api.delete(`/sku-master/${sku}/cad`),
  uploadImages: (sku, formData) => api.post(`/sku-master/${sku}/images`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  deleteImage: (sku, imageId) => api.delete(`/sku-master/${sku}/images/${imageId}`),
  bulkUploadCsv: (formData) => api.post('/sku-master/bulk/upload-csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  bulkUploadCad: (formData) => api.post('/sku-master/bulk/upload-cad', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
};

export const marketplaceAccountAPI = {
  getAll: (params) => api.get('/marketplace-accounts', { params }),
  getById: (id) => api.get(`/marketplace-accounts/${id}`),
  create: (data) => api.post('/marketplace-accounts', data),
  update: (id, data) => api.put(`/marketplace-accounts/${id}`, data),
  delete: (id) => api.delete(`/marketplace-accounts/${id}`),
  testConnection: (id) => api.post(`/marketplace-accounts/${id}/test`),
  syncAccount: (id) => api.post(`/marketplace-accounts/${id}/sync`),
  syncAll: () => api.post('/marketplace-accounts/sync-all'),
  getSyncHistory: (id, params) => api.get(`/marketplace-accounts/${id}/sync-history`, { params }),
  getOrderCount: (id) => api.get(`/marketplace-accounts/${id}/order-count`),
  getMarketplaceIds: () => api.get('/marketplace-accounts/marketplace-ids')
};

export const auditLogAPI = {
  getAll: (params) => api.get('/audit-logs', { params }),
  getStatistics: (params) => api.get('/audit-logs/statistics', { params }),
  getActionTypes: () => api.get('/audit-logs/action-types'),
  getEntityTypes: () => api.get('/audit-logs/entity-types'),
  getEntityLogs: (entity, entityId, params) => api.get(`/audit-logs/${entity}/${entityId}`, { params })
};

export const docketAPI = {
  getAll: (params) => api.get('/dockets', { params }),
  getById: (id) => api.get(`/dockets/${id}`),
  create: (data) => api.post('/dockets', data),
  updateStatus: (id, status, notes) => api.patch(`/dockets/${id}/status`, { status, notes })
};

// WhatsApp API
export const whatsappAPI = {
  // Configuration
  getConfig: () => api.get('/whatsapp/config'),
  saveConfig: (data) => api.post('/whatsapp/config', data),
  testConnection: () => api.post('/whatsapp/config/test'),

  // Conversations
  getConversations: (params) => api.get('/whatsapp/conversations', { params }),
  getConversation: (id) => api.get(`/whatsapp/conversations/${id}`),
  updateConversation: (id, data) => api.put(`/whatsapp/conversations/${id}`, data),
  sendMessage: (conversationId, data) => api.post(`/whatsapp/conversations/${conversationId}/send`, data),
  sendToPhone: (data) => api.post('/whatsapp/send', data),

  // Funnels (Automation Flows)
  getFunnels: (params) => api.get('/whatsapp/funnels', { params }),
  getFunnel: (id) => api.get(`/whatsapp/funnels/${id}`),
  createFunnel: (data) => api.post('/whatsapp/funnels', data),
  updateFunnel: (id, data) => api.put(`/whatsapp/funnels/${id}`, data),
  deleteFunnel: (id) => api.delete(`/whatsapp/funnels/${id}`),
  triggerFunnel: (id, data) => api.post(`/whatsapp/funnels/${id}/trigger`, data),

  // Funnel Runs
  getFunnelRuns: (params) => api.get('/whatsapp/runs', { params }),
  getFunnelRun: (id) => api.get(`/whatsapp/runs/${id}`),
  cancelFunnelRun: (id) => api.post(`/whatsapp/runs/${id}/cancel`),

  // Templates
  getTemplates: () => api.get('/whatsapp/templates'),

  // Analytics
  getAnalytics: (params) => api.get('/whatsapp/analytics', { params })
};
