# Marketing Management Hub — design copy

This folder has exactly one working file: `index.html`. It's the whole app, self-contained: no `npm install`, no terminal commands, no server, no ports.

## To just look at it

Double-click `index.html`. It opens in your browser and works immediately.

## To open it in Antigravity and have it improve the design

Open this folder in Antigravity. Tell it to edit `index.html` directly, for example: "make the Dashboard's KPI cards bigger" or "add a Campaigns screen using the same visual style already in this file." It can preview changes by opening `index.html` in a browser after each edit, no build step, no dev server.

Everything (markup, styles, and the React app) lives inside this one file, loaded through a few `<script>` tags pointing at React, ReactDOM, and Babel on a CDN, so the browser does the work with no install step at all. That's also why it's not meant to be the final shipped product long-term; once the design is where you want it, a proper Vite project (like the one I sent you before) is the right next step for adding a real backend and multi-user hosting. But for getting the design itself right, this is the simplest possible thing to iterate on.
