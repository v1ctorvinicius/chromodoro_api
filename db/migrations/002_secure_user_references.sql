drop policy if exists "user can CRUD own sessions" on public.sessions;
create policy "user can CRUD own sessions" on public.sessions
for all
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.projects as p
    where p.id = sessions.project_id
      and p.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.projects as p
    where p.id = sessions.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "user can CRUD own notes" on public.notes;
create policy "user can CRUD own notes" on public.notes
for all
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.projects as p
    where p.id = notes.project_id
      and p.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.projects as p
    where p.id = notes.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "user can CRUD own contributions" on public.contributions;
create policy "user can CRUD own contributions" on public.contributions
for all
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.projects as p
    where p.id = contributions.project_id
      and p.user_id = auth.uid()
  )
  and (
    session_id is null
    or exists (
      select 1
      from public.sessions as s
      where s.id = contributions.session_id
        and s.user_id = auth.uid()
        and s.project_id = contributions.project_id
    )
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.projects as p
    where p.id = contributions.project_id
      and p.user_id = auth.uid()
  )
  and (
    session_id is null
    or exists (
      select 1
      from public.sessions as s
      where s.id = contributions.session_id
        and s.user_id = auth.uid()
        and s.project_id = contributions.project_id
    )
  )
);
