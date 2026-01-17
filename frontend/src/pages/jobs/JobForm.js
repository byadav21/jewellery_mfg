import React from 'react';
import { Link } from 'react-router-dom';

const JobForm = () => {
  return (
    <>
      <div className="content-header">
        <div className="container-fluid">
          <div className="row mb-2">
            <div className="col-sm-6">
              <h1>Create Job</h1>
            </div>
            <div className="col-sm-6">
              <ol className="breadcrumb float-sm-right">
                <li className="breadcrumb-item"><Link to="/jobs">Jobs</Link></li>
                <li className="breadcrumb-item active">Create</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
      <section className="content">
        <div className="container-fluid">
          <div className="card">
            <div className="card-body">
              <p>Job creation form will be implemented here.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default JobForm;
