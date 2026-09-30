-- Applied to an empty project. Run once through a tracked remote migration.
create schema if not exists ats_private;
revoke all on schema ats_private from public, anon;
grant usage on schema ats_private to authenticated, service_role;

create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null,
 created_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 tenant_id uuid not null references public.organizations(id),
 email text not null, name text not null,
 role text not null check(role in ('admin','recruiter','interviewer')),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 unique(id,tenant_id)
);
-- These helpers have no caller-controlled user ID. Profiles cannot be changed by clients.
create function ats_private.tenant() returns uuid language sql stable security definer
set search_path='' as $$ select tenant_id from public.profiles where id=(select auth.uid()) and is_active $$;
create function ats_private.role() returns text language sql stable security definer
set search_path='' as $$ select role from public.profiles where id=(select auth.uid()) and is_active $$;

create table public.jobs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null default ats_private.tenant() references public.organizations(id),
 title text not null, department text, status text not null default 'open',
 created_at timestamptz not null default now(), deleted_at timestamptz, unique(id,tenant_id)
);
create table public.applicants (
 id text primary key default gen_random_uuid()::text, tenant_id uuid not null default ats_private.tenant() references public.organizations(id),
 name text not null check(length(name) between 1 and 200), name_kana text, gender text, birth_date date, age integer check(age between 0 and 120),
 email text, phone text, address text, education text, current_job text, experience_years integer check(experience_years>=0),
 current_salary integer check(current_salary>=0), desired_salary integer check(desired_salary>=0),
 job_id uuid not null, step text not null default '書類選考' check(step in ('書類選考','筆記試験','1次面接','2次面接','最終面接','内定')),
 status text not null default '未対応' check(status in ('未対応','通過','不合格','保留','辞退')),
 stars integer not null default 0 check(stars between 0 and 5), memo text, applied_at date not null default current_date,
 created_by uuid default auth.uid() references public.profiles(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), deleted_at timestamptz,
 unique(id,tenant_id), foreign key(job_id,tenant_id) references public.jobs(id,tenant_id)
);
create table public.tags (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null default ats_private.tenant() references public.organizations(id),
 name text not null, color text, unique(tenant_id,name), unique(id,tenant_id)
);
create table public.applicant_tags (
 applicant_id text not null, tag_id uuid not null, tenant_id uuid not null default ats_private.tenant(),
 primary key(applicant_id,tag_id), foreign key(applicant_id,tenant_id) references public.applicants(id,tenant_id) on delete cascade,
 foreign key(tag_id,tenant_id) references public.tags(id,tenant_id) on delete cascade
);
create table public.interviewer_assignments (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null default ats_private.tenant(),
 applicant_id text not null, user_id uuid not null, step text not null,
 assigned_by uuid default auth.uid() references public.profiles(id), created_at timestamptz not null default now(),
 unique(applicant_id,user_id,step), foreign key(applicant_id,tenant_id) references public.applicants(id,tenant_id) on delete cascade,
 foreign key(user_id,tenant_id) references public.profiles(id,tenant_id)
);
create function ats_private.can_read_applicant(p_id text) returns boolean language sql stable security definer
set search_path='' as $$
 select exists(select 1 from public.applicants a join public.profiles p on p.tenant_id=a.tenant_id
 where a.id=p_id and a.deleted_at is null and p.id=(select auth.uid()) and p.is_active
 and (p.role in ('admin','recruiter') or exists(select 1 from public.interviewer_assignments x where x.applicant_id=a.id and x.user_id=p.id)))
$$;
create table public.step_histories (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null default ats_private.tenant(), applicant_id text not null,
 step text not null, status text not null, note text, changed_by uuid default auth.uid() references public.profiles(id),
 created_at timestamptz not null default now(), foreign key(applicant_id,tenant_id) references public.applicants(id,tenant_id) on delete cascade
);
create table public.evaluations (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null default ats_private.tenant(), applicant_id text not null,
 step text not null, evaluator_id uuid, overall integer not null default 0 check(overall between 0 and 5),
 criteria jsonb not null default '{}', comment text, is_admin_comment boolean not null default false, created_at timestamptz not null default now(),
 foreign key(applicant_id,tenant_id) references public.applicants(id,tenant_id) on delete cascade,
 foreign key(evaluator_id,tenant_id) references public.profiles(id,tenant_id)
);
create table public.files (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null default ats_private.tenant(), applicant_id text not null,
 name text not null, file_type text not null, storage_path text not null unique, size_bytes bigint not null check(size_bytes between 1 and 10485760),
 uploaded_by uuid default auth.uid() references public.profiles(id), created_at timestamptz not null default now(),
 foreign key(applicant_id,tenant_id) references public.applicants(id,tenant_id) on delete cascade,
 check(split_part(storage_path,'/',1)=tenant_id::text and split_part(storage_path,'/',2)=applicant_id)
);
create table public.mail_templates (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null default ats_private.tenant() references public.organizations(id),
 name text not null, subject text not null, body text not null, created_at timestamptz not null default now(), unique(id,tenant_id)
);
create table public.mail_logs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.organizations(id), applicant_id text not null,
 template_id uuid, subject text not null, sent_to text not null, body text not null,
 sent_by uuid not null references public.profiles(id), sent_at timestamptz not null default now(),
 status text not null check(status in ('pending','sent','failed','unknown')), request_key uuid not null unique,
 provider_id text, foreign key(applicant_id,tenant_id) references public.applicants(id,tenant_id),
 foreign key(template_id,tenant_id) references public.mail_templates(id,tenant_id)
);
create table public.timeline_entries (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null default ats_private.tenant(), applicant_id text not null,
 user_id uuid default auth.uid() references public.profiles(id), user_name text not null default '',
 type text not null check(type in ('notify','discuss','urgent')), text text not null check(length(text) between 1 and 20000),
 created_at timestamptz not null default now(), foreign key(applicant_id,tenant_id) references public.applicants(id,tenant_id) on delete cascade
);

-- Append selection changes atomically, even for bulk edits or direct API requests.
create function ats_private.record_step() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or new.tenant_id is distinct from ats_private.tenant() or ats_private.role() not in ('admin','recruiter') then
   raise exception 'Active recruiter required' using errcode='42501';
 end if;
 if tg_op='INSERT' then
  insert into public.step_histories(tenant_id,applicant_id,step,status,note,changed_by) values(new.tenant_id,new.id,new.step,new.status,'応募受付',auth.uid());
 elsif new.step is distinct from old.step or new.status is distinct from old.status then
  insert into public.step_histories(tenant_id,applicant_id,step,status,note,changed_by) values(new.tenant_id,new.id,new.step,new.status,old.step||'('||old.status||') → '||new.step||'('||new.status||')',auth.uid());
 end if;
 return new;
end $$;
create trigger record_applicant_step after insert or update on public.applicants for each row execute function ats_private.record_step();
create function ats_private.stamp_timeline() returns trigger language plpgsql set search_path='' as $$
begin new.user_id=auth.uid(); select p.name into new.user_name from public.profiles p where p.id=auth.uid(); return new; end $$;
create trigger stamp_timeline before insert on public.timeline_entries for each row execute function ats_private.stamp_timeline();

-- Deny access unless a policy below explicitly permits it.
do $$ declare t text; begin
 foreach t in array array['organizations','profiles','jobs','applicants','tags','applicant_tags','interviewer_assignments','step_histories','evaluations','files','mail_templates','mail_logs','timeline_entries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create policy organization_read on public.organizations for select to authenticated using(id=(select ats_private.tenant()));
create policy profile_read on public.profiles for select to authenticated using(tenant_id=(select ats_private.tenant()));
-- Profile and organization membership are provisioned only by trusted administration.
do $$ declare t text; begin
 foreach t in array array['jobs','tags','mail_templates'] loop
  execute format('create policy tenant_read on public.%I for select to authenticated using(tenant_id=(select ats_private.tenant()))',t);
  execute format('create policy recruiter_write on public.%I for all to authenticated using(tenant_id=(select ats_private.tenant()) and (select ats_private.role()) in (''admin'',''recruiter'')) with check(tenant_id=(select ats_private.tenant()) and (select ats_private.role()) in (''admin'',''recruiter''))',t);
  execute format('grant insert,update,delete on public.%I to authenticated',t);
 end loop;
end $$;
create policy applicant_read on public.applicants for select to authenticated using(ats_private.can_read_applicant(id));
create policy applicant_insert on public.applicants for insert to authenticated with check(tenant_id=(select ats_private.tenant()) and (select ats_private.role()) in ('admin','recruiter') and created_by=(select auth.uid()));
create policy applicant_update on public.applicants for update to authenticated using(tenant_id=(select ats_private.tenant()) and (select ats_private.role()) in ('admin','recruiter')) with check(tenant_id=(select ats_private.tenant()) and (select ats_private.role()) in ('admin','recruiter'));
grant insert,update on public.applicants to authenticated;
do $$ declare t text; begin
 foreach t in array array['applicant_tags','interviewer_assignments','files'] loop
  execute format('create policy candidate_read on public.%I for select to authenticated using(tenant_id=(select ats_private.tenant()) and ats_private.can_read_applicant(applicant_id))',t);
  execute format('create policy recruiter_write on public.%I for all to authenticated using(tenant_id=(select ats_private.tenant()) and (select ats_private.role()) in (''admin'',''recruiter'')) with check(tenant_id=(select ats_private.tenant()) and (select ats_private.role()) in (''admin'',''recruiter'') and ats_private.can_read_applicant(applicant_id))',t);
  execute format('grant insert,update,delete on public.%I to authenticated',t);
 end loop;
end $$;
create policy history_read on public.step_histories for select to authenticated using(tenant_id=(select ats_private.tenant()) and ats_private.can_read_applicant(applicant_id));
create policy evaluation_read on public.evaluations for select to authenticated using(tenant_id=(select ats_private.tenant()) and ats_private.can_read_applicant(applicant_id) and ((select ats_private.role()) in ('admin','recruiter') or (evaluator_id=(select auth.uid()) and not is_admin_comment)));
create policy evaluation_write on public.evaluations for all to authenticated using(tenant_id=(select ats_private.tenant()) and ats_private.can_read_applicant(applicant_id) and ((select ats_private.role()) in ('admin','recruiter') or (evaluator_id=(select auth.uid()) and not is_admin_comment))) with check(tenant_id=(select ats_private.tenant()) and ats_private.can_read_applicant(applicant_id) and ((select ats_private.role()) in ('admin','recruiter') or (evaluator_id=(select auth.uid()) and not is_admin_comment)));
grant insert,update,delete on public.evaluations to authenticated;
create policy timeline_read on public.timeline_entries for select to authenticated using(tenant_id=(select ats_private.tenant()) and ats_private.can_read_applicant(applicant_id));
create policy timeline_insert on public.timeline_entries for insert to authenticated with check(tenant_id=(select ats_private.tenant()) and ats_private.can_read_applicant(applicant_id) and user_id=(select auth.uid()));
create policy timeline_delete on public.timeline_entries for delete to authenticated using(tenant_id=(select ats_private.tenant()) and ats_private.can_read_applicant(applicant_id) and (user_id=(select auth.uid()) or (select ats_private.role()) in ('admin','recruiter')));
grant insert,delete on public.timeline_entries to authenticated;
create policy mail_read on public.mail_logs for select to authenticated using(tenant_id=(select ats_private.tenant()) and (select ats_private.role()) in ('admin','recruiter'));

revoke all on all functions in schema ats_private from public,anon,authenticated;
grant execute on function ats_private.tenant(),ats_private.role(),ats_private.can_read_applicant(text) to authenticated,service_role;
create index profiles_tenant_idx on public.profiles(tenant_id);
create index applicants_tenant_date_idx on public.applicants(tenant_id,applied_at desc) where deleted_at is null;
create index applicants_job_idx on public.applicants(job_id,tenant_id);
create index assignments_user_idx on public.interviewer_assignments(user_id,applicant_id);
do $$ declare t text; begin
 foreach t in array array['applicant_tags','interviewer_assignments','step_histories','evaluations','files','mail_logs','timeline_entries'] loop
  execute format('create index %I on public.%I(tenant_id,applicant_id)',t||'_tenant_applicant_idx',t);
 end loop;
end $$;
create index mail_rate_idx on public.mail_logs(sent_by,sent_at desc);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(
 'applicant-files','applicant-files',false,10485760,
 array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/zip','application/x-zip-compressed','image/png','image/jpeg']
);
create policy ats_file_read on storage.objects for select to authenticated using(bucket_id='applicant-files' and split_part(name,'/',1)=(select ats_private.tenant())::text and ats_private.can_read_applicant(split_part(name,'/',2)));
create policy ats_file_insert on storage.objects for insert to authenticated with check(bucket_id='applicant-files' and split_part(name,'/',1)=(select ats_private.tenant())::text and (select ats_private.role()) in ('admin','recruiter') and ats_private.can_read_applicant(split_part(name,'/',2)));
create policy ats_file_delete on storage.objects for delete to authenticated using(bucket_id='applicant-files' and split_part(name,'/',1)=(select ats_private.tenant())::text and (select ats_private.role()) in ('admin','recruiter') and ats_private.can_read_applicant(split_part(name,'/',2)));

-- Only the authenticated Edge Function's server client may reserve mail.
create function public.reserve_ats_mail(p_user uuid,p_applicant text,p_template uuid,p_key uuid)
returns public.mail_logs language plpgsql security invoker set search_path='' as $$
declare p public.profiles; a public.applicants; t public.mail_templates; m public.mail_logs;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into p from public.profiles where id=p_user and is_active and role in ('admin','recruiter');
 if p.id is null then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into m from public.mail_logs where request_key=p_key;
 if m.id is not null then
  if m.sent_by<>p_user or m.applicant_id<>p_applicant or m.template_id is distinct from p_template then raise exception 'Request key mismatch'; end if;
  return m;
 end if;
 if (select count(*) from public.mail_logs where sent_by=p_user and sent_at>now()-interval '1 minute')>=10 then raise exception 'Rate limit'; end if;
 select * into a from public.applicants where id=p_applicant and tenant_id=p.tenant_id and deleted_at is null;
 select * into t from public.mail_templates where id=p_template and tenant_id=p.tenant_id;
 if a.id is null or t.id is null or a.email is null or a.email !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' then raise exception 'Invalid candidate or template'; end if;
 insert into public.mail_logs(tenant_id,applicant_id,template_id,subject,sent_to,body,sent_by,status,request_key)
 values(p.tenant_id,a.id,t.id,replace(replace(t.subject,'{{applicant_name}}',a.name),'{{job_title}}',coalesce((select title from public.jobs where id=a.job_id),'')),a.email,replace(replace(t.body,'{{applicant_name}}',a.name),'{{job_title}}',coalesce((select title from public.jobs where id=a.job_id),'')),p.id,'pending',p_key) returning * into m;
 return m;
end $$;
revoke all on function public.reserve_ats_mail(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_ats_mail(uuid,text,uuid,uuid) to service_role;

insert into public.organizations(name) values('ATS Workspace');
insert into public.jobs(tenant_id,title,department) select id,'エンジニア','開発' from public.organizations where name='ATS Workspace';
insert into public.tags(tenant_id,name) select o.id,t.name from public.organizations o cross join (values('エンジニア'),('HR'),('HOT'),('KEEP')) t(name) where o.name='ATS Workspace';
insert into public.mail_templates(tenant_id,name,subject,body) select id,'面接日程のご相談','面接日程のご相談',E'{{applicant_name}} 様\n\n{{job_title}}へのご応募ありがとうございます。\n面接の日程候補をお知らせください。\n\n採用担当' from public.organizations where name='ATS Workspace';
