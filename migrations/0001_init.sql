-- 登录日志表。同一次 Access 登录只记一条：JWT 的 iat（签发时间）在整个会话内稳定，
-- 与 user_uuid 组成唯一键，配合 INSERT OR IGNORE 实现幂等，避免每次请求都产生一条记录。
CREATE TABLE IF NOT EXISTS login_logs (
  id                TEXT PRIMARY KEY,
  user_uuid         TEXT NOT NULL,
  email             TEXT,
  name              TEXT,
  login_method      TEXT,
  login_method_key  TEXT,
  idp_type          TEXT,
  country           TEXT,
  city              TEXT,
  ip                TEXT,
  colo              TEXT,
  asn               TEXT,
  as_org            TEXT,
  user_agent        TEXT,
  auth_at           INTEGER NOT NULL DEFAULT 0,
  session_exp       INTEGER,
  aud               TEXT,
  groups_json       TEXT,
  identity_json     TEXT,
  dev_mode          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  UNIQUE (user_uuid, auth_at)
);

CREATE INDEX IF NOT EXISTS idx_login_logs_created ON login_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs (user_uuid, created_at DESC);
