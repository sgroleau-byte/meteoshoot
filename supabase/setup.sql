-- ============================================================
-- MeteoShoot - Database Setup for User Management & Subscriptions
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Create user_profiles table (production)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'shooter', 'god')),
  subscription_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'expired')),
  lemon_customer_id TEXT,
  lemon_subscription_id TEXT,
  payment_provider TEXT DEFAULT 'lemonsqueezy',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create user_profiles_dev table (development)
CREATE TABLE IF NOT EXISTS user_profiles_dev (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'shooter', 'god')),
  subscription_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'expired')),
  lemon_customer_id TEXT,
  lemon_subscription_id TEXT,
  payment_provider TEXT DEFAULT 'lemonsqueezy',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_lemon ON user_profiles(lemon_customer_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_dev_user_id ON user_profiles_dev(user_id);

-- 4. Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_dev_updated_at
  BEFORE UPDATE ON user_profiles_dev
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Row Level Security - Production
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 6. Row Level Security - Dev
ALTER TABLE user_profiles_dev ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile dev"
  ON user_profiles_dev FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile dev"
  ON user_profiles_dev FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile dev"
  ON user_profiles_dev FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 7. Profile columns for name, organization, sector
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS sector TEXT;
ALTER TABLE user_profiles_dev ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE user_profiles_dev ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE user_profiles_dev ADD COLUMN IF NOT EXISTS sector TEXT;

-- 8. Auto-create profile on signup (with metadata)
-- NOTE: SET search_path = public is required because the trigger fires from
-- the auth schema, which doesn't include public in its default search_path.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, subscription_tier, subscription_status, full_name, organization, sector)
  VALUES (NEW.id, 'free', 'active', NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'organization', NEW.raw_user_meta_data->>'sector');

  INSERT INTO public.user_profiles_dev (user_id, subscription_tier, subscription_status, full_name, organization, sector)
  VALUES (NEW.id, 'free', 'active', NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'organization', NEW.raw_user_meta_data->>'sector');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop existing trigger if it exists, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 9. Add lang column to preferences tables
ALTER TABLE preferences ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'fr';
ALTER TABLE preferences_dev ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'fr';

-- 10. Row Level Security - Projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_dev ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own projects" ON projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own projects" ON projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own projects" ON projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own projects" ON projects FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users read own projects dev" ON projects_dev FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own projects dev" ON projects_dev FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own projects dev" ON projects_dev FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own projects dev" ON projects_dev FOR DELETE USING (auth.uid() = user_id);

-- 11. Row Level Security - Preferences
ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferences_dev ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own prefs" ON preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own prefs" ON preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own prefs" ON preferences FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users read own prefs dev" ON preferences_dev FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own prefs dev" ON preferences_dev FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own prefs dev" ON preferences_dev FOR UPDATE USING (auth.uid() = user_id);

-- 12. Row Level Security - Files
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files_dev ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own files" ON project_files FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own files" ON project_files FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own files" ON project_files FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own files" ON project_files FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users read own files dev" ON project_files_dev FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own files dev" ON project_files_dev FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own files dev" ON project_files_dev FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own files dev" ON project_files_dev FOR DELETE USING (auth.uid() = user_id);

-- 13. Admin RPC functions (SECURITY DEFINER — bypass RLS, admin email check inside)

-- List all users with profile + project count
CREATE OR REPLACE FUNCTION admin_get_all_users()
RETURNS TABLE (
  user_id UUID, email TEXT, created_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ,
  full_name TEXT, organization TEXT, sector TEXT,
  subscription_tier TEXT, subscription_status TEXT,
  project_count BIGINT
) AS $$
BEGIN
  IF (SELECT au.email FROM auth.users au WHERE au.id = auth.uid()) != 'sgroleau@me.com' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT au.id, au.email::TEXT, au.created_at, au.confirmed_at,
    up.full_name, up.organization, up.sector,
    up.subscription_tier, up.subscription_status,
    COALESCE(pc.cnt, 0)
  FROM auth.users au
  LEFT JOIN public.user_profiles up ON up.user_id = au.id
  LEFT JOIN (SELECT p.user_id, COUNT(*) AS cnt FROM public.projects p GROUP BY p.user_id) pc ON pc.user_id = au.id
  ORDER BY au.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Global stats
CREATE OR REPLACE FUNCTION admin_get_stats()
RETURNS JSON AS $$
DECLARE result JSON;
BEGIN
  IF (SELECT au.email FROM auth.users au WHERE au.id = auth.uid()) != 'sgroleau@me.com' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT json_build_object(
    'total_users', (SELECT COUNT(*) FROM auth.users),
    'total_projects', (SELECT COUNT(*) FROM public.projects),
    'users_by_tier', (SELECT json_object_agg(subscription_tier, cnt) FROM (SELECT subscription_tier, COUNT(*) AS cnt FROM public.user_profiles GROUP BY subscription_tier) t),
    'users_by_sector', (SELECT json_object_agg(COALESCE(sector, 'N/A'), cnt) FROM (SELECT sector, COUNT(*) AS cnt FROM public.user_profiles GROUP BY sector) t)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Change a user's subscription tier
CREATE OR REPLACE FUNCTION admin_set_tier(target_user_id UUID, new_tier TEXT)
RETURNS VOID AS $$
BEGIN
  IF (SELECT au.email FROM auth.users au WHERE au.id = auth.uid()) != 'sgroleau@me.com' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.user_profiles SET subscription_tier = new_tier WHERE user_id = target_user_id;
  UPDATE public.user_profiles_dev SET subscription_tier = new_tier WHERE user_id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 14. Dossiers client (regroupement des projets) + tag (transversal, créé maintenant
--     mais PAS encore utilisé dans l'interface), et état ouvert/fermé des dossiers.
--     Dev EN PREMIER (tester en local), puis prod avant le déploiement.
ALTER TABLE projects_dev ADD COLUMN IF NOT EXISTS client_folder TEXT;
ALTER TABLE projects_dev ADD COLUMN IF NOT EXISTS tag           TEXT;
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS client_folder TEXT;
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS tag           TEXT;

-- État ouvert/fermé des dossiers, par utilisateur, partagé entre le web et la PWA.
-- Carte { "NOM DU DOSSIER": true|false } (true = ouvert).
ALTER TABLE preferences_dev ADD COLUMN IF NOT EXISTS folder_states JSONB DEFAULT '{}'::jsonb;
ALTER TABLE preferences     ADD COLUMN IF NOT EXISTS folder_states JSONB DEFAULT '{}'::jsonb;
