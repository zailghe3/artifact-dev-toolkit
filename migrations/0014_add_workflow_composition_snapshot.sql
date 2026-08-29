-- Phase 15 freezes reusable Workflow definitions, revisions, and authored-path provenance.
ALTER TABLE workflow_runs ADD COLUMN composition_snapshot_json TEXT;
