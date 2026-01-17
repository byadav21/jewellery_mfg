import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { docketAPI } from '../../services/api';
import DataTable from '../../components/common/DataTable';

const DocketList = () => {
    const [dockets, setDockets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({
        status: '',
        search: '',
        startDate: '',
        endDate: ''
    });
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 10,
        total: 0,
        pages: 0
    });

    const fetchDockets = useCallback(async () => {
        try {
            setLoading(true);
            const params = {
                page: pagination.page,
                limit: pagination.limit,
                ...filters
            };
            const response = await docketAPI.getAll(params);
            setDockets(response.data.data?.dockets || response.data.dockets || []);
            setPagination(prev => ({
                ...prev,
                ...(response.data.data?.pagination || response.data.pagination)
            }));
        } catch (error) {
            toast.error('Failed to fetch dockets');
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, filters]);

    useEffect(() => {
        fetchDockets();
    }, [fetchDockets]);

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    const getStatusBadge = (status) => {
        const colors = {
            draft: 'secondary',
            dispatched: 'info',
            received: 'primary',
            completed: 'success',
            cancelled: 'danger'
        };
        return colors[status] || 'secondary';
    };

    return (
        <>
            <div className="content-header">
                <div className="container-fluid">
                    <div className="row mb-2">
                        <div className="col-sm-6">
                            <h1 className="m-0">Manufacturing Dockets</h1>
                        </div>
                        <div className="col-sm-6">
                            <ol className="breadcrumb float-sm-right">
                                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                                <li className="breadcrumb-item active">Dockets</li>
                            </ol>
                        </div>
                    </div>
                </div>
            </div>

            <section className="content">
                <div className="container-fluid">
                    {/* Filters */}
                    <div className="card">
                        <div className="card-header">
                            <h3 className="card-title">Filters</h3>
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
                                            placeholder="Docket # or Manufacturer..."
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
                                            <option value="draft">Draft</option>
                                            <option value="dispatched">Dispatched</option>
                                            <option value="received">Received</option>
                                            <option value="completed">Completed</option>
                                            <option value="cancelled">Cancelled</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="col-md-3">
                                    <div className="form-group">
                                        <label>Date From</label>
                                        <input
                                            type="date"
                                            className="form-control"
                                            name="startDate"
                                            value={filters.startDate}
                                            onChange={handleFilterChange}
                                        />
                                    </div>
                                </div>
                                <div className="col-md-3">
                                    <div className="form-group">
                                        <label>Date To</label>
                                        <input
                                            type="date"
                                            className="form-control"
                                            name="endDate"
                                            value={filters.endDate}
                                            onChange={handleFilterChange}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Dockets Table */}
                    <div className="card">
                        <div className="card-body">
                            <DataTable
                                columns={[
                                    {
                                        key: 'docketNumber',
                                        title: 'Docket #',
                                        render: (val, row) => (
                                            <Link to={`/dockets/${row._id}`}>
                                                <strong>{val}</strong>
                                            </Link>
                                        )
                                    },
                                    {
                                        key: 'manufacturer',
                                        title: 'Manufacturer',
                                        render: (mfr) => mfr?.name || 'Unassigned'
                                    },
                                    {
                                        key: 'jobs',
                                        title: 'Jobs Count',
                                        render: (jobs) => jobs?.length || 0
                                    },
                                    {
                                        key: 'status',
                                        title: 'Status',
                                        render: (status) => (
                                            <span className={`badge badge-${getStatusBadge(status)}`}>
                                                {status?.toUpperCase()}
                                            </span>
                                        )
                                    },
                                    {
                                        key: 'createdAt',
                                        title: 'Created Date',
                                        render: (date) => new Date(date).toLocaleDateString()
                                    },
                                    {
                                        key: 'actions',
                                        title: 'Actions',
                                        render: (_, row) => (
                                            <Link to={`/dockets/${row._id}`} className="btn btn-sm btn-primary">
                                                <i className="fas fa-eye"></i> View
                                            </Link>
                                        )
                                    }
                                ]}
                                data={dockets}
                                pagination={pagination}
                                onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
                                onLimitChange={(limit) => setPagination(prev => ({ ...prev, limit, page: 1 }))}
                                loading={loading}
                                emptyMessage="No dockets found"
                            />
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
};

export default DocketList;
