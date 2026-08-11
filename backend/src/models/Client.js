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
                email: { type: String, required: true, match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid email format'] },
                phone: { type: String, default: '', match: [/(^$|^[0-9]{10}$)/, 'Contact number must be exactly 10 digits'] },
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
