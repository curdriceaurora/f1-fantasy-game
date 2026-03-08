// API endpoint to get the current site mode
import { getSiteMode } from '../lib/site-config.js';

export default function handler(req, res) {
  const mode = getSiteMode();

  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).json({
    mode,
    isPreseason: mode === 'preseason',
    isSeason: mode === 'season',
  });
}
