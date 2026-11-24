ALTER TABLE work_iq_oauth_states
  ADD COLUMN repository_id bigint,
  DROP CONSTRAINT work_iq_oauth_states_verifier_secret_ref_fkey;

UPDATE work_iq_oauth_states s
SET repository_id = v.repository_id
FROM provider_credential_vault v
WHERE s.verifier_secret_ref = v.secret_id;

ALTER TABLE work_iq_oauth_states
  ALTER COLUMN repository_id SET NOT NULL,
  ADD CHECK (repository_id > 0);

DROP INDEX work_iq_oauth_states_expiry;
CREATE INDEX work_iq_oauth_states_expiry ON work_iq_oauth_states (repository_id, expires_at);
