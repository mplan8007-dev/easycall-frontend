-- Isolated CI database only. Never run on production.
\getenv fixture_password POSTGRES_PASSWORD
create role supabase_auth_admin login password :'fixture_password';
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path=auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema easycall_private_v2;
revoke all on schema easycall_private_v2 from public;
