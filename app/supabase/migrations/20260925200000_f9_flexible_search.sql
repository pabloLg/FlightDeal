-- F9 — Flexible search: rangos de fechas flexibles por búsqueda.
-- Cada búsqueda puede definir una ventana de días alrededor de depart_date
-- (y return_date) que el fuente debe explorar.

alter table public.searches
  add column date_flex_days int not null default 0
    check (date_flex_days >= 0 and date_flex_days <= 21);