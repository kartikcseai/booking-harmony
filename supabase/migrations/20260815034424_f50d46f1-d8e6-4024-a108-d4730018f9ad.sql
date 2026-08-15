REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_view_booking(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_booking(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_booking_transition() FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_event_mutation() FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, public, authenticated;