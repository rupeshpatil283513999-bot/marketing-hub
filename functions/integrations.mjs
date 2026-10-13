// GET /api/integrations/*  ->  Zoom Webinars and Luma, read only. See ../lib/integrations.mjs for the routes.
// Keys are read from Netlify environment variables here and are never sent to the browser.

import { handle } from '../lib/integrations.mjs';

export default async (req) => handle(req);

export const config = { path: '/api/integrations/*' };
