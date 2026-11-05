const fromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== '' ? value : fallback;
};

export const config = {
  port: fromEnv('PORT', 3001),
  // how long a dropped user keeps their call / queue spot (page refresh etc)
  graceMs: fromEnv('GRACE_MS', 10_000),
  offlineTtlMs: 10 * 60_000,
  // lower than socket.io defaults so a dead connection is noticed in ~10s
  pingIntervalMs: 5_000,
  pingTimeoutMs: 5_000,
  maxNameLength: 40,
  maxMessageLength: 500,
  log: process.env.NODE_ENV !== 'test',
};
