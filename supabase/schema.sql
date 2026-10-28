-- 보람 ON 데이터베이스 설정 (Supabase SQL Editor에 통째로 붙여 넣고 Run)
-- 모든 자료는 docs 표 한 곳에 '경로(path)' 단위로 저장돼요.
--   학교 공식 자료:  events / meals / timetable      → 누구나 읽기, 서버(자동 업데이트)만 쓰기
--   사이트 설정:      config                          → 누구나 읽기, 최고관리자만 쓰기
--   공개 프로필·글:   teachers / pub / approvals / ratings → 누구나 읽기, 본인 문서만 쓰기
--   개인 자료:        data/users/<내 id>              → 본인만 읽기·쓰기 (최고관리자 포함 누구도 못 봄)

create table if not exists public.docs (
  path        text primary key,
  coll        text not null,
  doc_id      text not null,
  owner       uuid,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists docs_coll_idx on public.docs (coll);

create table if not exists public.site_settings (
  key   text primary key,
  value text not null
);
alter table public.site_settings enable row level security;
-- site_settings는 어떤 로그인 사용자도 읽거나 쓸 수 없어요 (서버 전용).

-- 최고관리자 이메일 (아래 이메일을 사용자님 이메일로 바꾼 뒤 실행)
insert into public.site_settings(key, value) values ('owner_email', 'story280@nyschool.co.kr')
  on conflict (key) do update set value = excluded.value;

create schema if not exists private;
create or replace function private.is_site_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() ->> 'email') = (select value from public.site_settings where key = 'owner_email'), false)
$$;
revoke all on function private.is_site_owner() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_site_owner() to anon, authenticated;

alter table public.docs enable row level security;

drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select using (
  case
    when coll like 'data/users/%' then auth.uid() is not null and coll = 'data/users/' || auth.uid()::text and owner = auth.uid()
    else true
  end
);

drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert with check (
  auth.uid() is not null and owner = auth.uid() and (
    (coll in ('teachers','pub','approvals','ratings') and doc_id = auth.uid()::text and path = coll || '/' || doc_id)
    or (coll = 'data/users/' || auth.uid()::text and path = coll || '/' || doc_id)
    or (coll = 'config' and private.is_site_owner() and path = coll || '/' || doc_id)
  )
);

drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update using (
  auth.uid() is not null and owner = auth.uid() and (
    (coll in ('teachers','pub','approvals','ratings') and doc_id = auth.uid()::text)
    or coll = 'data/users/' || auth.uid()::text
    or (coll = 'config' and private.is_site_owner())
  )
) with check (
  owner = auth.uid() and (
    (coll in ('teachers','pub','approvals','ratings') and doc_id = auth.uid()::text and path = coll || '/' || doc_id)
    or (coll = 'data/users/' || auth.uid()::text and path = coll || '/' || doc_id)
    or (coll = 'config' and private.is_site_owner() and path = coll || '/' || doc_id)
  )
);

drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete using (
  auth.uid() is not null and owner = auth.uid() and (
    (coll in ('teachers','pub','approvals','ratings') and doc_id = auth.uid()::text)
    or coll = 'data/users/' || auth.uid()::text
    or (coll = 'config' and private.is_site_owner())
  )
);

-- config 문서는 최고관리자가 처음 만들면 owner가 최고관리자로 고정돼요.
-- 최고관리자가 바뀌어도 이어서 쓸 수 있게, config는 최고관리자면 owner와 상관없이 수정 허용
drop policy if exists docs_update_config on public.docs;
create policy docs_update_config on public.docs for update using (coll = 'config' and private.is_site_owner())
  with check (coll = 'config' and private.is_site_owner() and owner = auth.uid());

-- 실시간 반영
do $$ begin
  begin
    alter publication supabase_realtime add table public.docs;
  exception when duplicate_object then null;
  end;
end $$;

-- 첨부 파일 저장소: 파일마다 추측할 수 없는 무작위 경로를 써요.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', true, 20971520)
on conflict (id) do nothing;

drop policy if exists files_insert on storage.objects;
create policy files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists files_delete on storage.objects;
create policy files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists files_list_own on storage.objects;
create policy files_list_own on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
