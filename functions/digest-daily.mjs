// Runs by itself every day at 04:00 UTC (09:30 India, 08:00 Dubai).
// Netlify only runs scheduled functions on the published (production) version of the site.
// Change the time by editing the cron text below: minute hour day month weekday, in UTC.

import { runDigest } from '../lib/run.js';

export default async () => {
  const result = await runDigest({ dry: false });
  console.log('daily digest:', JSON.stringify(result));
};

export const config = { schedule: '0 4 * * *' };
