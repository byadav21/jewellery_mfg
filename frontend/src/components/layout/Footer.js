import React from 'react';

const Footer = () => {
  return (
    <footer className="main-footer">
      <strong>
        Jewellery Manufacturing Tool &copy; {new Date().getFullYear()}
      </strong>
      <div className="float-right d-none d-sm-inline-block">
        <b>Version</b> 1.0.0
      </div>
    </footer>
  );
};

export default Footer;
