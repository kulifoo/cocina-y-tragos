// Capa de datos: Supabase si está configurado, si no modo local (vista previa).
const CFG = window.APP_CONFIG || {};
export const usaSupabase = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);

let sb = null;

// ───────── almacenamiento local (con respaldo en memoria) ─────────
const mem = {};
const ls = {
  get(k, d) {
    try { const v = localStorage.getItem('cyt:' + k); return v == null ? d : JSON.parse(v); }
    catch { return k in mem ? mem[k] : d; }
  },
  set(k, v) {
    mem[k] = v;
    try { localStorage.setItem('cyt:' + k, JSON.stringify(v)); } catch { /* sin storage */ }
  },
};

function separar(r) {
  const { imagen, regenerar, ...data } = r;
  return { id: r.id, tipo: r.tipo, data, imagen: imagen || null, regenerar: !!regenerar };
}
function unir(row) { return { ...row.data, id: row.id, imagen: row.imagen, regenerar: row.regenerar }; }

export async function init() {
  if (!usaSupabase) return;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true } });
}

// ───────── sesión ─────────
export async function usuario() {
  if (!usaSupabase) return { email: 'vista previa' };
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user : null;
}
export async function entrar(email, pass) {
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) throw error;
}
export async function salir() { if (sb) await sb.auth.signOut(); }

// ───────── recetas ─────────
export async function listarRecetas() {
  if (!usaSupabase) return ls.get('recetas', null);
  const out = []; let desde = 0;
  for (;;) {
    const { data, error } = await sb.from('recetas').select('*').range(desde, desde + 999);
    if (error) throw error;
    out.push(...data.map(unir));
    if (data.length < 1000) break;
    desde += 1000;
  }
  return out;
}
export async function guardarRecetas(lista) {
  if (!usaSupabase) {
    const todas = ls.get('recetas', []) || [];
    const m = new Map(todas.map(r => [r.id, r]));
    lista.forEach(r => m.set(r.id, r));
    ls.set('recetas', [...m.values()]);
    return;
  }
  const { error } = await sb.from('recetas').upsert(lista.map(separar));
  if (error) throw error;
}
export async function borrarReceta(id) {
  if (!usaSupabase) { ls.set('recetas', (ls.get('recetas', []) || []).filter(r => r.id !== id)); return; }
  const { error } = await sb.from('recetas').delete().eq('id', id);
  if (error) throw error;
}

// ───────── clave/valor compartido (semanas, despensa, compras, etc.) ─────────
export async function leer(clave, def) {
  if (!usaSupabase) return ls.get('kv:' + clave, def);
  const { data, error } = await sb.from('estado').select('valor').eq('clave', clave).maybeSingle();
  if (error) throw error;
  return data ? data.valor : def;
}
export async function escribir(clave, valor) {
  if (!usaSupabase) { ls.set('kv:' + clave, valor); return; }
  const { error } = await sb.from('estado').upsert({ clave, valor, actualizado: new Date().toISOString() });
  if (error) throw error;
}
// Lee lo último y aplica el cambio (evita pisar lo que cargó la otra persona).
export async function actualizar(clave, def, fn) {
  const actual = await leer(clave, def);
  const nuevo = fn(actual ?? def);
  await escribir(clave, nuevo);
  return nuevo;
}

// ───────── historial ─────────
export async function listarHistorial() {
  if (!usaSupabase) return ls.get('historial', []);
  const { data, error } = await sb.from('historial').select('*').order('fecha', { ascending: false }).limit(2000);
  if (error) throw error;
  return data;
}
export async function guardarHistorial(entradas) {
  if (!entradas.length) return;
  if (!usaSupabase) {
    const m = new Map(ls.get('historial', []).map(e => [e.id, e]));
    entradas.forEach(e => m.set(e.id, e));
    ls.set('historial', [...m.values()]);
    return;
  }
  const { error } = await sb.from('historial').upsert(entradas);
  if (error) throw error;
}
export async function borrarHistorial(id) {
  if (!usaSupabase) { ls.set('historial', ls.get('historial', []).filter(e => e.id !== id)); return; }
  await sb.from('historial').delete().eq('id', id);
}

// ───────── fotos ─────────
export async function subirFoto(id, blob) {
  if (!usaSupabase) {
    return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  }
  const ruta = `${id}-${Date.now()}.webp`;
  const { error } = await sb.storage.from('fotos').upload(ruta, blob, { contentType: 'image/webp', upsert: true });
  if (error) throw error;
  return sb.storage.from('fotos').getPublicUrl(ruta).data.publicUrl;
}
