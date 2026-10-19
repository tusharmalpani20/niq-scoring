CREATE TABLE report_trace_calls (
  id varchar(26) PRIMARY KEY,
  run_id varchar(26) NOT NULL REFERENCES report_generation_runs(id) ON DELETE CASCADE,
  attempt_id varchar(26) NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  step varchar(30) NOT NULL,
  system_prompt text NOT NULL,
  user_prompt text NOT NULL,
  response_schema jsonb NOT NULL,
  response jsonb,
  usage jsonb,
  error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX report_trace_call_sequence_uq ON report_trace_calls(run_id,attempt_id,sequence);
--> statement-breakpoint
CREATE INDEX report_trace_calls_expiry_idx ON report_trace_calls(expires_at);
--> statement-breakpoint
CREATE TABLE report_trace_events (
  id varchar(26) PRIMARY KEY,
  run_id varchar(26) NOT NULL REFERENCES report_generation_runs(id) ON DELETE CASCADE,
  attempt_id varchar(26) NOT NULL,
  stage varchar(80) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX report_trace_events_run_created_idx ON report_trace_events(run_id,created_at);
--> statement-breakpoint
CREATE INDEX report_trace_events_expiry_idx ON report_trace_events(expires_at);
