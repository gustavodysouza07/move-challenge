-- Adds pause accounting to the existing activity session table.
ALTER TABLE public.activity_sessions
ADD COLUMN IF NOT EXISTS paused_seconds integer NOT NULL DEFAULT 0;
