BEGIN;

CREATE TABLE IF NOT EXISTS atec.tblusermanagerassignment (
  employee_user_id integer NOT NULL REFERENCES atec.tblusers(userid) ON DELETE CASCADE,
  manager_user_id integer NOT NULL REFERENCES atec.tblusers(userid) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_by_user_id integer REFERENCES atec.tblusers(userid) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_user_id, manager_user_id),
  CONSTRAINT chk_tblusermanagerassignment_not_self CHECK (employee_user_id <> manager_user_id)
);

CREATE INDEX IF NOT EXISTS idx_tblusermanagerassignment_manager
  ON atec.tblusermanagerassignment(manager_user_id, employee_user_id);

INSERT INTO atec.tblusermanagerassignment(employee_user_id,manager_user_id,is_primary)
SELECT userid,manager_user_id,true
FROM atec.tblusers
WHERE manager_user_id IS NOT NULL AND manager_user_id <> userid
ON CONFLICT (employee_user_id,manager_user_id) DO UPDATE SET is_primary=true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='atec_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON atec.tblusermanagerassignment TO atec_app;
  END IF;
END $$;

COMMIT;
