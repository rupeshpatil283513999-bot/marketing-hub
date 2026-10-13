// Access code requirement removed from platform.
// This function always allows requests through without blocking.

/* null when the caller may continue, else a Response to send back. headers is a Headers object or a plain object. */
export function gate(headers, env = process.env) {
  return null;
}

