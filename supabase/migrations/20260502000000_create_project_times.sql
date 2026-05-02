-- Arbeitszeiten aus ProSonata
CREATE TABLE IF NOT EXISTS project_times (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prosonata_time_id    text        UNIQUE NOT NULL,
  date                 date        NOT NULL,
  employee_id          text,
  employee_first_name  text,
  employee_last_name   text,
  project_id           text,
  project_name         text,
  is_internal          boolean     DEFAULT false,
  hours                numeric(6,2),
  synced_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_times_date_idx     ON project_times (date);
CREATE INDEX IF NOT EXISTS project_times_employee_idx ON project_times (employee_id);
CREATE INDEX IF NOT EXISTS project_times_date_emp_idx ON project_times (date, employee_id);

ALTER TABLE project_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eingeloggte Benutzer können Arbeitszeiten lesen"
  ON project_times FOR SELECT
  USING (auth.role() = 'authenticated');
