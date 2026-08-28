-- Preserve the existing authorization semantics while letting PostgreSQL initialize
-- stable auth/session/location lookups once per statement instead of once per row.

-- portal_release_seen
DROP POLICY IF EXISTS "staff mark own release seen" ON public.portal_release_seen;
CREATE POLICY "staff mark own release seen"
  ON public.portal_release_seen
  FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "staff view own release seen" ON public.portal_release_seen;
CREATE POLICY "staff view own release seen"
  ON public.portal_release_seen
  FOR SELECT
  TO authenticated
  USING (profile_id = (SELECT auth.uid()));

-- portal_release_settings
DROP POLICY IF EXISTS "owners update release settings" ON public.portal_release_settings;
CREATE POLICY "owners update release settings"
  ON public.portal_release_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.active
        AND p.role::text = 'owner'
    )
  )
  WITH CHECK (id = true);

-- portal_releases
DROP POLICY IF EXISTS "owners manage releases" ON public.portal_releases;
CREATE POLICY "owners manage releases"
  ON public.portal_releases
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.active
        AND p.role::text = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.active
        AND p.role::text = 'owner'
    )
  );

-- portal_suggestions
DROP POLICY IF EXISTS "owners manage suggestions" ON public.portal_suggestions;
CREATE POLICY "owners manage suggestions"
  ON public.portal_suggestions
  FOR UPDATE
  TO authenticated
  USING (
    location_id = (SELECT public.current_location_id())
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.active
        AND p.role::text = 'owner'
    )
  )
  WITH CHECK (location_id = (SELECT public.current_location_id()));

DROP POLICY IF EXISTS "staff submit suggestions" ON public.portal_suggestions;
CREATE POLICY "staff submit suggestions"
  ON public.portal_suggestions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    location_id = (SELECT public.current_location_id())
    AND submitted_by = (SELECT auth.uid())
  );

-- profiles
DROP POLICY IF EXISTS "staff can read profiles at their location" ON public.profiles;
CREATE POLICY "staff can read profiles at their location"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR (
      (SELECT public.portal_human_session())
      AND location_id = (SELECT public.current_location_id())
      AND COALESCE(account_type, 'staff') = 'staff'
    )
  );

-- support_tickets
DROP POLICY IF EXISTS "staff can create support tickets" ON public.support_tickets;
CREATE POLICY "staff can create support tickets"
  ON public.support_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.portal_human_session())
    AND location_id = (SELECT public.current_location_id())
    AND created_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "staff can update own or managed support tickets" ON public.support_tickets;
CREATE POLICY "staff can update own or managed support tickets"
  ON public.support_tickets
  FOR UPDATE
  TO authenticated
  USING (
    location_id = (SELECT public.current_location_id())
    AND (
      created_by = (SELECT auth.uid())
      OR COALESCE((SELECT public.has_permission('staff.manage')), false)
    )
  )
  WITH CHECK (location_id = (SELECT public.current_location_id()));
