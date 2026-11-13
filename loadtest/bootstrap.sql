-- Local test container only. Never apply this file to Supabase production.
create role anon nologin;
create role authenticated nologin;
\getenv test_db_password POSTGRES_PASSWORD
create role authenticator noinherit login password :'test_db_password';
grant anon,authenticated to authenticator;
create schema auth;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb not null default '{}',created_at timestamptz default now(),email_confirmed_at timestamptz,last_sign_in_at timestamptz,raw_user_meta_data jsonb not null default '{}');
create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid not null,factor_type text,status text);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(auth.jwt()->>'sub'))::uuid$$;
grant usage on schema auth to authenticated;
grant execute on function auth.jwt(),auth.uid() to authenticated;
-- Match the live project's integer identities, not the older UUID fallback schema.
create table public.easycall_voters(uid bigint generated always as identity primary key,camp_id text not null,voter_id text not null,name text not null,phone text not null,dong text default '',last_result text default 'READY',last_memo text default '',locked_by text,updated_at timestamptz default now());
create table public.easycall_call_logs(id bigint generated always as identity primary key,camp_id text not null,agent_id text not null,used_phone text,voter_id text,voter_name text,voter_phone text,dong text,gender text,age text,call_result text,status text,duration text,memo text,call_time text);
