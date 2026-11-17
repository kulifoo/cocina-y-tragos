// Genera en lote las fotos que faltan (o marcadas para regenerar) y las sube a Supabase.
// Se corre desde GitHub Actions ("Generar imágenes") o localmente con:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... OPENAI_API_KEY=... node generar-imagenes.mjs
//
// Variables opcionales:
//   IMAGE_MODEL   modelo de imágenes de OpenAI (por defecto gpt-image-1)
//   IMAGE_QUALITY low | medium | high (por defecto medium)
//   LIMITE        cantidad máxima a generar en esta corrida (por defecto todas)
//   SOLO_IDS      ids separados por coma, para generar solo esas

import sharp from 'sharp';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY } = process.env;
const MODEL = process.env.IMAGE_MODEL || 'gpt-image-1';
const QUALITY = process.env.IMAGE_QUALITY || 'medium';
const LIMITE = parseInt(process.env.LIMITE || '0', 10);
const SOLO = (process.env.SOLO_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY })) {
  if (!v) { console.error(`Falta la variable ${k}. Cargala en GitHub → Settings → Secrets and variables → Actions.`); process.exit(1); }
}
const base = SUPABASE_URL.replace(/\/$/, '');
// Clave nueva (sb_secret_…) va solo en "apikey"; la clásica (JWT) también en Authorization
const sbHeaders = SUPABASE_SERVICE_KEY.startsWith('eyJ')
  ? { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
  : { apikey: SUPABASE_SERVICE_KEY };

async function pendientes() {
  const r = await fetch(`${base}/rest/v1/recetas?select=id,data,imagen,regenerar&or=(imagen.is.null,regenerar.eq.true)`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`Supabase (leer recetas): ${r.status} ${await r.text()}`);
  let filas = await r.json();
  if (SOLO.length) filas = filas.filter(f => SOLO.includes(f.id));
  if (LIMITE > 0) filas = filas.slice(0, LIMITE);
  return filas;
}

async function generar(prompt) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(MODEL.startsWith('dall-e')
      ? { model: MODEL, prompt, size: '1792x1024', quality: QUALITY === 'high' ? 'hd' : 'standard', response_format: 'b64_json', n: 1 }
      : { model: MODEL, prompt, size: '1536x1024', quality: QUALITY, n: 1 }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`OpenAI: ${j.error?.message || r.status}`);
  const d = j.data[0];
  if (d.b64_json) return Buffer.from(d.b64_json, 'base64');
  return Buffer.from(await (await fetch(d.url)).arrayBuffer());
}

async function subir(id, png) {
  // Recorte 4:3 y compresión WebP (máx. 1200 px)
  const webp = await sharp(png).resize(1200, 900, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  const ruta = `${id}-${Date.now()}.webp`;
  const r = await fetch(`${base}/storage/v1/object/fotos/${ruta}`, {
    method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'image/webp', 'x-upsert': 'true' }, body: webp,
  });
  if (!r.ok) throw new Error(`Supabase (subir foto): ${r.status} ${await r.text()}`);
  return `${base}/storage/v1/object/public/fotos/${ruta}`;
}

async function guardar(id, url) {
  const r = await fetch(`${base}/rest/v1/recetas?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ imagen: url, regenerar: false, actualizado: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Supabase (guardar): ${r.status} ${await r.text()}`);
}

const filas = await pendientes();
console.log(`Imágenes a generar: ${filas.length}`);
let ok = 0; const fallas = [];
for (const [i, f] of filas.entries()) {
  const nombre = f.data?.nombre || f.id;
  const prompt = f.data?.prompt_imagen || `Fotografía gastronómica profesional de ${nombre}. Estilo editorial, sin texto, formato 4:3.`;
  process.stdout.write(`[${i + 1}/${filas.length}] ${nombre}… `);
  try {
    const png = await generar(prompt);
    const url = await subir(f.id, png);
    await guardar(f.id, url);
    ok++; console.log('✓');
  } catch (e) {
    fallas.push(`${nombre}: ${e.message}`); console.log('✗ ' + e.message);
  }
}
console.log(`\nListo: ${ok} generadas, ${fallas.length} con error.`);
if (fallas.length) { console.log(fallas.join('\n')); if (!ok) process.exit(1); }
