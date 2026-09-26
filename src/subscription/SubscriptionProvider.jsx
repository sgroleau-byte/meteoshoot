import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';

// ===== SUBSCRIPTION =====
export const TBL_USER_PROFILES = isDev ? 'user_profiles_dev' : 'user_profiles';

export const TIER_LIMITS = {
  free: { maxProjects: Infinity },
  shooter: { maxProjects: Infinity },
  god: { maxProjects: Infinity }
};

export const SubscriptionContext = createContext();
export const useSubscription = () => useContext(SubscriptionContext);

export const SubscriptionProvider = ({ children }) => {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [subLoading, setSubLoading] = useState(true);

  useEffect(() => {
    if (!user) { setProfile(null); setSubLoading(false); return; }

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from(TBL_USER_PROFILES)
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code === 'PGRST116') {
        // No profile found — create one (fallback for users created before trigger).
        // Les colonnes d'abonnement ne sont plus modifiables par le client (droits par colonne):
        // elles prennent leurs valeurs par défaut en base (free / active).
        const { data: newProfile } = await supabase
          .from(TBL_USER_PROFILES)
          .insert({ user_id: user.id })
          .select()
          .single();
        setProfile(newProfile);
      } else if (data) {
        setProfile(data);
      }
      setSubLoading(false);
    };

    loadProfile();

    // Realtime subscription for profile changes (webhook updates tier)
    const channel = supabase.channel('profile-changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: TBL_USER_PROFILES,
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        setProfile(payload.new);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const tier = profile?.subscription_tier || 'free';
  const limits = TIER_LIMITS[tier];
  const isActive = profile?.subscription_status === 'active' || profile?.subscription_status === 'trialing';

  const canCreateProject = (currentCount) => {
    return currentCount < limits.maxProjects;
  };

  const getProjectLimit = () => limits.maxProjects;
  const isShooterUser = () => tier === 'shooter' || tier === 'god';

  return (
    <SubscriptionContext.Provider value={{
      profile, subLoading, tier, isActive,
      canCreateProject, getProjectLimit, isShooterUser, limits
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
};
