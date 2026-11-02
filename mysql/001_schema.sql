-- campaign-messages schema. MySQL 8, InnoDB, utf8mb4. Safe to run more than once.
--
-- Uniqueness constraints (documented per table):
--   campaign_statuses     UNIQUE (code)
--   message_statuses      UNIQUE (code)
--   messages              UNIQUE (campaign_id, phone)
--   message_provider_ids  UNIQUE (message_id), UNIQUE (provider_message_id)
--   message_failures      UNIQUE (message_id)
--   message_claims        UNIQUE (message_id)
--   webhook_events        UNIQUE (event_id)

CREATE TABLE IF NOT EXISTS campaign_statuses (
  id   BIGINT AUTO_INCREMENT NOT NULL,
  code VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_statuses_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS message_statuses (
  id   BIGINT AUTO_INCREMENT NOT NULL,
  code VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_message_statuses_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO campaign_statuses (code) VALUES
  ('draft'),
  ('running'),
  ('finished');

INSERT IGNORE INTO message_statuses (code) VALUES
  ('queued'),
  ('sent'),
  ('delivered'),
  ('read'),
  ('failed');

CREATE TABLE IF NOT EXISTS campaigns (
  id        BIGINT AUTO_INCREMENT NOT NULL,
  template  TEXT NOT NULL,
  status_id BIGINT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_campaigns_status
    FOREIGN KEY (status_id) REFERENCES campaign_statuses (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT AUTO_INCREMENT NOT NULL,
  campaign_id     BIGINT NOT NULL,
  phone           VARCHAR(15) NOT NULL,
  body            TEXT NOT NULL,
  status_id       BIGINT NOT NULL,
  attempt_count   INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_messages_campaign_phone (campaign_id, phone),
  KEY ix_messages_status_next_attempt (status_id, next_attempt_at),
  CONSTRAINT fk_messages_campaign
    FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE RESTRICT,
  CONSTRAINT fk_messages_status
    FOREIGN KEY (status_id) REFERENCES message_statuses (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS message_provider_ids (
  id                  BIGINT AUTO_INCREMENT NOT NULL,
  message_id          BIGINT NOT NULL,
  provider_message_id VARCHAR(191) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_message_provider_ids_message (message_id),
  UNIQUE KEY uq_message_provider_ids_provider (provider_message_id),
  CONSTRAINT fk_message_provider_ids_message
    FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS message_failures (
  id         BIGINT AUTO_INCREMENT NOT NULL,
  message_id BIGINT NOT NULL,
  reason     VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_message_failures_message (message_id),
  CONSTRAINT fk_message_failures_message
    FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS message_claims (
  id         BIGINT AUTO_INCREMENT NOT NULL,
  message_id BIGINT NOT NULL,
  claimed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_message_claims_message (message_id),
  CONSTRAINT fk_message_claims_message
    FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webhook_events (
  id         BIGINT AUTO_INCREMENT NOT NULL,
  event_id   VARCHAR(191) NOT NULL,
  message_id BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_webhook_events_event (event_id),
  CONSTRAINT fk_webhook_events_message
    FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
