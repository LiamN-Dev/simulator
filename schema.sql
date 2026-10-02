CREATE TABLE IF NOT EXISTS subjects (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#6366f1',
  sort_order INT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS posts (
  id          SERIAL PRIMARY KEY,
  subject_id  INT  NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  link_type   TEXT NOT NULL DEFAULT 'link',
  unit        TEXT,
  description TEXT,
  due_date    DATE,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS posts_subject_idx ON posts(subject_id);
CREATE INDEX IF NOT EXISTS posts_due_idx ON posts(due_date);

CREATE TABLE IF NOT EXISTS requests (
  id          SERIAL PRIMARY KEY,
  subject_id  INT REFERENCES subjects(id) ON DELETE SET NULL,
  text        TEXT NOT NULL,
  date_needed DATE,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fulfilled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subjects (name, slug, color, sort_order) VALUES
  ('Chemistry', 'chemistry', '#10b981', 1),
  ('English',   'english',   '#6366f1', 2),
  ('History',   'history',   '#f59e0b', 3),
  ('Math',      'math',      '#ef4444', 4)
ON CONFLICT (slug) DO NOTHING;
