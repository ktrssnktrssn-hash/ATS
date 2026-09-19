-- Run in the Supabase SQL editor as project administrator after creating a user in
-- Authentication > Users. Replace the two values below; never put a password here.
begin;
do $$
declare
 member_email text := 'REPLACE_WITH_CONFIRMED_EMAIL';
 member_name text := 'REPLACE_WITH_NAME';
 member_role text := 'admin'; -- admin / recruiter / interviewer
 uid uuid; tenant uuid;
begin
 if member_email like 'REPLACE_%' or member_name like 'REPLACE_%' then raise exception 'Set email and name first'; end if;
 select id into strict uid from auth.users where lower(email)=lower(member_email) and email_confirmed_at is not null;
 select id into strict tenant from public.organizations where name='ATS Workspace';
 if exists(select 1 from public.profiles where id=uid) then raise exception 'Profile already exists; inspect before changing permissions'; end if;
 insert into public.profiles(id,tenant_id,email,name,role) values(uid,tenant,member_email,member_name,member_role);
end $$;
commit;
