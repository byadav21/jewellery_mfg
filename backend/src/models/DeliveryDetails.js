const mongoose = require('mongoose');

const deliveryDetailsSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true,
    unique: true
  },
  deliveryType: {
    type: String,
    required: true,
    enum: ['hand', 'courier']
  },
  // Hand delivery fields
  deliveryPersonName: {
    type: String
  },
  handDeliveryDateTime: {
    type: Date
  },
  // Courier delivery fields
  courierName: {
    type: String
  },
  trackingNumber: {
    type: String
  },
  dispatchedAt: {
    type: Date
  },
  // Common fields
  deliveredTo: {
    type: String
  },
  deliveryAddress: {
    type: String
  },
  deliveredAt: {
    type: Date
  },
  remarks: {
    type: String
  },
  proofOfDelivery: {
    type: String // File path for signature/photo
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// job already indexed via unique: true
deliveryDetailsSchema.index({ deliveryType: 1 });
deliveryDetailsSchema.index({ trackingNumber: 1 });

module.exports = mongoose.model('DeliveryDetails', deliveryDetailsSchema);
