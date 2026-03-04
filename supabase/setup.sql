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

-- 7. Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (user_id, subscription_tier, subscription_status)
  VALUES (NEW.id, 'free', 'active');

  INSERT INTO user_profiles_dev (user_id, subscription_tier, subscription_status)
  VALUES (NEW.id, 'free', 'active');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 8. Add lang column to preferences tables
ALTER TABLE preferences ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'fr';
ALTER TABLE preferences_dev ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'fr';
