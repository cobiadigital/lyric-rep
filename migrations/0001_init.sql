-- One row per lyric idea: a line, a fragment, or a whole section.
-- id is generated on the client so offline saves can be retried safely.
CREATE TABLE IF NOT EXISTS lyrics (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lyrics_created ON lyrics(created_at);
