import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Formik, Form, Field, FieldArray, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import DatePicker from 'react-datepicker';
import { toast } from 'react-toastify';
import api from '../../services/api';
import 'react-datepicker/dist/react-datepicker.css';

// Validation Schema with enhanced validation
const validationSchema = Yup.object().shape({
  buyerName: Yup.string()
    .required('Buyer name is required')
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name cannot exceed 100 characters'),
  buyerEmail: Yup.string()
    .email('Invalid email address')
    .max(100, 'Email cannot exceed 100 characters'),
  buyerPhone: Yup.string()
    .matches(/^[0-9+\-\s()]*$/, 'Invalid phone number format')
    .max(20, 'Phone number too long'),
  promisedDate: Yup.date()
    .nullable()
    .min(new Date(new Date().setHours(0, 0, 0, 0)), 'Promised date must be today or in the future'),
  shippingAddress: Yup.object().shape({
    addressLine1: Yup.string().max(200, 'Address too long'),
    addressLine2: Yup.string().max(200, 'Address too long'),
    city: Yup.string().max(100, 'City name too long'),
    state: Yup.string().max(100, 'State name too long'),
    postalCode: Yup.string().max(20, 'Postal code too long'),
    country: Yup.string().max(100, 'Country name too long')
  }),
  items: Yup.array()
    .of(
      Yup.object().shape({
        productName: Yup.string()
          .required('Product name is required')
          .min(2, 'Product name must be at least 2 characters')
          .max(200, 'Product name too long'),
        sku: Yup.string().max(50, 'SKU too long'),
        quantity: Yup.number()
          .min(1, 'Quantity must be at least 1')
          .max(1000, 'Quantity cannot exceed 1000')
          .required('Quantity is required')
          .integer('Quantity must be a whole number'),
        itemPrice: Yup.number()
          .min(0, 'Price cannot be negative')
          .max(10000000, 'Price too high'),
        priority: Yup.string()
          .oneOf(['low', 'medium', 'high', 'urgent'], 'Invalid priority'),
        customerRequest: Yup.string().max(1000, 'Instructions too long'),
        cadRequired: Yup.string()
          .oneOf(['yes', 'no'], 'Please select Yes or No')
          .required('CAD requirement is required'),
        cadFile: Yup.mixed()
          .when('cadRequired', {
            is: 'yes',
            then: () => Yup.mixed().required('CAD file is required when CAD is Yes'),
            otherwise: () => Yup.mixed().nullable()
          })
      })
    )
    .min(1, 'At least one item is required')
});

const initialValues = {
  buyerName: '',
  buyerEmail: '',
  buyerPhone: '',
  shippingAddress: {
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: ''
  },
  promisedDate: null,
  isExistingCustomer: false,
  selectedCustomerId: '',
  items: [
    {
      productName: '',
      sku: '',
      quantity: 1,
      itemPrice: 0,
      priority: 'medium',
      customerRequest: '',
      cadRequired: 'no',
      cadFile: null,
      referenceImages: []
    }
  ]
};

const ManualOrderForm = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Debounce customer search
  const searchCustomers = useCallback(async (searchTerm) => {
    if (!searchTerm || searchTerm.length < 2) {
      setCustomers([]);
      return;
    }

    setSearchingCustomers(true);
    try {
      const response = await api.get('/orders/customers/search', {
        params: { search: searchTerm }
      });
      const data = response.data.data || response.data || [];
      setCustomers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Customer search error:', error);
      setCustomers([]);
    } finally {
      setSearchingCustomers(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (customerSearchTerm) {
        searchCustomers(customerSearchTerm);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearchTerm, searchCustomers]);

  // Handle customer selection
  const handleCustomerSelect = (customer, setFieldValue) => {
    setFieldValue('buyerName', customer.buyerName || '');
    setFieldValue('buyerEmail', customer.buyerEmail || '');
    setFieldValue('buyerPhone', customer.buyerPhone || '');
    setFieldValue('selectedCustomerId', customer._id || '');
    setFieldValue('isExistingCustomer', true);
    if (customer.shippingAddress) {
      setFieldValue('shippingAddress', customer.shippingAddress);
    }
    setShowCustomerDropdown(false);
    setCustomerSearchTerm('');
    toast.info(`Customer "${customer.buyerName}" selected`);
  };

  // Handle file upload for reference images
  const handleImageUpload = async (e, index, setFieldValue, currentImages) => {
    const files = Array.from(e.target.files);
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    const validFiles = files.filter(file => {
      if (!validTypes.includes(file.type)) {
        toast.error(`${file.name}: Invalid file type. Only JPG, PNG, GIF, WEBP allowed`);
        return false;
      }
      if (file.size > maxSize) {
        toast.error(`${file.name}: File too large. Max 5MB allowed`);
        return false;
      }
      return true;
    });

    if (validFiles.length > 0) {
      const newImages = [...(currentImages || []), ...validFiles];
      setFieldValue(`items.${index}.referenceImages`, newImages);
    }
  };

  // Handle CAD file upload (STL only)
  const handleCadFileUpload = (e, index, setFieldValue) => {
    const file = e.target.files[0];
    if (!file) return;

    const validExtensions = ['.stl', '.STL'];
    const fileName = file.name;
    const extension = fileName.substring(fileName.lastIndexOf('.'));

    if (!validExtensions.includes(extension)) {
      toast.error('Only STL files are allowed for CAD uploads');
      e.target.value = '';
      return;
    }

    const maxSize = 50 * 1024 * 1024; // 50MB for STL files
    if (file.size > maxSize) {
      toast.error('CAD file too large. Max 50MB allowed');
      e.target.value = '';
      return;
    }

    setFieldValue(`items.${index}.cadFile`, file);
    toast.success(`CAD file "${fileName}" selected`);
  };

  // Remove reference image
  const removeImage = (index, imageIndex, setFieldValue, currentImages) => {
    const newImages = currentImages.filter((_, i) => i !== imageIndex);
    setFieldValue(`items.${index}.referenceImages`, newImages);
  };

  // Handle form submission with file upload
  const handleSubmit = async (values, { setSubmitting: setFormSubmitting }) => {
    setSubmitting(true);
    try {
      const formData = new FormData();

      // Add basic order data
      formData.append('buyerName', values.buyerName);
      formData.append('buyerEmail', values.buyerEmail || '');
      formData.append('buyerPhone', values.buyerPhone || '');
      formData.append('shippingAddress', JSON.stringify(values.shippingAddress));
      formData.append('promisedDate', values.promisedDate ? values.promisedDate.toISOString() : '');
      formData.append('isExistingCustomer', values.isExistingCustomer);
      formData.append('selectedCustomerId', values.selectedCustomerId || '');

      // Process items
      const itemsData = values.items.map((item, index) => ({
        productName: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        itemPrice: item.itemPrice,
        priority: item.priority,
        customerRequest: item.customerRequest,
        cadRequired: item.cadRequired,
        hasCADFile: item.cadRequired === 'yes' && item.cadFile,
        referenceImageCount: item.referenceImages?.length || 0
      }));

      formData.append('items', JSON.stringify(itemsData));

      // Add files
      values.items.forEach((item, index) => {
        // Add CAD file if exists
        if (item.cadRequired === 'yes' && item.cadFile) {
          formData.append(`cadFile_${index}`, item.cadFile);
        }

        // Add reference images
        if (item.referenceImages && item.referenceImages.length > 0) {
          item.referenceImages.forEach((img, imgIndex) => {
            formData.append(`refImage_${index}_${imgIndex}`, img);
          });
        }
      });

      const response = await api.post('/orders/manual', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        toast.success('Custom order created successfully!');
        navigate('/orders');
      } else {
        toast.error(response.data.message || 'Failed to create order');
      }
    } catch (error) {
      console.error('Create order error:', error);
      toast.error(error.response?.data?.message || 'Failed to create order');
    } finally {
      setSubmitting(false);
      setFormSubmitting(false);
    }
  };

  return (
    <section className="content">
      <div className="container-fluid">
        {/* Page Header */}
        <div className="row mb-3">
          <div className="col-12">
            <h3 className="m-0">
              <i className="fas fa-plus-circle mr-2"></i>
              Create Custom Order
            </h3>
            <small className="text-muted">Create a manual order that will automatically generate production jobs</small>
          </div>
        </div>

        <Formik
          initialValues={initialValues}
          validationSchema={validationSchema}
          onSubmit={handleSubmit}
          validateOnBlur={true}
          validateOnChange={true}
        >
          {({ values, errors, touched, setFieldValue, isSubmitting, isValid }) => (
            <Form>
              <div className="row">
                {/* Customer Information Card */}
                <div className="col-md-6">
                  <div className="card card-primary">
                    <div className="card-header">
                      <h3 className="card-title">
                        <i className="fas fa-user mr-2"></i>
                        Customer Information
                      </h3>
                    </div>
                    <div className="card-body">
                      {/* Customer Search */}
                      <div className="form-group">
                        <label>
                          <i className="fas fa-search mr-1"></i>
                          Search Existing Customer
                        </label>
                        <div className="position-relative">
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Search by name, email, or phone..."
                            value={customerSearchTerm}
                            onChange={(e) => {
                              setCustomerSearchTerm(e.target.value);
                              setShowCustomerDropdown(true);
                            }}
                            onFocus={() => setShowCustomerDropdown(true)}
                          />
                          {searchingCustomers && (
                            <div className="position-absolute" style={{ right: '10px', top: '10px' }}>
                              <i className="fas fa-spinner fa-spin"></i>
                            </div>
                          )}

                          {/* Customer Dropdown */}
                          {showCustomerDropdown && customers.length > 0 && (
                            <div className="dropdown-menu show w-100" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                              {customers.map((customer) => (
                                <button
                                  key={customer._id}
                                  type="button"
                                  className="dropdown-item"
                                  onClick={() => handleCustomerSelect(customer, setFieldValue)}
                                >
                                  <strong>{customer.buyerName}</strong>
                                  <br />
                                  <small className="text-muted">
                                    {customer.buyerEmail} | {customer.buyerPhone}
                                  </small>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <small className="text-muted">Search and select to auto-fill customer details</small>
                      </div>

                      {values.isExistingCustomer && (
                        <div className="alert alert-info py-2">
                          <i className="fas fa-check-circle mr-1"></i>
                          Existing customer selected
                          <button
                            type="button"
                            className="btn btn-sm btn-link float-right p-0"
                            onClick={() => {
                              setFieldValue('isExistingCustomer', false);
                              setFieldValue('selectedCustomerId', '');
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      )}

                      <hr />

                      <div className="form-group">
                        <label htmlFor="buyerName">
                          Buyer Name <span className="text-danger">*</span>
                        </label>
                        <Field
                          type="text"
                          name="buyerName"
                          className={`form-control ${errors.buyerName && touched.buyerName ? 'is-invalid' : touched.buyerName ? 'is-valid' : ''}`}
                          placeholder="Enter buyer name"
                        />
                        <ErrorMessage name="buyerName" component="div" className="invalid-feedback" />
                      </div>

                      <div className="form-group">
                        <label htmlFor="buyerEmail">Email</label>
                        <Field
                          type="email"
                          name="buyerEmail"
                          className={`form-control ${errors.buyerEmail && touched.buyerEmail ? 'is-invalid' : touched.buyerEmail && values.buyerEmail ? 'is-valid' : ''}`}
                          placeholder="Enter email address"
                        />
                        <ErrorMessage name="buyerEmail" component="div" className="invalid-feedback" />
                      </div>

                      <div className="form-group">
                        <label htmlFor="buyerPhone">Phone</label>
                        <Field
                          type="text"
                          name="buyerPhone"
                          className={`form-control ${errors.buyerPhone && touched.buyerPhone ? 'is-invalid' : touched.buyerPhone && values.buyerPhone ? 'is-valid' : ''}`}
                          placeholder="Enter phone number"
                        />
                        <ErrorMessage name="buyerPhone" component="div" className="invalid-feedback" />
                      </div>

                      <div className="form-group">
                        <label htmlFor="promisedDate">Promised Delivery Date</label>
                        <DatePicker
                          selected={values.promisedDate}
                          onChange={(date) => setFieldValue('promisedDate', date)}
                          className={`form-control ${errors.promisedDate && touched.promisedDate ? 'is-invalid' : ''}`}
                          dateFormat="yyyy-MM-dd"
                          minDate={new Date()}
                          placeholderText="Select delivery date"
                          isClearable
                        />
                        {errors.promisedDate && touched.promisedDate && (
                          <div className="text-danger small mt-1">{errors.promisedDate}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Shipping Address Card */}
                <div className="col-md-6">
                  <div className="card card-info">
                    <div className="card-header">
                      <h3 className="card-title">
                        <i className="fas fa-map-marker-alt mr-2"></i>
                        Shipping Address
                      </h3>
                    </div>
                    <div className="card-body">
                      <div className="form-group">
                        <label>Address Line 1</label>
                        <Field
                          type="text"
                          name="shippingAddress.addressLine1"
                          className={`form-control ${errors.shippingAddress?.addressLine1 ? 'is-invalid' : ''}`}
                          placeholder="Street address"
                        />
                        <ErrorMessage name="shippingAddress.addressLine1" component="div" className="invalid-feedback" />
                      </div>

                      <div className="form-group">
                        <label>Address Line 2</label>
                        <Field
                          type="text"
                          name="shippingAddress.addressLine2"
                          className="form-control"
                          placeholder="Apartment, suite, etc."
                        />
                      </div>

                      <div className="row">
                        <div className="col-6">
                          <div className="form-group">
                            <label>City</label>
                            <Field
                              type="text"
                              name="shippingAddress.city"
                              className="form-control"
                              placeholder="City"
                            />
                          </div>
                        </div>
                        <div className="col-6">
                          <div className="form-group">
                            <label>State</label>
                            <Field
                              type="text"
                              name="shippingAddress.state"
                              className="form-control"
                              placeholder="State"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="row">
                        <div className="col-6">
                          <div className="form-group">
                            <label>Postal Code</label>
                            <Field
                              type="text"
                              name="shippingAddress.postalCode"
                              className="form-control"
                              placeholder="ZIP/Postal code"
                            />
                          </div>
                        </div>
                        <div className="col-6">
                          <div className="form-group">
                            <label>Country</label>
                            <Field
                              type="text"
                              name="shippingAddress.country"
                              className="form-control"
                              placeholder="Country"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Order Items Card */}
              <div className="card card-success">
                <div className="card-header">
                  <h3 className="card-title">
                    <i className="fas fa-list mr-2"></i>
                    Order Items
                  </h3>
                </div>
                <div className="card-body">
                  <FieldArray name="items">
                    {({ push, remove }) => (
                      <>
                        {values.items.map((item, index) => (
                          <div key={index} className="card mb-3 bg-light">
                            <div className="card-body">
                              <div className="row align-items-end">
                                <div className="col-12 mb-2">
                                  <div className="d-flex justify-content-between align-items-center">
                                    <h5 className="mb-0">
                                      <span className="badge badge-secondary mr-2">#{index + 1}</span>
                                      Item Details
                                    </h5>
                                    {values.items.length > 1 && (
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-danger"
                                        onClick={() => remove(index)}
                                      >
                                        <i className="fas fa-trash"></i> Remove
                                      </button>
                                    )}
                                  </div>
                                  <hr />
                                </div>

                                {/* Row 1: Product Name, SKU, Quantity, Price */}
                                <div className="col-md-4">
                                  <div className="form-group">
                                    <label>
                                      Product Name <span className="text-danger">*</span>
                                    </label>
                                    <Field
                                      type="text"
                                      name={`items.${index}.productName`}
                                      className={`form-control ${
                                        errors.items?.[index]?.productName && touched.items?.[index]?.productName
                                          ? 'is-invalid'
                                          : touched.items?.[index]?.productName ? 'is-valid' : ''
                                      }`}
                                      placeholder="e.g., Diamond Ring"
                                    />
                                    <ErrorMessage
                                      name={`items.${index}.productName`}
                                      component="div"
                                      className="invalid-feedback"
                                    />
                                  </div>
                                </div>

                                <div className="col-md-2">
                                  <div className="form-group">
                                    <label>SKU</label>
                                    <Field
                                      type="text"
                                      name={`items.${index}.sku`}
                                      className="form-control"
                                      placeholder="e.g., DR-001"
                                    />
                                    <small className="text-muted">Auto-generated if empty</small>
                                  </div>
                                </div>

                                <div className="col-md-2">
                                  <div className="form-group">
                                    <label>
                                      Quantity <span className="text-danger">*</span>
                                    </label>
                                    <Field
                                      type="number"
                                      name={`items.${index}.quantity`}
                                      className={`form-control ${
                                        errors.items?.[index]?.quantity && touched.items?.[index]?.quantity
                                          ? 'is-invalid'
                                          : ''
                                      }`}
                                      min="1"
                                      max="1000"
                                    />
                                    <ErrorMessage
                                      name={`items.${index}.quantity`}
                                      component="div"
                                      className="invalid-feedback"
                                    />
                                  </div>
                                </div>

                                <div className="col-md-2">
                                  <div className="form-group">
                                    <label>Price ($)</label>
                                    <Field
                                      type="number"
                                      name={`items.${index}.itemPrice`}
                                      className="form-control"
                                      min="0"
                                      step="0.01"
                                    />
                                  </div>
                                </div>

                                <div className="col-md-2">
                                  <div className="form-group">
                                    <label>Priority</label>
                                    <Field
                                      as="select"
                                      name={`items.${index}.priority`}
                                      className="form-control"
                                    >
                                      <option value="low">Low</option>
                                      <option value="medium">Medium</option>
                                      <option value="high">High</option>
                                      <option value="urgent">Urgent</option>
                                    </Field>
                                  </div>
                                </div>

                                {/* Row 2: CAD Required and CAD File Upload */}
                                <div className="col-md-3">
                                  <div className="form-group">
                                    <label>
                                      CAD Required <span className="text-danger">*</span>
                                    </label>
                                    <Field
                                      as="select"
                                      name={`items.${index}.cadRequired`}
                                      className={`form-control ${
                                        errors.items?.[index]?.cadRequired && touched.items?.[index]?.cadRequired
                                          ? 'is-invalid'
                                          : ''
                                      }`}
                                      onChange={(e) => {
                                        setFieldValue(`items.${index}.cadRequired`, e.target.value);
                                        if (e.target.value === 'no') {
                                          setFieldValue(`items.${index}.cadFile`, null);
                                        }
                                      }}
                                    >
                                      <option value="no">No</option>
                                      <option value="yes">Yes</option>
                                    </Field>
                                    <ErrorMessage
                                      name={`items.${index}.cadRequired`}
                                      component="div"
                                      className="invalid-feedback"
                                    />
                                  </div>
                                </div>

                                {/* CAD File Upload - Only show if CAD Required is Yes */}
                                {item.cadRequired === 'yes' && (
                                  <div className="col-md-5">
                                    <div className="form-group">
                                      <label>
                                        CAD File (STL) <span className="text-danger">*</span>
                                      </label>
                                      <div className="custom-file">
                                        <input
                                          type="file"
                                          className={`custom-file-input ${
                                            errors.items?.[index]?.cadFile && touched.items?.[index]?.cadFile
                                              ? 'is-invalid'
                                              : ''
                                          }`}
                                          id={`cadFile-${index}`}
                                          accept=".stl,.STL"
                                          onChange={(e) => handleCadFileUpload(e, index, setFieldValue)}
                                        />
                                        <label className="custom-file-label" htmlFor={`cadFile-${index}`}>
                                          {item.cadFile ? item.cadFile.name : 'Choose STL file...'}
                                        </label>
                                      </div>
                                      {item.cadFile && (
                                        <div className="mt-2">
                                          <span className="badge badge-success">
                                            <i className="fas fa-file-alt mr-1"></i>
                                            {item.cadFile.name}
                                          </span>
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-link text-danger"
                                            onClick={() => setFieldValue(`items.${index}.cadFile`, null)}
                                          >
                                            <i className="fas fa-times"></i>
                                          </button>
                                        </div>
                                      )}
                                      {errors.items?.[index]?.cadFile && touched.items?.[index]?.cadFile && (
                                        <div className="text-danger small mt-1">
                                          {errors.items[index].cadFile}
                                        </div>
                                      )}
                                      <small className="text-muted">Only .stl files accepted (Max 50MB)</small>
                                    </div>
                                  </div>
                                )}

                                {/* Reference Images Upload */}
                                <div className={`col-md-${item.cadRequired === 'yes' ? '4' : '9'}`}>
                                  <div className="form-group">
                                    <label>
                                      <i className="fas fa-images mr-1"></i>
                                      Reference Images
                                    </label>
                                    <div className="custom-file">
                                      <input
                                        type="file"
                                        className="custom-file-input"
                                        id={`refImages-${index}`}
                                        accept="image/jpeg,image/png,image/gif,image/webp"
                                        multiple
                                        onChange={(e) => handleImageUpload(e, index, setFieldValue, item.referenceImages)}
                                      />
                                      <label className="custom-file-label" htmlFor={`refImages-${index}`}>
                                        Choose images...
                                      </label>
                                    </div>
                                    <small className="text-muted">JPG, PNG, GIF, WEBP (Max 5MB each)</small>

                                    {/* Image Preview */}
                                    {item.referenceImages && item.referenceImages.length > 0 && (
                                      <div className="mt-2 d-flex flex-wrap">
                                        {item.referenceImages.map((img, imgIndex) => (
                                          <div key={imgIndex} className="position-relative mr-2 mb-2">
                                            <img
                                              src={URL.createObjectURL(img)}
                                              alt={`Reference ${imgIndex + 1}`}
                                              className="img-thumbnail"
                                              style={{ width: '60px', height: '60px', objectFit: 'cover' }}
                                            />
                                            <button
                                              type="button"
                                              className="btn btn-danger btn-xs position-absolute"
                                              style={{ top: '-5px', right: '-5px', padding: '0 4px', fontSize: '10px' }}
                                              onClick={() => removeImage(index, imgIndex, setFieldValue, item.referenceImages)}
                                            >
                                              <i className="fas fa-times"></i>
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Customer Request / Special Instructions */}
                                <div className="col-12">
                                  <div className="form-group mb-0">
                                    <label>Customer Request / Special Instructions</label>
                                    <Field
                                      as="textarea"
                                      name={`items.${index}.customerRequest`}
                                      className={`form-control ${
                                        errors.items?.[index]?.customerRequest ? 'is-invalid' : ''
                                      }`}
                                      rows="2"
                                      placeholder="Enter any special instructions or customization requests..."
                                      maxLength="1000"
                                    />
                                    <small className="text-muted">
                                      {(item.customerRequest || '').length}/1000 characters
                                    </small>
                                    <ErrorMessage
                                      name={`items.${index}.customerRequest`}
                                      component="div"
                                      className="invalid-feedback"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}

                        <button
                          type="button"
                          className="btn btn-outline-primary"
                          onClick={() =>
                            push({
                              productName: '',
                              sku: '',
                              quantity: 1,
                              itemPrice: 0,
                              priority: 'medium',
                              customerRequest: '',
                              cadRequired: 'no',
                              cadFile: null,
                              referenceImages: []
                            })
                          }
                        >
                          <i className="fas fa-plus mr-2"></i>
                          Add Another Item
                        </button>
                      </>
                    )}
                  </FieldArray>

                  {errors.items && typeof errors.items === 'string' && (
                    <div className="alert alert-danger mt-2">{errors.items}</div>
                  )}
                </div>
              </div>

              {/* Summary & Submit */}
              <div className="card">
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-6">
                      <h5>Order Summary</h5>
                      <table className="table table-sm">
                        <tbody>
                          <tr>
                            <td>Total Items:</td>
                            <td><strong>{values.items.length}</strong></td>
                          </tr>
                          <tr>
                            <td>Total Quantity:</td>
                            <td>
                              <strong>
                                {values.items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0)}
                              </strong>
                            </td>
                          </tr>
                          <tr>
                            <td>Total Value:</td>
                            <td>
                              <strong>
                                ${values.items.reduce((sum, item) =>
                                  sum + ((parseFloat(item.itemPrice) || 0) * (parseInt(item.quantity) || 0)), 0
                                ).toFixed(2)}
                              </strong>
                            </td>
                          </tr>
                          <tr>
                            <td>Items with CAD:</td>
                            <td>
                              <strong>
                                {values.items.filter(item => item.cadRequired === 'yes').length}
                              </strong>
                            </td>
                          </tr>
                          <tr>
                            <td>Reference Images:</td>
                            <td>
                              <strong>
                                {values.items.reduce((sum, item) => sum + (item.referenceImages?.length || 0), 0)}
                              </strong>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="col-md-6 text-right">
                      <p className="text-muted mb-3">
                        <i className="fas fa-info-circle mr-1"></i>
                        A production job will be created for each item in this order.
                      </p>

                      {/* Validation Status */}
                      {!isValid && Object.keys(errors).length > 0 && (
                        <div className="alert alert-warning text-left mb-3">
                          <strong><i className="fas fa-exclamation-triangle mr-1"></i>Please fix the following errors:</strong>
                          <ul className="mb-0 mt-2">
                            {errors.buyerName && <li>{errors.buyerName}</li>}
                            {errors.items && typeof errors.items === 'string' && <li>{errors.items}</li>}
                            {Array.isArray(errors.items) && errors.items.map((itemError, idx) => (
                              itemError && Object.keys(itemError).map(key => (
                                <li key={`${idx}-${key}`}>Item {idx + 1}: {itemError[key]}</li>
                              ))
                            ))}
                          </ul>
                        </div>
                      )}

                      <button
                        type="button"
                        className="btn btn-secondary mr-2"
                        onClick={() => navigate('/orders')}
                        disabled={submitting}
                      >
                        <i className="fas fa-times mr-1"></i>
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary btn-lg"
                        disabled={submitting || isSubmitting}
                      >
                        {submitting ? (
                          <>
                            <i className="fas fa-spinner fa-spin mr-1"></i>
                            Creating Order...
                          </>
                        ) : (
                          <>
                            <i className="fas fa-check mr-1"></i>
                            Create Order
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </section>
  );
};

export default ManualOrderForm;
