import { useState, useEffect } from 'react';
import { adminListClients, adminCreateClient, adminDeleteClient, adminUpdateClient, adminBulkCreateClients } from '../../services/adminClientApi';
import type { Client, ClientContact } from '../../types';
import { 
    IconPlus, IconTrash, IconUsers, IconBuilding, IconSearch, 
    IconEdit, IconFilter, IconClose, IconOpen, IconUpload
} from '../../components/Icons';

export default function AdminClients() {
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'inactive'>('all');
    
    // Bulk Upload state
    const [showBulk, setShowBulk] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkResult, setBulkResult] = useState<any>(null);
    const [bulkError, setBulkError] = useState('');
    const [uploading, setUploading] = useState(false);

    // Form state
    const [name, setName] = useState('');
    const [status, setStatus] = useState<'active' | 'pending' | 'inactive'>('active');
    const [contacts, setContacts] = useState<ClientContact[]>([{ name: '', email: '', phone: '', designation: '' }]);

    useEffect(() => {
        fetchClients();
    }, []);

    const fetchClients = async () => {
        try {
            setLoading(true);
            const data = await adminListClients();
            setClients(data.clients);
        } catch (err) {
            console.error('Error fetching clients:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleBulkUpload = async () => {
        if (!bulkFile) return;
        try {
            setBulkError('');
            setUploading(true);
            const result = await adminBulkCreateClients(bulkFile);
            setBulkResult(result);
            await fetchClients();
        } catch (err: any) {
            setBulkError(err.message || 'Unknown error occurred during upload.');
        } finally {
            setUploading(false);
        }
    };

    const handleOpenModal = (client?: Client) => {
        if (client) {
            setEditingClient(client);
            setName(client.name);
            setStatus(client.status || 'active');
            setContacts(client.contacts.length > 0 ? [...client.contacts] : [{ name: '', email: '', phone: '', designation: '' }]);
        } else {
            setEditingClient(null);
            setName('');
            setStatus('active');
            setContacts([{ name: '', email: '', phone: '', designation: '' }]);
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingClient(null);
    };

    const addContactField = () => {
        setContacts([...contacts, { name: '', email: '', phone: '', designation: '' }]);
    };

    const updateContact = (index: number, field: keyof ClientContact, value: string) => {
        const newContacts = [...contacts];
        newContacts[index] = { ...newContacts[index], [field]: value };
        setContacts(newContacts);
    };

    const removeContact = (index: number) => {
        if (contacts.length === 1) return;
        setContacts(contacts.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        if (!name.trim()) return alert('Client name is required');
        const validContacts = contacts.filter(c => c.name.trim() && c.email.trim());
        if (validContacts.length === 0) return alert('At least one contact person with name and email is required');

        try {
            const payload = { name, contacts: validContacts, status };
            if (editingClient) {
                await adminUpdateClient(editingClient.id || editingClient._id!, payload);
            } else {
                await adminCreateClient(payload);
            }
            handleCloseModal();
            fetchClients();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this client? This will remove all associated contact information.')) return;
        try {
            await adminDeleteClient(id);
            fetchClients();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const filteredClients = clients.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.contacts.some(con => con.name.toLowerCase().includes(searchTerm.toLowerCase()) || con.email.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    const getInitials = (n: string) => n.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();

    return (
        <div className="admin-clients">
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Clients</h2>
                    <p className="page-subtitle">Manage client organizations and their key contact personnel</p>
                </div>
                <div className="page-header-right" style={{ display: 'flex', gap: '12px' }}>
                    <button className="btn btn-secondary btn-lg" onClick={() => { setShowBulk(true); setBulkResult(null); setBulkFile(null); setBulkError(''); }}>
                        <IconUpload /> Import Bulk
                    </button>
                    <button className="btn btn-primary btn-lg" onClick={() => handleOpenModal()}>
                        <IconPlus /> Add New Client
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="toolbar">
                <div className="toolbar-left">
                    <div className="search-container">
                        <span className="search-icon"><IconSearch /></span>
                        <input 
                            type="text" 
                            className="search-input" 
                            placeholder="Search by company or contact..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <IconFilter />
                        <select 
                            className="filter-select"
                            value={statusFilter}
                            onChange={(e: any) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">All Status</option>
                            <option value="active">Active</option>
                            <option value="pending">Pending</option>
                            <option value="inactive">Inactive</option>
                        </select>
                    </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    Showing <strong>{filteredClients.length}</strong> clients
                </div>
            </div>

            {/* Client Grid */}
            <div className="client-grid">
                {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="client-card skeleton" style={{ height: 280, opacity: 0.5 }}></div>
                    ))
                ) : filteredClients.map(client => (
                    <div key={client.id || client._id} className="client-card">
                        <div className="client-card-header">
                            <div className="client-title-wrapper">
                                <div className="client-icon-box">
                                    <IconBuilding />
                                </div>
                                <div>
                                    <div className="client-name" title={client.name}>{client.name}</div>
                                    <span className={`client-status-badge status-${client.status || 'active'}`}>
                                        {client.status || 'active'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="client-card-body">
                            <div className="contact-section-label">
                                <IconUsers /> Contact Persons
                            </div>
                            <div className="contact-list">
                                {client.contacts.slice(0, 2).map((contact, i) => (
                                    <div key={i} className="contact-card">
                                        <div className="contact-avatar">{getInitials(contact.name)}</div>
                                        <div className="contact-info">
                                            <div className="contact-name">{contact.name}</div>
                                            <div className="contact-detail">{contact.email}</div>
                                        </div>
                                    </div>
                                ))}
                                {client.contacts.length > 2 && (
                                    <div style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, paddingLeft: 8 }}>
                                        + {client.contacts.length - 2} more contacts
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="client-card-footer">
                            <button className="btn btn-ghost btn-sm" title="View Details">
                                <IconOpen />
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleOpenModal(client)}>
                                <IconEdit /> Edit
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(client.id || client._id!)}>
                                <IconTrash />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {filteredClients.length === 0 && !loading && (
                <div style={{ textAlign: 'center', padding: 100, background: 'var(--color-bg-card)', borderRadius: 12, border: '1px dashed var(--color-border)' }}>
                    <div style={{ opacity: 0.2, marginBottom: 16 }}><IconBuilding /></div>
                    <h3 style={{ color: 'var(--color-text-primary)' }}>No clients found</h3>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Try adjusting your search or filters</p>
                </div>
            )}

            {/* Improved Modal */}
            {isModalOpen && (
                <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: 700, borderRadius: 16 }}>
                        <div className="modal-header" style={{ padding: '20px 24px' }}>
                            <h3 className="modal-title">{editingClient ? 'Edit Client' : 'Create New Client'}</h3>
                            <button className="modal-close" onClick={handleCloseModal}><IconClose /></button>
                        </div>
                        <div className="modal-body" style={{ padding: '24px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 24 }}>
                                <div className="form-group">
                                    <label className="form-label required">Company Name</label>
                                    <input 
                                        type="text" 
                                        className="form-control" 
                                        value={name} 
                                        onChange={e => setName(e.target.value)} 
                                        placeholder="Enter company name"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Client Status</label>
                                    <select 
                                        className="form-control"
                                        value={status}
                                        onChange={(e: any) => setStatus(e.target.value)}
                                    >
                                        <option value="active">Active</option>
                                        <option value="pending">Pending</option>
                                        <option value="inactive">Inactive</option>
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                                <div className="contact-section-label" style={{ margin: 0 }}>
                                    <IconUsers /> Contact Personnel
                                </div>
                                <button className="btn btn-ghost btn-sm" onClick={addContactField} style={{ color: 'var(--color-primary)' }}>
                                    <IconPlus /> Add Another
                                </button>
                            </div>

                            <div style={{ maxHeight: '45vh', overflowY: 'auto', paddingRight: 8, display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {contacts.map((contact, index) => (
                                    <div key={index} style={{ 
                                        padding: 20, 
                                        background: 'var(--color-bg-page)', 
                                        borderRadius: 12, 
                                        border: '1px solid var(--color-border-light)',
                                        position: 'relative'
                                    }}>
                                        {contacts.length > 1 && (
                                            <button 
                                                onClick={() => removeContact(index)}
                                                style={{ position: 'absolute', top: 12, right: 12, background: '#fee2e2', border: 'none', color: '#dc2626', cursor: 'pointer', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            ><IconClose /></button>
                                        )}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label required">Full Name</label>
                                                <input 
                                                    type="text" 
                                                    className="form-control" 
                                                    value={contact.name}
                                                    placeholder="John Doe"
                                                    onChange={e => updateContact(index, 'name', e.target.value)}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label required">Email</label>
                                                <input 
                                                    type="email" 
                                                    className="form-control" 
                                                    value={contact.email}
                                                    placeholder="john@example.com"
                                                    onChange={e => updateContact(index, 'email', e.target.value)}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Phone</label>
                                                <input 
                                                    type="text" 
                                                    className="form-control" 
                                                    value={contact.phone}
                                                    placeholder="+1..."
                                                    onChange={e => updateContact(index, 'phone', e.target.value)}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Designation</label>
                                                <input 
                                                    type="text" 
                                                    className="form-control" 
                                                    value={contact.designation}
                                                    placeholder="Project Manager"
                                                    onChange={e => updateContact(index, 'designation', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="form-actions" style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--color-border-light)' }}>
                                <button className="btn btn-secondary btn-lg" onClick={handleCloseModal}>Cancel</button>
                                <button className="btn btn-primary btn-lg" onClick={handleSave} style={{ minWidth: 140 }}>
                                    {editingClient ? 'Update Client' : 'Create Client'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Bulk Upload Modal ── */}
            {showBulk && (
                <div className="modal-overlay" onClick={() => setShowBulk(false)}>
                    <div className="modal" style={{ maxWidth: 550 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Bulk Client Upload</span>
                            <button className="modal-close" onClick={() => setShowBulk(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            {bulkError && (
                                <div className="info-box danger mb-md" style={{ padding: '8px 12px', fontSize: 13 }}>
                                    <strong>Error:</strong> {bulkError}
                                </div>
                            )}
                            {!bulkResult ? (
                                <>
                                    <div className="info-box info mb-md">
                                        <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Required Excel Format</h4>
                                        <p style={{ margin: '0 0 12px 0', fontSize: 13, opacity: 0.9 }}>
                                            Please upload an Excel file (<code>.xlsx</code> or <code>.csv</code>) with headers in the first row:
                                        </p>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                                            <div>
                                                <strong>Required Columns:</strong>
                                                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                                                    <li><code>Client Name</code></li>
                                                    <li><code>Client Email</code></li>
                                                </ul>
                                            </div>
                                            <div>
                                                <strong>Optional Columns:</strong>
                                                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                                                    <li><code>Contact Name</code></li>
                                                    <li><code>Phone</code></li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Select Excel File</label>
                                        <input 
                                            type="file" 
                                            accept=".xlsx,.csv"
                                            className="form-control" 
                                            onChange={e => setBulkFile(e.target.files?.[0] || null)}
                                            style={{ padding: '8px' }}
                                        />
                                    </div>

                                    <div className="form-actions mt-lg">
                                        <button className="btn btn-secondary" onClick={() => setShowBulk(false)} disabled={uploading}>Cancel</button>
                                        <button 
                                            className="btn btn-primary" 
                                            onClick={handleBulkUpload} 
                                            disabled={uploading || !bulkFile}
                                        >
                                            {uploading ? 'Processing...' : 'Upload Clients'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div>
                                    <div className={`info-box ${bulkResult.createdCount > 0 ? 'success' : 'warning'} mb-md`}>
                                        <p style={{ fontWeight: 600, margin: 0 }}>{bulkResult.message}</p>
                                    </div>
                                    
                                    {bulkResult.errors && bulkResult.errors.length > 0 && (
                                        <div className="form-group">
                                            <label className="form-label">Issues / Errors:</label>
                                            <div style={{ 
                                                maxHeight: 200, 
                                                overflowY: 'auto', 
                                                background: '#f8fafc', 
                                                padding: '12px', 
                                                borderRadius: 6,
                                                fontSize: 12,
                                                border: '1px solid #e2e8f0',
                                                color: 'var(--color-danger)'
                                            }}>
                                                {bulkResult.errors.map((err: string, idx: number) => (
                                                    <div key={idx} style={{ marginBottom: 4 }}>• {err}</div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="form-actions mt-lg">
                                        <button className="btn btn-primary" onClick={() => setShowBulk(false)}>Close</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
