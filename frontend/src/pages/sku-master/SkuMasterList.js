import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { skuMasterAPI } from '../../services/api';
import DataTable from '../../components/common/DataTable';
import useDebounce from '../../hooks/useDebounce';

const API_BASE_URL = process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001';

const SkuMasterList = () => {
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statistics, setStatistics] = useState(null);
  const [filters, setFilters] = useState({
    search: '',
    category: '',
    hasCadFile: '',
    isActive: 'true'
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  });

  // Bulk selection state
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [showCadUploadModal, setShowCadUploadModal] = useState(false);
  const [showBulkCsvModal, setShowBulkCsvModal] = useState(false);
  const [showBulkCadModal, setShowBulkCadModal] = useState(false);
  const [showImageUploadModal, setShowImageUploadModal] = useState(false);
  const [showSkuDetailModal, setShowSkuDetailModal] = useState(false);
  const [selectedSkuDetail, setSelectedSkuDetail] = useState(null);
  const [editingSku, setEditingSku] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    sku: '',
    productName: '',
    category: 'other',
    basePrice: '',
    weight: '',
    metalType: '',
    purity: ''
  });
  const [newSkuCadFile, setNewSkuCadFile] = useState(null);
  const [newSkuImages, setNewSkuImages] = useState([]);

  const cadFileInputRef = useRef(null);
  const csvFileInputRef = useRef(null);
  const bulkCadInputRef = useRef(null);
  const imageUploadInputRef = useRef(null);
  const newSkuCadInputRef = useRef(null);
  const newSkuImagesInputRef = useRef(null);

  const categories = [
    { value: 'ring', label: 'Ring' },
    { value: 'necklace', label: 'Necklace' },
    { value: 'bracelet', label: 'Bracelet' },
    { value: 'earring', label: 'Earring' },
    { value: 'pendant', label: 'Pendant' },
    { value: 'chain', label: 'Chain' },
    { value: 'bangle', label: 'Bangle' },
    { value: 'other', label: 'Other' }
  ];

  // Debounce search input
  const debouncedSearch = useDebounce(filters.search, 300);

  // Create effective filters with debounced search
  const effectiveFilters = useMemo(() => ({
    ...filters,
    search: debouncedSearch
  }), [filters.category, filters.hasCadFile, filters.isActive, debouncedSearch]);

  const fetchSkus = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...effectiveFilters
      };
      const response = await skuMasterAPI.getAll(params);
      setSkus(response.data.data?.skus || []);
      if (response.data.data?.pagination) {
        setPagination(prev => ({ ...prev, ...response.data.data.pagination }));
      }
    } catch (error) {
      console.error('Error fetching SKUs:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, effectiveFilters]);

  const fetchStatistics = async () => {
    try {
      const response = await skuMasterAPI.getStatistics();
      setStatistics(response.data.data);
    } catch (error) {
      console.error('Error fetching statistics:', error);
    }
  };

  useEffect(() => {
    fetchSkus();
    fetchStatistics();
  }, [fetchSkus]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const resetForm = () => {
    setFormData({
      sku: '',
      productName: '',
      category: 'other',
      basePrice: '',
      weight: '',
      metalType: '',
      purity: ''
    });
    setEditingSku(null);
    setNewSkuCadFile(null);
    setNewSkuImages([]);
  };

  const handleOpenModal = async (sku = null) => {
    if (sku) {
      try {
        // Fetch full SKU details including CAD file and images
        const response = await skuMasterAPI.getBySku(sku.sku);
        const fullSkuData = response.data.data;

        setEditingSku(fullSkuData);
        setFormData({
          sku: fullSkuData.sku,
          productName: fullSkuData.productName,
          category: fullSkuData.category || 'other',
          basePrice: fullSkuData.basePrice || '',
          weight: fullSkuData.weight || '',
          metalType: fullSkuData.metalType || '',
          purity: fullSkuData.purity || ''
        });
      } catch (error) {
        toast.error('Failed to load SKU details');
        return;
      }
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
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle CAD file selection in Add SKU modal
  const handleNewSkuCadSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'stl') {
      toast.error('Only STL files are allowed for CAD uploads');
      e.target.value = '';
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      toast.error('CAD file too large. Max 100MB allowed');
      e.target.value = '';
      return;
    }

    setNewSkuCadFile(file);
    toast.info(`CAD file "${file.name}" selected`);
  };

  // Handle multiple images selection in Add SKU modal
  const handleNewSkuImagesSelect = (e) => {
    const files = Array.from(e.target.files);
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    const validFiles = files.filter(file => {
      if (!validTypes.includes(file.type)) {
        toast.error(`${file.name}: Invalid file type. Only JPG, PNG, GIF, WEBP allowed`);
        return false;
      }
      if (file.size > maxSize) {
        toast.error(`${file.name}: File too large. Max 10MB allowed`);
        return false;
      }
      return true;
    });

    if (validFiles.length > 0) {
      setNewSkuImages(prev => [...prev, ...validFiles]);
      toast.info(`${validFiles.length} image(s) added`);
    }
  };

  // Remove image from new SKU images
  const removeNewSkuImage = (index) => {
    setNewSkuImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setUploading(true);
      let skuRecord;

      if (editingSku) {
        await skuMasterAPI.update(editingSku.sku, formData);
        toast.success('SKU updated successfully');
        skuRecord = { sku: editingSku.sku };
      } else {
        const response = await skuMasterAPI.create(formData);
        toast.success('SKU created successfully');
        skuRecord = response.data.data;

        // Upload CAD file if selected
        if (newSkuCadFile && skuRecord?.sku) {
          const cadFormData = new FormData();
          cadFormData.append('file', newSkuCadFile);
          try {
            await skuMasterAPI.uploadCadFile(skuRecord.sku, cadFormData);
            toast.success('CAD file uploaded');
          } catch (err) {
            toast.error('Failed to upload CAD file');
          }
        }

        // Upload images if selected
        if (newSkuImages.length > 0 && skuRecord?.sku) {
          const imgFormData = new FormData();
          newSkuImages.forEach(img => {
            imgFormData.append('images', img);
          });
          try {
            await skuMasterAPI.uploadImages(skuRecord.sku, imgFormData);
            toast.success(`${newSkuImages.length} image(s) uploaded`);
          } catch (err) {
            toast.error('Failed to upload images');
          }
        }
      }

      handleCloseModal();
      fetchSkus();
      fetchStatistics();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save SKU');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (sku) => {
    if (!window.confirm(`Are you sure you want to delete SKU: ${sku}?`)) return;
    try {
      await skuMasterAPI.delete(sku);
      toast.success('SKU deleted successfully');
      fetchSkus();
      fetchStatistics();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete SKU');
    }
  };

  // Bulk selection handlers
  const handleSelectSku = (skuCode) => {
    setSelectedSkus(prev => {
      if (prev.includes(skuCode)) {
        return prev.filter(s => s !== skuCode);
      } else {
        return [...prev, skuCode];
      }
    });
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedSkus(skus.map(s => s.sku));
    } else {
      setSelectedSkus([]);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSkus.length === 0) return;

    setDeleting(true);
    let deleted = 0;
    let errors = 0;

    for (const sku of selectedSkus) {
      try {
        await skuMasterAPI.delete(sku);
        deleted++;
      } catch (error) {
        console.error(`Failed to delete SKU ${sku}:`, error);
        errors++;
      }
    }

    setDeleting(false);
    setShowDeleteConfirm(false);
    setSelectedSkus([]);

    if (errors === 0) {
      toast.success(`Successfully deleted ${deleted} SKU(s)`);
    } else {
      toast.warning(`Deleted ${deleted} SKU(s), ${errors} failed`);
    }

    fetchSkus();
    fetchStatistics();
  };

  const handleCadUpload = async (sku) => {
    setEditingSku(sku);
    setShowCadUploadModal(true);
  };

  const handleCadFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      setUploading(true);
      await skuMasterAPI.uploadCadFile(editingSku.sku, formData);
      toast.success('CAD file uploaded successfully');
      setShowCadUploadModal(false);
      fetchSkus();
      fetchStatistics();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to upload CAD file');
    } finally {
      setUploading(false);
      if (cadFileInputRef.current) {
        cadFileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteCad = async (sku) => {
    if (!window.confirm(`Are you sure you want to delete the CAD file for ${sku}?`)) return;
    try {
      await skuMasterAPI.deleteCadFile(sku);
      toast.success('CAD file deleted successfully');
      fetchSkus();
      fetchStatistics();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete CAD file');
    }
  };

  // Image upload modal handlers
  const handleOpenImageUploadModal = (sku) => {
    setEditingSku(sku);
    setShowImageUploadModal(true);
  };

  const handleImageUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('images', files[i]);
    }

    try {
      setUploading(true);
      await skuMasterAPI.uploadImages(editingSku.sku, formData);
      toast.success(`${files.length} image(s) uploaded successfully`);
      setShowImageUploadModal(false);
      fetchSkus();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to upload images');
    } finally {
      setUploading(false);
      if (imageUploadInputRef.current) {
        imageUploadInputRef.current.value = '';
      }
    }
  };

  // View SKU details with images
  const handleViewDetails = async (sku) => {
    try {
      const response = await skuMasterAPI.getBySku(sku.sku);
      setSelectedSkuDetail(response.data.data);
      setShowSkuDetailModal(true);
    } catch (error) {
      toast.error('Failed to load SKU details');
    }
  };

  // Delete image from SKU
  const handleDeleteImage = async (imageId) => {
    if (!window.confirm('Delete this image?')) return;
    try {
      await skuMasterAPI.deleteImage(selectedSkuDetail.sku, imageId);
      toast.success('Image deleted');
      // Refresh details
      const response = await skuMasterAPI.getBySku(selectedSkuDetail.sku);
      setSelectedSkuDetail(response.data.data);
      fetchSkus();
    } catch (error) {
      toast.error('Failed to delete image');
    }
  };

  const handleBulkCsvUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      setUploading(true);
      const response = await skuMasterAPI.bulkUploadCsv(formData);
      const result = response.data.data;
      toast.success(`Imported ${result.created} SKUs. ${result.skipped} skipped, ${result.errors?.length || 0} errors.`);
      setShowBulkCsvModal(false);
      fetchSkus();
      fetchStatistics();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to upload CSV');
    } finally {
      setUploading(false);
      if (csvFileInputRef.current) {
        csvFileInputRef.current.value = '';
      }
    }
  };

  const handleBulkCadUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      setUploading(true);
      const response = await skuMasterAPI.bulkUploadCad(formData);
      const result = response.data.data;
      toast.success(`Uploaded ${result.uploaded} CAD files. ${result.created} new SKUs created.`);
      setShowBulkCadModal(false);
      fetchSkus();
      fetchStatistics();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to upload CAD files');
    } finally {
      setUploading(false);
      if (bulkCadInputRef.current) {
        bulkCadInputRef.current.value = '';
      }
    }
  };

  const handleExport = async () => {
    try {
      const response = await skuMasterAPI.exportCsv();
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `sku-master-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Failed to export CSV');
    }
  };

  const getCategoryBadge = (category) => {
    const colors = {
      ring: 'primary',
      necklace: 'info',
      bracelet: 'success',
      earring: 'warning',
      pendant: 'secondary',
      chain: 'dark',
      bangle: 'danger',
      other: 'light'
    };
    return colors[category] || 'secondary';
  };

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">SKU Master</h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item active">SKU Master</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <section className="content">
        <div className="container-fluid">
          {/* Statistics Cards */}
          {statistics && (
            <div className="row">
              <div className="col-lg-3 col-6">
                <div className="small-box bg-info">
                  <div className="inner">
                    <h3>{statistics.total}</h3>
                    <p>Total SKUs</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-barcode"></i>
                  </div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-success">
                  <div className="inner">
                    <h3>{statistics.withCad}</h3>
                    <p>With CAD File</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-file-code"></i>
                  </div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-warning">
                  <div className="inner">
                    <h3>{statistics.withoutCad}</h3>
                    <p>Without CAD</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-file-excel"></i>
                  </div>
                </div>
              </div>
              <div className="col-lg-3 col-6">
                <div className="small-box bg-secondary">
                  <div className="inner">
                    <h3>{statistics.cadPercentage || 0}%</h3>
                    <p>CAD Coverage</p>
                  </div>
                  <div className="icon">
                    <i className="fas fa-chart-pie"></i>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bulk Selection Bar */}
          {selectedSkus.length > 0 && (
            <div className="alert alert-info d-flex justify-content-between align-items-center mb-3">
              <span>
                <i className="fas fa-check-square mr-2"></i>
                <strong>{selectedSkus.length}</strong> SKU(s) selected
              </span>
              <div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <i className="fas fa-trash mr-1"></i>
                  Delete Selected
                </button>
                <button
                  className="btn btn-secondary btn-sm ml-2"
                  onClick={() => setSelectedSkus([])}
                >
                  <i className="fas fa-times mr-1"></i>
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="row mb-3">
            <div className="col-md-12">
              <div className="btn-group mr-2">
                <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                  <i className="fas fa-plus mr-1"></i> Add SKU
                </button>
              </div>
              <div className="btn-group mr-2">
                <button className="btn btn-success" onClick={() => setShowBulkCsvModal(true)}>
                  <i className="fas fa-file-csv mr-1"></i> Import CSV
                </button>
                <button className="btn btn-info" onClick={() => setShowBulkCadModal(true)}>
                  <i className="fas fa-file-upload mr-1"></i> Bulk CAD Upload
                </button>
              </div>
              <button className="btn btn-secondary" onClick={handleExport}>
                <i className="fas fa-download mr-1"></i> Export CSV
              </button>
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
                <div className="col-md-3">
                  <div className="form-group">
                    <label>Search</label>
                    <input
                      type="text"
                      className="form-control"
                      name="search"
                      placeholder="SKU or Product Name..."
                      value={filters.search}
                      onChange={handleFilterChange}
                    />
                  </div>
                </div>
                <div className="col-md-2">
                  <div className="form-group">
                    <label>Category</label>
                    <select
                      className="form-control"
                      name="category"
                      value={filters.category}
                      onChange={handleFilterChange}
                    >
                      <option value="">All Category</option>
                      {categories.map(cat => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="col-md-2">
                  <div className="form-group">
                    <label>CAD Status</label>
                    <select
                      className="form-control"
                      name="hasCadFile"
                      value={filters.hasCadFile}
                      onChange={handleFilterChange}
                    >
                      <option value="">All CAD</option>
                      <option value="true">Has CAD</option>
                      <option value="false">No CAD</option>
                    </select>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="form-group">
                    <label>Status</label>
                    <select
                      className="form-control"
                      name="isActive"
                      value={filters.isActive}
                      onChange={handleFilterChange}
                    >
                      <option value="all">All Status</option>
                      <option value="true">Active Only</option>
                      <option value="false">Inactive/Deleted</option>
                    </select>
                  </div>
                </div>
                <div className="col-md-2 d-flex align-items-end">
                  <button
                    className="btn btn-secondary btn-block mb-3"
                    onClick={() => setFilters({ search: '', category: '', hasCadFile: '', isActive: 'true' })}
                  >
                    Clear All
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* SKU Table */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">SKU List</h3>
            </div>
            <div className="card-body">
              <DataTable
                columns={[
                  {
                    key: 'sku',
                    title: 'SKU',
                    sortable: true,
                    render: (skuCode, sku) => (
                      <strong
                        style={{ cursor: 'pointer', color: '#007bff' }}
                        onClick={() => handleViewDetails(sku)}
                      >
                        {skuCode}
                      </strong>
                    )
                  },
                  {
                    key: 'productName',
                    title: 'Product Name',
                    sortable: true,
                    render: (productName) => (
                      <span className="text-truncate d-inline-block" style={{ maxWidth: '200px' }} title={productName}>
                        {productName}
                      </span>
                    )
                  },
                  {
                    key: 'category',
                    title: 'Category',
                    sortable: true,
                    render: (category) => (
                      <span className={`badge badge-${getCategoryBadge(category)}`}>
                        {category}
                      </span>
                    )
                  },
                  {
                    key: 'hasCadFile',
                    title: 'CAD File',
                    render: (hasCadFile) => hasCadFile ? (
                      <span className="badge badge-success">
                        <i className="fas fa-check mr-1"></i> YES
                      </span>
                    ) : (
                      <span className="badge badge-warning">
                        <i className="fas fa-times mr-1"></i> NO
                      </span>
                    )
                  },
                  {
                    key: 'images',
                    title: 'Images',
                    render: (images) => (
                      <span className="badge badge-info">
                        <i className="fas fa-images mr-1"></i>
                        {images?.length || 0}
                      </span>
                    )
                  },
                  {
                    key: 'metalType',
                    title: 'Metal',
                    render: (metalType) => metalType || '-'
                  },
                  {
                    key: 'weight',
                    title: 'Weight',
                    sortable: true,
                    render: (weight) => weight ? `${weight}g` : '-'
                  },
                  {
                    key: 'actions',
                    title: 'Actions',
                    render: (_, sku) => (
                      <div className="btn-group">
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleViewDetails(sku)}
                          title="View Details"
                        >
                          <i className="fas fa-eye"></i>
                        </button>
                        <button
                          className="btn btn-sm btn-info"
                          onClick={() => handleOpenModal(sku)}
                          title="Edit"
                        >
                          <i className="fas fa-edit"></i>
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(sku.sku)}
                          title="Delete SKU"
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      </div>
                    )
                  }
                ]}
                data={skus}
                pagination={pagination}
                onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
                onLimitChange={(limit) => setPagination(prev => ({ ...prev, limit, page: 1 }))}
                loading={loading}
                emptyMessage="No SKUs found"
                emptyIcon="fas fa-barcode"
                selectable={true}
                selectedRows={selectedSkus}
                onSelectRow={handleSelectSku}
                onSelectAll={handleSelectAll}
                rowKey="sku"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Add/Edit SKU Modal with File Uploads */}
      {showModal && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{editingSku ? 'Edit SKU' : 'Add New SKU'}</h5>
                <button type="button" className="close" onClick={handleCloseModal}>
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body">
                  <div className="row">
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>SKU Code <span className="text-danger">*</span></label>
                        <input
                          type="text"
                          className="form-control"
                          name="sku"
                          value={formData.sku}
                          onChange={handleFormChange}
                          required
                          disabled={!!editingSku}
                          placeholder="e.g., SKU-001"
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Product Name <span className="text-danger">*</span></label>
                        <input
                          type="text"
                          className="form-control"
                          name="productName"
                          value={formData.productName}
                          onChange={handleFormChange}
                          required
                        />
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Category</label>
                        <select
                          className="form-control"
                          name="category"
                          value={formData.category}
                          onChange={handleFormChange}
                        >
                          {categories.map(cat => (
                            <option key={cat.value} value={cat.value}>{cat.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-group">
                        <label>Base Price (INR)</label>
                        <input
                          type="number"
                          className="form-control"
                          name="basePrice"
                          value={formData.basePrice}
                          onChange={handleFormChange}
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-md-4">
                      <div className="form-group">
                        <label>Metal Type</label>
                        <input
                          type="text"
                          className="form-control"
                          name="metalType"
                          value={formData.metalType}
                          onChange={handleFormChange}
                          placeholder="e.g., Gold, Silver"
                        />
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="form-group">
                        <label>Purity</label>
                        <input
                          type="text"
                          className="form-control"
                          name="purity"
                          value={formData.purity}
                          onChange={handleFormChange}
                          placeholder="e.g., 22K, 18K"
                        />
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="form-group">
                        <label>Weight (grams)</label>
                        <input
                          type="number"
                          className="form-control"
                          name="weight"
                          value={formData.weight}
                          onChange={handleFormChange}
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </div>
                  </div>

                  {/* File Upload Section - For new SKU */}
                  {!editingSku && (
                    <>
                      <hr />
                      <h6 className="mb-3"><i className="fas fa-upload mr-2"></i>File Uploads (Optional)</h6>

                      <div className="row">
                        {/* CAD File Upload */}
                        <div className="col-md-6">
                          <div className="form-group">
                            <label><i className="fas fa-file-code mr-1"></i> CAD File (STL)</label>
                            <div className="custom-file">
                              <input
                                type="file"
                                className="custom-file-input"
                                accept=".stl,.STL"
                                ref={newSkuCadInputRef}
                                onChange={handleNewSkuCadSelect}
                              />
                              <label className="custom-file-label">
                                {newSkuCadFile ? newSkuCadFile.name : 'Choose STL file...'}
                              </label>
                            </div>
                            {newSkuCadFile && (
                              <div className="mt-2">
                                <span className="badge badge-success mr-2">
                                  <i className="fas fa-file mr-1"></i>
                                  {newSkuCadFile.name}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-link text-danger p-0"
                                  onClick={() => {
                                    setNewSkuCadFile(null);
                                    if (newSkuCadInputRef.current) newSkuCadInputRef.current.value = '';
                                  }}
                                >
                                  <i className="fas fa-times"></i> Remove
                                </button>
                              </div>
                            )}
                            <small className="text-muted">Only .stl files (Max 100MB)</small>
                          </div>
                        </div>

                        {/* Reference Images Upload */}
                        <div className="col-md-6">
                          <div className="form-group">
                            <label><i className="fas fa-images mr-1"></i> Reference Images</label>
                            <div className="custom-file">
                              <input
                                type="file"
                                className="custom-file-input"
                                accept="image/jpeg,image/png,image/gif,image/webp"
                                multiple
                                ref={newSkuImagesInputRef}
                                onChange={handleNewSkuImagesSelect}
                              />
                              <label className="custom-file-label">
                                Choose images...
                              </label>
                            </div>
                            <small className="text-muted">JPG, PNG, GIF, WEBP (Max 10MB each)</small>

                            {/* Image Previews */}
                            {newSkuImages.length > 0 && (
                              <div className="mt-2 d-flex flex-wrap">
                                {newSkuImages.map((img, index) => (
                                  <div key={index} className="position-relative mr-2 mb-2">
                                    <img
                                      src={URL.createObjectURL(img)}
                                      alt={`Preview ${index + 1}`}
                                      className="img-thumbnail"
                                      style={{ width: '80px', height: '80px', objectFit: 'cover' }}
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-danger btn-xs position-absolute"
                                      style={{ top: '-8px', right: '-8px', padding: '2px 6px', fontSize: '10px' }}
                                      onClick={() => removeNewSkuImage(index)}
                                    >
                                      <i className="fas fa-times"></i>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Existing Files Section - For editing SKU */}
                  {editingSku && (
                    <>
                      <hr />
                      <h6 className="mb-3"><i className="fas fa-folder-open mr-2"></i>Existing Files</h6>

                      <div className="row">
                        {/* CAD File Section */}
                        <div className="col-md-6">
                          <div className="card">
                            <div className="card-header py-2">
                              <h6 className="mb-0"><i className="fas fa-file-code mr-2"></i>CAD File</h6>
                            </div>
                            <div className="card-body">
                              {editingSku.hasCadFile && editingSku.cadFile ? (
                                <div className="d-flex align-items-center">
                                  <i className="fas fa-file-alt fa-2x text-success mr-3"></i>
                                  <div className="flex-grow-1">
                                    <strong>{editingSku.cadFile.fileName}</strong>
                                    <br />
                                    <small className="text-muted">
                                      {(editingSku.cadFile.fileSize / 1024 / 1024).toFixed(2)} MB
                                    </small>
                                  </div>
                                  <div className="btn-group">
                                    <a
                                      href={`${API_BASE_URL}${editingSku.cadFile.filePath}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn btn-sm btn-outline-primary"
                                      title="Download"
                                    >
                                      <i className="fas fa-download"></i>
                                    </a>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger"
                                      onClick={() => handleDeleteCad(editingSku.sku)}
                                      title="Delete CAD"
                                    >
                                      <i className="fas fa-trash"></i>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center py-3">
                                  <i className="fas fa-file-excel fa-2x text-muted mb-2"></i>
                                  <p className="text-muted mb-2">No CAD file uploaded</p>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-success"
                                    onClick={() => {
                                      setShowModal(false);
                                      handleCadUpload(editingSku);
                                    }}
                                  >
                                    <i className="fas fa-upload mr-1"></i> Upload CAD
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Images Section */}
                        <div className="col-md-6">
                          <div className="card">
                            <div className="card-header py-2 d-flex justify-content-between align-items-center">
                              <h6 className="mb-0">
                                <i className="fas fa-images mr-2"></i>
                                Reference Images ({editingSku.images?.length || 0})
                              </h6>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={() => {
                                  setShowModal(false);
                                  handleOpenImageUploadModal(editingSku);
                                }}
                              >
                                <i className="fas fa-plus"></i>
                              </button>
                            </div>
                            <div className="card-body" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                              {editingSku.images && editingSku.images.length > 0 ? (
                                <div className="d-flex flex-wrap">
                                  {editingSku.images.map((img, index) => (
                                    <div key={img._id || index} className="position-relative mr-2 mb-2">
                                      <img
                                        src={`${API_BASE_URL}${img.filePath}`}
                                        alt={`${editingSku.sku} - ${index + 1}`}
                                        className="img-thumbnail"
                                        style={{ width: '80px', height: '80px', objectFit: 'cover', cursor: 'pointer' }}
                                        onClick={() => window.open(`${API_BASE_URL}${img.filePath}`, '_blank')}
                                      />
                                      {img.isPrimary && (
                                        <span
                                          className="badge badge-primary position-absolute"
                                          style={{ top: '2px', left: '2px', fontSize: '8px' }}
                                        >
                                          Primary
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        className="btn btn-danger btn-xs position-absolute"
                                        style={{ top: '-6px', right: '-6px', padding: '1px 4px', fontSize: '9px' }}
                                        onClick={async () => {
                                          if (window.confirm('Delete this image?')) {
                                            try {
                                              await skuMasterAPI.deleteImage(editingSku.sku, img._id);
                                              toast.success('Image deleted');
                                              // Refresh the modal data
                                              const response = await skuMasterAPI.getBySku(editingSku.sku);
                                              setEditingSku(response.data.data);
                                              fetchSkus();
                                            } catch (error) {
                                              toast.error('Failed to delete image');
                                            }
                                          }
                                        }}
                                      >
                                        <i className="fas fa-times"></i>
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-center py-3">
                                  <i className="fas fa-images fa-2x text-muted mb-2"></i>
                                  <p className="text-muted mb-0">No images uploaded</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={handleCloseModal} disabled={uploading}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={uploading}>
                    {uploading ? (
                      <>
                        <i className="fas fa-spinner fa-spin mr-1"></i>
                        {editingSku ? 'Updating...' : 'Creating...'}
                      </>
                    ) : (
                      editingSku ? 'Update' : 'Create'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {showModal && <div className="modal-backdrop fade show"></div>}

      {/* CAD Upload Modal */}
      {showCadUploadModal && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Upload CAD File for {editingSku?.sku}</h5>
                <button type="button" className="close" onClick={() => setShowCadUploadModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label>Select STL File</label>
                  <div className="custom-file">
                    <input
                      type="file"
                      className="custom-file-input"
                      accept=".stl,.STL"
                      ref={cadFileInputRef}
                      onChange={handleCadFileSelect}
                      disabled={uploading}
                    />
                    <label className="custom-file-label">Choose file...</label>
                  </div>
                  <small className="form-text text-muted">Only .stl files are allowed (max 100MB)</small>
                </div>
                {uploading && (
                  <div className="text-center">
                    <div className="spinner-border text-primary" role="status">
                      <span className="sr-only">Uploading...</span>
                    </div>
                    <p className="mt-2">Uploading...</p>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCadUploadModal(false)}
                  disabled={uploading}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showCadUploadModal && <div className="modal-backdrop fade show"></div>}

      {/* Image Upload Modal */}
      {showImageUploadModal && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Upload Images for {editingSku?.sku}</h5>
                <button type="button" className="close" onClick={() => setShowImageUploadModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label>Select Images</label>
                  <div className="custom-file">
                    <input
                      type="file"
                      className="custom-file-input"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      multiple
                      ref={imageUploadInputRef}
                      onChange={handleImageUpload}
                      disabled={uploading}
                    />
                    <label className="custom-file-label">Choose images...</label>
                  </div>
                  <small className="form-text text-muted">JPG, PNG, GIF, WEBP (max 10MB each, up to 10 images)</small>
                </div>
                {uploading && (
                  <div className="text-center">
                    <div className="spinner-border text-primary" role="status">
                      <span className="sr-only">Uploading...</span>
                    </div>
                    <p className="mt-2">Uploading images...</p>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowImageUploadModal(false)}
                  disabled={uploading}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showImageUploadModal && <div className="modal-backdrop fade show"></div>}

      {/* SKU Detail Modal */}
      {showSkuDetailModal && selectedSkuDetail && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="fas fa-barcode mr-2"></i>
                  SKU Details: {selectedSkuDetail.sku}
                </h5>
                <button type="button" className="close" onClick={() => setShowSkuDetailModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="row">
                  {/* SKU Info */}
                  <div className="col-md-6">
                    <div className="card">
                      <div className="card-header">
                        <h6 className="mb-0"><i className="fas fa-info-circle mr-2"></i>Product Information</h6>
                      </div>
                      <div className="card-body">
                        <table className="table table-sm table-borderless">
                          <tbody>
                            <tr>
                              <td className="text-muted">SKU Code:</td>
                              <td><strong>{selectedSkuDetail.sku}</strong></td>
                            </tr>
                            <tr>
                              <td className="text-muted">Product Name:</td>
                              <td>{selectedSkuDetail.productName}</td>
                            </tr>
                            <tr>
                              <td className="text-muted">Category:</td>
                              <td>
                                <span className={`badge badge-${getCategoryBadge(selectedSkuDetail.category)}`}>
                                  {selectedSkuDetail.category}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td className="text-muted">Metal Type:</td>
                              <td>{selectedSkuDetail.metalType || '-'}</td>
                            </tr>
                            <tr>
                              <td className="text-muted">Purity:</td>
                              <td>{selectedSkuDetail.purity || '-'}</td>
                            </tr>
                            <tr>
                              <td className="text-muted">Weight:</td>
                              <td>{selectedSkuDetail.weight ? `${selectedSkuDetail.weight}g` : '-'}</td>
                            </tr>
                            <tr>
                              <td className="text-muted">Base Price:</td>
                              <td>{selectedSkuDetail.basePrice ? `INR ${selectedSkuDetail.basePrice}` : '-'}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* CAD File Section */}
                    <div className="card">
                      <div className="card-header">
                        <h6 className="mb-0"><i className="fas fa-file-code mr-2"></i>CAD File</h6>
                      </div>
                      <div className="card-body">
                        {selectedSkuDetail.hasCadFile && selectedSkuDetail.cadFile ? (
                          <div className="d-flex align-items-center">
                            <i className="fas fa-file-alt fa-2x text-success mr-3"></i>
                            <div>
                              <strong>{selectedSkuDetail.cadFile.fileName}</strong>
                              <br />
                              <small className="text-muted">
                                {(selectedSkuDetail.cadFile.fileSize / 1024 / 1024).toFixed(2)} MB
                              </small>
                              <br />
                              <a
                                href={`${API_BASE_URL}${selectedSkuDetail.cadFile.filePath}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-sm btn-outline-primary mt-1"
                              >
                                <i className="fas fa-download mr-1"></i> Download
                              </a>
                            </div>
                          </div>
                        ) : (
                          <div className="text-muted text-center py-3">
                            <i className="fas fa-file-excel fa-2x mb-2"></i>
                            <p className="mb-0">No CAD file uploaded</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Images Section */}
                  <div className="col-md-6">
                    <div className="card">
                      <div className="card-header">
                        <h6 className="mb-0">
                          <i className="fas fa-images mr-2"></i>
                          Reference Images ({selectedSkuDetail.images?.length || 0})
                        </h6>
                      </div>
                      <div className="card-body">
                        {selectedSkuDetail.images && selectedSkuDetail.images.length > 0 ? (
                          <div className="row">
                            {selectedSkuDetail.images.map((img, index) => (
                              <div key={img._id || index} className="col-4 mb-3">
                                <div className="position-relative">
                                  <img
                                    src={`${API_BASE_URL}${img.filePath}`}
                                    alt={`${selectedSkuDetail.sku} - ${index + 1}`}
                                    className="img-fluid img-thumbnail"
                                    style={{ width: '100%', height: '120px', objectFit: 'cover', cursor: 'pointer' }}
                                    onClick={() => window.open(`${API_BASE_URL}${img.filePath}`, '_blank')}
                                  />
                                  {img.isPrimary && (
                                    <span className="badge badge-primary position-absolute" style={{ top: '5px', left: '5px' }}>
                                      Primary
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-xs position-absolute"
                                    style={{ top: '5px', right: '5px' }}
                                    onClick={() => handleDeleteImage(img._id)}
                                  >
                                    <i className="fas fa-trash"></i>
                                  </button>
                                </div>
                                <small className="text-muted d-block text-truncate">{img.fileName}</small>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-muted text-center py-5">
                            <i className="fas fa-images fa-3x mb-2"></i>
                            <p className="mb-0">No images uploaded</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setShowSkuDetailModal(false);
                    handleOpenImageUploadModal(selectedSkuDetail);
                  }}
                >
                  <i className="fas fa-plus mr-1"></i> Add Images
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowSkuDetailModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showSkuDetailModal && <div className="modal-backdrop fade show"></div>}

      {/* Bulk CSV Upload Modal */}
      {showBulkCsvModal && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Import SKUs from CSV</h5>
                <button type="button" className="close" onClick={() => setShowBulkCsvModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="alert alert-info">
                  <h6>CSV Format:</h6>
                  <code>sku,product_name,category,metal_type,purity,weight,base_price</code>
                  <p className="mt-2 mb-0">Categories: ring, necklace, bracelet, earring, pendant, chain, bangle, other</p>
                </div>
                <div className="form-group">
                  <label>Select CSV File</label>
                  <div className="custom-file">
                    <input
                      type="file"
                      className="custom-file-input"
                      accept=".csv"
                      ref={csvFileInputRef}
                      onChange={handleBulkCsvUpload}
                      disabled={uploading}
                    />
                    <label className="custom-file-label">Choose file...</label>
                  </div>
                </div>
                {uploading && (
                  <div className="text-center">
                    <div className="spinner-border text-primary" role="status">
                      <span className="sr-only">Uploading...</span>
                    </div>
                    <p className="mt-2">Processing CSV...</p>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowBulkCsvModal(false)}
                  disabled={uploading}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showBulkCsvModal && <div className="modal-backdrop fade show"></div>}

      {/* Bulk CAD Upload Modal */}
      {showBulkCadModal && (
        <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Bulk CAD File Upload</h5>
                <button type="button" className="close" onClick={() => setShowBulkCadModal(false)}>
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <div className="alert alert-info">
                  <h6>File Naming Convention:</h6>
                  <p className="mb-0">Files must be named as <code>SKU.stl</code> (e.g., <code>SKU-001.stl</code>)</p>
                  <p className="mb-0">The SKU will be extracted from the filename automatically.</p>
                  <p className="mb-0 mt-2"><strong>Note:</strong> If SKU doesn't exist, it will be created automatically.</p>
                </div>
                <div className="form-group">
                  <label>Select STL Files</label>
                  <div className="custom-file">
                    <input
                      type="file"
                      className="custom-file-input"
                      accept=".stl,.STL"
                      multiple
                      ref={bulkCadInputRef}
                      onChange={handleBulkCadUpload}
                      disabled={uploading}
                    />
                    <label className="custom-file-label">Choose files...</label>
                  </div>
                  <small className="form-text text-muted">Select multiple STL files (max 100 files)</small>
                </div>
                {uploading && (
                  <div className="text-center">
                    <div className="spinner-border text-primary" role="status">
                      <span className="sr-only">Uploading...</span>
                    </div>
                    <p className="mt-2">Uploading CAD files...</p>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowBulkCadModal(false)}
                  disabled={uploading}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showBulkCadModal && <div className="modal-backdrop fade show"></div>}

      {/* Bulk Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-danger text-white">
                <h5 className="modal-title">
                  <i className="fas fa-exclamation-triangle mr-2"></i>
                  Confirm Delete
                </h5>
                <button
                  type="button"
                  className="close text-white"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                >
                  <span>&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <p>Are you sure you want to delete <strong>{selectedSkus.length}</strong> SKU(s)?</p>
                <p className="text-danger mb-0">
                  <i className="fas fa-exclamation-circle mr-1"></i>
                  This action cannot be undone. All associated CAD files and images will also be deleted.
                </p>

                {selectedSkus.length <= 10 && (
                  <div className="mt-3">
                    <strong>SKUs to delete:</strong>
                    <ul className="mb-0 mt-2" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                      {selectedSkus.map(sku => (
                        <li key={sku}>{sku}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleBulkDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <>
                      <span className="spinner-border spinner-border-sm mr-1"></span>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-trash mr-1"></i>
                      Delete {selectedSkus.length} SKU(s)
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SkuMasterList;
