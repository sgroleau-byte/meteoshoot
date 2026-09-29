import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { TBL_PREFS, TBL_PROJECTS, TBL_ROUTES, supabase } from '../lib/supabase.js';
import { useSubscription } from '../subscription/SubscriptionProvider.jsx';
import { ProjectStatus } from './constants.js';
import { fileHelpers } from './files.js';
import { generateId } from './helpers.js';

// ===== STORE =====
export const StoreContext = createContext();
export const useStore = () => useContext(StoreContext);

// Traduction Projet / ligne Supabase (camelCase et snake_case), source unique.
// projectFromRow: lecture (db vers app). PROJECT_TO_ROW: correspondance des champs (app vers db).
export const projectFromRow = (p) => ({
  id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng,
  status: p.status, mandates: p.mandates || [], orientation: p.orientation || [],
  isContest: p.is_contest, notes: p.notes, links: p.links || [],
  departureAddress: p.departure_address, departureLat: p.departure_lat, departureLng: p.departure_lng,
  travelTime: p.travel_time, sortOrder: p.sort_order,
  createdAt: p.created_at, shotAt: p.shot_at, completedAt: p.completed_at,
  buildings: p.buildings || [],
  clientFolder: p.client_folder ?? null, tag: p.tag ?? null,
  onHold: p.on_hold ?? false
});
export const PROJECT_TO_ROW = {
  name: 'name', address: 'address', lat: 'lat', lng: 'lng', status: 'status',
  mandates: 'mandates', orientation: 'orientation', isContest: 'is_contest',
  notes: 'notes', links: 'links', departureAddress: 'departure_address',
  departureLat: 'departure_lat', departureLng: 'departure_lng', travelTime: 'travel_time',
  shotAt: 'shot_at', createdAt: 'created_at', completedAt: 'completed_at', buildings: 'buildings',
  clientFolder: 'client_folder', tag: 'tag', onHold: 'on_hold'
};
// rowFromProject: écriture (app vers db), ligne complète. Sert à réinsérer un projet
// supprimé quand on annule la suppression (la ligne a déjà été effacée en base).
export const rowFromProject = (proj, userId) => {
  const row = { id: proj.id, user_id: userId, sort_order: proj.sortOrder ?? 0 };
  for (const [camel, snake] of Object.entries(PROJECT_TO_ROW)) {
    if (proj[camel] !== undefined) row[snake] = proj[camel];
  }
  return row;
};

// routeFromRow: lecture (db vers app). ROUTE_TO_ROW: correspondance des champs (app vers db).
export const routeFromRow = (r) => ({
  id: r.id, name: r.name || '', useHome: r.use_home !== false,
  departureAddress: r.departure_address || '', departureLat: r.departure_lat ?? null, departureLng: r.departure_lng ?? null,
  destinations: r.destinations || [], archived: r.archived || false,
  sortOrder: r.sort_order ?? 0, createdAt: r.created_at
});
export const ROUTE_TO_ROW = {
  name: 'name', useHome: 'use_home', departureAddress: 'departure_address',
  departureLat: 'departure_lat', departureLng: 'departure_lng',
  destinations: 'destinations', archived: 'archived', sortOrder: 'sort_order'
};

export const StoreProvider = ({ children }) => {
  const { user } = useAuth();
  const { canCreateProject, getProjectLimit } = useSubscription();
  const [projects, setProjects] = useState(() => JSON.parse(localStorage.getItem('sp-projects') || '[]'));
  const [prefs, setPrefsState] = useState(() => {
    const p = JSON.parse(localStorage.getItem('sp-prefs') || '{"homeAddress":"","homeLat":null,"homeLng":null,"prepTime":60}');
    // v633.110 : le seuil rouge par défaut de la liste Édition passe de 25 à 30 jours. Un 25 déjà enregistré
    // (ancien défaut, que le champ persistait dès qu'on le touchait) est retiré une seule fois.
    if (!localStorage.getItem('sp-edit-alert30')) { if (p.editAlertDays === 25) delete p.editAlertDays; localStorage.setItem('sp-edit-alert30', '1'); }
    return p;
  });
  // État ouvert/fermé des dossiers client, carte { "NOM": true|false }. Vide = aucun état
  // enregistré (on appliquera alors le défaut "2 premiers ouverts" à l'affichage). Persisté
  // dans les préférences Supabase (partagé web + PWA) et mis en cache local pour l'offline.
  const [folderStates, setFolderStatesState] = useState(() => { try { return JSON.parse(localStorage.getItem('sp-folder-states') || '{}'); } catch (e) { return {}; } });
  const [routes, setRoutes] = useState(() => JSON.parse(localStorage.getItem('sp-routes') || '[]'));
  const [view, setView] = useState('todo');
  const [selectedId, setSelectedId] = useState(null);
  const [synced, setSynced] = useState(false);

  // Cache to localStorage (always, for offline)
  useEffect(() => { localStorage.setItem('sp-projects', JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem('sp-prefs', JSON.stringify(prefs)); }, [prefs]);
  useEffect(() => { localStorage.setItem('sp-folder-states', JSON.stringify(folderStates)); }, [folderStates]);
  useEffect(() => { localStorage.setItem('sp-routes', JSON.stringify(routes)); }, [routes]);

  // === SUPABASE SYNC ===
  // On login: load from Supabase or migrate localStorage
  useEffect(() => {
    if (!user) return;

    // Clear localStorage if a different user logged in
    const prevUserId = localStorage.getItem('sp-user-id');
    if (prevUserId && prevUserId !== user.id) {
      localStorage.removeItem('sp-projects');
      localStorage.removeItem('sp-prefs');
      localStorage.removeItem('sp-folder-states');
      localStorage.removeItem('sp-routes');
      localStorage.removeItem('sp-migrated-to-supabase');
      setProjects([]);
      setPrefsState({homeAddress:'',homeLat:null,homeLng:null,prepTime:60});
      setFolderStatesState({});
      setRoutes([]);
    }
    localStorage.setItem('sp-user-id', user.id);

    const syncData = async () => {
      try {
        // Load projects from Supabase
        const { data: dbProjects, error: pErr } = await supabase
          .from(TBL_PROJECTS)
          .select('*')
          .order('sort_order', { ascending: true });
        
        // Load preferences
        const { data: dbPrefs, error: prErr } = await supabase
          .from(TBL_PREFS)
          .select('*')
          .single();

        if (pErr && pErr.code !== 'PGRST116') console.error('Projects load error:', pErr);
        if (prErr && prErr.code !== 'PGRST116') console.error('Prefs load error:', prErr);

        const { data: dbRoutes, error: rErr } = await supabase
          .from(TBL_ROUTES).select('*').order('sort_order', { ascending: true });
        if (rErr && rErr.code !== 'PGRST116') console.error('Routes load error:', rErr);
        if (dbRoutes) setRoutes(dbRoutes.map(routeFromRow));

        const hasDbData = dbProjects && dbProjects.length > 0;
        const hasLocalData = projects.length > 0;
        const alreadyMigrated = localStorage.getItem('sp-migrated-to-supabase');

        if (hasDbData) {
          // Supabase has data → use it
          setProjects(dbProjects.map(projectFromRow));
        } else if (hasLocalData && !alreadyMigrated) {
          // First login with localStorage data → migrate to Supabase
          for (let i = 0; i < projects.length; i++) {
            const p = projects[i];
            await supabase.from(TBL_PROJECTS).upsert({
              id: p.id, user_id: user.id, name: p.name, address: p.address,
              lat: p.lat, lng: p.lng, status: p.status || 'todo',
              mandates: p.mandates || [], orientation: p.orientation || [],
              is_contest: p.isContest || false, client_folder: p.clientFolder ?? null, tag: p.tag ?? null, notes: p.notes || '',
              links: p.links || [],
              departure_address: p.departureAddress, departure_lat: p.departureLat, departure_lng: p.departureLng,
              travel_time: p.travelTime, sort_order: i,
              created_at: p.createdAt || new Date().toISOString(),
              shot_at: p.shotAt, completed_at: p.completedAt
            });
          }
          localStorage.setItem('sp-migrated-to-supabase', 'true');
        }

        if (dbPrefs) {
          // Fusion (et non remplacement) : les réglages d'affichage de la liste Édition
          // ne sont pas en base et doivent survivre à la synchronisation.
          setPrefsState(p => ({
            ...p,
            homeAddress: dbPrefs.home_address || '', homeLat: dbPrefs.home_lat,
            homeLng: dbPrefs.home_lng, prepTime: dbPrefs.prep_time || 60
          }));
          // État des dossiers depuis le compte (partagé web + PWA). Absent/null sur les
          // anciens comptes ou si la migration n'a pas tourné: on garde {} (défaut appliqué à l'affichage).
          if (dbPrefs.folder_states && typeof dbPrefs.folder_states === 'object') {
            setFolderStatesState(dbPrefs.folder_states);
          }
        } else if (prefs.homeLat) {
          // Migrate prefs
          await supabase.from(TBL_PREFS).upsert({
            user_id: user.id, home_address: prefs.homeAddress,
            home_lat: prefs.homeLat, home_lng: prefs.homeLng,
            prep_time: typeof prefs.prepTime === 'number' ? prefs.prepTime : 60
          });
        }

        setSynced(true);
      } catch (err) {
        console.error('Sync error:', err);
        setSynced(true); // Continue with localStorage
      }
    };
    syncData();
  }, [user]);

  // Realtime subscription: sync across devices
  useEffect(() => {
    if (!user || !synced) return;
    const channel = supabase.channel('projects-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const p = payload.new;
          const mapped = projectFromRow(p);
          setProjects(prev => {
            const exists = prev.findIndex(x => x.id === p.id);
            if (exists >= 0) { const next = [...prev]; next[exists] = mapped; return next; }
            return [mapped, ...prev];
          });
        } else if (payload.eventType === 'DELETE') {
          setProjects(prev => prev.filter(x => x.id !== payload.old.id));
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user, synced]);

  // === CRUD (writes to Supabase + local state) ===
  const setPrefs = (update) => {
    setPrefsState(p => {
      const next = {...p, ...update};
      if (user) {
        supabase.from(TBL_PREFS).upsert({
          user_id: user.id, home_address: next.homeAddress,
          home_lat: next.homeLat, home_lng: next.homeLng,
          prep_time: typeof next.prepTime === 'number' ? next.prepTime : 60
        }).then(({ error }) => { if (error) console.error('Prefs save error:', error); });
      }
      return next;
    });
  };

  // Ouvre/ferme un dossier et persiste la carte complète dans les préférences.
  // L'upsert ne porte que sur folder_states: PostgREST ne touche pas les autres colonnes
  // (home_address, etc.), donc aucun écrasement des autres préférences.
  const setFolderState = (name, open) => {
    setFolderStatesState(prev => {
      const next = { ...prev, [name]: open };
      if (user) {
        supabase.from(TBL_PREFS).upsert({ user_id: user.id, folder_states: next })
          .then(({ error }) => { if (error) console.error('Folder state save error:', error); });
      }
      return next;
    });
  };

  const addProject = (data) => {
    // Check project limit for subscription tier
    const activeCount = projects.filter(p => p.status !== ProjectStatus.DONE).length;
    if (!canCreateProject(activeCount)) {
      return { error: 'limit_reached', limit: getProjectLimit() };
    }
    const proj = { id: generateId(), name: data.name || 'Nouveau', address: data.address || '', lat: data.lat, lng: data.lng, mandates: data.mandates || [], orientation: data.orientation || [], deliveryDate: data.deliveryDate || null, isContest: data.isContest || false, clientFolder: (data.clientFolder && data.clientFolder.trim()) || null, status: ProjectStatus.TODO, notes: '', links: [], buildings: [], travelTime: data.travelTime || null, departureAddress: data.departureAddress || null, departureLat: data.departureLat || null, departureLng: data.departureLng || null, createdAt: new Date().toISOString(), shotAt: null };
    setProjects(p => {
      const newList = [proj, ...p];
      // Update all sort_orders in Supabase
      if (user) {
        newList.forEach((pr, i) => {
          if (pr.id !== proj.id) supabase.from(TBL_PROJECTS).update({ sort_order: i }).eq('id', pr.id);
        });
      }
      return newList;
    });
    if (user) {
      supabase.from(TBL_PROJECTS).insert({
        id: proj.id, user_id: user.id, name: proj.name, address: proj.address,
        lat: proj.lat, lng: proj.lng, status: proj.status,
        mandates: proj.mandates, orientation: proj.orientation,
        is_contest: proj.isContest, client_folder: proj.clientFolder, notes: '', links: [], buildings: [],
        departure_address: proj.departureAddress, departure_lat: proj.departureLat, departure_lng: proj.departureLng,
        travel_time: proj.travelTime, sort_order: 0,
        created_at: proj.createdAt
      }).then(({ error }) => { if (error) console.error('Insert error:', error); });
    }
    return proj.id;
  };

  const updateProject = (id, upd) => {
    setProjects(p => p.map(x => x.id === id ? {...x, ...upd} : x));
    if (user) {
      // Map camelCase to snake_case
      const dbUpd = {};
      for (const [camel, snake] of Object.entries(PROJECT_TO_ROW)) {
        if (camel in upd) dbUpd[snake] = upd[camel];
      }
      if (Object.keys(dbUpd).length > 0) {
        supabase.from(TBL_PROJECTS).update(dbUpd).eq('id', id)
          .then(({ error }) => { if (error) console.error('Update error:', error); });
      }
    }
  };

  const [lastDeleted, setLastDeleted] = useState(null);
  const deleteTimerRef = useRef(null);
  // Id du projet supprimé dont les fichiers attachés attendent leur purge (fin de la
  // fenêtre d'annulation). Les fichiers ne sont pas purgés tout de suite pour que
  // l'annulation retrouve le dossier complet (aucune cascade en base sur project_files).
  const pendingFilePurgeRef = useRef(null);

  const purgePendingFiles = () => {
    const pid = pendingFilePurgeRef.current;
    pendingFilePurgeRef.current = null;
    if (pid && user) fileHelpers.deleteAllForProject(pid).catch(e => console.error('File cleanup error:', e));
  };

  const deleteProject = (id) => {
    const proj = projects.find(x => x.id === id);
    if (!proj) return;
    setProjects(p => p.filter(x => x.id !== id));
    if (selectedId === id) setSelectedId(null);
    // Une suppression précédente encore en fenêtre d'annulation devient définitive
    // (son toast est remplacé): purge de ses fichiers maintenant.
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    purgePendingFiles();
    setLastDeleted(proj);
    // Suppression immédiate en base: différée, elle sautait dès qu'on rechargeait
    // l'app pendant la fenêtre d'annulation (le projet réapparaissait au reload).
    // L'annulation réinsère la ligne complète via rowFromProject.
    if (user) {
      supabase.from(TBL_PROJECTS).delete().eq('id', id)
        .then(({ error }) => { if (error) console.error('Delete error:', error); });
    }
    pendingFilePurgeRef.current = id;
    deleteTimerRef.current = setTimeout(() => {
      purgePendingFiles();
      setLastDeleted(prev => prev?.id === id ? null : prev);
    }, 60000);
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    pendingFilePurgeRef.current = null;
    setProjects(p => [lastDeleted, ...p]);
    // Upsert plutôt qu'insert: idempotent si le delete n'était pas parti (hors ligne).
    if (user) {
      supabase.from(TBL_PROJECTS).upsert(rowFromProject(lastDeleted, user.id))
        .then(({ error }) => { if (error) console.error('Undo insert error:', error); });
    }
    setLastDeleted(null);
  };

  // === CRUD routes ===
  const addRoute = (data = {}) => {
    const route = {
      id: `r_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: data.name || '', useHome: data.useHome !== false,
      departureAddress: data.departureAddress || '', departureLat: data.departureLat ?? null, departureLng: data.departureLng ?? null,
      destinations: data.destinations || [], archived: false, sortOrder: 0, createdAt: new Date().toISOString()
    };
    setRoutes(prev => [route, ...prev]);
    if (user) {
      supabase.from(TBL_ROUTES).insert({
        id: route.id, user_id: user.id, name: route.name, use_home: route.useHome,
        departure_address: route.departureAddress, departure_lat: route.departureLat, departure_lng: route.departureLng,
        destinations: route.destinations, archived: false, sort_order: 0, created_at: route.createdAt
      }).then(({ error }) => { if (error) console.error('Route insert error:', error); });
    }
    return route.id;
  };

  const updateRoute = (id, upd) => {
    setRoutes(prev => prev.map(x => x.id === id ? { ...x, ...upd } : x));
    if (user) {
      const dbUpd = { updated_at: new Date().toISOString() };
      for (const [camel, snake] of Object.entries(ROUTE_TO_ROW)) {
        if (camel in upd) dbUpd[snake] = upd[camel];
      }
      supabase.from(TBL_ROUTES).update(dbUpd).eq('id', id)
        .then(({ error }) => { if (error) console.error('Route update error:', error); });
    }
  };

  const deleteRoute = (id) => {
    setRoutes(prev => prev.filter(x => x.id !== id));
    if (user) supabase.from(TBL_ROUTES).delete().eq('id', id)
      .then(({ error }) => { if (error) console.error('Route delete error:', error); });
  };

  const advanceProject = (id) => setProjects(p => p.map(x => {
    if (x.id !== id) return x;
    if (x.status === ProjectStatus.TODO) {
      const upd = { status: ProjectStatus.RETOUCHING, shotAt: new Date().toISOString() };
      if (user) supabase.from(TBL_PROJECTS).update({ status: upd.status, shot_at: upd.shotAt }).eq('id', id)
        .then(({ error }) => { if (error) console.error('Advance error:', error); });
      return {...x, ...upd};
    }
    if (x.status === ProjectStatus.RETOUCHING) {
      const upd = { status: ProjectStatus.DONE, completedAt: new Date().toISOString() };
      if (user) {
        fileHelpers.deleteAllForProject(id).catch(e => console.error('File cleanup error:', e));
        supabase.from(TBL_PROJECTS).update({ status: upd.status, completed_at: upd.completedAt }).eq('id', id)
          .then(({ error }) => { if (error) console.error('Advance error:', error); });
      }
      return {...x, ...upd};
    }
    return x;
  }));
  
  const revertProject = (id) => setProjects(p => p.map(x => {
    if (x.id !== id) return x;
    if (x.status === ProjectStatus.DONE) {
      const upd = { status: ProjectStatus.RETOUCHING, completedAt: null };
      if (user) supabase.from(TBL_PROJECTS).update({ status: upd.status, completed_at: null }).eq('id', id)
        .then(({ error }) => { if (error) console.error('Revert error:', error); });
      return {...x, ...upd};
    }
    if (x.status === ProjectStatus.RETOUCHING) {
      const upd = { status: ProjectStatus.TODO, shotAt: null };
      if (user) supabase.from(TBL_PROJECTS).update({ status: upd.status, shot_at: null }).eq('id', id)
        .then(({ error }) => { if (error) console.error('Revert error:', error); });
      return {...x, ...upd};
    }
    return x;
  }));
  
  const reorderProjects = (dragId, dropId) => {
    setProjects(p => {
      const dragIndex = p.findIndex(x => x.id === dragId);
      const dropIndex = p.findIndex(x => x.id === dropId);
      if (dragIndex === -1 || dropIndex === -1) return p;
      const newProjects = [...p];
      const [dragged] = newProjects.splice(dragIndex, 1);
      newProjects.splice(dropIndex, 0, dragged);
      // Update sort_order in Supabase
      if (user) {
        Promise.all(
          newProjects.map((proj, i) => 
            supabase.from(TBL_PROJECTS).update({ sort_order: i }).eq('id', proj.id)
          )
        ).then(results => {
          const errors = results.filter(r => r.error);
          if (errors.length) console.error('Reorder save errors:', errors);
        });
      }
      return newProjects;
    });
  };

  // Réordonne les projets TODO selon la séquence d'ids fournie (les projets non-TODO gardent
  // leur place), puis réécrit sort_order pour tous. Utilisé par le glisser structuré (dossiers,
  // cartes dans un dossier, cartes seules). Garde-fou: on n'applique que si la séquence couvre
  // exactement tous les TODO, sinon on ne touche à rien.
  const applyTodoOrder = (orderedTodoIds) => {
    setProjects(p => {
      const todoCount = p.filter(x => x.status === ProjectStatus.TODO).length;
      const byId = new Map(p.map(x => [x.id, x]));
      const queue = orderedTodoIds.map(id => byId.get(id)).filter(x => x && x.status === ProjectStatus.TODO);
      if (queue.length !== todoCount) return p;
      let qi = 0;
      const newProjects = p.map(x => x.status === ProjectStatus.TODO ? queue[qi++] : x);
      if (user) {
        Promise.all(
          newProjects.map((proj, i) => supabase.from(TBL_PROJECTS).update({ sort_order: i }).eq('id', proj.id))
        ).then(results => { const errors = results.filter(r => r.error); if (errors.length) console.error('Reorder save errors:', errors); });
      }
      return newProjects;
    });
  };

  // Assigne un projet à un dossier (clientFolder) ET applique le nouvel ordre TODO, en une
  // seule passe. Utilisé quand on dépose une carte sans dossier sur un dossier (glisser).
  const moveToFolder = (draggedId, folderName, orderedTodoIds) => {
    const cf = (folderName && folderName.trim()) || null;
    setProjects(p => {
      const todoCount = p.filter(x => x.status === ProjectStatus.TODO).length;
      const updated = p.map(x => x.id === draggedId ? { ...x, clientFolder: cf } : x);
      const byId = new Map(updated.map(x => [x.id, x]));
      const queue = orderedTodoIds.map(id => byId.get(id)).filter(x => x && x.status === ProjectStatus.TODO);
      const ordered = queue.length === todoCount;
      let next = updated;
      if (ordered) { let qi = 0; next = updated.map(x => x.status === ProjectStatus.TODO ? queue[qi++] : x); }
      if (user) {
        supabase.from(TBL_PROJECTS).update({ client_folder: cf }).eq('id', draggedId)
          .then(({ error }) => { if (error) console.error('Folder assign error:', error); });
        if (ordered) {
          Promise.all(next.map((proj, i) => supabase.from(TBL_PROJECTS).update({ sort_order: i }).eq('id', proj.id)))
            .then(results => { const errs = results.filter(r => r.error); if (errs.length) console.error('Reorder save errors:', errs); });
        }
      }
      return next;
    });
  };

  return <StoreContext.Provider value={{ projects, routes, synced, prefs, view, selectedId, setView, setSelectedId, addProject, updateProject, deleteProject, addRoute, updateRoute, deleteRoute, advanceProject, revertProject, reorderProjects, applyTodoOrder, moveToFolder, setPrefs, lastDeleted, undoDelete, folderStates, setFolderState }}>{children}</StoreContext.Provider>;
};
