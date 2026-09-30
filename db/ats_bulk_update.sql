create function public.bulk_update_ats_applicants(p_ids text[],p_data jsonb)
returns setof public.applicants language plpgsql security invoker set search_path='' as $$
declare expected integer; actual integer;
begin
 if coalesce(ats_private.role(),'') not in ('admin','recruiter') then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_ids is null or cardinality(p_ids)=0 or cardinality(p_ids)>1000 or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid bulk request'; end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('step','status')) or p_data='{}' then raise exception 'Invalid fields'; end if;
 select count(distinct x) into expected from unnest(p_ids) x;
 return query update public.applicants set
  step=case when p_data ? 'step' then p_data->>'step' else step end,
  status=case when p_data ? 'status' then p_data->>'status' else status end,
  updated_at=now()
 where id=any(p_ids) and deleted_at is null returning *;
 get diagnostics actual=row_count;
 if actual<>expected then raise exception 'A candidate is unavailable; no changes applied'; end if;
end $$;
revoke all on function public.bulk_update_ats_applicants(text[],jsonb) from public,anon;
grant execute on function public.bulk_update_ats_applicants(text[],jsonb) to authenticated;
drop policy applicant_read on public.applicants;
create policy applicant_read on public.applicants for select to authenticated using(
 tenant_id=(select ats_private.tenant()) and ((select ats_private.role()) in ('admin','recruiter') or ats_private.can_read_applicant(id))
);
