const Team = require('../models/Team');

exports.createTeam = async (req, res) => {
    try {
        const { name, lead, members, project_manager, assistant_project_manager } = req.body;
        
        if (!name || !lead || (Array.isArray(lead) && lead.length === 0)) {
            return res.status(400).json({ error: 'Team name and at least one lead are required' });
        }

        const existingTeam = await Team.findOne({ name });
        if (existingTeam) {
            return res.status(400).json({ error: 'A team with this name already exists' });
        }

        const team = new Team({
            name,
            project_manager: project_manager || null,
            assistant_project_manager: assistant_project_manager || null,
            lead: Array.isArray(lead) ? lead : [lead],
            members: members || []
        });

        await team.save();
        
        // Populate for response
        await team.populate('project_manager', 'username email displayName role');
        await team.populate('assistant_project_manager', 'username email displayName role');
        await team.populate('lead', 'username email displayName role project_manager assistant_project_manager');
        await team.populate('members', 'username email displayName role');

        res.status(201).json(team);
    } catch (error) {
        console.error('Error creating team:', error);
        res.status(500).json({ error: 'Failed to create team: ' + String(error) });
    }
};

exports.getTeams = async (req, res) => {
    try {
        const teams = await Team.find()
            .populate('project_manager', 'username email displayName role')
            .populate('assistant_project_manager', 'username email displayName role')
            .populate('lead', 'username email displayName role project_manager assistant_project_manager')
            .populate('members', 'username email displayName role')
            .sort({ createdAt: -1 });
        res.json(teams);
    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ error: 'Failed to fetch teams: ' + String(error) });
    }
};

exports.deleteTeam = async (req, res) => {
    try {
        const { id } = req.params;
        const team = await Team.findByIdAndDelete(id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        res.json({ message: 'Team deleted successfully' });
    } catch (error) {
        console.error('Error deleting team:', error);
        res.status(500).json({ error: 'Failed to delete team: ' + String(error) });
    }
};

exports.updateTeam = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, lead, members, project_manager, assistant_project_manager } = req.body;

        if (!name || !lead || (Array.isArray(lead) && lead.length === 0)) {
            return res.status(400).json({ error: 'Team name and at least one lead are required' });
        }

        const existingTeam = await Team.findOne({ name, _id: { $ne: id } });
        if (existingTeam) {
            return res.status(400).json({ error: 'A team with this name already exists' });
        }

        const team = await Team.findById(id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        team.name = name;
        team.project_manager = project_manager || null;
        team.assistant_project_manager = assistant_project_manager || null;
        team.lead = Array.isArray(lead) ? lead : [lead];
        team.members = members || [];

        await team.save();

        await team.populate('project_manager', 'username email displayName role');
        await team.populate('assistant_project_manager', 'username email displayName role');
        await team.populate('lead', 'username email displayName role project_manager assistant_project_manager');
        await team.populate('members', 'username email displayName role');

        res.json(team);
    } catch (error) {
        console.error('Error updating team:', error);
        res.status(500).json({ error: 'Failed to update team: ' + String(error) });
    }
};
