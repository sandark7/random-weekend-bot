CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  event_name TEXT NOT NULL,
  user_id_hash TEXT,
  chat_id_hash TEXT,
  session_id TEXT NOT NULL,
  flow_id TEXT,
  app_version TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
  ON analytics_events(created_at);

CREATE INDEX IF NOT EXISTS idx_analytics_events_event_name
  ON analytics_events(event_name);

CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id
  ON analytics_events(session_id);

CREATE INDEX IF NOT EXISTS idx_analytics_events_flow_id
  ON analytics_events(flow_id);
