import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { notificationAPI } from '../../services/api';

const NotificationLogs = () => {
  const [logs, setLogs] = useState([]);
  const [statistics, setStatistics] = useState({
    total: 0,
    sent: 0,
    failed: 0,
    pending: 0
  });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    type: '',
    status: '',
    search: '',
    startDate: '',
    endDate: ''
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  });
  const [retrying, setRetrying] = useState(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...filters
      };
      const response = await notificationAPI.getLogs(params);
      setLogs(response.data.data || response.data.logs || []);
      if (response.data.pagination) {
        setPagination(prev => ({ ...prev, ...response.data.pagination }));
      }
    } catch (error) {
      console.error('Error fetching notification logs:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, filters]);

  const fetchStatistics = async () => {
    try {
      const response = await notificationAPI.getStatistics();
      setStatistics(response.data.data || response.data.statistics || {
        total: 0,
        sent: 0,
        failed: 0,
        pending: 0
      });
    } catch (error) {
      console.error('Error fetching statistics:', error);
    }
  };

  useEffect(() => {
    fetchStatistics();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleRetry = async (logId) => {
    try {
      setRetrying(logId);
      await notificationAPI.retry(logId);
      toast.success('Notification retry initiated');
      fetchLogs();
      fetchStatistics();
    } catch (error) {
      toast.error('Failed to retry notification');
    } finally {
      setRetrying(null);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      sent: 'success',
      delivered: 'success',
      failed: 'danger',
      pending: 'warning',
      queued: 'info'
    };
    return badges[status] || 'secondary';
  };

  const getTypeBadge = (type) => {
    const badges = {
      whatsapp: 'success',
      email: 'primary',
      sms: 'info'
    };
    return badges[type] || 'secondary';
  };

  const getTypeIcon = (type) => {
    const icons = {
      whatsapp: 'fab fa-whatsapp',
      email: 'fas fa-envelope',
      sms: 'fas fa-sms'
    };
    return icons[type] || 'fas fa-bell';
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

  return (
    <section className="content">
      <div className="container-fluid pt-3">
        <h1 className="h3 mb-3">Notification Logs</h1>

        {/* Statistics Cards */}
        <div className="row">
          <div className="col-lg-3 col-6">
            <div className="small-box bg-info">
              <div className="inner">
                <h3>{statistics.total || 0}</h3>
                <p>Total Notifications</p>
              </div>
              <div className="icon">
                <i className="fas fa-bell"></i>
              </div>
            </div>
          </div>
          <div className="col-lg-3 col-6">
            <div className="small-box bg-success">
              <div className="inner">
                <h3>{statistics.sent || 0}</h3>
                <p>Sent Successfully</p>
              </div>
              <div className="icon">
                <i className="fas fa-check-circle"></i>
              </div>
            </div>
          </div>
          <div className="col-lg-3 col-6">
            <div className="small-box bg-danger">
              <div className="inner">
                <h3>{statistics.failed || 0}</h3>
                <p>Failed</p>
              </div>
              <div className="icon">
                <i className="fas fa-times-circle"></i>
              </div>
            </div>
          </div>
          <div className="col-lg-3 col-6">
            <div className="small-box bg-warning">
              <div className="inner">
                <h3>{statistics.pending || 0}</h3>
                <p>Pending</p>
              </div>
              <div className="icon">
                <i className="fas fa-clock"></i>
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
              <div className="col-md-2">
                <div className="form-group">
                  <label>Type</label>
                  <select
                    className="form-control"
                    name="type"
                    value={filters.type}
                    onChange={handleFilterChange}
                  >
                    <option value="">All Types</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
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
                    <option value="sent">Sent</option>
                    <option value="delivered">Delivered</option>
                    <option value="failed">Failed</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>
              <div className="col-md-3">
                <div className="form-group">
                  <label>Search</label>
                  <input
                    type="text"
                    className="form-control"
                    name="search"
                    placeholder="Recipient, Job ID..."
                    value={filters.search}
                    onChange={handleFilterChange}
                  />
                </div>
              </div>
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
              <div className="col-md-1 d-flex align-items-end">
                <div className="form-group">
                  <button
                    className="btn btn-secondary btn-block"
                    onClick={() => {
                      setFilters({
                        type: '',
                        status: '',
                        search: '',
                        startDate: '',
                        endDate: ''
                      });
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

        {/* Logs Table */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Notification History ({pagination.total || logs.length})</h3>
            <div className="card-tools">
              <button className="btn btn-sm btn-outline-primary" onClick={() => { fetchLogs(); fetchStatistics(); }}>
                <i className="fas fa-sync-alt mr-1"></i> Refresh
              </button>
            </div>
          </div>
          <div className="card-body table-responsive p-0">
            {loading ? (
              <div className="text-center py-5">
                <div className="spinner-border text-primary" role="status">
                  <span className="sr-only">Loading...</span>
                </div>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-5 text-muted">
                <i className="fas fa-bell-slash fa-3x mb-3"></i>
                <p>No notification logs found</p>
              </div>
            ) : (
              <table className="table table-hover text-nowrap">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Recipient</th>
                    <th>Subject / Event</th>
                    <th>Job ID</th>
                    <th>Status</th>
                    <th>Sent At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log._id}>
                      <td>
                        <span className={`badge badge-${getTypeBadge(log.type)}`}>
                          <i className={`${getTypeIcon(log.type)} mr-1`}></i>
                          {log.type?.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <div>
                          <strong>{log.recipientName || '-'}</strong>
                          <small className="d-block text-muted">
                            {log.recipient || log.recipientEmail || log.recipientPhone}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {log.subject || log.eventType || log.template || '-'}
                        </div>
                      </td>
                      <td>
                        {log.jobId ? (
                          <a href={`/jobs/${log.jobId._id || log.jobId}`}>
                            {log.jobId.jobNumber || log.jobId}
                          </a>
                        ) : '-'}
                      </td>
                      <td>
                        <span className={`badge badge-${getStatusBadge(log.status)}`}>
                          {log.status}
                        </span>
                        {log.error && (
                          <i
                            className="fas fa-exclamation-circle text-danger ml-1"
                            title={log.error}
                            style={{ cursor: 'pointer' }}
                          ></i>
                        )}
                      </td>
                      <td>{formatDate(log.sentAt || log.createdAt)}</td>
                      <td>
                        {log.status === 'failed' && (
                          <button
                            className="btn btn-sm btn-warning"
                            onClick={() => handleRetry(log._id)}
                            disabled={retrying === log._id}
                            title="Retry"
                          >
                            {retrying === log._id ? (
                              <span className="spinner-border spinner-border-sm" role="status"></span>
                            ) : (
                              <i className="fas fa-redo"></i>
                            )}
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-info ml-1"
                          data-toggle="modal"
                          data-target={`#logDetail-${log._id}`}
                          title="View Details"
                        >
                          <i className="fas fa-eye"></i>
                        </button>

                        {/* Detail Modal */}
                        <div className="modal fade" id={`logDetail-${log._id}`} tabIndex="-1">
                          <div className="modal-dialog modal-lg">
                            <div className="modal-content">
                              <div className="modal-header">
                                <h5 className="modal-title">Notification Details</h5>
                                <button type="button" className="close" data-dismiss="modal">
                                  <span>&times;</span>
                                </button>
                              </div>
                              <div className="modal-body">
                                <dl className="row">
                                  <dt className="col-sm-3">Type</dt>
                                  <dd className="col-sm-9">
                                    <span className={`badge badge-${getTypeBadge(log.type)}`}>
                                      {log.type}
                                    </span>
                                  </dd>

                                  <dt className="col-sm-3">Status</dt>
                                  <dd className="col-sm-9">
                                    <span className={`badge badge-${getStatusBadge(log.status)}`}>
                                      {log.status}
                                    </span>
                                  </dd>

                                  <dt className="col-sm-3">Recipient</dt>
                                  <dd className="col-sm-9">
                                    {log.recipientName && <strong>{log.recipientName}<br /></strong>}
                                    {log.recipient || log.recipientEmail || log.recipientPhone}
                                  </dd>

                                  <dt className="col-sm-3">Subject/Event</dt>
                                  <dd className="col-sm-9">{log.subject || log.eventType || '-'}</dd>

                                  <dt className="col-sm-3">Message</dt>
                                  <dd className="col-sm-9">
                                    <pre className="bg-light p-2 rounded" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                      {log.message || log.body || '-'}
                                    </pre>
                                  </dd>

                                  {log.jobId && (
                                    <>
                                      <dt className="col-sm-3">Job</dt>
                                      <dd className="col-sm-9">
                                        <a href={`/jobs/${log.jobId._id || log.jobId}`}>
                                          {log.jobId.jobNumber || log.jobId}
                                        </a>
                                      </dd>
                                    </>
                                  )}

                                  <dt className="col-sm-3">Sent At</dt>
                                  <dd className="col-sm-9">{formatDate(log.sentAt || log.createdAt)}</dd>

                                  {log.deliveredAt && (
                                    <>
                                      <dt className="col-sm-3">Delivered At</dt>
                                      <dd className="col-sm-9">{formatDate(log.deliveredAt)}</dd>
                                    </>
                                  )}

                                  {log.error && (
                                    <>
                                      <dt className="col-sm-3">Error</dt>
                                      <dd className="col-sm-9">
                                        <div className="alert alert-danger mb-0">
                                          {log.error}
                                        </div>
                                      </dd>
                                    </>
                                  )}

                                  {log.retryCount > 0 && (
                                    <>
                                      <dt className="col-sm-3">Retry Count</dt>
                                      <dd className="col-sm-9">{log.retryCount}</dd>
                                    </>
                                  )}
                                </dl>
                              </div>
                              <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" data-dismiss="modal">
                                  Close
                                </button>
                              </div>
                            </div>
                          </div>
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
                {[...Array(Math.min(pagination.pages, 10))].map((_, i) => {
                  let pageNum;
                  if (pagination.pages <= 10) {
                    pageNum = i + 1;
                  } else if (pagination.page <= 5) {
                    pageNum = i + 1;
                  } else if (pagination.page >= pagination.pages - 4) {
                    pageNum = pagination.pages - 9 + i;
                  } else {
                    pageNum = pagination.page - 5 + i;
                  }
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
              <div className="float-left text-muted">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} entries
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default NotificationLogs;
