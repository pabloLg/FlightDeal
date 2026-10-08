-- F11 (tarjeta por fuente): which source observed each flight_options row.
-- Nullable so pre-existing rows stay valid; the runner writes it on every
-- upsert from the merge outcome (aligned with options by index).
alter table public.flight_options
  add column if not exists source_id text;
