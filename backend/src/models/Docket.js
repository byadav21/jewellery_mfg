const mongoose = require('mongoose');

const docketSchema = new mongoose.Schema({
    docketNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true
    },
    jobs: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job'
    }],
    manufacturer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['draft', 'dispatched', 'received', 'completed'],
        default: 'draft'
    },
    notes: {
        type: String,
        trim: true
    },
    dispatchedAt: Date,
    receivedAt: Date,
    completedAt: Date,
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed
    }
}, {
    timestamps: true
});

// Index for performance
docketSchema.index({ docketNumber: 1 });
docketSchema.index({ manufacturer: 1 });
docketSchema.index({ status: 1 });

/**
 * Static method to generate next docket number
 * Format: DOC000001
 */
docketSchema.statics.generateNextNumber = async function () {
    const lastDocket = await this.findOne({}, {}, { sort: { 'createdAt': -1 } });
    let nextNum = 1;

    if (lastDocket && lastDocket.docketNumber) {
        const currentNum = parseInt(lastDocket.docketNumber.replace('DOC', ''));
        if (!isNaN(currentNum)) {
            nextNum = currentNum + 1;
        }
    }

    return `DOC${nextNum.toString().padStart(6, '0')}`;
};

module.exports = mongoose.model('Docket', docketSchema);
