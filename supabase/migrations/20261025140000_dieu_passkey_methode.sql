-- Verrou Face ID de dieu: reconnaissance plus large du nom de la méthode (passkey ou webauthn, peu importe la casse),
-- alignée sur la fonction edge admin-users (25 octobre 2026).
create or replace function public.passkey_satisfied()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.admins a where a.user_id = auth.uid() and a.passkey_required)
      or exists (
        select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m
        where m ->> 'method' ~* '(passkey|webauthn)'
      );
$$;
revoke execute on function public.passkey_satisfied() from public, anon;
grant execute on function public.passkey_satisfied() to authenticated;
