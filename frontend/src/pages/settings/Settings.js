import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { settingsAPI, userAPI } from '../../services/api';

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  // General Settings
  const [generalSettings, setGeneralSettings] = useState({
    company_name: '',
    company_email: '',
    company_phone: '',
    company_address: '',
    currency: 'INR',
    timezone: 'Asia/Kolkata'
  });

  // TAT Settings (in hours)
  const [tatSettings, setTatSettings] = useState({
    cad_tat_hours: 24,
    manufacturing_tat_hours: 48,
    production_coordinator_tat_hours: 24,
    delivery_tat_hours: 24
  });

  // Notification Settings
  const [notificationSettings, setNotificationSettings] = useState({
    email_notifications_enabled: true,
    whatsapp_notifications_enabled: true,
    tat_breach_alert_enabled: true,
    daily_summary_enabled: true,
    daily_summary_time: '09:00'
  });

  // API Credentials
  const [amazonCredentials, setAmazonCredentials] = useState({
    seller_id: '',
    marketplace_id: '',
    access_key: '',
    secret_key: '',
    refresh_token: '',
    client_id: '',
    client_secret: ''
  });

  // Amazon Sync Settings
  const [amazonSyncSettings, setAmazonSyncSettings] = useState({
    amazon_sync_enabled: false,
    amazon_sync_interval: 30,
    amazon_sync_days_back: 30,
    amazon_sync_time: '',
    amazon_max_results_per_page: 100,
    amazon_fetch_all_pages: true
  });

  const [ebayCredentials, setEbayCredentials] = useState({
    app_id: '',
    cert_id: '',
    dev_id: '',
    auth_token: '',
    environment: 'sandbox'
  });

  const [whatsappCredentials, setWhatsappCredentials] = useState({
    api_url: '',
    api_key: '',
    sender_number: ''
  });

  const [emailSettings, setEmailSettings] = useState({
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    smtp_secure: false,
    from_email: '',
    from_name: ''
  });

  // Auto-Assignment Rules
  const [autoAssignmentRules, setAutoAssignmentRules] = useState({
    amazon: { cadDesigner: '', manufacturer: '', admin: '', productionCoordinator: '' },
    ebay: { cadDesigner: '', manufacturer: '', admin: '', productionCoordinator: '' },
    etsy: { cadDesigner: '', manufacturer: '', admin: '', productionCoordinator: '' },
    manual: { cadDesigner: '', manufacturer: '', admin: '', productionCoordinator: '' }
  });

  const [users, setUsers] = useState({
    designers: [],
    manufacturers: [],
    admins: [],
    productionCoordinators: []
  });


  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await settingsAPI.getAll();
      const settings = response.data.data || response.data.settings || [];

      // Parse settings into respective state objects
      settings.forEach(setting => {
        const { key, value } = setting;

        // General settings
        if (key in generalSettings) {
          setGeneralSettings(prev => ({ ...prev, [key]: value }));
        }
        // TAT settings
        else if (key in tatSettings) {
          setTatSettings(prev => ({ ...prev, [key]: value }));
        }
        // Notification settings
        else if (key in notificationSettings) {
          setNotificationSettings(prev => ({ ...prev, [key]: value }));
        }
        // Amazon sync settings
        else if (key === 'amazon_sync_enabled' || key === 'amazon_sync_interval' ||
          key === 'amazon_sync_days_back' || key === 'amazon_sync_time' ||
          key === 'amazon_max_results_per_page' || key === 'amazon_fetch_all_pages') {
          setAmazonSyncSettings(prev => ({ ...prev, [key]: value }));
        }
        // Amazon credentials
        else if (key.startsWith('amazon_')) {
          const subKey = key.replace('amazon_', '');
          setAmazonCredentials(prev => ({ ...prev, [subKey]: value }));
        }
        // eBay credentials
        else if (key.startsWith('ebay_')) {
          const subKey = key.replace('ebay_', '');
          setEbayCredentials(prev => ({ ...prev, [subKey]: value }));
        }
        // WhatsApp credentials
        else if (key.startsWith('whatsapp_')) {
          const subKey = key.replace('whatsapp_', '');
          setWhatsappCredentials(prev => ({ ...prev, [subKey]: value }));
        }
        // Email settings
        else if (key.startsWith('email_') || key.startsWith('smtp_') || key.startsWith('from_')) {
          setEmailSettings(prev => ({ ...prev, [key]: value }));
        }
        // Auto-assignment rules
        else if (key === 'auto_assignment_rules') {
          try {
            const rules = typeof value === 'string' ? JSON.parse(value) : value;
            if (rules) {
              setAutoAssignmentRules(prev => ({
                ...prev,
                ...rules
              }));
            }
          } catch (e) {
            console.error('Error parsing auto_assignment_rules:', e);
          }
        }
      });

      // Fetch users for dropdowns
      await fetchUsers();
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  }, [generalSettings, tatSettings, notificationSettings]);

  const fetchUsers = async () => {
    try {
      const rolesToFetch = ['designer', 'manufacturer', 'admin', 'super_admin'];
      const usersByRole = {};

      for (const role of rolesToFetch) {
        const response = await userAPI.getByRole(role);
        usersByRole[role] = response.data.data || [];
      }

      setUsers({
        designers: usersByRole.designer || [],
        manufacturers: usersByRole.manufacturer || [],
        admins: [...(usersByRole.admin || []), ...(usersByRole.super_admin || [])],
        productionCoordinators: [...(usersByRole.admin || []), ...(usersByRole.super_admin || [])]
      });
    } catch (error) {
      console.error('Error fetching users for settings:', error);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSaveGeneral = async () => {
    try {
      setSaving(true);
      const settingsToSave = Object.entries(generalSettings).map(([key, value]) => ({ key, value }));
      await settingsAPI.updateBulk(settingsToSave);
      toast.success('General settings saved successfully');
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTAT = async () => {
    try {
      setSaving(true);
      const settingsToSave = Object.entries(tatSettings).map(([key, value]) => ({ key, value }));
      await settingsAPI.updateBulk(settingsToSave);
      toast.success('TAT settings saved successfully');
    } catch (error) {
      toast.error('Failed to save TAT settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    try {
      setSaving(true);
      const settingsToSave = Object.entries(notificationSettings).map(([key, value]) => ({ key, value }));
      await settingsAPI.updateBulk(settingsToSave);
      toast.success('Notification settings saved successfully');
    } catch (error) {
      toast.error('Failed to save notification settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAmazon = async () => {
    try {
      setSaving(true);
      await settingsAPI.saveAPICredentials('amazon', amazonCredentials);
      toast.success('Amazon API credentials saved successfully');
    } catch (error) {
      toast.error('Failed to save Amazon credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAmazonSync = async () => {
    try {
      setSaving(true);
      const settingsToSave = Object.entries(amazonSyncSettings).map(([key, value]) => ({ key, value }));
      await settingsAPI.updateBulk(settingsToSave);
      toast.success('Amazon sync settings saved successfully');
    } catch (error) {
      toast.error('Failed to save sync settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEbay = async () => {
    try {
      setSaving(true);
      await settingsAPI.saveAPICredentials('ebay', ebayCredentials);
      toast.success('eBay API credentials saved successfully');
    } catch (error) {
      toast.error('Failed to save eBay credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWhatsApp = async () => {
    try {
      setSaving(true);
      await settingsAPI.saveAPICredentials('whatsapp', whatsappCredentials);
      toast.success('WhatsApp API settings saved successfully');
    } catch (error) {
      toast.error('Failed to save WhatsApp settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEmail = async () => {
    try {
      setSaving(true);
      const settingsToSave = Object.entries(emailSettings).map(([key, value]) => ({ key, value }));
      await settingsAPI.updateBulk(settingsToSave);
      toast.success('Email settings saved successfully');
    } catch (error) {
      toast.error('Failed to save email settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAutoAssignment = async () => {
    try {
      setSaving(true);
      await settingsAPI.update('auto_assignment_rules', JSON.stringify(autoAssignmentRules));
      toast.success('Auto-assignment rules saved successfully');
    } catch (error) {
      toast.error('Failed to save auto-assignment rules');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="content">
        <div className="container-fluid pt-3">
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status">
              <span className="sr-only">Loading...</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="content">
      <div className="container-fluid pt-3">
        <h1 className="h3 mb-3">Settings</h1>

        <div className="row">
          {/* Settings Navigation */}
          <div className="col-md-3">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Categories</h3>
              </div>
              <div className="card-body p-0">
                <ul className="nav nav-pills flex-column">
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === 'general' ? 'active' : ''}`}
                      onClick={() => setActiveTab('general')}
                    >
                      <i className="fas fa-cog mr-2"></i> General
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === 'tat' ? 'active' : ''}`}
                      onClick={() => setActiveTab('tat')}
                    >
                      <i className="fas fa-clock mr-2"></i> TAT Settings
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === 'notifications' ? 'active' : ''}`}
                      onClick={() => setActiveTab('notifications')}
                    >
                      <i className="fas fa-bell mr-2"></i> Notifications
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === 'amazon' ? 'active' : ''}`}
                      onClick={() => setActiveTab('amazon')}
                    >
                      <i className="fab fa-amazon mr-2"></i> Amazon API
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === 'ebay' ? 'active' : ''}`}
                      onClick={() => setActiveTab('ebay')}
                    >
                      <i className="fab fa-ebay mr-2"></i> eBay API
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === 'whatsapp' ? 'active' : ''}`}
                      onClick={() => setActiveTab('whatsapp')}
                    >
                      <i className="fab fa-whatsapp mr-2"></i> WhatsApp API
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === 'email' ? 'active' : ''}`}
                      onClick={() => setActiveTab('email')}
                    >
                      <i className="fas fa-envelope mr-2"></i> Email (SMTP)
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === 'assignment' ? 'active' : ''}`}
                      onClick={() => setActiveTab('assignment')}
                    >
                      <i className="fas fa-user-tag mr-2"></i> Auto-Assignment
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Settings Content */}
          <div className="col-md-9">
            {/* General Settings */}
            {activeTab === 'general' && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">General Settings</h3>
                </div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Company Name</label>
                        <input
                          type="text"
                          className="form-control"
                          value={generalSettings.company_name}
                          onChange={(e) => setGeneralSettings(prev => ({ ...prev, company_name: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Company Email</label>
                        <input
                          type="email"
                          className="form-control"
                          value={generalSettings.company_email}
                          onChange={(e) => setGeneralSettings(prev => ({ ...prev, company_email: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Company Phone</label>
                        <input
                          type="tel"
                          className="form-control"
                          value={generalSettings.company_phone}
                          onChange={(e) => setGeneralSettings(prev => ({ ...prev, company_phone: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Currency</label>
                        <select
                          className="form-control"
                          value={generalSettings.currency}
                          onChange={(e) => setGeneralSettings(prev => ({ ...prev, currency: e.target.value }))}
                        >
                          <option value="INR">INR (Indian Rupee)</option>
                          <option value="USD">USD (US Dollar)</option>
                          <option value="EUR">EUR (Euro)</option>
                          <option value="GBP">GBP (British Pound)</option>
                        </select>
                      </div>
                    </div>
                    <div className="col-md-12">
                      <div className="form-group">
                        <label>Company Address</label>
                        <textarea
                          className="form-control"
                          rows="3"
                          value={generalSettings.company_address}
                          onChange={(e) => setGeneralSettings(prev => ({ ...prev, company_address: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card-footer">
                  <button className="btn btn-primary" onClick={handleSaveGeneral} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {/* TAT Settings */}
            {activeTab === 'tat' && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">TAT (Turn Around Time) Settings</h3>
                </div>
                <div className="card-body">
                  <div className="alert alert-info">
                    <i className="fas fa-info-circle mr-2"></i>
                    TAT breach alerts will be sent when these time limits are exceeded.
                  </div>
                  <div className="row">
                    <div className="col-md-3">
                      <div className="form-group">
                        <label>CAD TAT (Hours)</label>
                        <input
                          type="number"
                          className="form-control"
                          min="1"
                          value={tatSettings.cad_tat_hours}
                          onChange={(e) => setTatSettings(prev => ({ ...prev, cad_tat_hours: parseInt(e.target.value) }))}
                        />
                        <small className="text-muted">Time allowed for CAD design completion</small>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="form-group">
                        <label>Manufacturing TAT (Hours)</label>
                        <input
                          type="number"
                          className="form-control"
                          min="1"
                          value={tatSettings.manufacturing_tat_hours}
                          onChange={(e) => setTatSettings(prev => ({ ...prev, manufacturing_tat_hours: parseInt(e.target.value) }))}
                        />
                        <small className="text-muted">Time allowed for manufacturing completion</small>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="form-group">
                        <label>Production Coordinator TAT (Hours)</label>
                        <input
                          type="number"
                          className="form-control"
                          min="1"
                          value={tatSettings.production_coordinator_tat_hours}
                          onChange={(e) => setTatSettings(prev => ({ ...prev, production_coordinator_tat_hours: parseInt(e.target.value) }))}
                        />
                        <small className="text-muted">Response time for Production Coordinator</small>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="form-group">
                        <label>Delivery TAT (Hours)</label>
                        <input
                          type="number"
                          className="form-control"
                          min="1"
                          value={tatSettings.delivery_tat_hours}
                          onChange={(e) => setTatSettings(prev => ({ ...prev, delivery_tat_hours: parseInt(e.target.value) }))}
                        />
                        <small className="text-muted">Time allowed for delivery completion</small>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card-footer">
                  <button className="btn btn-primary" onClick={handleSaveTAT} disabled={saving}>
                    {saving ? 'Saving...' : 'Save TAT Settings'}
                  </button>
                </div>
              </div>
            )}

            {/* Notification Settings */}
            {activeTab === 'notifications' && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Notification Settings</h3>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <div className="custom-control custom-switch">
                      <input
                        type="checkbox"
                        className="custom-control-input"
                        id="emailNotifications"
                        checked={notificationSettings.email_notifications_enabled}
                        onChange={(e) => setNotificationSettings(prev => ({ ...prev, email_notifications_enabled: e.target.checked }))}
                      />
                      <label className="custom-control-label" htmlFor="emailNotifications">
                        Enable Email Notifications
                      </label>
                    </div>
                  </div>
                  <div className="form-group">
                    <div className="custom-control custom-switch">
                      <input
                        type="checkbox"
                        className="custom-control-input"
                        id="whatsappNotifications"
                        checked={notificationSettings.whatsapp_notifications_enabled}
                        onChange={(e) => setNotificationSettings(prev => ({ ...prev, whatsapp_notifications_enabled: e.target.checked }))}
                      />
                      <label className="custom-control-label" htmlFor="whatsappNotifications">
                        Enable WhatsApp Notifications
                      </label>
                    </div>
                  </div>
                  <div className="form-group">
                    <div className="custom-control custom-switch">
                      <input
                        type="checkbox"
                        className="custom-control-input"
                        id="tatBreachAlert"
                        checked={notificationSettings.tat_breach_alert_enabled}
                        onChange={(e) => setNotificationSettings(prev => ({ ...prev, tat_breach_alert_enabled: e.target.checked }))}
                      />
                      <label className="custom-control-label" htmlFor="tatBreachAlert">
                        Enable TAT Breach Alerts
                      </label>
                    </div>
                    <small className="text-muted">Send alerts when TAT is breached</small>
                  </div>
                  <div className="form-group">
                    <div className="custom-control custom-switch">
                      <input
                        type="checkbox"
                        className="custom-control-input"
                        id="dailySummary"
                        checked={notificationSettings.daily_summary_enabled}
                        onChange={(e) => setNotificationSettings(prev => ({ ...prev, daily_summary_enabled: e.target.checked }))}
                      />
                      <label className="custom-control-label" htmlFor="dailySummary">
                        Enable Daily Summary
                      </label>
                    </div>
                  </div>
                  {notificationSettings.daily_summary_enabled && (
                    <div className="form-group">
                      <label>Daily Summary Time</label>
                      <input
                        type="time"
                        className="form-control"
                        style={{ maxWidth: '200px' }}
                        value={notificationSettings.daily_summary_time}
                        onChange={(e) => setNotificationSettings(prev => ({ ...prev, daily_summary_time: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
                <div className="card-footer">
                  <button className="btn btn-primary" onClick={handleSaveNotifications} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Notification Settings'}
                  </button>
                </div>
              </div>
            )}

            {/* Amazon API Settings */}
            {activeTab === 'amazon' && (
              <>
                {/* Amazon Credentials Card */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">Amazon SP-API Credentials</h3>
                  </div>
                  <div className="card-body">
                    <div className="alert alert-warning">
                      <i className="fas fa-exclamation-triangle mr-2"></i>
                      Keep your API credentials secure. Do not share them.
                    </div>
                    <div className="row">
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Seller ID</label>
                          <input
                            type="text"
                            className="form-control"
                            value={amazonCredentials.seller_id}
                            onChange={(e) => setAmazonCredentials(prev => ({ ...prev, seller_id: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Marketplace ID</label>
                          <input
                            type="text"
                            className="form-control"
                            value={amazonCredentials.marketplace_id}
                            onChange={(e) => setAmazonCredentials(prev => ({ ...prev, marketplace_id: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Access Key</label>
                          <input
                            type="password"
                            className="form-control"
                            value={amazonCredentials.access_key}
                            onChange={(e) => setAmazonCredentials(prev => ({ ...prev, access_key: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Secret Key</label>
                          <input
                            type="password"
                            className="form-control"
                            value={amazonCredentials.secret_key}
                            onChange={(e) => setAmazonCredentials(prev => ({ ...prev, secret_key: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Client ID</label>
                          <input
                            type="text"
                            className="form-control"
                            value={amazonCredentials.client_id}
                            onChange={(e) => setAmazonCredentials(prev => ({ ...prev, client_id: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="form-group">
                          <label>Client Secret</label>
                          <input
                            type="password"
                            className="form-control"
                            value={amazonCredentials.client_secret}
                            onChange={(e) => setAmazonCredentials(prev => ({ ...prev, client_secret: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="col-md-12">
                        <div className="form-group">
                          <label>Refresh Token</label>
                          <textarea
                            className="form-control"
                            rows="2"
                            value={amazonCredentials.refresh_token}
                            onChange={(e) => setAmazonCredentials(prev => ({ ...prev, refresh_token: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="card-footer">
                    <button className="btn btn-primary" onClick={handleSaveAmazon} disabled={saving}>
                      {saving ? 'Saving...' : 'Save Amazon Credentials'}
                    </button>
                  </div>
                </div>

                {/* Amazon Sync Settings Card */}
                <div className="card mt-3">
                  <div className="card-header">
                    <h3 className="card-title">
                      <i className="fas fa-sync-alt mr-2"></i>
                      Amazon Order Sync Settings
                    </h3>
                  </div>
                  <div className="card-body">
                    <div className="alert alert-info">
                      <i className="fas fa-info-circle mr-2"></i>
                      Configure automatic order synchronization from Amazon. Orders will be fetched automatically based on the schedule below.
                    </div>
                    <div className="row">
                      <div className="col-md-12">
                        <div className="form-group">
                          <div className="custom-control custom-switch">
                            <input
                              type="checkbox"
                              className="custom-control-input"
                              id="amazonSyncEnabled"
                              checked={amazonSyncSettings.amazon_sync_enabled}
                              onChange={(e) => setAmazonSyncSettings(prev => ({ ...prev, amazon_sync_enabled: e.target.checked }))}
                            />
                            <label className="custom-control-label" htmlFor="amazonSyncEnabled">
                              <strong>Enable Automatic Order Sync</strong>
                            </label>
                          </div>
                          <small className="text-muted d-block mt-1">When enabled, orders will be automatically fetched from Amazon</small>
                        </div>
                      </div>

                      {amazonSyncSettings.amazon_sync_enabled && (
                        <>
                          <div className="col-md-4">
                            <div className="form-group">
                              <label>Sync Interval (Minutes)</label>
                              <select
                                className="form-control"
                                value={amazonSyncSettings.amazon_sync_interval}
                                onChange={(e) => setAmazonSyncSettings(prev => ({ ...prev, amazon_sync_interval: parseInt(e.target.value) }))}
                              >
                                <option value="5">Every 5 minutes</option>
                                <option value="10">Every 10 minutes</option>
                                <option value="15">Every 15 minutes</option>
                                <option value="30">Every 30 minutes</option>
                                <option value="60">Every 1 hour</option>
                                <option value="120">Every 2 hours</option>
                                <option value="360">Every 6 hours</option>
                                <option value="720">Every 12 hours</option>
                                <option value="1440">Once daily</option>
                              </select>
                              <small className="text-muted">How often to check for new orders</small>
                            </div>
                          </div>
                          <div className="col-md-4">
                            <div className="form-group">
                              <label>Fetch Orders From Last (Days)</label>
                              <select
                                className="form-control"
                                value={amazonSyncSettings.amazon_sync_days_back}
                                onChange={(e) => setAmazonSyncSettings(prev => ({ ...prev, amazon_sync_days_back: parseInt(e.target.value) }))}
                              >
                                <option value="1">1 day</option>
                                <option value="3">3 days</option>
                                <option value="7">7 days</option>
                                <option value="14">14 days</option>
                                <option value="30">30 days</option>
                                <option value="60">60 days</option>
                                <option value="90">90 days</option>
                              </select>
                              <small className="text-muted">How far back to look for orders</small>
                            </div>
                          </div>
                          <div className="col-md-4">
                            <div className="form-group">
                              <label>Specific Sync Time (Optional)</label>
                              <input
                                type="time"
                                className="form-control"
                                value={amazonSyncSettings.amazon_sync_time}
                                onChange={(e) => setAmazonSyncSettings(prev => ({ ...prev, amazon_sync_time: e.target.value }))}
                              />
                              <small className="text-muted">Leave empty to use interval-based sync</small>
                            </div>
                          </div>

                          <div className="col-md-12 mt-3">
                            <h6><i className="fas fa-cogs mr-2"></i>Advanced Sync Settings</h6>
                            <hr />
                          </div>

                          <div className="col-md-4">
                            <div className="form-group">
                              <label>Orders Per API Page</label>
                              <select
                                className="form-control"
                                value={amazonSyncSettings.amazon_max_results_per_page}
                                onChange={(e) => setAmazonSyncSettings(prev => ({ ...prev, amazon_max_results_per_page: parseInt(e.target.value) }))}
                              >
                                <option value="10">10 orders</option>
                                <option value="25">25 orders</option>
                                <option value="50">50 orders</option>
                                <option value="100">100 orders (Amazon max)</option>
                              </select>
                              <small className="text-muted">Amazon API limit is 100 per page. Use "All Pages" mode to fetch more.</small>
                            </div>
                          </div>

                          <div className="col-md-8">
                            <div className="form-group">
                              <label>Pagination Mode</label>
                              <div className="mt-2">
                                <div className="custom-control custom-radio custom-control-inline">
                                  <input
                                    type="radio"
                                    id="singlePage"
                                    name="paginationMode"
                                    className="custom-control-input"
                                    checked={!amazonSyncSettings.amazon_fetch_all_pages}
                                    onChange={() => setAmazonSyncSettings(prev => ({ ...prev, amazon_fetch_all_pages: false }))}
                                  />
                                  <label className="custom-control-label" htmlFor="singlePage">
                                    <strong>Single Page</strong> - Fetch only first page (faster)
                                  </label>
                                </div>
                                <div className="custom-control custom-radio custom-control-inline mt-2">
                                  <input
                                    type="radio"
                                    id="allPages"
                                    name="paginationMode"
                                    className="custom-control-input"
                                    checked={amazonSyncSettings.amazon_fetch_all_pages === true || amazonSyncSettings.amazon_fetch_all_pages === 'true'}
                                    onChange={() => setAmazonSyncSettings(prev => ({ ...prev, amazon_fetch_all_pages: true }))}
                                  />
                                  <label className="custom-control-label" htmlFor="allPages">
                                    <strong>All Pages</strong> - Fetch all orders (slower, complete)
                                  </label>
                                </div>
                              </div>
                              <small className="text-muted d-block mt-2">
                                <i className="fas fa-info-circle mr-1"></i>
                                Single page mode fetches up to {amazonSyncSettings.amazon_max_results_per_page} orders quickly.
                                All pages mode fetches every order but may take several minutes for large order volumes.
                              </small>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="card-footer">
                    <button className="btn btn-success" onClick={handleSaveAmazonSync} disabled={saving}>
                      <i className="fas fa-save mr-2"></i>
                      {saving ? 'Saving...' : 'Save Sync Settings'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* eBay API Settings */}
            {activeTab === 'ebay' && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">eBay API Credentials</h3>
                </div>
                <div className="card-body">
                  <div className="alert alert-warning">
                    <i className="fas fa-exclamation-triangle mr-2"></i>
                    Keep your API credentials secure. Do not share them.
                  </div>
                  <div className="row">
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>App ID (Client ID)</label>
                        <input
                          type="text"
                          className="form-control"
                          value={ebayCredentials.app_id}
                          onChange={(e) => setEbayCredentials(prev => ({ ...prev, app_id: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Cert ID (Client Secret)</label>
                        <input
                          type="password"
                          className="form-control"
                          value={ebayCredentials.cert_id}
                          onChange={(e) => setEbayCredentials(prev => ({ ...prev, cert_id: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Dev ID</label>
                        <input
                          type="text"
                          className="form-control"
                          value={ebayCredentials.dev_id}
                          onChange={(e) => setEbayCredentials(prev => ({ ...prev, dev_id: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Environment</label>
                        <select
                          className="form-control"
                          value={ebayCredentials.environment}
                          onChange={(e) => setEbayCredentials(prev => ({ ...prev, environment: e.target.value }))}
                        >
                          <option value="sandbox">Sandbox (Testing)</option>
                          <option value="production">Production</option>
                        </select>
                      </div>
                    </div>
                    <div className="col-md-12">
                      <div className="form-group">
                        <label>Auth Token</label>
                        <textarea
                          className="form-control"
                          rows="3"
                          value={ebayCredentials.auth_token}
                          onChange={(e) => setEbayCredentials(prev => ({ ...prev, auth_token: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card-footer">
                  <button className="btn btn-primary" onClick={handleSaveEbay} disabled={saving}>
                    {saving ? 'Saving...' : 'Save eBay Credentials'}
                  </button>
                </div>
              </div>
            )}

            {/* WhatsApp API Settings */}
            {activeTab === 'whatsapp' && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">WhatsApp API Settings</h3>
                </div>
                <div className="card-body">
                  <div className="alert alert-info">
                    <i className="fas fa-info-circle mr-2"></i>
                    Configure your WhatsApp Business API or third-party provider settings here.
                  </div>
                  <div className="row">
                    <div className="col-md-12">
                      <div className="form-group">
                        <label>API URL</label>
                        <input
                          type="url"
                          className="form-control"
                          placeholder="https://api.example.com/send"
                          value={whatsappCredentials.api_url}
                          onChange={(e) => setWhatsappCredentials(prev => ({ ...prev, api_url: e.target.value }))}
                        />
                        <small className="text-muted">The endpoint URL for sending WhatsApp messages</small>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>API Key</label>
                        <input
                          type="password"
                          className="form-control"
                          value={whatsappCredentials.api_key}
                          onChange={(e) => setWhatsappCredentials(prev => ({ ...prev, api_key: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Sender Number</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="+91XXXXXXXXXX"
                          value={whatsappCredentials.sender_number}
                          onChange={(e) => setWhatsappCredentials(prev => ({ ...prev, sender_number: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card-footer">
                  <button className="btn btn-primary" onClick={handleSaveWhatsApp} disabled={saving}>
                    {saving ? 'Saving...' : 'Save WhatsApp Settings'}
                  </button>
                </div>
              </div>
            )}

            {/* Email (SMTP) Settings */}
            {activeTab === 'email' && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Email (SMTP) Settings</h3>
                </div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-8">
                      <div className="form-group">
                        <label>SMTP Host</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="smtp.gmail.com"
                          value={emailSettings.smtp_host}
                          onChange={(e) => setEmailSettings(prev => ({ ...prev, smtp_host: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="form-group">
                        <label>SMTP Port</label>
                        <input
                          type="number"
                          className="form-control"
                          value={emailSettings.smtp_port}
                          onChange={(e) => setEmailSettings(prev => ({ ...prev, smtp_port: parseInt(e.target.value) }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>SMTP Username</label>
                        <input
                          type="text"
                          className="form-control"
                          value={emailSettings.smtp_user}
                          onChange={(e) => setEmailSettings(prev => ({ ...prev, smtp_user: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>SMTP Password</label>
                        <input
                          type="password"
                          className="form-control"
                          value={emailSettings.smtp_password}
                          onChange={(e) => setEmailSettings(prev => ({ ...prev, smtp_password: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-12">
                      <div className="form-group">
                        <div className="custom-control custom-switch">
                          <input
                            type="checkbox"
                            className="custom-control-input"
                            id="smtpSecure"
                            checked={emailSettings.smtp_secure}
                            onChange={(e) => setEmailSettings(prev => ({ ...prev, smtp_secure: e.target.checked }))}
                          />
                          <label className="custom-control-label" htmlFor="smtpSecure">
                            Use SSL/TLS
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>From Email</label>
                        <input
                          type="email"
                          className="form-control"
                          placeholder="noreply@example.com"
                          value={emailSettings.from_email}
                          onChange={(e) => setEmailSettings(prev => ({ ...prev, from_email: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>From Name</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Jewellery Manufacturing"
                          value={emailSettings.from_name}
                          onChange={(e) => setEmailSettings(prev => ({ ...prev, from_name: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card-footer">
                  <button className="btn btn-primary" onClick={handleSaveEmail} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Email Settings'}
                  </button>
                </div>
              </div>
            )}

            {/* Auto-Assignment Settings */}
            {activeTab === 'assignment' && (
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Auto-Assignment Rules</h3>
                </div>
                <div className="card-body">
                  <div className="alert alert-info">
                    <i className="fas fa-info-circle mr-2"></i>
                    Configure automatic user assignment for new orders based on their channel.
                  </div>

                  {['amazon', 'ebay', 'etsy', 'manual'].map(channel => (
                    <div key={channel} className="mb-4 p-3 border rounded bg-light">
                      <h5 className="text-capitalize mb-3">
                        <i className={`fab fa-${channel === 'manual' ? 'edit' : channel} mr-2`}></i>
                        {channel} Channel
                      </h5>
                      <div className="row">
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>Default CAD Designer</label>
                            <select
                              className="form-control"
                              value={autoAssignmentRules[channel].cadDesigner}
                              onChange={(e) => setAutoAssignmentRules(prev => ({
                                ...prev,
                                [channel]: { ...prev[channel], cadDesigner: e.target.value }
                              }))}
                            >
                              <option value="">-- No Auto-Assignment --</option>
                              {users.designers.map(u => (
                                <option key={u._id} value={u._id}>{u.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>Default Manufacturer</label>
                            <select
                              className="form-control"
                              value={autoAssignmentRules[channel].manufacturer}
                              onChange={(e) => setAutoAssignmentRules(prev => ({
                                ...prev,
                                [channel]: { ...prev[channel], manufacturer: e.target.value }
                              }))}
                            >
                              <option value="">-- No Auto-Assignment --</option>
                              {users.manufacturers.map(u => (
                                <option key={u._id} value={u._id}>{u.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>Default Admin</label>
                            <select
                              className="form-control"
                              value={autoAssignmentRules[channel].admin}
                              onChange={(e) => setAutoAssignmentRules(prev => ({
                                ...prev,
                                [channel]: { ...prev[channel], admin: e.target.value }
                              }))}
                            >
                              <option value="">-- No Auto-Assignment --</option>
                              {users.admins.map(u => (
                                <option key={u._id} value={u._id}>{u.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="form-group">
                            <label>Production Coordinator</label>
                            <select
                              className="form-control"
                              value={autoAssignmentRules[channel].productionCoordinator}
                              onChange={(e) => setAutoAssignmentRules(prev => ({
                                ...prev,
                                [channel]: { ...prev[channel], productionCoordinator: e.target.value }
                              }))}
                            >
                              <option value="">-- No Auto-Assignment --</option>
                              {users.productionCoordinators.map(u => (
                                <option key={u._id} value={u._id}>{u.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="card-footer">
                  <button className="btn btn-primary" onClick={handleSaveAutoAssignment} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Auto-Assignment Rules'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Settings;
