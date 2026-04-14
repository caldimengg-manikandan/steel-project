/**
 * ============================================================
 * Client Model
 * ============================================================
 * A Client belongs to one Admin.
 * Stores client name and associated contact persons.
 */
const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Client name is required'],
            trim: true,
            maxlength: 120,
        },

        createdByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: [true, 'createdByAdminId is required'],
            index: true,
        },
        status: {
            type: String,
            enum: ['active', 'pending', 'inactive'],
            default: 'active',
        },

        contacts: [
            {
                name: { type: String, required: true },
                email: { type: String, required: true, match: [/.+@.+\..+/, 'Invalid email format'] },
                phone: { type: String, default: '' },
                designation: { type: String, default: '' },
            }
        ],
    },
    {
        timestamps: true,
        collection: 'clients',
    }
);

// Ensure unique client names PER admin
clientSchema.index({ name: 1, createdByAdminId: 1 }, { unique: true });

module.exports = mongoose.model('Client', clientSchema);
