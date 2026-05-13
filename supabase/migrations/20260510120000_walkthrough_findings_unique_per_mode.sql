-- Step 3.4.5: one walkthrough_findings row per (deal_id, user_id, mode).
-- Assumes public.walkthrough_findings exists with deal_id, user_id, mode, created_at, frame_storage_paths.
-- frame_storage_paths is treated as jsonb (JSON array of storage path strings). If your column is text[],
-- convert before running: ALTER TABLE public.walkthrough_findings
--   ALTER COLUMN frame_storage_paths TYPE jsonb USING to_jsonb(frame_storage_paths);

-- ─── 1) Merge duplicate groups (same deal_id, user_id, mode) into keeper row, then delete extras ───
WITH dups AS (
  SELECT deal_id, user_id, mode
  FROM public.walkthrough_findings
  GROUP BY deal_id, user_id, mode
  HAVING COUNT(*) > 1
),
members AS (
  SELECT w.*
  FROM public.walkthrough_findings w
  INNER JOIN dups d
    ON w.deal_id = d.deal_id
   AND w.user_id = d.user_id
   AND w.mode = d.mode
),
elems AS (
  SELECT
    m.id,
    m.deal_id,
    m.user_id,
    m.mode,
    m.created_at AS row_created,
    elem.value AS path_val,
    elem.ordinality AS path_ord
  FROM members m
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(m.frame_storage_paths, '[]'::jsonb))
    WITH ORDINALITY AS elem(value, ordinality)
),
merged AS (
  SELECT
    deal_id,
    user_id,
    mode,
    COALESCE(
      jsonb_agg(path_val ORDER BY row_created, path_ord) FILTER (WHERE path_val IS NOT NULL AND path_val <> ''),
      '[]'::jsonb
    ) AS merged_paths
  FROM elems
  GROUP BY deal_id, user_id, mode
),
keepers AS (
  SELECT DISTINCT ON (m.deal_id, m.user_id, m.mode)
    m.id,
    m.deal_id,
    m.user_id,
    m.mode
  FROM members m
  ORDER BY m.deal_id, m.user_id, m.mode, m.created_at DESC
)
UPDATE public.walkthrough_findings wf
SET frame_storage_paths = mg.merged_paths
FROM merged mg
INNER JOIN keepers k
  ON k.deal_id = mg.deal_id
 AND k.user_id = mg.user_id
 AND k.mode = mg.mode
WHERE wf.id = k.id;

WITH dups AS (
  SELECT deal_id, user_id, mode
  FROM public.walkthrough_findings
  GROUP BY deal_id, user_id, mode
  HAVING COUNT(*) > 1
),
keepers AS (
  SELECT DISTINCT ON (w.deal_id, w.user_id, w.mode)
    w.id
  FROM public.walkthrough_findings w
  INNER JOIN dups d
    ON w.deal_id = d.deal_id
   AND w.user_id = d.user_id
   AND w.mode = d.mode
  ORDER BY w.deal_id, w.user_id, w.mode, w.created_at DESC
)
DELETE FROM public.walkthrough_findings w
USING dups d
WHERE w.deal_id = d.deal_id
  AND w.user_id = d.user_id
  AND w.mode = d.mode
  AND w.id NOT IN (SELECT id FROM keepers);

-- ─── 2) updated_at column (idempotent) ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'walkthrough_findings'
      AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.walkthrough_findings
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- Backfill if column existed but was nullable (defensive)
UPDATE public.walkthrough_findings
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

-- ─── 3) Trigger: bump updated_at on UPDATE ───
CREATE OR REPLACE FUNCTION public.set_walkthrough_findings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS on_walkthrough_findings_updated_set_timestamp ON public.walkthrough_findings;

CREATE TRIGGER on_walkthrough_findings_updated_set_timestamp
  BEFORE UPDATE ON public.walkthrough_findings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_walkthrough_findings_updated_at();

-- ─── 4) UNIQUE (deal_id, user_id, mode) ───
CREATE UNIQUE INDEX IF NOT EXISTS walkthrough_findings_deal_user_mode_uidx
  ON public.walkthrough_findings (deal_id, user_id, mode);
