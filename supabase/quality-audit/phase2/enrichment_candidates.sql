-- Industry research enrichment — candidate queue (never auto-overwrites core.model)
-- Apply approved rows only via scripts/apply-enrichment-approvals.py

SELECT core.assert_dev_branch();

CREATE TABLE IF NOT EXISTS core.enrichment_candidates (
  candidate_id text PRIMARY KEY,
  machine_id text NOT NULL REFERENCES core.model(machine_id) ON DELETE CASCADE,
  field_name text NOT NULL,
  current_value text,
  proposed_value text NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN (
      'oem',
      'dealer',
      'brochure',
      'track_finder',
      'intelligent_fitment',
      'manual_review'
    )
  ),
  source_url text,
  source_priority int NOT NULL CHECK (source_priority BETWEEN 1 AND 5),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_text text,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'conflict', 'superseded')
  ),
  reviewed_by text,
  reviewed_at timestamptz,
  batch_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machine_id, field_name, proposed_value, source_type, source_url)
);

CREATE INDEX IF NOT EXISTS idx_enrichment_candidates_machine
  ON core.enrichment_candidates(machine_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_candidates_status
  ON core.enrichment_candidates(status);
CREATE INDEX IF NOT EXISTS idx_enrichment_candidates_batch
  ON core.enrichment_candidates(batch_id);

CREATE OR REPLACE VIEW public.fleet_enrichment_candidates AS
SELECT
  ec.candidate_id,
  ec.machine_id,
  c.shopify_handle,
  c.brand,
  c.model,
  ec.field_name,
  ec.current_value,
  ec.proposed_value,
  ec.source_type,
  ec.source_url,
  ec.source_priority,
  ec.confidence,
  ec.evidence_text,
  ec.status,
  ec.reviewed_by,
  ec.reviewed_at,
  ec.batch_id,
  ec.created_at
FROM core.enrichment_candidates ec
JOIN public.fleet_machine_catalog c ON c.machine_id = ec.machine_id
ORDER BY ec.source_priority, ec.confidence DESC, c.brand, c.model;

GRANT SELECT ON public.fleet_enrichment_candidates TO anon, authenticated;
