-- Scenario catalog, session index, AAR summaries and user-to-session links (impl. §7).
CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY, name TEXT, version TEXT, scale TEXT, r2_key TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, scenario_id TEXT, owner TEXT, profile TEXT, seed INTEGER,
  status TEXT, created_at INTEGER, ended_at INTEGER, archive_key TEXT, owner_name TEXT, parent TEXT
);
CREATE TABLE IF NOT EXISTS aar (session_id TEXT PRIMARY KEY, metrics_json TEXT, narrative_key TEXT, narrative_json TEXT);
CREATE TABLE IF NOT EXISTS members (session_id TEXT, user TEXT, view TEXT, PRIMARY KEY (session_id, user));
CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner, created_at);
CREATE INDEX IF NOT EXISTS sessions_created ON sessions(created_at);
-- Fallback archive store when no R2 bucket is bound: blobs split into chunks.
CREATE TABLE IF NOT EXISTS archive (key TEXT, chunk INTEGER, data BLOB, created_at INTEGER, PRIMARY KEY (key, chunk));
-- Monte Carlo batch summaries uploaded from browsers.
CREATE TABLE IF NOT EXISTS montecarlo (id TEXT PRIMARY KEY, scenario_id TEXT, seeds INTEGER, created_at INTEGER, summary_json TEXT, owner TEXT);
