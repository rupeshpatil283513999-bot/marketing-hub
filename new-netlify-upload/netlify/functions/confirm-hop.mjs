// /api/confirm-hop, the original handler run through the adapter (see ../lib/adapter.mjs).
import handler from '../lib/legacy/confirm-hop.cjs';
import { adapt } from '../lib/adapter.mjs';

export default adapt(handler);
export const config = { path: '/api/confirm-hop' };
