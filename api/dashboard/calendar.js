import { loadCalendarScheduleData } from '../../lib/dashboard-data.js';

export default function handler(req, res) {
  try {
    return res.status(200).json(loadCalendarScheduleData());
  } catch (error) {
    console.error('Dashboard calendar error:', error);
    return res.status(500).json({ error: 'Unable to load calendar' });
  }
}
