import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';

// ===== ABONNEMENT =====
// Palier effectif (phase 3, 25 octobre 2026): « complet » si l'abonnement est actif OU si la période gratuite court
// encore (trial_ends_at, posée par dieu à l'invitation); sinon « gratuit », bridé selon les réglages de dieu
// (app_settings.free_limits: projets actifs, vue 3D; la prévision sur 10 jours est la même pour tout le monde). Tant que le profil n'est pas chargé, rien
// n'est bridé (pas de clignotement des limites au démarrage).
export const TBL_USER_PROFILES = isDev ? 'user_profiles_dev' : 'user_profiles';
const DEFAULT_FREE_LIMITS = { maxProjects: 3, scene3d: false };
const FULL_LIMITS = { maxProjects: Infinity, scene3d: true, forecastDays: 10 };
const PAID_TIERS = ['shooter', 'god'];
const PAID_STATUSES = ['active', 'past_due', 'trialing'];

export const SubscriptionContext = createContext();
export const useSubscription = () => useContext(SubscriptionContext);

export const SubscriptionProvider = ({ children }) => {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [freeSettings, setFreeSettings] = useState(null);
  const [subLoading, setSubLoading] = useState(true);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!user) { setProfile(null); setSubLoading(false); return; }

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from(TBL_USER_PROFILES)
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code === 'PGRST116') {
        // Pas de profil: on le crée (comptes d'avant le déclencheur). Les colonnes d'abonnement ne sont pas
        // modifiables par le client (droits par colonne): elles prennent leurs valeurs par défaut en base.
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
    // Réglages du gratuit, décidés dans dieu (lecture ouverte aux comptes connectés).
    supabase.from('app_settings').select('value').eq('key', 'free_limits').maybeSingle()
      .then(({ data }) => { if (data?.value) setFreeSettings(data.value); }, () => {});
    // Dernière visite (lue dans le tableau de bord dieu): au plus une écriture par heure, côté serveur.
    supabase.rpc('touch_last_seen').then(() => {}, () => {});

    // Le profil suit en temps réel (dieu change le palier ou la fin de gratuité, le webhook de paiement aussi).
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

  // L'heure avance (fin de gratuité qui tombe pendant que l'app reste ouverte): une relecture par heure.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 3600000);
    return () => clearInterval(id);
  }, []);

  const derived = useMemo(() => {
    const isPaid = !!profile && PAID_TIERS.includes(profile.subscription_tier) && PAID_STATUSES.includes(profile.subscription_status);
    const trialEndsAt = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null;
    const inTrial = !isPaid && !!trialEndsAt && trialEndsAt.getTime() > now;
    const trialEnded = !isPaid && !!trialEndsAt && trialEndsAt.getTime() <= now;
    const trialDaysLeft = inTrial ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / 86400000)) : 0;
    const disabled = !!profile?.disabled_at;
    const tier = !profile ? 'free' : disabled ? 'free' : isPaid ? profile.subscription_tier : inTrial ? 'shooter' : 'free';
    const freeLimits = { ...DEFAULT_FREE_LIMITS, ...(freeSettings || {}) };
    // Profil pas encore lu: pas de bridage (on ne ferme rien avant de savoir).
    const limits = (!profile || tier !== 'free')
      ? FULL_LIMITS
      : { maxProjects: Number.isFinite(freeLimits.maxProjects) ? freeLimits.maxProjects : 3, scene3d: !!freeLimits.scene3d, forecastDays: 10 };
    return { isPaid, trialEndsAt, inTrial, trialEnded, trialDaysLeft, tier, freeLimits, limits, isFounder: !!profile?.is_founder };
  }, [profile, freeSettings, now]);

  const { tier, limits } = derived;
  const isActive = profile?.subscription_status === 'active' || profile?.subscription_status === 'trialing' || derived.inTrial;

  const canCreateProject = (currentCount) => currentCount < limits.maxProjects;
  const getProjectLimit = () => limits.maxProjects;
  const isShooterUser = () => tier === 'shooter' || tier === 'god';
  const canUse3d = () => !!limits.scene3d;
  const openUpgrade = useCallback(() => setUpgradeOpen(true), []);
  const closeUpgrade = useCallback(() => setUpgradeOpen(false), []);

  return (
    <SubscriptionContext.Provider value={{
      profile, subLoading, tier, isActive,
      canCreateProject, getProjectLimit, isShooterUser, limits,
      canUse3d, forecastDays: limits.forecastDays,
      isPaid: derived.isPaid, inTrial: derived.inTrial, trialEnded: derived.trialEnded, trialDaysLeft: derived.trialDaysLeft,
      trialEndsAt: derived.trialEndsAt, isFounder: derived.isFounder, freeLimits: derived.freeLimits,
      upgradeOpen, openUpgrade, closeUpgrade
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
};
