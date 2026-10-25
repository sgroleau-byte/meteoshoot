// Repère du calage de l'image dans la pose du modèle importé (v633.243): { s, x, n } (et o, l'origine de x et n, une
// fois enregistré). Clé de comparaison sur les valeurs seules: la colonne jsonb de Postgres réordonne les clés d'un
// objet, et une comparaison du texte jugeait la pose changée à chaque passage en ligne (réécriture sans fin d'un
// appareil à l'autre).
export const satKey = (r) => r === undefined ? '-' : (r && typeof r === 'object' && !Array.isArray(r)) ? JSON.stringify([Array.isArray(r.s) ? r.s : null, r.x, r.n]) : JSON.stringify(r);
