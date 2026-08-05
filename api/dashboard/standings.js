import { loadStandingsData } from '../../lib/dashboard-data.js';

export function createStandingsHandler(load = loadStandingsData) {
  return function handler(req, res) {
    try {
      return res.status(200).json(load());
    } catch (error) {
      console.error('Dashboard standings error:', error);
      return res.status(500).json({ error: 'Unable to load standings' });
    }
  };
}

export default createStandingsHandler();
