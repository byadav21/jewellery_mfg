import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { marketplaceAccountAPI } from '../../services/api';

const MarketplaceAccountList = () => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState({});
  const [testing, setTesting] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    channel: 'amazon',
    accountCode: '',
    amazonCredentials: {
      refreshToken: '',
      clientId: '',
      clientSecret: '',
      marketplaceId: '',
      sellerId: ''
    },
    ebayCredentials: {
      appId: '',
      certId: '',
      refreshToken: ''
    },
    settings: {
      syncEnabled: true,
      autoCreateJobs: true,
      defaultPriority: 'medium',
      syncLastNDays: 7
    }
  });

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await marketplaceAccountAPI.getAll();
      setAccounts(response.data.data?.accounts || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const resetForm = () => {
    setFormData({
      name: '',
      channel: 'amazon',
      accountCode: '',
      amazonCredentials: {
        refreshToken: '',
        clientId: '',
        clientSecret: '',
        marketplaceId: '',
        sellerId: ''
      },
      ebayCredentials: {
        appId: '',
        certId: '',
        refreshToken: ''
      },
      settings: {
        syncEnabled: true,
        autoCreateJobs: true,
        defaultPriority: 'medium',
        syncLastNDays: 7
      }
    });
    setEditingAccount(null);
  };

  const handleOpenModal = (account = null) => {
    if (account) {
      setEditingAccount(account);
      setFormData({
        name: account.name,
        channel: account.channel,
        accountCode: account.accountCode,
        amazonCredentials: {
          refreshToken: '',
          clientId: '',
          clientSecret: '',
          marketplaceId: account.amazonCredentials?.marketplaceId || '',
          sellerId: account.amazonCredentials?.sellerId || ''
        },
        ebayCredentials: {
          appId: '',
          certId: '',
          refreshToken: ''
        },
        settings: {
          syncEnabled: account.settings?.syncEnabled ?? true,
          autoCreateJobs: account.settings?.autoCreateJobs ?? true,
          defaultPriority: account.settings?.defaultPriority || 'medium',
          syncLastNDays: account.settings?.syncLastNDays || 7
        }
      });
    } else {
      resetForm();
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    resetForm();
  };

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setFormData(prev => ({
        ...prev,
        [parent]: {
          ...prev[parent],
          [child]: type === 'checkbox' ? checked : value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...formData };

      // Clean up credentials based on channel
      if (formData.channel === 'amazon') {
        delete payload.ebayCredentials;
        // Only send credentials if they are filled
        if (!payload.amazonCredentials.refreshToken && !payload.amazonCredentials.clientId) {
          delete payload.amazonCredentials;
        }
      } else {
        delete payload.amazonCredentials;
        if (!payload.ebayCredentials.appId && !payload.ebayCredentials.certId) {
          delete payload.ebayCredentials;
        }
      }

      if (editingAccount) {
        await marketplaceAccountAPI.update(editingAccount._id, payload);
        toast.success('Account updated successfully');
      } else {
        await marketplaceAccountAPI.create(payload);
        toast.success('Account created successfully');
      }
      handleCloseModal();
      fetchAccounts();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save account');
    }
  };

  const handleDelete = async (account) => {
    if (!window.confirm(`Are you sure you want to delete account: ${account.name}?`)) return;
    try {
      await marketplaceAccountAPI.delete(account._id);
      toast.success('Account deleted successfully');
      fetchAccounts();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete account');
    }
  };

  const handleTestConnection = async (account) => {
    try {
      setTesting(prev => ({ ...prev, [account._id]: true }));
      const response = await marketplaceAccountAPI.testConnection(account._id);
      if (response.data.data?.success) {
        toast.success('Connection successful!');
      } else {
        toast.error(response.data.data?.message || 'Connection failed');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Connection test failed');
    } finally {
      setTesting(prev => ({ ...prev, [account._id]: false }));
    }
  };

  const handleSync = async (account) => {
    try {
      setSyncing(prev => ({ ...prev, [account._id]: true }));
      const response = await marketplaceAccountAPI.syncAccount(account._id);
      const stats = response.data.data?.stats;
      if (stats) {
        toast.success(`Synced: ${stats.ordersImported} orders imported, ${stats.ordersSkipped} skipped`);
      } else {
        toast.success('Sync completed');
      }
      fetchAccounts();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Sync failed');
    } finally {
      setSyncing(prev => ({ ...prev, [account._id]: false }));
    }
  };

  const handleSyncAll = async () => {
    try {
      setSyncing(prev => ({ ...prev, all: true }));
      const response = await marketplaceAccountAPI.syncAll();
      toast.success(response.data.message || 'All accounts synced');
      fetchAccounts();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Sync all failed');
    } finally {
      setSyncing(prev => ({ ...prev, all: false }));
    }
  };

  const getChannelIcon = (channel) => {
    return channel === 'amazon' ? 'fab fa-amazon' : 'fab fa-ebay';
  };

  const getChannelBadge = (channel) => {
    return channel === 'amazon' ? 'warning' : 'info';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
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
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">Marketplace Accounts</h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item active">Marketplace Accounts</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <section className="content">
        <div className="container-fluid">
          {/* Action Buttons */}
          <div className="row mb-3">
            <div className="col-md-12">
              <button className="btn btn-primary mr-2" onClick={() => handleOpenModal()}>
                <i className="fas fa-plus mr-1"></i> Add Account
              </button>
              <button
                className="btn btn-success"
                onClick={handleSyncAll}
                disabled={syncing.all}
              >
                {syncing.all ? (
                  <><span className="spinner-border spinner-border-sm mr-1"></span> Syncing All...</>
                ) : (
                  <><i className="fas fa-sync mr-1"></i> Sync All Accounts</>
                )}
              </button>
            </div>
          </div>

          {/* Accounts Cards */}
          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary" role="status">
                <span className="sr-only">Loading...</span>
              </div>
            </div>
          ) : accounts.length === 0 ? (
            <div className="card">
              <div className="card-body text-center py-5 text-muted">
                <i className="fas fa-store fa-3x mb-3"></i>
                <p>No marketplace accounts configured</p>
                <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                  <i className="fas fa-plus mr-1"></i> Add First Account
                </button>
              </div>
            </div>
          ) : (
            <div className="row">
              {accounts.map(account => (
                <div key={account._id} className="col-md-6 col-lg-4">
                  <div className={`card ${!account.isActive ? 'bg-light' : ''}`}>
                    <div className="card-header">
                      <h3 className="card-title">
                        <i className={`${getChannelIcon(account.channel)} mr-2`}></i>
                        {account.name}
                      </h3>
                      <div className="card-tools">
                        <span className={`badge badge-${getChannelBadge(account.channel)}`}>
                          {account.channel.toUpperCase()}
                        </span>
                        {!account.isActive && (
                          <span className="badge badge-secondary ml-1">Inactive</span>
                        )}
                      </div>
                    </div>
                    <div className="card-body">
                      <table className="table table-sm table-borderless mb-0">
                        <tbody>
                          <tr>
                            <td className="text-muted">Account Code:</td>
                            <td><strong>{account.accountCode}</strong></td>
                          </tr>
                          <tr>
                            <td className="text-muted">Sync Status:</td>
                            <td>
                              {account.settings?.syncEnabled ? (
                                <span className="badge badge-success">Enabled</span>
                              ) : (
                                <span className="badge badge-secondary">Disabled</span>
                              )}
                            </td>
                          </tr>
                          <tr>
                            <td className="text-muted">Last Sync:</td>
                            <td>{formatDate(account.lastSyncAt)}</td>
                          </tr>
                          {account.lastSyncStats && (
                            <tr>
                              <td className="text-muted">Last Result:</td>
                              <td>
                                <small>
                                  {account.lastSyncStats.ordersImported} imported,{' '}
                                  {account.lastSyncStats.ordersSkipped} skipped
                                </small>
                              </td>
                            </tr>
                          )}
                          <tr>
                            <td className="text-muted">Priority:</td>
                            <td>
                              <span className={`badge badge-${
                                account.settings?.defaultPriority === 'urgent' ? 'danger' :
                                account.settings?.defaultPriority === 'high' ? 'warning' :
                                account.settings?.defaultPriority === 'medium' ? 'info' : 'secondary'
                              }`}>
                                {account.settings?.defaultPriority || 'medium'}
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="card-footer">
                      <div className="btn-group btn-group-sm">
                        <button
                          className="btn btn-info"
                          onClick={() => handleTestConnection(account)}
                          disabled={testing[account._id]}
                          title="Test Connection"
                        >
                          {testing[account._id] ? (
                            <span className="spinner-border spinner-border-sm"></span>
                          ) : (
                            <i className="fas fa-plug"></i>
                          )}
                        </button>
                        <button
                          className="btn btn-success"
                          onClick={() => handleSync(account)}
                          disabled={syncing[account._id] || !account.settings?.syncEnabled}
                          title="Sync Now"
                        >
                          {syncing[account._id] ? (
                            <span className="spinner-border spinner-border-sm"></span>
                          ) : (
                            <i className="fas fa-sync"></i>
                          )}
                        </button>
                        <button
                          className="btn btn-primary"
                          onClick={() => handleOpenModal(account)}
                          title="Edit"
                        >
                          <i className="fas fa-edit"></i>
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDelete(account)}
                          title="Delete"
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Add/Edit Account Modal */}
      {showModal && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {editingAccount ? 'Edit Account' : 'Add New Account'}
                </h5>
                <button type="button" className="close" onClick={handleCloseModal}>
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body">
                  {/* Basic Info */}
                  <div className="row">
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Account Name <span className="text-danger">*</span></label>
                        <input
                          type="text"
                          className="form-control"
                          name="name"
                          value={formData.name}
                          onChange={handleFormChange}
                          required
                          placeholder="e.g., Amazon US Store"
                        />
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="form-group">
                        <label>Channel <span className="text-danger">*</span></label>
                        <select
                          className="form-control"
                          name="channel"
                          value={formData.channel}
                          onChange={handleFormChange}
                          disabled={!!editingAccount}
                        >
                          <option value="amazon">Amazon</option>
                          <option value="ebay">eBay</option>
                        </select>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="form-group">
                        <label>Account Code <span className="text-danger">*</span></label>
                        <input
                          type="text"
                          className="form-control"
                          name="accountCode"
                          value={formData.accountCode}
                          onChange={handleFormChange}
                          required
                          disabled={!!editingAccount}
                          placeholder="e.g., AMZ-US-01"
                        />
                      </div>
                    </div>
                  </div>

                  <hr />

                  {/* Credentials */}
                  <h6 className="mb-3">
                    <i className={`${getChannelIcon(formData.channel)} mr-2`}></i>
                    {formData.channel === 'amazon' ? 'Amazon' : 'eBay'} Credentials
                    {editingAccount && (
                      <small className="text-muted ml-2">(Leave blank to keep existing)</small>
                    )}
                  </h6>

                  {formData.channel === 'amazon' ? (
                    <>
                      <div className="row">
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>Client ID</label>
                            <input
                              type="text"
                              className="form-control"
                              name="amazonCredentials.clientId"
                              value={formData.amazonCredentials.clientId}
                              onChange={handleFormChange}
                              placeholder="LWA Client ID"
                            />
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>Client Secret</label>
                            <input
                              type="password"
                              className="form-control"
                              name="amazonCredentials.clientSecret"
                              value={formData.amazonCredentials.clientSecret}
                              onChange={handleFormChange}
                              placeholder="LWA Client Secret"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="row">
                        <div className="col-md-12">
                          <div className="form-group">
                            <label>Refresh Token</label>
                            <textarea
                              className="form-control"
                              name="amazonCredentials.refreshToken"
                              value={formData.amazonCredentials.refreshToken}
                              onChange={handleFormChange}
                              rows="2"
                              placeholder="SP-API Refresh Token"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="row">
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>Marketplace ID</label>
                            <input
                              type="text"
                              className="form-control"
                              name="amazonCredentials.marketplaceId"
                              value={formData.amazonCredentials.marketplaceId}
                              onChange={handleFormChange}
                              placeholder="e.g., A21TJRUUN4KGV"
                            />
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>Seller ID</label>
                            <input
                              type="text"
                              className="form-control"
                              name="amazonCredentials.sellerId"
                              value={formData.amazonCredentials.sellerId}
                              onChange={handleFormChange}
                              placeholder="Your Seller ID"
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="row">
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>App ID</label>
                            <input
                              type="text"
                              className="form-control"
                              name="ebayCredentials.appId"
                              value={formData.ebayCredentials.appId}
                              onChange={handleFormChange}
                              placeholder="eBay App ID"
                            />
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>Cert ID</label>
                            <input
                              type="password"
                              className="form-control"
                              name="ebayCredentials.certId"
                              value={formData.ebayCredentials.certId}
                              onChange={handleFormChange}
                              placeholder="eBay Cert ID"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="row">
                        <div className="col-md-12">
                          <div className="form-group">
                            <label>OAuth Refresh Token</label>
                            <textarea
                              className="form-control"
                              name="ebayCredentials.refreshToken"
                              value={formData.ebayCredentials.refreshToken}
                              onChange={handleFormChange}
                              rows="2"
                              placeholder="eBay OAuth Refresh Token"
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <hr />

                  {/* Settings */}
                  <h6 className="mb-3"><i className="fas fa-cog mr-2"></i>Sync Settings</h6>
                  <div className="row">
                    <div className="col-md-3">
                      <div className="form-group">
                        <div className="custom-control custom-switch">
                          <input
                            type="checkbox"
                            className="custom-control-input"
                            id="syncEnabled"
                            name="settings.syncEnabled"
                            checked={formData.settings.syncEnabled}
                            onChange={handleFormChange}
                          />
                          <label className="custom-control-label" htmlFor="syncEnabled">
                            Enable Sync
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="form-group">
                        <div className="custom-control custom-switch">
                          <input
                            type="checkbox"
                            className="custom-control-input"
                            id="autoCreateJobs"
                            name="settings.autoCreateJobs"
                            checked={formData.settings.autoCreateJobs}
                            onChange={handleFormChange}
                          />
                          <label className="custom-control-label" htmlFor="autoCreateJobs">
                            Auto Create Jobs
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="form-group">
                        <label>Default Priority</label>
                        <select
                          className="form-control"
                          name="settings.defaultPriority"
                          value={formData.settings.defaultPriority}
                          onChange={handleFormChange}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="form-group">
                        <label>Sync Last N Days</label>
                        <input
                          type="number"
                          className="form-control"
                          name="settings.syncLastNDays"
                          value={formData.settings.syncLastNDays}
                          onChange={handleFormChange}
                          min="1"
                          max="30"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingAccount ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {showModal && <div className="modal-backdrop fade show"></div>}
    </>
  );
};

export default MarketplaceAccountList;
