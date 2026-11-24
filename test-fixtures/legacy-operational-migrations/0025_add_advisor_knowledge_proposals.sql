-- Operational proposals only. Approved knowledge remains authoritative in Git.
CREATE TABLE advisor_knowledge_proposals (
 id TEXT PRIMARY KEY,
 repository_scope TEXT NOT NULL,
 owner_id INTEGER NOT NULL,
 actor TEXT NOT NULL,
 document_json TEXT NOT NULL,
 expected_sha TEXT,
 revision INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL CHECK(state IN ('draft','reviewed','publishing','published','conflict','uncertain')),
 review_digest TEXT,
 review_session TEXT,
 review_expires_at INTEGER,
 publication_json TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX advisor_knowledge_proposals_scope ON advisor_knowledge_proposals(repository_scope,owner_id,updated_at);
