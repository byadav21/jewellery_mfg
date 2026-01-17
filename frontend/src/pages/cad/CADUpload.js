import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { jobAPI, cadAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const API_BASE_URL = process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001';

const CADUpload = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [job, setJob] = useState(null);
  const [cadFiles, setCadFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [comments, setComments] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);


  const fetchJobAndFiles = useCallback(async () => {
    try {
      setLoading(true);
      const [jobResponse, filesResponse] = await Promise.all([
        jobAPI.getById(jobId),
        cadAPI.getFiles(jobId)
      ]);

      if (jobResponse.data.success) {
        setJob(jobResponse.data.data);
      }
      if (filesResponse.data.success) {
        setCadFiles(filesResponse.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load job details');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchJobAndFiles();
  }, [jobId, fetchJobAndFiles]);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    const allowedExtensions = ['.stl', '.obj', '.step', '.stp', '.iges', '.igs', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

    const validFiles = files.filter(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        toast.error(`File ${file.name} has invalid extension. Allowed: ${allowedExtensions.join(', ')}`);
        return false;
      }
      // Max 500MB per file
      if (file.size > 524288000) {
        toast.error(`File ${file.name} is too large. Max size is 500MB`);
        return false;
      }
      return true;
    });

    setSelectedFiles(validFiles);
  };

  const handleUpload = async (e) => {
    e.preventDefault();

    if (selectedFiles.length === 0) {
      toast.error('Please select at least one file to upload');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      const formData = new FormData();
      selectedFiles.forEach(file => {
        formData.append('files', file);
      });
      if (comments) {
        formData.append('comments', comments);
      }

      const response = await cadAPI.uploadFiles(jobId, formData);

      if (response.data.success) {
        toast.success(response.data.message || 'Files uploaded successfully');
        setSelectedFiles([]);
        setComments('');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        fetchJobAndFiles();
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error.response?.data?.message || 'Failed to upload files');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleSubmitForReview = async () => {
    if (!window.confirm('Submit this job for review? Make sure all CAD files are uploaded.')) return;

    try {
      await cadAPI.submitForReview(jobId);
      toast.success('Job submitted for review successfully');
      navigate('/cad/my-tasks');
    } catch (error) {
      toast.error('Failed to submit for review');
    }
  };

  const formatDate = (date) => {
    if (!date) return '-';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const getFileIcon = (fileType) => {
    switch (fileType) {
      case 'stl':
        return 'fas fa-cube text-primary';
      case 'image':
        return 'fas fa-image text-success';
      default:
        return 'fas fa-file text-secondary';
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      cad_assigned: 'info',
      cad_in_progress: 'primary',
      cad_submitted: 'warning',
      cad_approved: 'success',
      cad_rejected: 'danger'
    };
    return badges[status] || 'secondary';
  };

  const getStatusText = (status) => {
    const texts = {
      cad_assigned: 'Assigned',
      cad_in_progress: 'In Progress',
      cad_submitted: 'Submitted',
      cad_approved: 'Approved',
      cad_rejected: 'Rejected'
    };
    return texts[status] || status?.replace(/_/g, ' ');
  };

  const isAssignedDesigner = user && job && job.cadDesigner?._id === user._id;
  const userRoles = user?.roles?.map(r => r.name || r) || [];
  const isAdmin = userRoles.includes('admin') || userRoles.includes('super_admin');
  const canUpload = isAssignedDesigner || isAdmin;
  const canSubmitForReview = canUpload &&
    ['cad_in_progress', 'cad_rejected'].includes(job?.status) &&
    cadFiles.length > 0;

  if (loading) {
    return (
      <section className="content">
        <div className="container-fluid">
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status">
              <span className="sr-only">Loading...</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!job) {
    return (
      <section className="content">
        <div className="container-fluid pt-3">
          <div className="alert alert-warning">
            <h5><i className="icon fas fa-exclamation-triangle"></i> Job Not Found</h5>
            The requested job could not be found.
            <br />
            <Link to="/cad/my-tasks" className="btn btn-secondary mt-3">
              <i className="fas fa-arrow-left mr-1"></i> Back to My Tasks
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!canUpload) {
    return (
      <section className="content">
        <div className="container-fluid pt-3">
          <div className="alert alert-danger">
            <h5><i className="icon fas fa-ban"></i> Access Denied</h5>
            You are not authorized to upload files for this job.
            <br />
            <Link to="/cad/my-tasks" className="btn btn-secondary mt-3">
              <i className="fas fa-arrow-left mr-1"></i> Back to My Tasks
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1 className="m-0">
                Upload CAD Files
                <small className="text-muted ml-2">- {job.jobCode}</small>
              </h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/dashboard">Dashboard</Link></li>
                <li className="breadcrumb-item"><Link to="/cad/my-tasks">My Tasks</Link></li>
                <li className="breadcrumb-item active">Upload</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <section className="content">
        <div className="container-fluid">
          {/* Back Button and Actions */}
          <div className="mb-3 d-flex justify-content-between">
            <button className="btn btn-secondary" onClick={() => navigate(-1)}>
              <i className="fas fa-arrow-left mr-1"></i> Back
            </button>
            <div>
              <Link to={`/jobs/${job._id}`} className="btn btn-info mr-2">
                <i className="fas fa-eye mr-1"></i> View Job Details
              </Link>
              {canSubmitForReview && (
                <button className="btn btn-success" onClick={handleSubmitForReview}>
                  <i className="fas fa-paper-plane mr-1"></i> Submit for Review
                </button>
              )}
            </div>
          </div>

          {/* Rejection Alert */}
          {job.status === 'cad_rejected' && (
            <div className="alert alert-danger">
              <h5><i className="icon fas fa-exclamation-circle"></i> CAD Rejected!</h5>
              {job.rejectionReason && <p><strong>Reason:</strong> {job.rejectionReason}</p>}
              Please review the feedback and upload revised CAD files.
            </div>
          )}

          <div className="row">
            {/* Job Info Card */}
            <div className="col-md-4">
              <div className="card card-primary">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-briefcase mr-2"></i>
                    Job Information
                  </h3>
                </div>
                <div className="card-body">
                  <table className="table table-sm table-borderless">
                    <tbody>
                      <tr>
                        <td className="text-muted">Job Code:</td>
                        <td><strong>{job.jobCode}</strong></td>
                      </tr>
                      <tr>
                        <td className="text-muted">Status:</td>
                        <td>
                          <span className={`badge badge-${getStatusBadge(job.status)}`}>
                            {getStatusText(job.status)}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="text-muted">SKU:</td>
                        <td><code>{job.sku || '-'}</code></td>
                      </tr>
                      <tr>
                        <td className="text-muted">Product:</td>
                        <td>{job.productName || '-'}</td>
                      </tr>
                      {job.cadDeadline && (
                        <tr>
                          <td className="text-muted">Deadline:</td>
                          <td>{formatDate(job.cadDeadline)}</td>
                        </tr>
                      )}
                      {job.cadNotes && (
                        <tr>
                          <td className="text-muted">Notes:</td>
                          <td>{job.cadNotes}</td>
                        </tr>
                      )}
                      {job.customerRequest && (
                        <tr>
                          <td className="text-muted">Customer Request:</td>
                          <td><em>{job.customerRequest}</em></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Reference Images */}
              {job.referenceImages && job.referenceImages.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">
                      <i className="fas fa-images mr-2"></i>
                      Reference Images
                    </h3>
                  </div>
                  <div className="card-body">
                    <div className="row">
                      {job.referenceImages.map((img, index) => (
                        <div key={index} className="col-6 mb-2">
                          <img
                            src={`${API_BASE_URL}${img}`}
                            alt={`Reference ${index + 1}`}
                            className="img-fluid img-thumbnail"
                            style={{ cursor: 'pointer' }}
                            onClick={() => window.open(`${API_BASE_URL}${img}`, '_blank')}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Upload Form & Files List */}
            <div className="col-md-8">
              {/* Upload Form */}
              <div className="card card-success">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-upload mr-2"></i>
                    Upload CAD Files
                  </h3>
                </div>
                <form onSubmit={handleUpload}>
                  <div className="card-body">
                    <div className="form-group">
                      <label>Select Files</label>
                      <div className="custom-file">
                        <input
                          type="file"
                          className="custom-file-input"
                          id="cadFiles"
                          ref={fileInputRef}
                          multiple
                          accept=".stl,.obj,.step,.stp,.iges,.igs,.png,.jpg,.jpeg,.gif,.webp"
                          onChange={handleFileSelect}
                          disabled={uploading}
                        />
                        <label className="custom-file-label" htmlFor="cadFiles">
                          {selectedFiles.length > 0
                            ? `${selectedFiles.length} file(s) selected`
                            : 'Choose file(s)...'}
                        </label>
                      </div>
                      <small className="form-text text-muted">
                        Allowed formats: STL, OBJ, STEP, STP, IGES, IGS, PNG, JPG, JPEG, GIF, WEBP (Max 500MB per file)
                      </small>
                    </div>

                    {selectedFiles.length > 0 && (
                      <div className="form-group">
                        <label>Selected Files:</label>
                        <ul className="list-group">
                          {selectedFiles.map((file, index) => (
                            <li key={index} className="list-group-item d-flex justify-content-between align-items-center py-2">
                              <span>
                                <i className={`${getFileIcon(file.name.endsWith('.stl') ? 'stl' : 'other')} mr-2`}></i>
                                {file.name}
                              </span>
                              <span className="badge badge-secondary">{formatFileSize(file.size)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="form-group">
                      <label>Comments (Optional)</label>
                      <textarea
                        className="form-control"
                        rows="2"
                        placeholder="Add any comments about these files..."
                        value={comments}
                        onChange={(e) => setComments(e.target.value)}
                        disabled={uploading}
                      />
                    </div>

                    {uploading && (
                      <div className="progress mb-3">
                        <div
                          className="progress-bar progress-bar-striped progress-bar-animated"
                          role="progressbar"
                          style={{ width: `${uploadProgress || 100}%` }}
                        >
                          Uploading...
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="card-footer">
                    <button
                      type="submit"
                      className="btn btn-success"
                      disabled={uploading || selectedFiles.length === 0}
                    >
                      {uploading ? (
                        <>
                          <span className="spinner-border spinner-border-sm mr-1"></span>
                          Uploading...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-upload mr-1"></i>
                          Upload Files
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Existing Files */}
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-folder-open mr-2"></i>
                    Uploaded CAD Files ({cadFiles.length})
                  </h3>
                </div>
                <div className="card-body p-0">
                  {cadFiles.length === 0 ? (
                    <div className="text-center py-4 text-muted">
                      <i className="fas fa-folder-open fa-3x mb-3"></i>
                      <p>No CAD files uploaded yet</p>
                    </div>
                  ) : (
                    <table className="table table-hover mb-0">
                      <thead>
                        <tr>
                          <th>File Name</th>
                          <th>Type</th>
                          <th>Size</th>
                          <th>Uploaded</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cadFiles.map((file) => (
                          <tr key={file._id}>
                            <td>
                              <i className={`${getFileIcon(file.fileType)} mr-2`}></i>
                              {file.fileName}
                            </td>
                            <td>
                              <span className="badge badge-secondary">
                                {file.fileType?.toUpperCase() || 'OTHER'}
                              </span>
                            </td>
                            <td>{formatFileSize(file.fileSize)}</td>
                            <td>
                              <small>{formatDate(file.uploadedAt)}</small>
                              {file.uploadedBy && (
                                <small className="d-block text-muted">by {file.uploadedBy.name}</small>
                              )}
                            </td>
                            <td>
                              <a
                                href={`${API_BASE_URL}${file.filePath}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-sm btn-info"
                                title="Download"
                                download
                              >
                                <i className="fas fa-download"></i>
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default CADUpload;
