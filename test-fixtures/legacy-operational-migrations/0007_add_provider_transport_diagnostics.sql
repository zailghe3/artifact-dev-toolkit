ALTER TABLE workflow_step_attempts ADD COLUMN provider_client_request_id TEXT;
ALTER TABLE workflow_step_attempts ADD COLUMN provider_request_id TEXT;
ALTER TABLE workflow_step_attempts ADD COLUMN provider_http_status INTEGER;
ALTER TABLE workflow_step_attempts ADD COLUMN provider_elapsed_ms INTEGER;
ALTER TABLE workflow_step_attempts ADD COLUMN provider_processing_ms INTEGER;
ALTER TABLE workflow_step_attempts ADD COLUMN provider_transport_outcome TEXT CHECK(provider_transport_outcome IN ('response_received','timeout','network_error'));
