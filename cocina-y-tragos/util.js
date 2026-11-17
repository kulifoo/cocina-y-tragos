// Utilidades generales
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
export const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'receta';

// ───────── fechas ─────────
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const deIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const hoy = () => iso(new Date());
export const sumarDias = (s, n) => { const d = deIso(s); d.setDate(d.getDate() + n); return iso(d); };
export const lunesDe = (s) => { const d = deIso(s); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
export const diasEntre = (a, b) => Math.round((deIso(b) - deIso(a)) / 86400000);
export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fechaCorta = (s) => { const d = deIso(s); return `${d.getDate()} ${MESES[d.getMonth()]}`; };

// ───────── cantidades ─────────
const FRAC = [[0.25, '¼'], [0.33, '⅓'], [0.5, '½'], [0.66, '⅔'], [0.75, '¾']];
export function fmtCant(q, unidad) {
  if (q == null || isNaN(q)) return '';
  if (['g', 'ml'].includes(unidad)) {
    if (q >= 1000) return `${+(q / 1000).toFixed(2)} ${unidad === 'g' ? 'kg' : 'l'}`.replace('.', ',');
    const r = q >= 100 ? Math.round(q / 10) * 10 : Math.round(q);
    return `${r} ${unidad}`;
  }
  const ent = Math.floor(q); const dec = q - ent;
  let txt = ent ? String(ent) : '';
  if (dec > 0.12) {
    const f = FRAC.reduce((a, b) => Math.abs(b[0] - dec) < Math.abs(a[0] - dec) ? b : a);
    if (dec > 0.87) txt = String(ent + 1); else txt += f[1];
  }
  if (!txt) txt = '¼';
  return `${txt} ${unidad || ''}`.trim();
}
export function textoIng(i, factor = 1) {
  if (i.cant == null) return { cant: i.unidad && i.unidad !== 'c/n' ? i.unidad : (i.unidad === 'c/n' ? 'c/n' : ''), nombre: i.nombre };
  return { cant: fmtCant(i.cant * factor, i.unidad), nombre: i.nombre };
}

// ───────── góndolas ─────────
const GONDOLAS = [
  ['Verdulería', ['papa', 'papines', 'cebolla', 'ajo', 'zanahoria', 'zapallito', 'zapallo', 'calabaza', 'morron', 'lechuga', 'rucula', 'espinaca', 'brocoli', 'perejil', 'albahaca', 'romero', 'menta', 'limon', 'lima', 'naranja', 'pomelo', 'manzana', 'banana', 'frutilla', 'durazno', 'sandia', 'pepino', 'palta', 'chaucha', 'apio', 'verdeo', 'jengibre', 'hojas verdes', 'tomate', 'hoja de lechuga']],
  ['Carnes y pescados', ['pollo', 'carne', 'nalga', 'cuadril', 'falda', 'merluza', 'pescado', 'bife', 'lomo', 'vacio']],
  ['Lácteos, huevos y fiambres', ['huevo', 'leche', 'yogur', 'queso', 'muzzarella', 'ricota', 'provolone', 'crema', 'dulce de leche', 'manteca', 'jamon', 'panceta', 'chorizo', 'feta']],
  ['Bebidas', ['fernet', 'gin', 'campari', 'vermut', 'aperol', 'espumante', 'ron ', 'ron', 'cachaca', 'bourbon', 'tequila', 'triple sec', 'gaseosa', 'tonica', 'soda', 'ginger', 'hielo', 'vino', 'cerveza', 'amargo', 'jugo de pomelo', 'jugo de naranja']],
];
export function gondola(nombre) {
  const n = norm(nombre);
  if (/\b(tomate triturado|pure de tomate)\b/.test(n)) return 'Almacén';
  for (const [g, kws] of GONDOLAS) if (kws.some(k => n === k.trim() || n.startsWith(k) || n.includes(' ' + k.trim()))) return g;
  return 'Almacén';
}
export const ORDEN_GONDOLAS = ['Verdulería', 'Carnes y pescados', 'Lácteos, huevos y fiambres', 'Almacén', 'Bebidas', 'Preparaciones caseras', 'Otros'];

export const BASICOS_DEFAULT = ['sal', 'sal gruesa', 'pimienta', 'aceite', 'aceite de oliva', 'aceite para freír', 'azúcar', 'vinagre', 'orégano', 'pimentón', 'comino', 'nuez moscada', 'canela', 'ají molido', 'esencia de vainilla', 'polvo de hornear', 'agua', 'agua fría', 'agua tibia', 'hielo'];

// Proteína principal (para no repetir días seguidos)
export function proteina(r) {
  const t = norm(r.ingredientes.map(i => i.nombre).join(' '));
  if (/pollo/.test(t)) return 'pollo';
  if (/merluza|pescado|atun|salmon/.test(t)) return 'pescado';
  if (/carne|nalga|cuadril|falda|bife/.test(t)) return 'carne';
  if (/lenteja|garbanzo|poroto/.test(t)) return 'legumbre';
  return 'vegetal';
}

// ───────── imagen comprimida ─────────
export async function comprimir(file, max = 1200) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise(res => c.toBlob(res, 'image/webp', 0.82));
}

export const PLANTILLA_IMG = {
  comida: 'Vista cenital o 45°, sobre mesa de madera clara, vajilla de cerámica artesanal, luz natural lateral suave, sombras suaves.',
  trago: 'Vista frontal a la altura del vaso, fondo oscuro con iluminación cálida de bar, gotas de condensación, decoración visible.',
  cola: 'Estilo editorial, colores naturales, profundidad de campo baja, sin texto, sin manos, sin logos, formato 4:3.',
};
export function armarPrompt(r) {
  const desc = r.descripcion ? `, ${r.descripcion}` : '';
  return `Fotografía gastronómica profesional de ${String(r.nombre || '').toLowerCase()}${desc}. ${PLANTILLA_IMG[r.tipo === 'trago' ? 'trago' : 'comida']} ${PLANTILLA_IMG.cola}`;
}
