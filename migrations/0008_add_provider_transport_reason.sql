ALTER TABLE workflow_step_attempts ADD COLUMN provider_transport_reason TEXT CHECK(provider_transport_reason IN ('cross_request_io','invalid_request_context','network_connection_lost','aborted','fetch_type_error','unknown'));
ALTER TABLE workflow_step_attempts ADD COLUMN provider_runtime_error_name TEXT CHECK(provider_runtime_error_name IN ('TypeError','AbortError','Error'));
