const mongoose = require('mongoose');

const projectStatusSchema = new mongoose.Schema({
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
  total_drawings: { type: Number, default: 0 },
  fabrication_count: { type: Number, default: 0 },
  approval_count: { type: Number, default: 0 },
  hold_count: { type: Number, default: 0 },
  pending_count: { type: Number, default: 0 },
  failed_count: { type: Number, default: 0 },
  status: { type: String, default: 'Not Started' },
  last_updated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ProjectStatus', projectStatusSchema);
