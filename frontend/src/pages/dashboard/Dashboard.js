import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { dashboardAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { isAdmin, isDesigner, isManufacturer } = useAuth();

  useEffect(() => {
    fetchStatistics();
  }, []);

  const fetchStatistics = async () => {
    try {
      const response = await dashboardAPI.getStatistics();
      setStats(response.data.data);
    } catch (error) {
      console.error('Error fetching statistics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="content-wrapper">
        <div className="content">
          <div className="container-fluid pt-4">
            <div className="spinner-wrapper">
              <div className="spinner-border text-primary" role="status">
                <span className="sr-only">Loading...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Content Header */}
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">Dashboard</h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item active">Dashboard</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <section className="content">
        <div className="container-fluid">
          {/* Info boxes */}
          <div className="row">
            {/* Total Jobs */}
            <div className="col-12 col-sm-6 col-md-3">
              <div className="info-box">
                <span className="info-box-icon bg-info elevation-1">
                  <i className="fas fa-briefcase"></i>
                </span>
                <div className="info-box-content">
                  <span className="info-box-text">Total Jobs</span>
                  <span className="info-box-number">{stats?.totalJobs || 0}</span>
                </div>
              </div>
            </div>

            {/* Today's Jobs */}
            <div className="col-12 col-sm-6 col-md-3">
              <div className="info-box">
                <span className="info-box-icon bg-success elevation-1">
                  <i className="fas fa-calendar-day"></i>
                </span>
                <div className="info-box-content">
                  <span className="info-box-text">Today's Jobs</span>
                  <span className="info-box-number">{stats?.todayJobs || 0}</span>
                </div>
              </div>
            </div>

            {/* Overdue Jobs */}
            <div className="col-12 col-sm-6 col-md-3">
              <div className="info-box">
                <span className="info-box-icon bg-danger elevation-1">
                  <i className="fas fa-exclamation-triangle"></i>
                </span>
                <div className="info-box-content">
                  <span className="info-box-text">Overdue Jobs</span>
                  <span className="info-box-number">{stats?.overdueJobs || 0}</span>
                </div>
              </div>
            </div>

            {/* Pending CAD Reviews (Admin only) */}
            {isAdmin() && (
              <div className="col-12 col-sm-6 col-md-3">
                <div className="info-box">
                  <span className="info-box-icon bg-warning elevation-1">
                    <i className="fas fa-pencil-ruler"></i>
                  </span>
                  <div className="info-box-content">
                    <span className="info-box-text">Pending CAD Reviews</span>
                    <span className="info-box-number">{stats?.pendingCADReviews || 0}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Additional Stats Row */}
          {isAdmin() && (
            <div className="row">
              <div className="col-12 col-sm-6 col-md-3">
                <div className="small-box bg-primary">
                  <div className="inner">
                    <h3>{stats?.totalOrders || 0}</h3>
                    <p>Total Orders</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-shopping-cart"></i>
                  </div>
                  <Link to="/orders" className="small-box-footer">
                    View Orders <i className="fas fa-arrow-circle-right"></i>
                  </Link>
                </div>
              </div>

              <div className="col-12 col-sm-6 col-md-3">
                <div className="small-box bg-success">
                  <div className="inner">
                    <h3>{stats?.readyForDelivery || 0}</h3>
                    <p>Ready for Delivery</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-truck"></i>
                  </div>
                  <Link to="/delivery" className="small-box-footer">
                    View Deliveries <i className="fas fa-arrow-circle-right"></i>
                  </Link>
                </div>
              </div>

              <div className="col-12 col-sm-6 col-md-3">
                <div className="small-box bg-warning">
                  <div className="inner">
                    <h3>{stats?.pendingManufacturing || 0}</h3>
                    <p>Pending Manufacturing</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-industry"></i>
                  </div>
                  <Link to="/manufacturing" className="small-box-footer">
                    View Jobs <i className="fas fa-arrow-circle-right"></i>
                  </Link>
                </div>
              </div>

              <div className="col-12 col-sm-6 col-md-3">
                <div className="small-box bg-danger">
                  <div className="inner">
                    <h3>{stats?.lowStockCount || 0}</h3>
                    <p>Low Stock Components</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-cubes"></i>
                  </div>
                  <Link to="/components" className="small-box-footer">
                    View Components <i className="fas fa-arrow-circle-right"></i>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Designer Stats */}
          {isDesigner() && !isAdmin() && (
            <div className="row">
              <div className="col-12 col-md-6">
                <div className="small-box bg-info">
                  <div className="inner">
                    <h3>{stats?.myCADTasks || 0}</h3>
                    <p>My CAD Tasks</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-pencil-ruler"></i>
                  </div>
                  <Link to="/cad/my-tasks" className="small-box-footer">
                    View Tasks <i className="fas fa-arrow-circle-right"></i>
                  </Link>
                </div>
              </div>

              <div className="col-12 col-md-6">
                <div className="small-box bg-warning">
                  <div className="inner">
                    <h3>{stats?.myPendingCAD || 0}</h3>
                    <p>Pending Assignments</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-clock"></i>
                  </div>
                  <Link to="/cad/my-tasks" className="small-box-footer">
                    View Pending <i className="fas fa-arrow-circle-right"></i>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Manufacturer Stats */}
          {isManufacturer() && !isAdmin() && (
            <div className="row">
              <div className="col-12 col-md-6">
                <div className="small-box bg-purple">
                  <div className="inner">
                    <h3>{stats?.myManufacturingJobs || 0}</h3>
                    <p>My Manufacturing Jobs</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-industry"></i>
                  </div>
                  <Link to="/manufacturing" className="small-box-footer">
                    View Jobs <i className="fas fa-arrow-circle-right"></i>
                  </Link>
                </div>
              </div>

              <div className="col-12 col-md-6">
                <div className="small-box bg-orange">
                  <div className="inner">
                    <h3>{stats?.myPendingAcceptance || 0}</h3>
                    <p>Pending Acceptance</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-clock"></i>
                  </div>
                  <Link to="/manufacturing" className="small-box-footer">
                    View Pending <i className="fas fa-arrow-circle-right"></i>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Jobs by Status */}
          <div className="row">
            <div className="col-12">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-chart-pie mr-2"></i>
                    Jobs by Status
                  </h3>
                </div>
                <div className="card-body">
                  <div className="row">
                    {Object.entries(stats?.jobsByStatus || {}).map(([status, count]) => (
                      <div key={status} className="col-6 col-md-3 col-lg-2 mb-3">
                        <div className="text-center">
                          <span className={`badge badge-status-${status} p-2`}>
                            {status.replace(/_/g, ' ').toUpperCase()}
                          </span>
                          <h4 className="mt-2 mb-0">{count}</h4>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Jobs by Channel */}
          {isAdmin() && (
            <div className="row">
              <div className="col-12 col-md-6">
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">
                      <i className="fas fa-store mr-2"></i>
                      Jobs by Channel
                    </h3>
                  </div>
                  <div className="card-body">
                    <div className="row text-center">
                      <div className="col-4">
                        <span className="badge badge-channel-amazon p-2 mb-2">AMAZON</span>
                        <h3>{stats?.jobsByChannel?.amazon || 0}</h3>
                      </div>
                      <div className="col-4">
                        <span className="badge badge-channel-ebay p-2 mb-2">EBAY</span>
                        <h3>{stats?.jobsByChannel?.ebay || 0}</h3>
                      </div>
                      <div className="col-4">
                        <span className="badge badge-channel-manual p-2 mb-2">MANUAL</span>
                        <h3>{stats?.jobsByChannel?.manual || 0}</h3>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-md-6">
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">
                      <i className="fas fa-bolt mr-2"></i>
                      Quick Actions
                    </h3>
                  </div>
                  <div className="card-body">
                    <div className="row">
                      <div className="col-6 mb-2">
                        <Link to="/orders/new" className="btn btn-primary btn-block">
                          <i className="fas fa-plus mr-2"></i> New Order
                        </Link>
                      </div>
                      <div className="col-6 mb-2">
                        <Link to="/jobs/new" className="btn btn-success btn-block">
                          <i className="fas fa-plus mr-2"></i> New Job
                        </Link>
                      </div>
                      <div className="col-6 mb-2">
                        <Link to="/cad/reviews" className="btn btn-warning btn-block">
                          <i className="fas fa-eye mr-2"></i> CAD Reviews
                        </Link>
                      </div>
                      <div className="col-6 mb-2">
                        <Link to="/delivery" className="btn btn-info btn-block">
                          <i className="fas fa-truck mr-2"></i> Deliveries
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
};

export default Dashboard;
