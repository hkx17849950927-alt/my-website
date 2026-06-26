drop policy if exists "messages_delete_own" on public.chat_messages;
create policy "messages_delete_own"
on public.chat_messages for delete
to authenticated
using (user_id = auth.uid());
