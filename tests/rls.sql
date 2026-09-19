-- Run on the initialized project. All fixtures are rolled back, including Auth rows.
begin;
do $$
declare ta uuid:=gen_random_uuid(); tb uuid:=gen_random_uuid();
 ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid(); ui uuid:=gen_random_uuid(); un uuid:=gen_random_uuid();
 ja uuid:=gen_random_uuid(); jb uuid:=gen_random_uuid(); aa text:=gen_random_uuid()::text; ab text:=gen_random_uuid()::text;
 ev uuid:=gen_random_uuid(); n integer;
begin
 insert into auth.users(id,email,created_at,updated_at) values(ua,ua||'@example.invalid',now(),now()),(ub,ub||'@example.invalid',now(),now()),(ui,ui||'@example.invalid',now(),now()),(un,un||'@example.invalid',now(),now());
 insert into public.organizations(id,name) values(ta,'RLS test A'),(tb,'RLS test B');
 insert into public.profiles(id,tenant_id,email,name,role) values(ua,ta,ua||'@example.invalid','Test A','admin'),(ub,tb,ub||'@example.invalid','Test B','recruiter'),(ui,ta,ui||'@example.invalid','Test Interviewer','interviewer');
 insert into public.jobs(id,tenant_id,title) values(ja,ta,'Test Job A'),(jb,tb,'Test Job B');
 perform set_config('request.jwt.claim.sub',ua::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 insert into public.applicants(id,name,job_id) values(aa,'Test candidate A',ja);
 update public.applicants set step='1次面接' where id=aa;
 select count(*) into n from public.step_histories where applicant_id=aa;
 if n<>2 then raise exception 'History not atomic: %',n; end if;
 begin
  insert into public.applicants(name,job_id,tenant_id) values('Cross tenant',jb,ta);
  raise exception 'Cross-tenant job accepted';
 exception when foreign_key_violation then null; end;
 begin
  update public.profiles set role='admin' where id=ui;
  raise exception 'Client can edit roles';
 exception when insufficient_privilege then null; end;
 insert into public.interviewer_assignments(applicant_id,user_id,step) values(aa,ui,'1次面接');
 insert into public.evaluations(id,applicant_id,step,evaluator_id,overall) values(ev,aa,'1次面接',ui,3);
 insert into storage.objects(bucket_id,name) values('applicant-files',ta::text||'/'||aa||'/test.pdf');
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',ub::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',ub,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 insert into public.applicants(id,name,job_id) values(ab,'Test candidate B',jb);
 select count(*) into n from public.applicants where id=aa;
 if n<>0 then raise exception 'Cross tenant read'; end if;
 update public.applicants set name='Forbidden' where id=aa;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Cross tenant update'; end if;
 select count(*) into n from storage.objects where name=ta::text||'/'||aa||'/test.pdf';
 if n<>0 then raise exception 'Cross tenant file read'; end if;
 begin
  insert into storage.objects(bucket_id,name) values('applicant-files',ta::text||'/'||aa||'/forbidden.pdf');
  raise exception 'Cross tenant file upload';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',ui::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',ui,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 select count(*) into n from public.applicants where id=aa;
 if n<>1 then raise exception 'Assigned interviewer cannot read'; end if;
 update public.applicants set name='Forbidden' where id=aa;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Interviewer can edit candidate'; end if;
 update public.evaluations set overall=5 where id=ev;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Interviewer cannot save own evaluation'; end if;
 begin
  update public.evaluations set is_admin_comment=true where id=ev;
  raise exception 'Interviewer can write admin comment';
 exception when insufficient_privilege then null; end;
 begin
  perform public.reserve_ats_mail(ui,aa,gen_random_uuid(),gen_random_uuid());
  raise exception 'Client can reserve mail';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 update public.profiles set is_active=false where id=ui;
 execute 'set local role authenticated';
 select count(*) into n from public.applicants where id=aa;
 if n<>0 then raise exception 'Disabled user retains access'; end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',un::text,true);
 perform set_config('request.jwt.claims',json_build_object('sub',un,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 select count(*) into n from public.applicants;
 if n<>0 then raise exception 'Unprovisioned user can read candidates'; end if;
 execute 'reset role';
 execute 'set local role anon';
 begin
  perform 1 from public.applicants;
  raise exception 'Anonymous user can read candidates';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
end $$;
rollback;
select 'PASS: tenant isolation, cross-tenant foreign keys, role escalation, interviewer scope, inactive/unprovisioned users, private storage, history, mail RPC and anonymous denial; fixtures rolled back' as result;
