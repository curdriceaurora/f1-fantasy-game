import { loadRaceDetail } from '../../../lib/dashboard-data.js';

export default function handler(req, res) {
  try {
    const { raceId } = req.query;
    const race = loadRaceDetail(raceId);
    if (!race) {
      return res.status(404).json({ error: 'Race not found' });
    }
    return res.status(200).json(race);
  } catch (error) {
    console.error('Dashboard race detail error:', error);
    return res.status(500).json({ error: 'Unable to load race detail' });
  }
}
