-- F11/fase booking: credenciales de fuentes gestionables desde la app.
--
-- El secreto se guarda cifrado (AES-256-GCM) y NUNCA en claro. La clave
-- maestra vive solo en las variables de entorno del servidor
-- (SOURCE_SECRET_KEY), fuera de la base de datos.
--
-- Seguridad: RLS activado SIN politicas + revoke total a anon y
-- authenticated. Ningun usuario, ni siquiera autenticado, puede leer esta
-- tabla: solo el service_role del servidor (mismo patrono que
-- source_structure_versions).
create table if not exists public.source_credentials (
  provider text primary key
    check (provider in ('serpapi', 'ignav')),
  -- Formato: v1.<iv-b64url>.<ciphertext-b64url> (AES-256-GCM autenticado).
  secret_encrypted text not null,
  updated_at timestamptz not null default now(),
  -- Email del administrador que la escribio (auditoria, no FK a profiles:
  -- esto es configuracion global, no dato de usuario).
  updated_by text
);

alter table public.source_credentials enable row level security;

revoke all on table public.source_credentials from anon, authenticated;
