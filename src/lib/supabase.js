import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../shared/config.js';

// ===== SUPABASE =====
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
export const TBL_PROJECTS = isDev ? 'projects_dev' : 'projects';
export const TBL_PREFS = isDev ? 'preferences_dev' : 'preferences';
export const TBL_FILES = isDev ? 'project_files_dev' : 'project_files';
export const TBL_ROUTES = isDev ? 'routes_dev' : 'routes';
export const TBL_ELEVATION = 'elevation_cache'; // shared global — no dev/prod split
export const STORAGE_BUCKET = 'project-files';
