import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { jobAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/common/DataTable';
import useDebounce from '../../hooks/useDebounce';

const JobList = () => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 0 });
  const [filters, setFilters] = useState({ status: '', channel: '', search: '' });
  const { isAdmin } = useAuth();

  // Debounce search input
  const debouncedSearch = useDebounce(filters.search, 300);

  // Create effective filters with debounced search
  const effectiveFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch
  }), [filters.status, filters.channel, debouncedSearch]);

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await jobAPI.getAll({
        page: pagination.page,
        limit: pagination.limit,
        ...effectiveFilters
      });
      const data = response.data.data || response.data;
      const jobsList = data.jobs || data || [];
      setJobs(Array.isArray(jobsList) ? jobsList : []);
      if (data.pagination) {
        setPagination(prev => ({ ...prev, ...data.pagination }));
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, effectiveFilters]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const getStatusBadge = (status) => {
    return <span className={`badge badge-status-${status}`}>{status?.replace(/_/g, ' ')}</span>;
  };

  const getChannelBadge = (channel) => {
    return <span className={`badge badge-channel-${channel}`}>{channel?.toUpperCase()}</span>;
  };

  const getPriorityBadge = (priority) => {
    return <span className={`badge badge-priority-${priority}`}>{priority?.toUpperCase()}</span>;
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({ status: '', channel: '', search: '' });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const columns = [
    {
      key: 'jobCode',
      title: 'Job Code',
      sortable: true,
      render: (jobCode, job) => (
        <Link to={`/jobs/${job._id}`}>
          <strong>{jobCode}</strong>
        </Link>
      )
    },
    {
      key: 'channel',
      title: 'Channel',
      sortable: true,
      render: (channel) => getChannelBadge(channel)
    },
    {
      key: 'sku',
      title: 'SKU',
      sortable: true,
      render: (sku) => sku || '-'
    },
    {
      key: 'productName',
      title: 'Product',
      sortable: true,
      render: (productName) => (
        <span className="text-truncate d-inline-block" style={{ maxWidth: '200px' }} title={productName}>
          {productName}
        </span>
      )
    },
    {
      key: 'priority',
      title: 'Priority',
      sortable: true,
      render: (priority) => getPriorityBadge(priority)
    },
    {
      key: 'status',
      title: 'Status',
      sortable: true,
      render: (status) => getStatusBadge(status)
    },
    {
      key: 'dueDate',
      title: 'Due Date',
      sortable: true,
      render: (dueDate, job) => {
        if (!dueDate) return '-';
        const date = new Date(dueDate);
        const isOverdue = date < new Date();
        return (
          <span className={isOverdue ? 'text-danger font-weight-bold' : ''}>
            {date.toLocaleDateString()}
            {isOverdue && <i className="fas fa-exclamation-circle ml-1"></i>}
          </span>
        );
      }
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_, job) => (
        <Link to={`/jobs/${job._id}`} className="btn btn-sm btn-info">
          <i className="fas fa-eye"></i>
        </Link>
      )
    }
  ];

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">Jobs</h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item active">Jobs</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <section className="content">
        <div className="container-fluid">
          {/* Filters Card */}
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
                      placeholder="Job Code, SKU, Product, Customer..."
                      value={filters.search}
                      onChange={handleFilterChange}
                    />
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
                      <option value="new">New</option>
                      <option value="cad_assigned">CAD Assigned</option>
                      <option value="cad_in_progress">CAD In Progress</option>
                      <option value="cad_submitted">CAD Submitted</option>
                      <option value="cad_approved">CAD Approved</option>
                      <option value="manufacturing_assigned">Manufacturing Assigned</option>
                      <option value="manufacturing_in_progress">Manufacturing In Progress</option>
                      <option value="delivered">Delivered</option>
                    </select>
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
                <div className="col-md-2 d-flex align-items-end">
                  <div className="form-group">
                    <button className="btn btn-secondary btn-block" onClick={clearFilters}>
                      Clear Filters
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Jobs Table Card */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">All Jobs</h3>
              {isAdmin() && (
                <div className="card-tools">
                  <Link to="/jobs/new" className="btn btn-primary btn-sm">
                    <i className="fas fa-plus mr-1"></i> New Job
                  </Link>
                </div>
              )}
            </div>
            <div className="card-body">
              <DataTable
                columns={columns}
                data={jobs}
                pagination={pagination}
                onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
                onLimitChange={(limit) => setPagination(prev => ({ ...prev, limit, page: 1 }))}
                loading={loading}
                emptyMessage="No jobs found"
                emptyIcon="fas fa-briefcase"
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default JobList;
