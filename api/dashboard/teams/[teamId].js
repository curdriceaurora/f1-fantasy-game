import { loadTeamDetail } from '../../../lib/dashboard-data.js';

export default function handler(req, res) {
  try {
    const { teamId } = req.query;
    const team = loadTeamDetail(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    return res.status(200).json(team);
  } catch (error) {
    console.error('Dashboard team detail error:', error);
    return res.status(500).json({ error: 'Unable to load team detail' });
  }
}
