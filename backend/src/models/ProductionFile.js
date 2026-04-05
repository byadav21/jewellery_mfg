const mongoose = require('mongoose');

const productionFileSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    enum: ['image', 'video', 'document', 'other'],
    default: 'image'
  },
  mimeType: {
    type: String
  },
  fileSize: {
    type: Number
  },
  remarks: {
    type: String
  },
  stage: {
    type: String,
    enum: ['in_progress', 'qc', 'final'],
    default: 'final'
  }
}, {
  timestamps: { createdAt: 'uploadedAt', updatedAt: 'updatedAt' }
});

productionFileSchema.index({ job: 1 });
productionFileSchema.index({ uploadedBy: 1 });
productionFileSchema.index({ stage: 1 });

module.exports = mongoose.model('ProductionFile', productionFileSchema);
