insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marlon-avatars',
  'marlon-avatars',
  true,
  5242880,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "marlon avatar managers select" on storage.objects;
drop policy if exists "marlon avatar managers insert" on storage.objects;
drop policy if exists "marlon avatar managers update" on storage.objects;
drop policy if exists "marlon avatar managers delete" on storage.objects;

create policy "marlon avatar managers select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'marlon-avatars'
  and name = current_location_id()::text || '/marlon-avatar'
  and has_permission('settings.manage')
);

create policy "marlon avatar managers insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'marlon-avatars'
  and name = current_location_id()::text || '/marlon-avatar'
  and has_permission('settings.manage')
);

create policy "marlon avatar managers update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'marlon-avatars'
  and name = current_location_id()::text || '/marlon-avatar'
  and has_permission('settings.manage')
)
with check (
  bucket_id = 'marlon-avatars'
  and name = current_location_id()::text || '/marlon-avatar'
  and has_permission('settings.manage')
);

create policy "marlon avatar managers delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'marlon-avatars'
  and name = current_location_id()::text || '/marlon-avatar'
  and has_permission('settings.manage')
);
