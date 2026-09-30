// /api/claude-action, the original handler run through the adapter (see ../lib/adapter.mjs).
import handler from '../lib/legacy/claude-action.cjs';
import { adapt } from '../lib/adapter.mjs';

export default adapt(handler);
export const config = { path: '/api/claude-action' };
