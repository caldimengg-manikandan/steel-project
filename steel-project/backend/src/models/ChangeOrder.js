const mongoose = require('mongoose');

const changeOrderSchema = new mongoose.Schema(
    {
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        createdByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: true,
            index: true,
        },
        coNumber: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: '',
        },
        status: {
            type: String,
            enum: ['PENDING', 'APPROVED', 'WORK_COMPLETED', 'CANCELLED'],
            default: 'PENDING',
            index: true,
        },
        amount: {
            type: Number,
            default: 0,
        },
        date: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
        collection: 'change_orders',
    }
);

changeOrderSchema.index({ projectId: 1, coNumber: 1 }, { unique: true });

module.exports = mongoose.model('ChangeOrder', changeOrderSchema);
