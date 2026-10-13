-- seed: deterministic local data (no network). Resets on `supabase db reset`.
-- Demo user logs in with demo@example.com / DemoPass123!

create extension if not exists pgcrypto;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  email_change_token_new, email_change, phone,
  raw_app_meta_data, raw_user_meta_data,
  last_sign_in_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'demo@example.com',
  crypt('DemoPass123!', gen_salt('bf')),
  now(),
  '',
  '',
  '',
  '',
  '',
  '{"provider": "email", "providers": ["email"]}',
  '{}',
  now(),
  now(),
  now()
)
on conflict do nothing;

insert into public.profiles (id, email, currency, retention_keep_aggregates)
values (
  '00000000-0000-0000-0000-000000000001',
  'demo@example.com',
  'EUR',
  true
)
on conflict (id) do update set
  email = excluded.email,
  currency = excluded.currency,
  retention_keep_aggregates = excluded.retention_keep_aggregates;

insert into public.searches (
  id, profile_id, origin, destination, depart_date, return_date,
  trip_type, cabin_class, stops, adults, enabled, alert_threshold_eur,
  date_flex_days
)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'MAD',
  'BCN',
  current_date + interval '30 days',
  current_date + interval '37 days',
  'round_trip',
  'economy',
  'any',
  1,
  true,
  80.00,
  0
)
on conflict (id) do nothing;

insert into public.searches (
  id, profile_id, origin, destination, depart_date, return_date,
  trip_type, cabin_class, stops, adults, enabled, alert_threshold_eur,
  date_flex_days
)
values (
  '00000000-0000-0000-0000-00000000000a',
  '00000000-0000-0000-0000-000000000001',
  'MAD',
  'LHR',
  current_date + interval '40 days',
  current_date + interval '47 days',
  'round_trip',
  'economy',
  'any',
  1,
  true,
  null,
  5
)
on conflict (id) do nothing;

insert into public.search_executions (
  id, search_id, status, structure_check_passed,
  scheduled_start, started_at, finished_at
)
values (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000002',
  'completed',
  true,
  now() - interval '1 day',
  now() - interval '1 day' + interval '5 seconds',
  now() - interval '1 day' + interval '20 seconds'
)
on conflict (id) do nothing;

insert into public.flight_options (
  id, search_id, execution_id, dedupe_key, outbound_legs, inbound_legs,
  price_eur, currency, airlines, total_duration_min
)
values
  (
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    'mad-bcn-ib3210',
    jsonb_build_array(jsonb_build_object(
      'airline', 'IB', 'flightNumber', 'IB3210',
      'departAirport', 'MAD', 'arriveAirport', 'BCN',
      'departAt', to_char(current_date + interval '30 days' + time '08:30', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'arriveAt', to_char(current_date + interval '30 days' + time '10:05', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'durationMin', 95
    )),
    jsonb_build_array(jsonb_build_object(
      'airline', 'IB', 'flightNumber', 'IB3211',
      'departAirport', 'BCN', 'arriveAirport', 'MAD',
      'departAt', to_char(current_date + interval '37 days' + time '18:20', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'arriveAt', to_char(current_date + interval '37 days' + time '19:55', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'durationMin', 95
    )),
    95.00,
    'EUR',
    '["Iberia"]',
    90
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    'mad-bcn-vy-4231',
    jsonb_build_array(jsonb_build_object(
      'airline', 'VY', 'flightNumber', 'VY4231',
      'departAirport', 'MAD', 'arriveAirport', 'BCN',
      'departAt', to_char(current_date + interval '30 days' + time '11:10', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'arriveAt', to_char(current_date + interval '30 days' + time '12:45', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'durationMin', 95
    )),
    jsonb_build_array(jsonb_build_object(
      'airline', 'VY', 'flightNumber', 'VY4232',
      'departAirport', 'BCN', 'arriveAirport', 'MAD',
      'departAt', to_char(current_date + interval '37 days' + time '20:10', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'arriveAt', to_char(current_date + interval '37 days' + time '21:45', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'durationMin', 95
    )),
    60.00,
    'EUR',
    '["Vueling"]',
    90
  )
on conflict (search_id, dedupe_key) do nothing;

insert into public.flight_prices (flight_option_id, price_eur, currency, observed_at)
select
  id::uuid as flight_option_id,
  price_eur,
  currency,
  now() - interval '1 day' + interval '30 minutes'
from public.flight_options
where search_id = '00000000-0000-0000-0000-000000000002'
on conflict do nothing;

insert into public.price_stats_daily (search_id, stats_date, min_price_eur, max_price_eur, avg_price_eur, observations)
values (
  '00000000-0000-0000-0000-000000000002',
  current_date - 1,
  60.00,
  95.00,
  77.50,
  2
)
on conflict (search_id, stats_date) do nothing;