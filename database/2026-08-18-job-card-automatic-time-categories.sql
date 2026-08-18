BEGIN;

ALTER TABLE atec.tbljobcard
  ADD COLUMN IF NOT EXISTS double_time_hours numeric(8,2),
  ADD COLUMN IF NOT EXISTS travel_hours numeric(8,2);

-- Official 2026 South African public holidays published by gov.za.
INSERT INTO atec.tblpublicholiday (holiday_date, holiday_name, active) VALUES
  ('2026-01-01', 'New Year''s Day', true),
  ('2026-03-21', 'Human Rights Day', true),
  ('2026-04-03', 'Good Friday', true),
  ('2026-04-06', 'Family Day', true),
  ('2026-04-27', 'Freedom Day', true),
  ('2026-05-01', 'Workers'' Day', true),
  ('2026-06-16', 'Youth Day', true),
  ('2026-08-09', 'National Women''s Day', true),
  ('2026-08-10', 'National Women''s Day observed', true),
  ('2026-09-24', 'Heritage Day', true),
  ('2026-12-16', 'Day of Reconciliation', true),
  ('2026-12-25', 'Christmas Day', true),
  ('2026-12-26', 'Day of Goodwill', true)
ON CONFLICT (holiday_date) DO UPDATE
SET holiday_name = EXCLUDED.holiday_name,
    active = EXCLUDED.active;

COMMIT;
