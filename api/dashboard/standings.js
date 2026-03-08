import { loadStandingsData } from '../../lib/dashboard-data.js';

export default function handler(req, res) {
  try {
    return res.status(200).json(loadStandingsData());
  } catch (error) {
    console.error('Dashboard standings error:', error);
    return res.status(500).json({ error: 'Unable to load standings' });
  }
}
