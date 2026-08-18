BEGIN;

DELETE FROM atec.tbldailytimesheet timesheet
WHERE timesheet.status = 'DRAFT'
  AND NOT EXISTS (
    SELECT 1 FROM atec.tbltimeentry entry
    WHERE entry.user_id = timesheet.user_id
      AND entry.activity_date = timesheet.timesheet_date
  )
  AND NOT EXISTS (
    SELECT 1 FROM atec.tbldailytimesheetline line
    WHERE line.timesheetid = timesheet.timesheetid
  );

COMMIT;
