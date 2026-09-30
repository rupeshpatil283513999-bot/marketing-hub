// /api/follow-up-cron, the original handler run through the adapter (see ../lib/adapter.mjs).
import handler from '../lib/legacy/follow-up-cron.cjs';
import { adapt } from '../lib/adapter.mjs';

export default adapt(handler);
export const config = { path: '/api/follow-up-cron' };
