// ============================================================
// MeteoShoot - Shared config, translations & i18n
// Loaded by all pages (index.html + site/*.html)
// ============================================================

// --- Supabase Config ---
var SUPABASE_URL = 'https://mioiieshhjqpakdlsfzw.supabase.co';
var SUPABASE_KEY = 'sb_publishable__6Z9fMxmUTmIieh5ABFBEQ_sHKygy2S';

// --- LemonSqueezy Config (placeholders - set from dashboard) ---
var LEMON_CHECKOUT_URL = 'https://driftandgrain.lemonsqueezy.com/checkout/buy/62706175-0f3d-4cfa-a1e5-d7c4cc7f80c8';

// --- Translations ---
var TRANSLATIONS = {
  fr: {
    // Auth
    login: 'connexion',
    loginLoading: 'connexion...',
    loginError: 'Les nuages passent, les mauvais mots de passe restent.',
    signup: 'créer un compte',
    signupTitle: 'CRÉER UN COMPTE',
    noAccount: 'Pas de compte?',
    hasAccount: 'Déjà un compte?',
    email: 'Courriel',
    password: 'Mot de passe',
    confirmPassword: 'Confirmer le mot de passe',
    createAccount: 'créer un compte',
    creatingAccount: 'création...',
    passwordMismatch: 'Les mots de passe ne dansent pas ensemble.',
    passwordTooShort: 'Au moins 6 caractères pour le mot de passe.',
    signupError: 'Oups, le ciel est couvert. Essayez de nouveau.',
    emailAlreadyExists: 'Ce courriel est déjà utilisé. Essayez de vous connecter.',
    checkEmail: 'Vérifiez votre boîte courriel pour confirmer votre compte.',
    emailSent: 'Courriel envoyé!',
    forgotPassword: 'Mot de passe oublié?',
    resetPassword: 'Réinitialiser le mot de passe',
    resetSent: 'Lien de réinitialisation envoyé par courriel.',
    backToLogin: 'Retour à la connexion',

    // Subscription tiers
    plan: 'ABONNEMENT',
    freePlan: 'GRATUIT',
    shooterPlan: 'SHOOTER',
    godPlan: 'GOD',
    freeTagline: 'Regarde le ciel',
    shooterTagline: "J'ai un plan",
    godTagline: "C'est moi le plan",
    active: 'ACTIF',
    canceled: 'ANNULÉ',
    pastDue: 'PAIEMENT EN RETARD',
    expired: 'EXPIRÉ',
    upgradeToShooter: 'PASSER AU MODE SHOOTER',
    manageSub: 'GÉRER MON ABONNEMENT',
    choosePlan: 'CHOISIR VOTRE PLAN',
    currentPlan: 'PLAN ACTUEL',
    comingSoon: 'BIENTÔT DISPONIBLE',
    perMonth: '/mois',
    perYear: '/an',

    // Tier features
    maxProjectsFree: '3 projets maximum',
    unlimitedProjects: 'Projets illimités',
    basicWeather: 'Météo de base',
    allFeatures: 'Toutes les fonctionnalités',
    continuousUpdates: 'Mises à jour en continu',
    storagePerProject: '30MB stockage/projet',
    shooterPlus: 'Tout de Shooter +',
    premiumWeather: 'Météo premium (API)',
    advancedFeatures: 'Fonctions avancées',
    limitReached: 'Limite de projets atteinte',

    // Navigation
    projects: 'PROJETS',
    editing: 'ÉDITION',
    preferences: 'PRÉFÉRENCES',

    // Project
    newProject: 'NOUVEAU PROJET',
    projectName: 'NOM DU PROJET',
    projectAddress: 'ADRESSE DU PROJET',
    departureAddress: 'ADRESSE DE DÉPART',
    departureHint: 'Hôtel, B&B...',
    enterAddress: "Entrer l'adresse...",
    projectNamePlaceholder: 'Client — Nom du projet',
    notes: 'NOTES',
    notesPlaceholder: 'Notes...',
    files: 'FICHIERS',
    noAddress: 'AUCUNE ADRESSE',
    deleteConfirm: 'SUPPRIMER ?',
    delete: 'Supprimer',
    moveToEditing: 'PASSER EN ÉDITION',
    moveToEditingConfirm: 'PASSER EN ÉDITION ?',
    cancel: 'ANNULER',
    added: 'AJOUTÉ',
    projectDeleted: 'PROJET SUPPRIMÉ',
    undo: 'ANNULER',
    created: 'CRÉÉ',
    edited: 'ÉDITION',
    noProjectsEditing: 'Aucun projet en édition',
    archived: 'ARCHIVÉ',
    archive: 'ARCHIVER',
    archiveConfirm: 'ARCHIVER ?',
    revert: 'REMETTRE',
    revertConfirm: 'REMETTRE ?',
    reactivate: 'RÉACTIVER',
    reactivateConfirm: 'RÉACTIVER ?',
    cancelEditing: 'ANNULER ÉDITION',
    cancelEditingConfirm: 'ANNULER ÉDITION ?',
    shape: 'FORME',
    projectDetailsTitle: 'DÉTAILS PROJET',
    projectsCount: 'PROJETS',

    // Weather
    weatherUnavailable: 'Météo non disponible',
    hourlyWeather: 'MÉTÉO HORAIRE',
    currentLocationWeather: 'MÉTÉO DE VOTRE POSITION ACTUELLE',
    browserLocationPermission: "Votre navigateur vous demandera l'autorisation d'accéder à votre position.",
    enableLocation: 'ACTIVER LA LOCALISATION',
    locationDenied: 'LOCALISATION REFUSÉE',
    locationHelp: 'Pour réactiver, allez dans Réglages > Safari > Localisation, ou dans les réglages de votre navigateur.',
    retry: 'RÉESSAYER',
    sunrise: 'LEVER',
    sunset: 'COUCHER',
    sunDate: 'DATE SOLEIL',
    updateLocation: 'METTRE À JOUR',
    kmh: 'KM/H',

    // Time & dates
    today: "AUJOURD'HUI",
    thisDay: 'CE JOUR',
    day: 'JOUR',
    days: 'JOURS',
    minutes: 'MINUTES',
    dayAbbrev: ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'],
    dayNames: ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'],
    monthAbbrev: ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEP', 'OCT', 'NOV', 'DÉC'],
    createdDate: 'DATE CRÉÉ',
    editedDate: 'DATE ÉDITION',

    // Orientation
    sun: 'SOLEIL',
    am: 'AM',
    pm: 'PM',
    travel: 'TRAJET',
    wake: 'RÉVEIL',

    // Settings
    homeAddressLabel: 'ADRESSE DE DÉPART PAR DÉFAUT (TRAJET)',
    homeAddressPlaceholder: 'Commencez à taper votre adresse...',
    prepTimeLabel: 'TEMPS DE PRÉPARATION (RÉVEIL)',
    weatherService: 'SERVICE MÉTÉO',
    apiKeyLabel: 'CLÉ API — SERVICE PREMIUM',
    apiKeyPlaceholder: 'Bientôt disponible...',
    disconnect: 'DÉCONNEXION',
    language: 'LANGUE',
    addressSaved: 'Adresse de départ sauvegardée!',
    addressSavedShort: 'Adresse sauvegardée!',
    addressNotFound: 'Adresse non trouvée',
    account: 'MON COMPTE',

    // Signup profile
    fullName: 'Prénom Nom',
    organization: 'Organisation (optionnel)',
    sector: 'Secteur',
    sectorOptions: ['Photographe / Vidéaste / Drone', 'Réalisateur', 'Équipe marketing', 'Créateur de contenu', 'Directeur artistique', 'Événementiel', 'Autre'],

    // Admin
    adminTitle: 'ADMIN',
    adminUsers: 'UTILISATEURS',
    adminStats: 'STATISTIQUES',
    adminTotalUsers: 'UTILISATEURS',
    adminTotalProjects: 'PROJETS',
    adminTierDistribution: 'TIERS',
    adminBySector: 'PAR SECTEUR',
    adminChangeTier: 'Changer le tier',
    adminUnauthorized: 'Accès non autorisé',
    adminConfirmed: 'Confirmé',
    adminPending: 'En attente',
    adminNoUsers: 'Aucun utilisateur',
    adminTierChanged: 'Tier modifié',

    // Errors
    errorPrefix: 'Erreur:',
    fileLimitExceeded: 'Limite de {limit} MB par projet dépassée',
  },

  en: {
    // Auth
    login: 'sign in',
    loginLoading: 'signing in...',
    loginError: 'Clouds pass, bad passwords stay.',
    signup: 'create account',
    signupTitle: 'CREATE ACCOUNT',
    noAccount: "Don't have an account?",
    hasAccount: 'Already have an account?',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm password',
    createAccount: 'create account',
    creatingAccount: 'creating...',
    passwordMismatch: "Passwords don't match.",
    passwordTooShort: 'Password must be at least 6 characters.',
    signupError: 'Oops, the sky is overcast. Try again.',
    emailAlreadyExists: 'This email is already in use. Try signing in.',
    checkEmail: 'Check your email to confirm your account.',
    emailSent: 'Email sent!',
    forgotPassword: 'Forgot password?',
    resetPassword: 'Reset password',
    resetSent: 'Reset link sent by email.',
    backToLogin: 'Back to sign in',

    // Subscription tiers
    plan: 'SUBSCRIPTION',
    freePlan: 'FREE',
    shooterPlan: 'SHOOTER',
    godPlan: 'GOD',
    freeTagline: 'Watch the sky',
    shooterTagline: 'I have a plan',
    godTagline: 'I am the plan',
    active: 'ACTIVE',
    canceled: 'CANCELED',
    pastDue: 'PAST DUE',
    expired: 'EXPIRED',
    upgradeToShooter: 'UPGRADE TO SHOOTER',
    manageSub: 'MANAGE SUBSCRIPTION',
    choosePlan: 'CHOOSE YOUR PLAN',
    currentPlan: 'CURRENT PLAN',
    comingSoon: 'COMING SOON',
    perMonth: '/mo',
    perYear: '/yr',

    // Tier features
    maxProjectsFree: '3 projects maximum',
    unlimitedProjects: 'Unlimited projects',
    basicWeather: 'Basic weather',
    allFeatures: 'All features',
    continuousUpdates: 'Continuous updates',
    storagePerProject: '30MB storage/project',
    shooterPlus: 'Everything in Shooter +',
    premiumWeather: 'Premium weather (API)',
    advancedFeatures: 'Advanced features',
    limitReached: 'Project limit reached',

    // Navigation
    projects: 'PROJECTS',
    editing: 'EDITING',
    preferences: 'PREFERENCES',

    // Project
    newProject: 'NEW PROJECT',
    projectName: 'PROJECT NAME',
    projectAddress: 'PROJECT ADDRESS',
    departureAddress: 'DEPARTURE ADDRESS',
    departureHint: 'Hotel, B&B...',
    enterAddress: 'Enter address...',
    projectNamePlaceholder: 'Client — Project name',
    notes: 'NOTES',
    notesPlaceholder: 'Notes...',
    files: 'FILES',
    noAddress: 'NO ADDRESS',
    deleteConfirm: 'DELETE?',
    delete: 'Delete',
    moveToEditing: 'MOVE TO EDITING',
    moveToEditingConfirm: 'MOVE TO EDITING?',
    cancel: 'CANCEL',
    added: 'ADDED',
    projectDeleted: 'PROJECT DELETED',
    undo: 'UNDO',
    created: 'CREATED',
    edited: 'EDITED',
    noProjectsEditing: 'No projects in editing',
    archived: 'ARCHIVED',
    archive: 'ARCHIVE',
    archiveConfirm: 'ARCHIVE?',
    revert: 'REVERT',
    revertConfirm: 'REVERT?',
    reactivate: 'REACTIVATE',
    reactivateConfirm: 'REACTIVATE?',
    cancelEditing: 'CANCEL EDITING',
    cancelEditingConfirm: 'CANCEL EDITING?',
    shape: 'SHAPE',
    projectDetailsTitle: 'PROJECT DETAILS',
    projectsCount: 'PROJECTS',

    // Weather
    weatherUnavailable: 'Weather unavailable',
    hourlyWeather: 'HOURLY WEATHER',
    currentLocationWeather: 'WEATHER FOR YOUR CURRENT LOCATION',
    browserLocationPermission: 'Your browser will ask for permission to access your location.',
    enableLocation: 'ENABLE LOCATION',
    locationDenied: 'LOCATION DENIED',
    locationHelp: 'To re-enable, go to Settings > Safari > Location, or to your browser settings.',
    retry: 'RETRY',
    sunrise: 'SUNRISE',
    sunset: 'SUNSET',
    sunDate: 'SUN DATE',
    updateLocation: 'UPDATE',
    kmh: 'KM/H',

    // Time & dates
    today: 'TODAY',
    thisDay: 'THIS DAY',
    day: 'DAY',
    days: 'DAYS',
    minutes: 'MINUTES',
    dayAbbrev: ['SUN.', 'MON.', 'TUE.', 'WED.', 'THU.', 'FRI.', 'SAT.'],
    dayNames: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    monthAbbrev: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
    createdDate: 'CREATED DATE',
    editedDate: 'EDITED DATE',

    // Orientation
    sun: 'SUN',
    am: 'AM',
    pm: 'PM',
    travel: 'TRAVEL',
    wake: 'WAKE',

    // Settings
    homeAddressLabel: 'DEFAULT DEPARTURE ADDRESS (TRAVEL)',
    homeAddressPlaceholder: 'Start typing your address...',
    prepTimeLabel: 'PREPARATION TIME (WAKE)',
    weatherService: 'WEATHER SERVICE',
    apiKeyLabel: 'API KEY — PREMIUM SERVICE',
    apiKeyPlaceholder: 'Coming soon...',
    disconnect: 'SIGN OUT',
    language: 'LANGUAGE',
    addressSaved: 'Departure address saved!',
    addressSavedShort: 'Address saved!',
    addressNotFound: 'Address not found',
    account: 'MY ACCOUNT',

    // Signup profile
    fullName: 'First Name Last Name',
    organization: 'Organization (optional)',
    sector: 'Sector',
    sectorOptions: ['Photographe / Vidéaste / Drone', 'Réalisateur', 'Équipe marketing', 'Créateur de contenu', 'Directeur artistique', 'Événementiel', 'Autre'],

    // Admin
    adminTitle: 'ADMIN',
    adminUsers: 'USERS',
    adminStats: 'STATISTICS',
    adminTotalUsers: 'USERS',
    adminTotalProjects: 'PROJECTS',
    adminTierDistribution: 'TIERS',
    adminBySector: 'BY SECTOR',
    adminChangeTier: 'Change tier',
    adminUnauthorized: 'Unauthorized access',
    adminConfirmed: 'Confirmed',
    adminPending: 'Pending',
    adminNoUsers: 'No users',
    adminTierChanged: 'Tier changed',

    // Errors
    errorPrefix: 'Error:',
    fileLimitExceeded: 'Limit of {limit} MB per project exceeded',
  }
};

// --- i18n Helper ---
function getDefaultLang() {
  var saved = localStorage.getItem('sp-lang');
  if (saved && TRANSLATIONS[saved]) return saved;
  var nav = (navigator.language || navigator.userLanguage || 'fr').toLowerCase();
  return nav.startsWith('fr') ? 'fr' : 'en';
}

// t() helper for use outside React (or in simple scripts)
function t(key, lang) {
  var l = lang || getDefaultLang();
  var tr = TRANSLATIONS[l];
  return (tr && tr[key] !== undefined) ? tr[key] : (TRANSLATIONS.fr[key] || key);
}
