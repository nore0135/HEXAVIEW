CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK (email = lower(email)),
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE social_profiles (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,30}$'),
 display_name varchar(80) NOT NULL,
 bio varchar(500) NOT NULL DEFAULT '',
 avatar_url text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE published_ideas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title varchar(160) NOT NULL,
 body text NOT NULL CHECK (octet_length(body) <= 100000),
 symbol varchar(30) NOT NULL,
 chart_state jsonb NOT NULL CHECK (jsonb_typeof(chart_state) = 'object'),
 visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ideas_public_feed ON published_ideas(created_at DESC, id) WHERE visibility='public';
CREATE INDEX ideas_author ON published_ideas(author_id,created_at DESC);
CREATE TABLE chart_workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(80) NOT NULL,
 state jsonb NOT NULL CHECK (jsonb_typeof(state)='object' AND octet_length(state::text)<=100000),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspaces_owner ON chart_workspaces(user_id,updated_at DESC);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);
