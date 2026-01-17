import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { cadAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/common/DataTable';

const CADTaskList = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const [sorting, setSorting] = useState({
    field: 'cadDeadline',
    direction: 'asc'
  });
  const { user } = useAuth();

  // Check if user is admin
  const userRoles = user?.roles?.map(r => r.name || r) || [];
  const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');

  // Selection state
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkRemarks, setBulkRemarks] = useState('');
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        sortField: sorting.field,
        sortDirection: sorting.direction,
        ...filters
      };
      const response = await cadAPI.getMyTasks(params);
      setTasks(response.data.data?.tasks || response.data.tasks || response.data.data || []);
      if (response.data.pagination || response.data.data?.pagination) {
        setPagination(prev => ({ ...prev, ...(response.data.pagination || response.data.data?.pagination) }));
      }
      // Clear selection when data changes
      setSelectedTasks([]);
    } catch (error) {
      console.error('Error fetching CAD tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, sorting.field, sorting.direction, filters]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleSort = (field, direction) => {
    setSorting({ field, direction });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleSubmitForReview = async (jobId) => {
    if (!window.confirm('Submit this job for review?')) return;

    try {
      await cadAPI.submitForReview(jobId);
      toast.success('Submitted for review successfully');
      fetchTasks();
    } catch (error) {
      toast.error('Failed to submit for review');
    }
  };

  // Selection handlers
  const handleSelectTask = (taskId) => {
    setSelectedTasks(prev => {
      if (prev.includes(taskId)) {
        return prev.filter(id => id !== taskId);
      } else {
        return [...prev, taskId];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedTasks.length === tasks.length) {
      setSelectedTasks([]);
    } else {
      setSelectedTasks(tasks.map(task => task._id));
    }
  };

  const isAllSelected = tasks.length > 0 && selectedTasks.length === tasks.length;

  // Bulk status update
  const handleBulkStatusUpdate = async (e) => {
    e.preventDefault();

    if (selectedTasks.length === 0) {
      toast.error('Please select at least one task');
      return;
    }

    if (!bulkStatus) {
      toast.error('Please select a status');
      return;
    }

    try {
      setBulkUpdating(true);
      const response = await cadAPI.bulkUpdateStatus(selectedTasks, bulkStatus, bulkRemarks);

      if (response.data.success) {
        const { success, failed } = response.data.data;
        if (success.length > 0) {
          toast.success(`${success.length} task(s) updated successfully`);
        }
        if (failed.length > 0) {
          toast.warning(`${failed.length} task(s) failed to update`);
        }
        setShowBulkStatusModal(false);
        setBulkStatus('');
        setBulkRemarks('');
        setSelectedTasks([]);
        fetchTasks();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update statuses');
    } finally {
      setBulkUpdating(false);
    }
  };

  const getStatusBadge = (status) => {
    const colors = {
      cad_assigned: 'info',
      cad_in_progress: 'primary',
      cad_submitted: 'warning',
      cad_approved: 'success',
      cad_rejected: 'danger'
    };
    return colors[status] || 'secondary';
  };

  const getStatusText = (status) => {
    const texts = {
      cad_assigned: 'Assigned',
      cad_in_progress: 'In Progress',
      cad_submitted: 'Submitted',
      cad_approved: 'Approved',
      cad_rejected: 'Rejected'
    };
    return texts[status] || status;
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

  const isOverdue = (dueDate, status) => {
    if (!dueDate) return false;
    if (status === 'cad_approved') return false;
    return new Date(dueDate) < new Date();
  };

  // Calculate statistics from all tasks (not paginated)
  const statistics = {
    assigned: tasks.filter(t => t.status === 'cad_assigned').length,
    inProgress: tasks.filter(t => t.status === 'cad_in_progress').length,
    submitted: tasks.filter(t => t.status === 'cad_submitted').length,
    rejected: tasks.filter(t => t.status === 'cad_rejected').length
  };

  // Available statuses for bulk update (role-based)
  const availableStatuses = isAdmin
    ? [
      { value: 'cad_assigned', label: 'Assigned' },
      { value: 'cad_in_progress', label: 'In Progress' },
      { value: 'cad_submitted', label: 'Submitted' },
      { value: 'cad_approved', label: 'Approved' },
      { value: 'cad_rejected', label: 'Rejected' }
    ]
    : [
      { value: 'cad_in_progress', label: 'In Progress' },
      { value: 'cad_submitted', label: 'Submitted' }
    ];

  // Checkbox column
  const checkboxColumn = {
    key: 'checkbox',
    title: (
      <div className="custom-control custom-checkbox">
        <input
          type="checkbox"
          className="custom-control-input"
          id="selectAll"
          checked={isAllSelected}
          onChange={handleSelectAll}
        />
        <label className="custom-control-label" htmlFor="selectAll"></label>
      </div>
    ),
    render: (_, task) => (
      <div className="custom-control custom-checkbox">
        <input
          type="checkbox"
          className="custom-control-input"
          id={`task-${task._id}`}
          checked={selectedTasks.includes(task._id)}
          onChange={() => handleSelectTask(task._id)}
        />
        <label className="custom-control-label" htmlFor={`task-${task._id}`}></label>
      </div>
    )
  };

  // Base DataTable columns
  const baseColumns = [
    {
      key: 'jobCode',
      title: 'Job Code',
      sortable: true,
      render: (_, task) => (
        <Link to={`/jobs/${task._id}`}>
          <strong>{task.jobCode}</strong>
        </Link>
      )
    },
    {
      key: 'productName',
      title: 'Product',
      sortable: true,
      render: (_, task) => (
        <div>
          <span className="text-truncate d-inline-block" style={{ maxWidth: '200px' }} title={task.productName}>
            {task.productName || '-'}
          </span>
          {task.sku && <small className="d-block text-muted"><code>{task.sku}</code></small>}
        </div>
      )
    }
  ];

  // Designer column (only for admins)
  const designerColumn = {
    key: 'cadDesigner',
    title: 'Designer',
    render: (designer) => (
      designer ? (
        <div>
          <strong>{designer.name}</strong>
          <small className="d-block text-muted">{designer.email}</small>
        </div>
      ) : (
        <span className="text-muted">Not assigned</span>
      )
    )
  };

  // Common columns after designer
  const commonColumns = [
    {
      key: 'priority',
      title: 'Priority',
      sortable: true,
      render: (priority) => (
        <span className={`badge badge-${getPriorityBadge(priority)}`}>
          {priority?.toUpperCase() || 'MEDIUM'}
        </span>
      )
    },
    {
      key: 'status',
      title: 'Status',
      sortable: true,
      render: (status, task) => (
        <div>
          <span className={`badge badge-${getStatusBadge(status)}`}>
            {getStatusText(status)}
          </span>
          {status === 'cad_rejected' && task.rejectionReason && (
            <i
              className="fas fa-info-circle text-danger ml-1"
              title={task.rejectionReason}
              style={{ cursor: 'pointer' }}
            ></i>
          )}
        </div>
      )
    },
    {
      key: 'cadAssignedAt',
      title: 'Assigned Date',
      sortable: true,
      render: (date) => formatDate(date)
    },
    {
      key: 'cadDeadline',
      title: 'Due Date',
      sortable: true,
      render: (date, task) => (
        <span className={isOverdue(date, task.status) ? 'text-danger font-weight-bold' : ''}>
          {formatDate(date)}
          {isOverdue(date, task.status) && (
            <i className="fas fa-exclamation-triangle text-danger ml-1" title="Overdue"></i>
          )}
        </span>
      )
    },
    {
      key: 'cadFiles',
      title: 'Files',
      render: (files) => (
        <span className={files?.length > 0 ? 'text-success' : 'text-muted'}>
          <i className="fas fa-file mr-1"></i>
          {files?.length || 0}
        </span>
      )
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_, task) => (
        <div className="btn-group">
          <Link
            to={`/jobs/${task._id}`}
            className="btn btn-sm btn-info"
            title="View Details"
          >
            <i className="fas fa-eye"></i>
          </Link>
          <Link
            to={`/cad/upload/${task._id}`}
            className="btn btn-sm btn-primary"
            title="Upload CAD Files"
          >
            <i className="fas fa-upload"></i>
          </Link>
          {(task.status === 'cad_in_progress' || task.status === 'cad_rejected') && task.cadFiles?.length > 0 && (
            <button
              className="btn btn-sm btn-success"
              onClick={() => handleSubmitForReview(task._id)}
              title="Submit for Review"
            >
              <i className="fas fa-paper-plane"></i>
            </button>
          )}
        </div>
      )
    }
  ];

  // Build columns based on role - admins see designer column
  const columns = isAdmin
    ? [checkboxColumn, ...baseColumns, designerColumn, ...commonColumns]
    : [checkboxColumn, ...baseColumns, ...commonColumns];

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">{isAdmin ? 'All CAD Tasks' : 'My CAD Tasks'}</h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item active">{isAdmin ? 'All CAD Tasks' : 'My CAD Tasks'}</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <section className="content">
        <div className="container-fluid">
          {/* Statistics Cards */}
          <div className="row">
            <div className="col-lg-3 col-6">
              <div className="small-box bg-info">
                <div className="inner">
                  <h3>{statistics.assigned}</h3>
                  <p>Assigned</p>
                </div>
                <div className="icon">
                  <i className="fas fa-inbox"></i>
                </div>
                <a
                  href="#!"
                  className="small-box-footer"
                  onClick={(e) => {
                    e.preventDefault();
                    setFilters(prev => ({ ...prev, status: 'cad_assigned' }));
                  }}
                >
                  View <i className="fas fa-arrow-circle-right"></i>
                </a>
              </div>
            </div>
            <div className="col-lg-3 col-6">
              <div className="small-box bg-primary">
                <div className="inner">
                  <h3>{statistics.inProgress}</h3>
                  <p>In Progress</p>
                </div>
                <div className="icon">
                  <i className="fas fa-pencil-ruler"></i>
                </div>
                <a
                  href="#!"
                  className="small-box-footer"
                  onClick={(e) => {
                    e.preventDefault();
                    setFilters(prev => ({ ...prev, status: 'cad_in_progress' }));
                  }}
                >
                  View <i className="fas fa-arrow-circle-right"></i>
                </a>
              </div>
            </div>
            <div className="col-lg-3 col-6">
              <div className="small-box bg-warning">
                <div className="inner">
                  <h3>{statistics.submitted}</h3>
                  <p>Pending Review</p>
                </div>
                <div className="icon">
                  <i className="fas fa-clock"></i>
                </div>
                <a
                  href="#!"
                  className="small-box-footer"
                  onClick={(e) => {
                    e.preventDefault();
                    setFilters(prev => ({ ...prev, status: 'cad_submitted' }));
                  }}
                >
                  View <i className="fas fa-arrow-circle-right"></i>
                </a>
              </div>
            </div>
            <div className="col-lg-3 col-6">
              <div className="small-box bg-danger">
                <div className="inner">
                  <h3>{statistics.rejected}</h3>
                  <p>Needs Revision</p>
                </div>
                <div className="icon">
                  <i className="fas fa-exclamation-circle"></i>
                </div>
                <a
                  href="#!"
                  className="small-box-footer"
                  onClick={(e) => {
                    e.preventDefault();
                    setFilters(prev => ({ ...prev, status: 'cad_rejected' }));
                  }}
                >
                  View <i className="fas fa-arrow-circle-right"></i>
                </a>
              </div>
            </div>
          </div>

          {/* Filters Card */}
          <div className="card collapsed-card">
            <div className="card-header">
              <h3 className="card-title">
                <i className="fas fa-filter mr-2"></i>
                Filters
              </h3>
              <div className="card-tools">
                <button type="button" className="btn btn-tool" data-card-widget="collapse">
                  <i className="fas fa-plus"></i>
                </button>
              </div>
            </div>
            <div className="card-body">
              <div className="row">
                <div className="col-md-4">
                  <div className="form-group">
                    <label>Search</label>
                    <div className="input-group">
                      <div className="input-group-prepend">
                        <span className="input-group-text"><i className="fas fa-search"></i></span>
                      </div>
                      <input
                        type="text"
                        className="form-control"
                        name="search"
                        placeholder="Job code, product name, SKU..."
                        value={filters.search}
                        onChange={handleFilterChange}
                      />
                    </div>
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
                      <option value="cad_assigned">Assigned</option>
                      <option value="cad_in_progress">In Progress</option>
                      <option value="cad_submitted">Submitted</option>
                      <option value="cad_rejected">Rejected</option>
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
                      <option value="urgent">Urgent</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>
                <div className="col-md-2 d-flex align-items-end">
                  <div className="form-group w-100">
                    <button
                      className="btn btn-secondary btn-block"
                      onClick={() => setFilters({ status: '', search: '', priority: '' })}
                    >
                      <i className="fas fa-times mr-1"></i> Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tasks DataTable */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <i className="fas fa-pencil-ruler mr-2"></i>
                CAD Tasks
                {selectedTasks.length > 0 && (
                  <span className="badge badge-primary ml-2">{selectedTasks.length} selected</span>
                )}
              </h3>
              <div className="card-tools">
                {selectedTasks.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-warning btn-sm mr-2"
                    onClick={() => setShowBulkStatusModal(true)}
                    title="Change Status for Selected"
                  >
                    <i className="fas fa-exchange-alt mr-1"></i>
                    Bulk Status Change
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-tool"
                  onClick={fetchTasks}
                  title="Refresh"
                >
                  <i className="fas fa-sync-alt"></i>
                </button>
              </div>
            </div>
            <div className="card-body">
              <DataTable
                columns={columns}
                data={tasks}
                pagination={pagination}
                onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
                onLimitChange={(limit) => setPagination(prev => ({ ...prev, limit, page: 1 }))}
                onSort={handleSort}
                loading={loading}
                emptyMessage="No CAD tasks assigned to you"
                emptyIcon="fas fa-pencil-ruler"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Bulk Status Change Modal */}
      {showBulkStatusModal && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-warning">
                <h5 className="modal-title">
                  <i className="fas fa-exchange-alt mr-2"></i>
                  Bulk Status Change
                </h5>
                <button type="button" className="close" onClick={() => setShowBulkStatusModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleBulkStatusUpdate}>
                <div className="modal-body">
                  <div className="alert alert-info">
                    <i className="fas fa-info-circle mr-2"></i>
                    You are about to change the status of <strong>{selectedTasks.length}</strong> selected task(s).
                  </div>

                  <div className="form-group">
                    <label>Selected Tasks:</label>
                    <div className="selected-tasks-list" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                      <ul className="list-group list-group-flush">
                        {tasks.filter(t => selectedTasks.includes(t._id)).map(task => (
                          <li key={task._id} className="list-group-item py-1 px-2 d-flex justify-content-between align-items-center">
                            <span>
                              <strong>{task.jobCode}</strong>
                              <small className="text-muted ml-2">{task.productName?.substring(0, 30)}...</small>
                            </span>
                            <span className={`badge badge-${getStatusBadge(task.status)}`}>
                              {getStatusText(task.status)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>New Status <span className="text-danger">*</span></label>
                    <select
                      className="form-control"
                      value={bulkStatus}
                      onChange={(e) => setBulkStatus(e.target.value)}
                      required
                    >
                      <option value="">Select Status</option>
                      {availableStatuses.map(status => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                    {!isAdmin && (
                      <small className="text-muted">
                        As a designer, you can change status to "In Progress" or "Submitted"
                      </small>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Remarks (Optional)</label>
                    <textarea
                      className="form-control"
                      rows="2"
                      placeholder="Enter remarks for this status change..."
                      value={bulkRemarks}
                      onChange={(e) => setBulkRemarks(e.target.value)}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowBulkStatusModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-warning"
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
                        Update {selectedTasks.length} Task(s)
                      </>
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

export default CADTaskList;
