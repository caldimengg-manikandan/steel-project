const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const { verifyToken, requireAdmin } = require('../middleware/auth');

router.use(verifyToken);

// All authenticated users can read teams list (needed for project allocations and assignments)
router.get('/', teamController.getTeams);

// Mutating operations require admin / manager access
router.use(requireAdmin);

router.post('/', teamController.createTeam);
router.put('/:id', teamController.updateTeam);
router.delete('/:id', teamController.deleteTeam);

module.exports = router;
