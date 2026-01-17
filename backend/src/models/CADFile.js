const mongoose = require('mongoose');

const cadFileSchema = new mongoose.Schema({
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
    enum: ['stl', 'image', 'other'],
    default: 'other'
  },
  mimeType: {
    type: String
  },
  fileSize: {
    type: Number
  },
  version: {
    type: Number,
    default: 1
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedAt: {
    type: Date
  },
  rejectionReason: {
    type: String
  },
  comments: {
    type: String
  },
  isLatest: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: { createdAt: 'uploadedAt', updatedAt: 'updatedAt' }
});

cadFileSchema.index({ job: 1, version: -1 });
cadFileSchema.index({ uploadedBy: 1 });
cadFileSchema.index({ isApproved: 1 });
cadFileSchema.index({ isLatest: 1 });

// Before saving a new file, mark previous versions as not latest
cadFileSchema.pre('save', async function(next) {
  if (this.isNew) {
    // Get the highest version for this job
    const lastFile = await this.constructor.findOne({ job: this.job })
      .sort({ version: -1 });

    if (lastFile) {
      this.version = lastFile.version + 1;
      // Mark all previous versions as not latest
      await this.constructor.updateMany(
        { job: this.job },
        { isLatest: false }
      );
    }
  }
  next();
});

module.exports = mongoose.model('CADFile', cadFileSchema);
