// /api/send-mail, the original handler run through the adapter (see ../lib/adapter.mjs). Needs the hub access code.
import handler from '../lib/legacy/send-mail.cjs';
import { adapt } from '../lib/adapter.mjs';

export default adapt(handler, { gate: true });
export const config = { path: '/api/send-mail' };
