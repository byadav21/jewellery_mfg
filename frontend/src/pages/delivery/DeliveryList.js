import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { deliveryAPI } from '../../services/api';

const DeliveryList = () => {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending');
  const [statistics, setStatistics] = useState({
    pending: 0,
    delivered: 0,
    overdue: 0
  });

  const fetchDeliveries = useCallback(async () => {
    try {
      setLoading(true);
      let response;
      if (activeTab === 'pending') {
        response = await deliveryAPI.getPending();
      } else if (activeTab === 'delivered') {
        response = await deliveryAPI.getDelivered();
      } else if (activeTab === 'overdue') {
        response = await deliveryAPI.getOverdue();
      }
      setDeliveries(response.data.data?.deliveries || response.data.deliveries || response.data.data || []);
    } catch (error) {
      console.error('Error fetching deliveries:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const fetchStatistics = async () => {
    try {
      const [pendingRes, deliveredRes, overdueRes] = await Promise.all([
        deliveryAPI.getPending(),
        deliveryAPI.getDelivered(),
        deliveryAPI.getOverdue()
      ]);
      setStatistics({
        pending: pendingRes.data.data?.length || pendingRes.data.deliveries?.length || 0,
        delivered: deliveredRes.data.data?.length || deliveredRes.data.deliveries?.length || 0,
        overdue: overdueRes.data.data?.length || overdueRes.data.deliveries?.length || 0
      });
    } catch (error) {
      console.error('Error fetching statistics:', error);
    }
  };

  useEffect(() => {
    fetchStatistics();
  }, []);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  const handleMarkDelivered = async (jobId) => {
    const confirmDelivery = window.confirm('Mark this item as delivered?');
    if (!confirmDelivery) return;

    const deliveryDetails = window.prompt('Enter any delivery notes (optional):');

    try {
      await deliveryAPI.markDelivered(jobId, {
        deliveredAt: new Date(),
        notes: deliveryDetails,
        receivedBy: 'Customer'
      });
      toast.success('Marked as delivered successfully');
      fetchDeliveries();
      fetchStatistics();
    } catch (error) {
      toast.error('Failed to mark as delivered');
    }
  };

  const getDeliveryTypeBadge = (type) => {
    const colors = {
      hand: 'info',
      courier: 'warning',
      pickup: 'secondary'
    };
    return colors[type] || 'secondary';
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

  return (
    <section className="content">
      <div className="container-fluid pt-3">
        {/* Header */}
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="h3 mb-0">Delivery Management</h1>
        </div>

        {/* Statistics Cards */}
        <div className="row">
          <div className="col-lg-4 col-6">
            <div
              className={`small-box ${activeTab === 'pending' ? 'bg-warning' : 'bg-light'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setActiveTab('pending')}
            >
              <div className="inner">
                <h3>{statistics.pending}</h3>
                <p>Pending Deliveries</p>
              </div>
              <div className="icon">
                <i className="fas fa-clock"></i>
              </div>
            </div>
          </div>
          <div className="col-lg-4 col-6">
            <div
              className={`small-box ${activeTab === 'delivered' ? 'bg-success' : 'bg-light'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setActiveTab('delivered')}
            >
              <div className="inner">
                <h3>{statistics.delivered}</h3>
                <p>Delivered</p>
              </div>
              <div className="icon">
                <i className="fas fa-check-circle"></i>
              </div>
            </div>
          </div>
          <div className="col-lg-4 col-6">
            <div
              className={`small-box ${activeTab === 'overdue' ? 'bg-danger' : 'bg-light'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setActiveTab('overdue')}
            >
              <div className="inner">
                <h3>{statistics.overdue}</h3>
                <p>Overdue</p>
              </div>
              <div className="icon">
                <i className="fas fa-exclamation-triangle"></i>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="card">
          <div className="card-header p-0 pt-1">
            <ul className="nav nav-tabs" role="tablist">
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'pending' ? 'active' : ''}`}
                  onClick={() => setActiveTab('pending')}
                >
                  <i className="fas fa-clock mr-1"></i> Pending
                </button>
              </li>
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'delivered' ? 'active' : ''}`}
                  onClick={() => setActiveTab('delivered')}
                >
                  <i className="fas fa-check mr-1"></i> Delivered
                </button>
              </li>
              <li className="nav-item">
                <button
                  className={`nav-link ${activeTab === 'overdue' ? 'active' : ''}`}
                  onClick={() => setActiveTab('overdue')}
                >
                  <i className="fas fa-exclamation-triangle mr-1"></i> Overdue
                </button>
              </li>
            </ul>
          </div>
          <div className="card-body table-responsive p-0">
            {loading ? (
              <div className="text-center py-5">
                <div className="spinner-border text-primary" role="status">
                  <span className="sr-only">Loading...</span>
                </div>
              </div>
            ) : deliveries.length === 0 ? (
              <div className="text-center py-5 text-muted">
                <i className="fas fa-truck fa-3x mb-3"></i>
                <p>No {activeTab} deliveries found</p>
              </div>
            ) : (
              <table className="table table-hover text-nowrap">
                <thead>
                  <tr>
                    <th>Job Code</th>
                    <th>Product</th>
                    <th>Customer</th>
                    <th>Delivery Type</th>
                    <th>Address</th>
                    <th>{activeTab === 'delivered' ? 'Delivered At' : 'Due Date'}</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map(delivery => {
                    const job = delivery.job || delivery;
                    const customer = job.order?.customer || job.customer || {};
                    return (
                      <tr key={delivery._id || job._id} className={isOverdue(delivery.dueDate) && activeTab !== 'delivered' ? 'table-danger' : ''}>
                        <td>
                          <Link to={`/jobs/${job._id}`}>
                            <strong>{job.jobCode || job.jobNumber}</strong>
                          </Link>
                        </td>
                        <td>
                          <div>
                            <strong>{job.productName || '-'}</strong>
                            {job.sku && <small className="d-block text-muted">{job.sku}</small>}
                          </div>
                        </td>
                        <td>
                          <div>
                            <strong>{customer.name || job.customerName || '-'}</strong>
                            {(customer.phone || job.customerPhone) && (
                              <small className="d-block text-muted">{customer.phone || job.customerPhone}</small>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={`badge badge-${getDeliveryTypeBadge(delivery.deliveryType || 'hand')}`}>
                            {(delivery.deliveryType || 'hand').toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <div style={{ maxWidth: '200px', whiteSpace: 'normal' }}>
                            {delivery.address || customer.address || job.shippingAddress || '-'}
                          </div>
                        </td>
                        <td>
                          {activeTab === 'delivered' ? (
                            formatDate(delivery.deliveredAt)
                          ) : (
                            <span className={isOverdue(delivery.dueDate) ? 'text-danger font-weight-bold' : ''}>
                              {formatDate(delivery.dueDate || job.dueDate)}
                            </span>
                          )}
                        </td>
                        <td>
                          {activeTab === 'delivered' ? (
                            <span className="badge badge-success">Delivered</span>
                          ) : isOverdue(delivery.dueDate) ? (
                            <span className="badge badge-danger">Overdue</span>
                          ) : (
                            <span className="badge badge-warning">Pending</span>
                          )}
                        </td>
                        <td>
                          <div className="btn-group">
                            <Link
                              to={`/jobs/${job._id}`}
                              className="btn btn-sm btn-info"
                              title="View Job"
                            >
                              <i className="fas fa-eye"></i>
                            </Link>
                            {activeTab !== 'delivered' && (
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => handleMarkDelivered(job._id)}
                                title="Mark Delivered"
                              >
                                <i className="fas fa-check"></i>
                              </button>
                            )}
                            {delivery.trackingNumber && (
                              <a
                                href={`https://www.google.com/search?q=${delivery.trackingNumber}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-sm btn-secondary"
                                title="Track Package"
                              >
                                <i className="fas fa-map-marker-alt"></i>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default DeliveryList;
