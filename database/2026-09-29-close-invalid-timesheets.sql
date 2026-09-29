BEGIN;
ALTER TABLE atec.tbldailytimesheet
  ADD COLUMN IF NOT EXISTS closed_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by_user_id integer REFERENCES atec.tblusers(userid);
ALTER TABLE atec.tbldailytimesheet DROP CONSTRAINT IF EXISTS chk_tbldailytimesheet_status;
ALTER TABLE atec.tbldailytimesheet ADD CONSTRAINT chk_tbldailytimesheet_status
  CHECK (status IN ('DRAFT','AWAITING_EMPLOYEE','EMPLOYEE_SUBMITTED','MANAGER_APPROVED','HR_ACCEPTED','EXPORTED','RETURNED','CLOSED_INVALID'));

-- Retain the closed record and prevent stale clients or timeline imports from reopening it.
CREATE OR REPLACE FUNCTION atec.protect_invalid_timesheet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CLOSED_INVALID' THEN
    RAISE EXCEPTION 'This timesheet is closed as invalid and is read-only.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_invalid_timesheet ON atec.tbldailytimesheet;
CREATE TRIGGER protect_invalid_timesheet BEFORE UPDATE OR DELETE ON atec.tbldailytimesheet
  FOR EACH ROW EXECUTE FUNCTION atec.protect_invalid_timesheet();

CREATE OR REPLACE FUNCTION atec.protect_invalid_timeentry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sheet_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status INTO sheet_status FROM atec.tbldailytimesheet
      WHERE user_id=OLD.user_id AND timesheet_date=OLD.activity_date FOR UPDATE;
    IF sheet_status='CLOSED_INVALID' THEN
      RAISE EXCEPTION 'Time entries for a timesheet closed as invalid are read-only.';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO sheet_status FROM atec.tbldailytimesheet
      WHERE user_id=NEW.user_id AND timesheet_date=NEW.activity_date FOR UPDATE;
    IF sheet_status='CLOSED_INVALID' THEN
      RAISE EXCEPTION 'This employee date is closed as invalid. Use the verified correct date.';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS protect_invalid_timeentry ON atec.tbltimeentry;
CREATE TRIGGER protect_invalid_timeentry BEFORE INSERT OR UPDATE OR DELETE ON atec.tbltimeentry
  FOR EACH ROW EXECUTE FUNCTION atec.protect_invalid_timeentry();
COMMIT;
