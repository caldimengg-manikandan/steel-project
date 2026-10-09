const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const { verifyToken, requireAdmin } = require('../middleware/auth');

router.use(verifyToken);
router.use(requireAdmin);

router.post('/', teamController.createTeam);
router.get('/', teamController.getTeams);
router.put('/:id', teamController.updateTeam);
router.delete('/:id', teamController.deleteTeam);

module.exports = router;
