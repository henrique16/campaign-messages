-- campaign-messages procedures. MySQL 8, InnoDB. Safe to run more than once.
-- Every procedure except webhook_open / webhook_apply owns its transaction.
-- webhook_open / webhook_apply run inside the adapter's transaction.
-- Locking reads use "FOR UPDATE OF <alias>" so lookup-table rows are never locked.

DELIMITER $$

-- Result: one row (campaign_id).
DROP PROCEDURE IF EXISTS create_campaign_with_messages$$
CREATE PROCEDURE create_campaign_with_messages(
  IN p_template TEXT,
  IN p_contacts JSON
)
BEGIN
  DECLARE v_campaign_id BIGINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  INSERT INTO campaigns (template, status_id)
  SELECT p_template, cs.id
  FROM campaign_statuses cs
  WHERE cs.code = 'draft';

  SET v_campaign_id = LAST_INSERT_ID();

  INSERT INTO messages (campaign_id, phone, body, status_id, attempt_count, next_attempt_at)
  SELECT v_campaign_id, jt.phone, jt.body, ms.id, 0, UTC_TIMESTAMP(3)
  FROM JSON_TABLE(
         p_contacts,
         '$[*]' COLUMNS (
           phone VARCHAR(15) PATH '$.phone',
           body  TEXT        PATH '$.body'
         )
       ) AS jt
  JOIN message_statuses ms ON ms.code = 'queued';

  COMMIT;

  SELECT v_campaign_id AS campaign_id;
END$$

-- Result: zero rows when the campaign does not exist, else one row
-- (id, status, queued, sent, delivered, read, failed).
DROP PROCEDURE IF EXISTS get_campaign_summary$$
CREATE PROCEDURE get_campaign_summary(
  IN p_campaign_id BIGINT
)
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT
    c.id AS id,
    cs.code AS status,
    CAST(COUNT(CASE WHEN ms.code = 'queued'    THEN 1 END) AS SIGNED) AS queued,
    CAST(COUNT(CASE WHEN ms.code = 'sent'      THEN 1 END) AS SIGNED) AS sent,
    CAST(COUNT(CASE WHEN ms.code = 'delivered' THEN 1 END) AS SIGNED) AS delivered,
    CAST(COUNT(CASE WHEN ms.code = 'read'      THEN 1 END) AS SIGNED) AS `read`,
    CAST(COUNT(CASE WHEN ms.code = 'failed'    THEN 1 END) AS SIGNED) AS failed
  FROM campaigns c
  JOIN campaign_statuses cs ON cs.id = c.status_id
  LEFT JOIN messages m ON m.campaign_id = c.id
  LEFT JOIN message_statuses ms ON ms.id = m.status_id
  WHERE c.id = p_campaign_id
  GROUP BY c.id, cs.code;

  COMMIT;
END$$

-- Result set 1: one row (found, total). Result set 2: (phone, reason) for the page.
DROP PROCEDURE IF EXISTS list_campaign_failures$$
CREATE PROCEDURE list_campaign_failures(
  IN p_campaign_id BIGINT,
  IN p_page INT,
  IN p_page_size INT
)
BEGIN
  DECLARE v_found TINYINT DEFAULT 0;
  DECLARE v_total INT DEFAULT 0;
  DECLARE v_limit BIGINT DEFAULT 0;
  DECLARE v_offset BIGINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET v_limit = GREATEST(p_page_size, 0);
  SET v_offset = GREATEST(p_page - 1, 0) * v_limit;

  START TRANSACTION;

  SELECT COUNT(*) INTO v_found FROM campaigns WHERE id = p_campaign_id;

  IF v_found > 0 THEN
    SELECT COUNT(*) INTO v_total
    FROM messages m
    JOIN message_statuses ms ON ms.id = m.status_id
    WHERE m.campaign_id = p_campaign_id AND ms.code = 'failed';
  END IF;

  SELECT v_found AS found, v_total AS total;

  SELECT m.phone AS phone, mf.reason AS reason
  FROM messages m
  JOIN message_statuses ms ON ms.id = m.status_id
  JOIN message_failures mf ON mf.message_id = m.id
  WHERE m.campaign_id = p_campaign_id AND ms.code = 'failed'
  ORDER BY m.id ASC
  LIMIT v_limit OFFSET v_offset;

  COMMIT;
END$$

-- Result: one row (outcome: started | not_found | unchanged, status: code after the call, '' when not found).
DROP PROCEDURE IF EXISTS mark_running_if_draft$$
CREATE PROCEDURE mark_running_if_draft(
  IN p_campaign_id BIGINT
)
BEGIN
  DECLARE v_found TINYINT DEFAULT 1;
  DECLARE v_code VARCHAR(32) DEFAULT '';
  DECLARE v_outcome VARCHAR(16) DEFAULT 'not_found';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT cs.code INTO v_code
  FROM campaigns c
  JOIN campaign_statuses cs ON cs.id = c.status_id
  WHERE c.id = p_campaign_id
  FOR UPDATE OF c;

  IF v_found = 1 THEN
    IF v_code = 'draft' THEN
      UPDATE campaigns
      SET status_id = (SELECT id FROM campaign_statuses WHERE code = 'running')
      WHERE id = p_campaign_id;
      SET v_code = 'running';
      SET v_outcome = 'started';
    ELSE
      SET v_outcome = 'unchanged';
    END IF;
  END IF;

  COMMIT;

  SELECT v_outcome AS outcome, v_code AS status;
END$$

-- Result: none.
DROP PROCEDURE IF EXISTS mark_finished$$
CREATE PROCEDURE mark_finished(
  IN p_campaign_id BIGINT
)
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  UPDATE campaigns
  SET status_id = (SELECT id FROM campaign_statuses WHERE code = 'finished')
  WHERE id = p_campaign_id
    AND status_id = (SELECT id FROM campaign_statuses WHERE code = 'running');

  COMMIT;
END$$

-- Result: zero or more rows (message_id, campaign_id, phone, body, attempt_count), ordered by message id.
DROP PROCEDURE IF EXISTS claim_due$$
CREATE PROCEDURE claim_due(
  IN p_now DATETIME(3),
  IN p_stale_before DATETIME(3),
  IN p_limit INT
)
main: BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  IF p_limit <= 0 THEN
    SELECT m.id AS message_id, m.campaign_id AS campaign_id, m.phone AS phone,
           m.body AS body, m.attempt_count AS attempt_count
    FROM messages m
    WHERE 1 = 0;
    LEAVE main;
  END IF;

  START TRANSACTION;

  DROP TEMPORARY TABLE IF EXISTS claim_due_picked;
  CREATE TEMPORARY TABLE claim_due_picked (
    message_id BIGINT NOT NULL,
    PRIMARY KEY (message_id)
  ) ENGINE=InnoDB;

  INSERT INTO claim_due_picked (message_id)
  SELECT m.id
  FROM messages m
  JOIN message_statuses ms ON ms.id = m.status_id
  JOIN campaigns c ON c.id = m.campaign_id
  JOIN campaign_statuses cs ON cs.id = c.status_id
  LEFT JOIN message_claims mc ON mc.message_id = m.id
  WHERE ms.code = 'queued'
    AND cs.code = 'running'
    AND m.next_attempt_at <= p_now
    AND (mc.id IS NULL OR mc.claimed_at < p_stale_before)
  ORDER BY m.id
  LIMIT p_limit
  FOR UPDATE OF m SKIP LOCKED;

  DELETE mc
  FROM message_claims mc
  JOIN claim_due_picked p ON p.message_id = mc.message_id;

  INSERT INTO message_claims (message_id, claimed_at)
  SELECT p.message_id, p_now
  FROM claim_due_picked p;

  SELECT m.id AS message_id, m.campaign_id AS campaign_id, m.phone AS phone,
         m.body AS body, m.attempt_count AS attempt_count
  FROM messages m
  JOIN claim_due_picked p ON p.message_id = m.id
  ORDER BY m.id;

  DROP TEMPORARY TABLE IF EXISTS claim_due_picked;

  COMMIT;
END main$$

-- Result: none. No-op unless the message is currently queued.
DROP PROCEDURE IF EXISTS record_sent$$
CREATE PROCEDURE record_sent(
  IN p_message_id BIGINT,
  IN p_provider_message_id VARCHAR(191)
)
BEGIN
  DECLARE v_found TINYINT DEFAULT 1;
  DECLARE v_locked_id BIGINT DEFAULT 0;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT m.id INTO v_locked_id
  FROM messages m
  JOIN message_statuses ms ON ms.id = m.status_id
  WHERE m.id = p_message_id AND ms.code = 'queued'
  FOR UPDATE OF m;

  IF v_found = 1 THEN
    UPDATE messages
    SET status_id = (SELECT id FROM message_statuses WHERE code = 'sent')
    WHERE id = p_message_id;

    INSERT INTO message_provider_ids (message_id, provider_message_id)
    VALUES (p_message_id, p_provider_message_id);

    DELETE FROM message_claims WHERE message_id = p_message_id;
  END IF;

  COMMIT;
END$$

-- Result: none. No-op unless the message is currently queued; status stays queued.
DROP PROCEDURE IF EXISTS record_retry$$
CREATE PROCEDURE record_retry(
  IN p_message_id BIGINT,
  IN p_attempt_count INT,
  IN p_next_attempt_at DATETIME(3)
)
BEGIN
  DECLARE v_found TINYINT DEFAULT 1;
  DECLARE v_locked_id BIGINT DEFAULT 0;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT m.id INTO v_locked_id
  FROM messages m
  JOIN message_statuses ms ON ms.id = m.status_id
  WHERE m.id = p_message_id AND ms.code = 'queued'
  FOR UPDATE OF m;

  IF v_found = 1 THEN
    UPDATE messages
    SET attempt_count = p_attempt_count,
        next_attempt_at = p_next_attempt_at
    WHERE id = p_message_id;

    DELETE FROM message_claims WHERE message_id = p_message_id;
  END IF;

  COMMIT;
END$$

-- Result: none. No-op unless the message is currently queued.
DROP PROCEDURE IF EXISTS record_failed$$
CREATE PROCEDURE record_failed(
  IN p_message_id BIGINT,
  IN p_reason VARCHAR(255)
)
BEGIN
  DECLARE v_found TINYINT DEFAULT 1;
  DECLARE v_locked_id BIGINT DEFAULT 0;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT m.id INTO v_locked_id
  FROM messages m
  JOIN message_statuses ms ON ms.id = m.status_id
  WHERE m.id = p_message_id AND ms.code = 'queued'
  FOR UPDATE OF m;

  IF v_found = 1 THEN
    UPDATE messages
    SET status_id = (SELECT id FROM message_statuses WHERE code = 'failed')
    WHERE id = p_message_id;

    INSERT INTO message_failures (message_id, reason)
    VALUES (p_message_id, p_reason);

    DELETE FROM message_claims WHERE message_id = p_message_id;
  END IF;

  COMMIT;
END$$

-- Result: one row (outcome: duplicate | unknown | open, message_id, current_status).
-- No transaction control: the caller's transaction keeps the row lock taken here.
DROP PROCEDURE IF EXISTS webhook_open$$
CREATE PROCEDURE webhook_open(
  IN p_event_id VARCHAR(191),
  IN p_provider_message_id VARCHAR(191)
)
BEGIN
  DECLARE v_found TINYINT DEFAULT 1;
  DECLARE v_event_count INT DEFAULT 0;
  DECLARE v_message_id BIGINT DEFAULT 0;
  DECLARE v_status VARCHAR(32) DEFAULT '';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = 0;

  SELECT COUNT(*) INTO v_event_count FROM webhook_events WHERE event_id = p_event_id;

  IF v_event_count > 0 THEN
    SELECT 'duplicate' AS outcome, CAST(0 AS SIGNED) AS message_id, '' AS current_status;
  ELSE
    SELECT mp.message_id INTO v_message_id
    FROM message_provider_ids mp
    WHERE mp.provider_message_id = p_provider_message_id;

    IF v_found = 0 THEN
      SELECT 'unknown' AS outcome, CAST(0 AS SIGNED) AS message_id, '' AS current_status;
    ELSE
      SELECT m.id, ms.code INTO v_message_id, v_status
      FROM messages m
      JOIN message_statuses ms ON ms.id = m.status_id
      WHERE m.id = v_message_id
      FOR UPDATE OF m;

      SELECT 'open' AS outcome, v_message_id AS message_id, v_status AS current_status;
    END IF;
  END IF;
END$$

-- Result: one row (outcome: applied | duplicate).
-- No transaction control: runs inside the caller's transaction.
-- p_action 'ignore' only records the event; 'apply' also sets p_next_status
-- (delivered | read | failed; failed also stores p_reason).
DROP PROCEDURE IF EXISTS webhook_apply$$
CREATE PROCEDURE webhook_apply(
  IN p_message_id BIGINT,
  IN p_event_id VARCHAR(191),
  IN p_action VARCHAR(16),
  IN p_next_status VARCHAR(32),
  IN p_reason VARCHAR(255)
)
main: BEGIN
  DECLARE v_duplicate TINYINT DEFAULT 0;

  IF NOT (p_action = 'ignore'
          OR (p_action = 'apply' AND p_next_status IN ('delivered', 'read', 'failed'))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'webhook_apply: invalid action or next status';
  END IF;

  BEGIN
    DECLARE CONTINUE HANDLER FOR 1062 SET v_duplicate = 1;
    INSERT INTO webhook_events (event_id, message_id) VALUES (p_event_id, p_message_id);
  END;

  IF v_duplicate = 1 THEN
    SELECT 'duplicate' AS outcome;
    LEAVE main;
  END IF;

  IF p_action = 'apply' THEN
    UPDATE messages
    SET status_id = (SELECT id FROM message_statuses WHERE code = p_next_status)
    WHERE id = p_message_id;

    IF p_next_status = 'failed' THEN
      INSERT INTO message_failures (message_id, reason) VALUES (p_message_id, p_reason);
    END IF;
  END IF;

  SELECT 'applied' AS outcome;
END main$$

DELIMITER ;
