import { loadTeamListData } from '../../../lib/dashboard-data.js';

export default function handler(req, res) {
  try {
    return res.status(200).json({ teams: loadTeamListData() });
  } catch (error) {
    console.error('Dashboard teams error:', error);
    return res.status(500).json({ error: 'Unable to load teams' });
  }
}
