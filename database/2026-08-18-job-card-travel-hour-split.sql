BEGIN;

ALTER TABLE atec.tbljobcard
  ADD COLUMN IF NOT EXISTS normal_travel_hours numeric(8,2),
  ADD COLUMN IF NOT EXISTS overtime_travel_hours numeric(8,2);

COMMIT;
