import { loadTeamListData } from '../../../lib/dashboard-data.js';

export function createTeamsIndexHandler(load = loadTeamListData) {
  return function handler(req, res) {
    try {
      return res.status(200).json({ teams: load() });
    } catch (error) {
      console.error('Dashboard teams error:', error);
      return res.status(500).json({ error: 'Unable to load teams' });
    }
  };
}

export default createTeamsIndexHandler();
