/**
 * ============================================================
 * Admin Clients Controller
 * ============================================================
 */
const Client = require('../models/Client');
const Project = require('../models/Project');

/**
 * GET /api/admin/clients
 * List all clients for the logged-in admin.
 */
async function listClients(req, res) {
    const adminId = req.principal.adminId;
    const clients = await Client.find({}).sort({ name: 1 });
    res.json({ count: clients.length, clients });
}

/**
 * POST /api/admin/clients
 * Create a new client.
 */
async function createClient(req, res) {
    const adminId = req.principal.adminId;
    const { name, contacts, status } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Client name is required.' });
    }

    try {
        const client = await Client.create({
            name,
            contacts: contacts || [],
            status: status || 'active',
            createdByAdminId: adminId
        });
        res.status(201).json({ client });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: 'A client with this name already exists.' });
        }
        throw err;
    }
}

/**
 * PATCH /api/admin/clients/:clientId
 */
async function updateClient(req, res) {
    const adminId = req.principal.adminId;
    const { clientId } = req.params;
    const { name, contacts, status } = req.body;

    const client = await Client.findOne({ _id: clientId, createdByAdminId: adminId });
    if (!client) {
        return res.status(404).json({ error: 'Client not found.' });
    }

    if (name !== undefined) client.name = name;
    if (contacts !== undefined) client.contacts = contacts;
    if (status !== undefined) client.status = status;

    await client.save();
    res.json({ client });
}

/**
 * DELETE /api/admin/clients/:clientId
 */
async function deleteClient(req, res) {
    const adminId = req.principal.adminId;
    const { clientId } = req.params;

    const client = await Client.findOne({ _id: clientId, createdByAdminId: adminId });
    if (!client) {
        return res.status(404).json({ error: 'Client not found.' });
    }

    // Optional: check if projects are linked?
    const projects = await Project.countDocuments({ clientId: client._id });
    if (projects > 0) {
       return res.status(400).json({ error: 'Cannot delete client with active projects.' });
    }

    await client.deleteOne();
    res.json({ message: `Client "${client.name}" deleted successfully.` });
}

module.exports = {
    listClients,
    createClient,
    updateClient,
    deleteClient,
    bulkCreateClients
};

const ExcelJS = require('exceljs');
const fs = require('fs');

/**
 * POST /api/admin/clients/bulk
 * Create clients from an Excel/CSV file uploaded via multer.
 * Required columns: "Client Name", "Client Email"
 */
async function bulkCreateClients(req, res) {
    const adminId = req.principal.adminId;

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
        console.log(`[BULK UPLOAD CLIENTS] Processing file at: ${req.file.path}`);
        
        const workbook = new ExcelJS.Workbook();
        const extension = req.file.originalname.split('.').pop().toLowerCase();
        
        if (extension === 'csv') {
            await workbook.csv.readFile(req.file.path);
        } else {
            await workbook.xlsx.readFile(req.file.path);
        }

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            throw new Error('Could not find a worksheet in the provided file.');
        }

        const headerRow = worksheet.getRow(1);
        const colMap = {};
        
        headerRow.eachCell((cell, colNumber) => {
            const header = String(cell.value).trim().toLowerCase();
            // Map common header naming variations
            if (header.includes('client name') || header === 'name' || header === 'company' || header === 'company name') colMap['clientName'] = colNumber;
            else if (header.includes('email') || header.includes('mail id')) colMap['email'] = colNumber;
            else if (header.includes('contact name') || header === 'contact') colMap['contactName'] = colNumber;
            else if (header.includes('phone') || header.includes('mobile')) colMap['phone'] = colNumber;
        });

        if (!colMap.clientName) {
            throw new Error('Could not find mandatory "Client Name" column in the header row.');
        }
        if (!colMap.email) {
            throw new Error('Could not find mandatory "Client Email" or "Mail ID" column in the header row.');
        }

        let createdCount = 0;
        let skippedCount = 0;
        let errorList = [];

        for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
            const row = worksheet.getRow(rowNumber);
            if (!row.hasValues) continue;

            const clientName = row.getCell(colMap.clientName).value;
            let emailValue = row.getCell(colMap.email).value;
            const contactNameValue = colMap.contactName ? row.getCell(colMap.contactName).value : null;
            const phoneValue = colMap.phone ? row.getCell(colMap.phone).value : null;

            if (!clientName || !emailValue) {
                errorList.push(`Row ${rowNumber}: Missing Client Name or Email.`);
                skippedCount++;
                continue;
            }
            
            // Clean values
            const name = String(clientName).trim();
            const email = (emailValue && typeof emailValue === 'object') ? emailValue.text || emailValue.hyperlink : String(emailValue).trim();
            const contactName = contactNameValue ? String(contactNameValue).trim() : name; 
            const phone = phoneValue ? String(phoneValue).trim() : '';

            // Check duplicate client name
            const existing = await Client.findOne({
                name: { $regex: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            });
            if (existing) {
                errorList.push(`Row ${rowNumber}: Client "${name}" already exists.`);
                skippedCount++;
                continue;
            }

            try {
                await Client.create({
                    name: name,
                    contacts: [{ name: contactName, email: email, phone: phone }],
                    status: 'active',
                    createdByAdminId: adminId
                });
                createdCount++;
            } catch (err) {
                errorList.push(`Row ${rowNumber}: ${err.message}`);
                skippedCount++;
            }
        }

        // Cleanup temp file
        try { fs.unlinkSync(req.file.path); } catch(e) {}

        res.json({
            message: `Bulk upload completed. Created: ${createdCount}, Skipped: ${skippedCount}.`,
            createdCount,
            skippedCount,
            errors: errorList
        });

    } catch (err) {
        console.error('[BULK UPLOAD CLIENTS] Error:', err);
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        res.status(500).json({ error: err.message || 'Failed to process bulk upload.' });
    }
}
