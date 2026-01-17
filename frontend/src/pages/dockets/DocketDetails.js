import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { docketAPI } from '../../services/api';

const API_BASE_URL = process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001';

const DocketDetails = () => {
    const { id } = useParams();
    const [docket, setDocket] = useState(null);
    const [loading, setLoading] = useState(true);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [statusNotes, setStatusNotes] = useState('');

    useEffect(() => {
        const fetchDocket = async () => {
            try {
                setLoading(true);
                const response = await docketAPI.getById(id);
                const data = response.data.data || response.data;
                setDocket(data);
                setNewStatus(data.status);
            } catch (error) {
                toast.error('Failed to fetch docket details');
            } finally {
                setLoading(false);
            }
        };
        fetchDocket();
    }, [id]);

    const handleUpdateStatus = async () => {
        if (!newStatus) return;
        try {
            setUpdatingStatus(true);
            const response = await docketAPI.updateStatus(id, newStatus, statusNotes);
            setDocket(response.data.data || response.data);
            toast.success('Status updated successfully');
            setStatusNotes('');
        } catch (error) {
            toast.error('Failed to update status');
        } finally {
            setUpdatingStatus(false);
        }
    };

    if (loading) return <div className="p-5 text-center"><div className="spinner-border"></div></div>;
    if (!docket) return <div className="p-5 text-center">Docket not found</div>;

    return (
        <>
            <div className="content-header">
                <div className="container-fluid">
                    <div className="row mb-2">
                        <div className="col-sm-6 d-flex align-items-center">
                            <h1 className="m-0 mr-3">Docket: {docket.docketNumber}</h1>
                            <span className={`badge badge-${docket.status === 'completed' ? 'success' :
                                    docket.status === 'dispatched' ? 'info' :
                                        docket.status === 'received' ? 'primary' : 'secondary'
                                }`}>
                                {docket.status?.toUpperCase()}
                            </span>
                        </div>
                        <div className="col-sm-6">
                            <ol className="breadcrumb float-sm-right">
                                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                                <li className="breadcrumb-item"><Link to="/dockets">Dockets</Link></li>
                                <li className="breadcrumb-item active">{docket.docketNumber}</li>
                            </ol>
                        </div>
                    </div>
                </div>
            </div>

            <section className="content">
                <div className="container-fluid">
                    <div className="row">
                        <div className="col-md-8">
                            {/* Jobs List */}
                            <div className="card">
                                <div className="card-header">
                                    <h3 className="card-title">Jobs included in this Docket</h3>
                                </div>
                                <div className="card-body p-0">
                                    <table className="table table-hover mb-0">
                                        <thead>
                                            <tr>
                                                <th>Job #</th>
                                                <th>Order ID</th>
                                                <th>SKU</th>
                                                <th>Status</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {docket.jobs?.map((job) => (
                                                <tr key={job._id}>
                                                    <td>
                                                        <Link to={`/jobs/${job._id}`}>{job.jobId || job._id.slice(-8).toUpperCase()}</Link>
                                                    </td>
                                                    <td>
                                                        {job.order?.externalOrderId || '-'}
                                                    </td>
                                                    <td>{job.sku}</td>
                                                    <td>
                                                        <span className="badge badge-secondary">{job.status}</span>
                                                    </td>
                                                    <td>
                                                        <Link to={`/jobs/${job._id}`} className="btn btn-xs btn-outline-primary">
                                                            <i className="fas fa-eye"></i>
                                                        </Link>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div className="col-md-4">
                            {/* Info & Status Update */}
                            <div className="card">
                                <div className="card-header">
                                    <h3 className="card-title">Docket Info</h3>
                                </div>
                                <div className="card-body">
                                    <p><strong>Manufacturer:</strong> {docket.manufacturer?.name || 'N/A'}</p>
                                    <p><strong>Created By:</strong> {docket.createdBy?.name || 'System'}</p>
                                    <p><strong>Created Date:</strong> {new Date(docket.createdAt).toLocaleString()}</p>
                                    {docket.notes && (
                                        <div className="mt-3 p-2 bg-light border rounded">
                                            <strong>Notes:</strong>
                                            <p className="mb-0">{docket.notes}</p>
                                        </div>
                                    )}

                                    <hr />

                                    <div className="form-group">
                                        <label>Update Status</label>
                                        <select
                                            className="form-control"
                                            value={newStatus}
                                            onChange={(e) => setNewStatus(e.target.value)}
                                        >
                                            <option value="draft">Draft</option>
                                            <option value="dispatched">Dispatched</option>
                                            <option value="received">Received</option>
                                            <option value="completed">Completed</option>
                                            <option value="cancelled">Cancelled</option>
                                        </select>
                                    </div>

                                    <div className="form-group">
                                        <label>Status Change Notes</label>
                                        <textarea
                                            className="form-control"
                                            rows="3"
                                            value={statusNotes}
                                            onChange={(e) => setStatusNotes(e.target.value)}
                                        />
                                    </div>

                                    <button
                                        className="btn btn-primary btn-block"
                                        onClick={handleUpdateStatus}
                                        disabled={updatingStatus || newStatus === docket.status}
                                    >
                                        {updatingStatus ? 'Updating...' : 'Update Status'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
};

export default DocketDetails;
