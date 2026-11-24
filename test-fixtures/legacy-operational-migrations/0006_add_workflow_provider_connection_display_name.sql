ALTER TABLE workflow_provider_connections ADD COLUMN display_name TEXT;
UPDATE workflow_provider_connections
SET display_name = CASE WHEN connection_key = 'openai-primary' THEN 'OpenAI Responses' ELSE connection_key END
WHERE display_name IS NULL OR trim(display_name) = '';
