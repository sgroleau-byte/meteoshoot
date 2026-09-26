import { STORAGE_BUCKET, TBL_FILES, supabase } from '../lib/supabase.js';

export const MAX_PROJECT_FILES_MB = 30;

// === File helpers ===
export const fileHelpers = {
  async list(projectId) {
    const { data, error } = await supabase.from(TBL_FILES).select('*').eq('project_id', projectId).order('created_at', { ascending: true });
    if (error) { console.error('List files error:', error); return []; }
    return data || [];
  },
  async upload(projectId, userId, file) {
    const ts = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${projectId}/${ts}_${safeName}`;
    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, { contentType: file.type });
    if (upErr) { console.error('Storage upload error:', upErr); throw upErr; }
    const { error: dbErr } = await supabase.from(TBL_FILES).insert({
      project_id: projectId, user_id: userId, filename: file.name,
      size_bytes: file.size, mime_type: file.type, storage_path: storagePath
    });
    if (dbErr) { console.error('DB insert error:', dbErr); throw dbErr; }
  },
  async deleteFile(fileRow) {
    await supabase.storage.from(STORAGE_BUCKET).remove([fileRow.storage_path]);
    await supabase.from(TBL_FILES).delete().eq('id', fileRow.id);
  },
  async deleteAllForProject(projectId) {
    const files = await this.list(projectId);
    if (files.length === 0) return;
    const paths = files.map(f => f.storage_path);
    await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    await supabase.from(TBL_FILES).delete().eq('project_id', projectId);
  },
  async getUrl(storagePath) {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 3600);
    return data?.signedUrl || '';
  }
};
