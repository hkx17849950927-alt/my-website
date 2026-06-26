drop policy if exists "messages_delete_own" on public.chat_messages;
create policy "messages_delete_own"
on public.chat_messages for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "messages_delete_super_admin" on public.chat_messages;
create policy "messages_delete_super_admin"
on public.chat_messages for delete
to authenticated
using (
  exists (
    select 1 from public.profiles admin
    where admin.id = auth.uid()
      and admin.account = '20010927'
  )
);
