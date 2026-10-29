const mongoose = require('mongoose');

const deletedStoragePathSchema = new mongoose.Schema(
    {
        path: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        deletedBy: {
            type: String,
            default: '',
        },
        deletedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('DeletedStoragePath', deletedStoragePathSchema);

