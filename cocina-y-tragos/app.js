import * as DB from './store.js';
import {
  $, $$, esc, norm, slug, hoy, sumarDias, lunesDe, diasEntre, DIAS, fechaCorta, deIso,
  fmtCant, textoIng, gondola, ORDEN_GONDOLAS, BASICOS_DEFAULT, proteina, comprimir, armarPrompt,
} from './util.js';

// ═════════════════════════ ESTADO ═════════════════════════
const S = {
  recetas: [], meta: {}, despensa: null, ajustes: null, historial: [], plantillas: [],
  semanas: {}, compras: {}, domingo: {}, timers: [],
};
const UI = {
  cocina: { linea: 'todas', cat: 'todas', q: '', f: new Set() },
  tragos: { alcohol: 'todos', q: '', tengo: false },
  semana: lunesDe(hoy()), porc: {}, tachados: {}, tab: {}, paso: 0, despTab: 'stock', fotoPendiente: null,
};
const porId = (id) => S.recetas.find(r => r.id === id);
const comidas = () => S.recetas.filter(r => r.tipo !== 'trago');
const tragos = () => S.recetas.filter(r => r.tipo === 'trago');
const meta = (id) => S.meta[id] || {};
const vacia = () => ({ dias: Array.from({ length: 7 }, () => ({ almuerzo: null, cena: null, trago: null })) });

const CATS = ['entradas', 'principales', 'guarniciones', 'ensaladas', 'sopas', 'postres', 'panadería', 'salsas'];
const EMOJI = { entradas: '🥟', principales: '🍽️', guarniciones: '🥔', ensaladas: '🥗', sopas: '🍲', postres: '🍮', 'panadería': '🍞', salsas: '🫙' };
const LINEA = { liviano: 'Liviano', 'dia-libre': 'Día libre' };
const LUGARES = ['heladera', 'freezer', 'alacena', 'barra'];
const SLOTS = { almuerzo: 'Almuerzo', cena: 'Cena', trago: 'Trago' };

// ═════════════════════════ ARRANQUE ═════════════════════════
async function boot() {
  try {
    await DB.init();
    const u = await DB.usuario();
    if (!u) return pantallaLogin();
    S.usuario = u;
    await cargar();
  } catch (e) {
    console.error(e);
    $('#vista').innerHTML = `<div class="vacio"><p>No se pudo conectar.</p><p class="sub">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reintentar</button></div>`;
    return;
  }
  window.addEventListener('hashchange', () => { salirCocina(); render(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && DB.usaSupabase) recargar(); });
  setInterval(tickTimers, 1000);
  datalists();
  render(true);
}

async function cargarSeed() {
  if (window.SEED) return window.SEED.recetas;
  const r = await fetch('seed.json'); return (await r.json()).recetas;
}

async function cargar() {
  const [sembrado, rec] = await Promise.all([DB.leer('sembrado', false), DB.listarRecetas()]);
  S.recetas = rec || [];
  if (!sembrado) {
    const seed = await cargarSeed();
    const ya = new Set(S.recetas.map(r => r.id));
    const nuevas = seed.filter(r => !ya.has(r.id));
    if (nuevas.length) await DB.guardarRecetas(nuevas);
    await DB.escribir('sembrado', true);
    S.recetas = [...S.recetas, ...nuevas];
  }
  const [m, d, a, p, h] = await Promise.all([
    DB.leer('meta', {}), DB.leer('despensa', null), DB.leer('ajustes', null), DB.leer('plantillas', []), DB.listarHistorial(),
  ]);
  S.meta = m || {}; S.plantillas = p || []; S.historial = h || [];
  S.despensa = d || { basicos: BASICOS_DEFAULT, stock: [], freezer: [] };
  S.ajustes = a || { porciones: 3, porcionesTrago: 2 };
  await cargarSemana(UI.semana);
  await cargarSemana(sumarDias(UI.semana, -7));
  await autoHistorial();
}

async function recargar() {
  try {
    S.recetas = (await DB.listarRecetas()) || S.recetas;
    S.meta = await DB.leer('meta', {});
    S.despensa = await DB.leer('despensa', S.despensa) || S.despensa;
    S.historial = await DB.listarHistorial();
    delete S.semanas[UI.semana]; delete S.compras[UI.semana];
    await cargarSemana(UI.semana);
    if (!location.hash.startsWith('#/editar') && !location.hash.startsWith('#/cocinar')) render();
  } catch (e) { console.warn(e); }
}

async function cargarSemana(wk) {
  if (!S.semanas[wk]) S.semanas[wk] = (await DB.leer('semana:' + wk, null)) || vacia();
  if (!S.compras[wk]) S.compras[wk] = (await DB.leer('compras:' + wk, null)) || { marcados: {}, extra: [] };
  if (!S.domingo[wk]) S.domingo[wk] = (await DB.leer('domingo:' + wk, null)) || {};
  return S.semanas[wk];
}

// Registra en el historial lo planificado en días que ya pasaron.
async function autoHistorial() {
  const ids = new Set(S.historial.map(e => e.id));
  const nuevas = [];
  for (const wk of [UI.semana, sumarDias(UI.semana, -7)]) {
    const plan = S.semanas[wk]; if (!plan) continue;
    plan.dias.forEach((dia, i) => {
      const fecha = sumarDias(wk, i);
      if (fecha >= hoy()) return;
      for (const slot of Object.keys(SLOTS)) {
        const s = dia[slot]; const id = `${fecha}:${slot}`;
        if (s && porId(s.id) && !ids.has(id)) nuevas.push({ id, receta_id: s.id, fecha, slot });
      }
    });
  }
  if (nuevas.length) { await DB.guardarHistorial(nuevas); S.historial.push(...nuevas); }
}

// ═════════════════════════ LOGIN ═════════════════════════
function pantallaLogin() {
  document.body.classList.add('sin-nav');
  $('#vista').innerHTML = `
  <div class="login">
    <div class="logo-grande">🍳🍹</div>
    <h1>Cocina &amp; Tragos</h1>
    <form id="f-login">
      <input name="email" type="email" placeholder="Email" autocomplete="username" required>
      <input name="pass" type="password" placeholder="Contraseña" autocomplete="current-password" required>
      <button class="btn grande">Entrar</button>
      <p class="error" id="login-err"></p>
    </form>
  </div>`;
  $('#f-login').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await DB.entrar(f.get('email'), f.get('pass')); location.reload(); }
    catch (err) { $('#login-err').textContent = 'No pudimos entrar: ' + err.message; }
  };
}

// ═════════════════════════ ROUTER ═════════════════════════
const VISTAS = {};
let rutaAnterior = '';
function render(scrollTop) {
  const partes = (location.hash.replace(/^#\/?/, '') || 'cocina').split('/').map(decodeURIComponent);
  const [ruta, ...args] = partes;
  const v = VISTAS[ruta] || VISTAS.cocina;
  const oscuro = ruta === 'tragos' || (ruta === 'receta' && porId(args[0])?.tipo === 'trago') ||
    (ruta === 'editar' && (args[1] === 'trago' || porId(args[0])?.tipo === 'trago' || porId(args[1])?.tipo === 'trago'));
  document.body.classList.toggle('oscuro', !!oscuro);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', oscuro ? '#100E14' : '#0F0F10');
  document.body.classList.toggle('sin-nav', ruta === 'cocinar');
  $('#vista').innerHTML = v.html(...args);
  v.despues?.(...args);
  $$('#nav a').forEach(a => a.classList.toggle('activo', a.dataset.r === (v.nav || ruta)));
  if (scrollTop && location.hash !== rutaAnterior) window.scrollTo(0, 0);
  rutaAnterior = location.hash;
}
const ir = (h) => { location.hash = h; };

// ═════════════════════════ COMPONENTES ═════════════════════════
function imagen(r, cls = '') {
  if (r.imagen) return `<img class="foto ${cls}" src="${esc(r.imagen)}" alt="${esc(r.nombre)}" loading="lazy">`;
  const em = r.tipo === 'trago' ? (r.alcohol ? '🍸' : '🍹') : (EMOJI[r.categoria] || '🍽️');
  const tono = r.tipo === 'trago' ? (r.alcohol ? 'ph-ambar' : 'ph-verde') : (r.linea === 'dia-libre' ? 'ph-rojo' : 'ph-oliva');
  return `<div class="foto ph ${tono} ${cls}"><span>${em}</span><small>Imagen pendiente</small></div>`;
}
const IC = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  hat: '<path d="M7 18v-4.2A4 4 0 1 1 9 6.3a3.6 3.6 0 0 1 6 0 4 4 0 1 1 2 7.5V18z"/><path d="M7 21h10"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c.4-3 2.8-5 5.5-5s5.1 2 5.5 5"/><circle cx="17" cy="9" r="2.3"/><path d="M16.5 14.6c2.3.2 3.9 2 4.2 4.4"/>',
  flame: '<path d="M12 3c2.5 3 5 5.6 5 10a5 5 0 0 1-10 0c0-2.3 1-4 2.3-5.3.2 1.8 1 3 2.2 3.3C11 8.5 11.6 5.5 12 3z"/>',
  bookmark: '<path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1z"/>',
  share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 13v6.5h14V13"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M10 20v-5.5h4V20"/>',
  glass: '<path d="M5 4h14l-7 8.5z"/><path d="M12 12.5V20M8 20h8"/>',
  calendar: '<rect x="4" y="5" width="16" height="15.5" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  list: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9.5 2.5h5"/>',
  basket: '<path d="M4 9h16l-1.5 10.5h-13z"/><path d="M8.5 9 11 4M15.5 9 13 4"/>',
  book: '<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  down: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.6-3.6 3.5-6 7-6s6.4 2.4 7 6"/>',
  shaker: '<path d="M8 8h8l-1 12.5H9z"/><path d="M8.5 8 9 5h6l.5 3M10.5 5V3h3v2"/>',
};
const ic = (n, s = 20, fill = false) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

const minTot = (r) => (r.prep_min || 0) + (r.coccion_min || 0);
const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) : ''}` : `${m} min`;
function etiquetaTiempo(r) {
  if (r.tipo === 'trago') return `<span class="tiempo">${ic('shaker', 12)}${r.alcohol ? 'Con alcohol' : 'Sin alcohol'}</span>`;
  return `<span class="tiempo">${ic('clock', 12)}${fmtMin(minTot(r))}</span>`;
}
function marca(r) {
  const on = !!meta(r.id).fav;
  return `<button class="marca ${on ? 'on' : ''}" data-a="fav" data-id="${esc(r.id)}" aria-label="Guardar">${ic('bookmark', 16, on)}</button>`;
}
function tarjeta(r, tam = '') {
  const desc = r.descripcion ? r.descripcion[0].toUpperCase() + r.descripcion.slice(1) : '';
  return `<a class="card ${tam}" href="#/receta/${encodeURIComponent(r.id)}">
    ${imagen(r)}${marca(r)}${r.propia ? '<span class="badge-mia">Mía</span>' : ''}
    <div class="card-b">${etiquetaTiempo(r)}<h3>${esc(r.nombre)}</h3>${tam === 'grande' && desc ? `<p class="desc-c">${esc(desc)}</p>` : ''}</div>
  </a>`;
}
function fila(r, extra) {
  const m = meta(r.id);
  const linea2 = extra ?? (m.puntaje ? `<span class="est">${'★'.repeat(m.puntaje)}</span>` : esc(r.tipo === 'trago' ? (r.alcohol ? 'Con alcohol' : 'Sin alcohol') : LINEA[r.linea] || ''));
  return `<a class="fila" href="#/receta/${encodeURIComponent(r.id)}">${imagen(r, 'chica')}
    <span class="fila-b"><b>${esc(r.nombre)}</b><small>${linea2}</small></span>
    <span class="fila-d"><button class="${m.fav ? 'on' : ''}" data-a="fav" data-id="${esc(r.id)}" aria-label="Guardar">${ic('bookmark', 18, m.fav)}</button>${r.tipo === 'trago' ? esc(r.tecnica || '') : fmtMin(minTot(r))}</span></a>`;
}
const grilla = (lista, vacioTxt = 'No hay nada con esos filtros.') =>
  lista.length ? `<div class="grid">${lista.map(r => tarjeta(r)).join('')}</div>` : `<div class="vacio"><p>${vacioTxt}</p></div>`;
const carrusel = (lista, tam) => `<div class="carrusel">${lista.map(r => tarjeta(r, tam)).join('')}</div>`;
const secTit = (t, accion = '') => `<div class="sec-tit"><h2>${t}</h2>${accion}</div>`;
// Orden "del día": cambia cada día pero es estable durante el día
const delDia = (lista) => { const k = hoy(); const h = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); return lista.slice().sort((a, b) => h(a.id + k) - h(b.id + k)); };
function nombrePropio() { try { return localStorage.getItem('cyt:nombre') || ''; } catch { return UI.nombre || ''; } }
function saludo(sub) {
  const h = new Date().getHours(); const n = nombrePropio();
  const s = h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  return `<header class="saludo"><div><h1>${s}${n ? ', ' + esc(n) : ''}</h1><p>${sub}</p></div><a class="avatar" href="#/ajustes" aria-label="Perfil">${n ? esc(n[0].toUpperCase()) : ic('user', 22)}</a></header>`;
}
const buscador = (valor, ph, input, filtros) => `<div class="buscador"><label class="campo-buscar">${ic('search', 18)}<input type="search" placeholder="${ph}" value="${esc(valor)}" data-i="${input}"></label>${filtros || ''}</div>`;
const chip = (txt, activo, attrs) => `<button class="chip ${activo ? 'on' : ''}" ${attrs}>${txt}</button>`;
const seg = (opciones, actual, accion) => `<div class="seg">${opciones.map(([v, t]) =>
  `<button class="${v === actual ? 'on' : ''}" data-a="${accion}" data-v="${v}">${t}</button>`).join('')}</div>`;

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.classList.add('fuera'), 2200); setTimeout(() => t.remove(), 2700);
}
function modal(html, onOpen) {
  cerrarModal();
  const m = document.createElement('div'); m.id = 'modal';
  m.innerHTML = `<div class="modal-fondo" data-a="cerrarModal"></div><div class="modal-caja">${html}</div>`;
  document.body.appendChild(m); document.body.classList.add('con-modal');
  onOpen?.(m);
}
function confirmar(msg, si = 'Sí') {
  return new Promise(res => {
    modal(`<h2>${esc(msg)}</h2><div class="acciones"><button class="btn" id="cf-si">${esc(si)}</button><button class="btn sec" id="cf-no">Cancelar</button></div>`, () => {
      $('#cf-si').onclick = () => { cerrarModal(); res(true); };
      $('#cf-no').onclick = () => { cerrarModal(); res(false); };
    });
  });
}
function cerrarModal() { $('#modal')?.remove(); document.body.classList.remove('con-modal'); }

async function guardarMeta(id, cambios) {
  S.meta = await DB.actualizar('meta', {}, m => ({ ...m, [id]: { ...(m[id] || {}), ...cambios } }));
}
async function guardarDespensa(fn) {
  S.despensa = await DB.actualizar('despensa', S.despensa, d => { const c = structuredClone(d); fn(c); return c; });
}
async function guardarSemana(wk) { await DB.escribir('semana:' + wk, S.semanas[wk]); }

function tengo(nombre) {
  const n = norm(nombre).replace(/^(jugo de|hojas? de|rodajas? de|ramitas? de|gotas? de) /, '');
  if (S.despensa.basicos.some(b => norm(b) === n)) return true;
  return S.despensa.stock.some(s => { const k = norm(s.nombre); return k === n || (k.length > 3 && (n.includes(k) || k.includes(n))); });
}
const esBasico = (nombre) => S.despensa.basicos.some(b => norm(b) === norm(nombre));

// ═════════════════════════ COCINA ═════════════════════════
const FILTROS = {
  rapido: ['≤ 30 min', r => minTot(r) <= 30],
  facil: ['Fácil', r => r.dificultad === 'fácil'],
  adelanta: ['Se adelanta', r => r.adelantar?.se_puede],
  favs: ['Guardadas', r => meta(r.id).fav],
  mias: ['Mías', r => r.propia],
  veg: ['Vegetariano', r => (r.etiquetas || []).includes('vegetariano')],
  tacc: ['Sin TACC', r => (r.etiquetas || []).includes('sin TACC')],
  kcal: ['≤ 400 kcal', r => r.kcal && r.kcal <= 400],
};
function filtrarCocina() {
  const c = UI.cocina; const q = norm(c.q);
  return comidas().filter(r =>
    (c.linea === 'todas' || r.linea === c.linea) &&
    (c.cat === 'todas' || r.categoria === c.cat) &&
    [...c.f].every(k => FILTROS[k][1](r)) &&
    (!q || norm(r.nombre + ' ' + r.ingredientes.map(i => i.nombre).join(' ') + ' ' + (r.etiquetas || []).join(' ')).includes(q))
  ).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
const filtrandoCocina = () => { const c = UI.cocina; return !!(c.q || c.cat !== 'todas' || c.linea !== 'todas' || c.f.size); };
function populares(pool) {
  const desde = sumarDias(hoy(), -30); const n = {};
  S.historial.filter(e => e.fecha >= desde).forEach(e => { n[e.receta_id] = (n[e.receta_id] || 0) + 1; });
  return delDia(pool).sort((a, b) => (n[b.id] || 0) - (n[a.id] || 0) || (meta(b.id).puntaje || 0) - (meta(a.id).puntaje || 0));
}
function resultadosCocina() {
  const l = filtrarCocina();
  return `${secTit(`${l.length} ${l.length === 1 ? 'receta' : 'recetas'}`, '<button data-a="limpiarFiltros">Limpiar</button>')}${grilla(l)}`;
}
function inicioCocina() {
  const todas = comidas();
  const plan = S.semanas[lunesDe(hoy())]; const d = (deIso(hoy()).getDay() + 6) % 7;
  const hoyMenu = plan ? ['almuerzo', 'cena'].map(s => [s, plan.dias[d][s] && porId(plan.dias[d][s].id)]).filter(x => x[1]) : [];
  const destacadas = delDia(todas.filter(r => r.linea === 'liviano' && ['principales', 'sopas', 'ensaladas'].includes(r.categoria))).slice(0, 6);
  const rapidas = delDia(todas.filter(r => minTot(r) <= 30)).slice(0, 10);
  const libre = delDia(todas.filter(r => r.linea === 'dia-libre')).slice(0, 10);
  const pop = populares(todas).slice(0, 5);
  return `
    ${hoyMenu.length ? secTit('Hoy en el menú', '<a href="#/semana">Ver semana</a>') + hoyMenu.map(([s, r]) => `<a class="hoy-card" href="#/receta/${encodeURIComponent(r.id)}">${imagen(r, 'chica')}<span><small>${SLOTS[s]}</small><br><b>${esc(r.nombre)}</b></span></a>`).join('') : ''}
    ${secTit('Destacadas', '<button data-a="verLinea" data-v="liviano">Ver todas</button>')}${carrusel(destacadas, 'grande')}
    ${secTit('Rápidas y fáciles', '<button data-a="verFiltro" data-v="rapido">Ver todas</button>')}${carrusel(rapidas, 'chica')}
    ${secTit('Populares', '')}<div class="filas">${pop.map(r => fila(r)).join('')}</div>
    ${secTit('Para el día libre', '<button data-a="verLinea" data-v="dia-libre">Ver todas</button>')}${carrusel(libre, 'chica')}`;
}
VISTAS.cocina = {
  html: () => {
    const c = UI.cocina; const activos = c.f.size + (c.cat !== 'todas' ? 1 : 0);
    const chipsLinea = [['todas', 'Todas'], ['liviano', 'Liviano'], ['dia-libre', 'Día libre']];
    return `${saludo('¿Qué cocinamos hoy?')}
    ${buscador(c.q, 'Buscar recetas, ingredientes…', 'qCocina', `<button class="btn-filtro" data-a="filtros" aria-label="Filtros">${ic('sliders', 20)}${activos ? '<i></i>' : ''}</button>`)}
    <div class="chips">${chipsLinea.map(([v, t]) => chip(t, c.linea === v && (v !== 'todas' || c.cat === 'todas'), `data-a="linea" data-v="${v}"`)).join('')}
      ${['principales', 'ensaladas', 'sopas', 'postres', 'entradas', 'panadería', 'guarniciones', 'salsas'].map(k => chip(k[0].toUpperCase() + k.slice(1), c.cat === k, `data-a="cat" data-v="${k}"`)).join('')}</div>
    <div id="lista">${filtrandoCocina() ? resultadosCocina() : inicioCocina()}</div>`;
  },
};
function modalFiltros() {
  const c = UI.cocina;
  modal(`<h2>Filtros</h2>
    <h3>Línea</h3>${seg([['todas', 'Todas'], ['liviano', 'Liviano'], ['dia-libre', 'Día libre']], c.linea, 'linea')}
    <h3>Categoría</h3><div class="chips wrap">${chip('Todas', c.cat === 'todas', 'data-a="cat" data-v="todas"')}${CATS.map(k => chip(k[0].toUpperCase() + k.slice(1), c.cat === k, `data-a="cat" data-v="${k}"`)).join('')}</div>
    <h3>Más filtros</h3><div class="chips wrap">${Object.entries(FILTROS).map(([k, [t]]) => chip(t, c.f.has(k), `data-a="filtro" data-v="${k}"`)).join('')}</div>
    <div class="acciones dos-col"><button class="btn sec" data-a="limpiarFiltros">Limpiar</button><button class="btn" data-a="cerrarModal">Ver ${filtrarCocina().length} recetas</button></div>`);
}

// ═════════════════════════ TRAGOS ═════════════════════════
function puedoHacer(r) { return r.ingredientes.every(i => tengo(i.nombre)); }
function filtrarTragos() {
  const t = UI.tragos; const q = norm(t.q);
  return tragos().filter(r =>
    (t.alcohol === 'todos' || (t.alcohol === 'con') === !!r.alcohol) &&
    (!t.tengo || puedoHacer(r)) &&
    (!q || norm(r.nombre + ' ' + r.ingredientes.map(i => i.nombre).join(' ')).includes(q))
  ).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
const filtrandoTragos = () => { const t = UI.tragos; return !!(t.q || t.alcohol !== 'todos' || t.tengo); };
function resultadosTragos() {
  const l = filtrarTragos(); const t = UI.tragos;
  return `${t.tengo ? '<p class="nota">Según tu <a href="#/despensa">despensa</a> (barra, heladera y básicos).</p>' : ''}
    ${secTit(`${l.length} ${l.length === 1 ? 'trago' : 'tragos'}`, '<button data-a="limpiarTragos">Limpiar</button>')}
    ${grilla(l, t.tengo ? 'Con lo que hay en la despensa no alcanza para ningún trago. Cargá tus botellas en Despensa → Barra.' : 'No hay tragos con esos filtros.')}`;
}
function inicioTragos() {
  const todos = tragos();
  return `${secTit('Destacados', '')}${carrusel(delDia(todos).slice(0, 6), 'grande')}
    ${secTit('Sin alcohol', '<button data-a="alcohol" data-v="sin">Ver todos</button>')}${carrusel(delDia(todos.filter(r => !r.alcohol)), 'chica')}
    ${secTit('Clásicos con alcohol', '<button data-a="alcohol" data-v="con">Ver todos</button>')}<div class="filas">${populares(todos.filter(r => r.alcohol)).slice(0, 6).map(r => fila(r)).join('')}</div>`;
}
VISTAS.tragos = {
  html: () => {
    const t = UI.tragos;
    return `${saludo('¿Qué tomamos hoy?')}
    ${buscador(t.q, 'Buscar tragos, ingredientes…', 'qTragos')}
    <div class="chips">${chip('Todos', t.alcohol === 'todos' && !t.tengo, 'data-a="alcohol" data-v="todos"')}${chip('Con alcohol', t.alcohol === 'con', 'data-a="alcohol" data-v="con"')}${chip('Sin alcohol', t.alcohol === 'sin', 'data-a="alcohol" data-v="sin"')}${chip('🍾 Con lo que tengo', t.tengo, 'data-a="tengo"')}</div>
    <div id="lista">${filtrandoTragos() ? resultadosTragos() : inicioTragos()}</div>`;
  },
};

// ═════════════════════════ DETALLE ═════════════════════════
VISTAS.receta = {
  nav: '',
  html: (id) => {
    const r = porId(id);
    if (!r) return `<div class="vacio"><p>No encontramos esa receta.</p><a class="btn" href="#/cocina">Volver</a></div>`;
    const m = meta(id);
    const porc = UI.porc[id] || r.porciones || 1;
    const f = porc / (r.porciones || 1);
    const tach = UI.tachados[id] || {};
    const esT = r.tipo === 'trago';
    const volver = esT ? '#/tragos' : '#/cocina';
    const hechas = S.historial.filter(e => e.receta_id === id).length;
    const tab = UI.tab[id] || 'pasos';
    const stat = (icono, valor, rotulo) => `<div>${ic(icono, 20)}<span><b>${esc(valor)}</b><span>${rotulo}</span></span></div>`;
    const stats = esT
      ? [stat('shaker', r.tecnica || '—', 'Técnica'), stat('glass', r.alcohol ? 'Sí' : 'No', 'Alcohol'), stat('people', r.porciones || 1, 'Rinde'), stat('flame', r.kcal || '—', 'Calorías')]
      : [stat('clock', minTot(r), 'Minutos'), stat('hat', (r.dificultad || '—')[0].toUpperCase() + (r.dificultad || '—').slice(1), 'Dificultad'), stat('people', r.porciones, 'Porciones'), stat('flame', r.kcal || '—', 'Calorías')];
    const desc = r.descripcion ? r.descripcion[0].toUpperCase() + r.descripcion.slice(1) + '.' : '';
    let cuerpo = '';
    if (tab === 'pasos') {
      cuerpo = `<ol class="pasos">${r.pasos.map((p, i) => `<li><span class="num">${i + 1}</span><div><p>${esc(p.texto)}</p>${p.timer ? `<button class="btn-timer" data-a="timer" data-min="${p.timer}" data-lbl="${esc(r.nombre)}">${ic('timer', 14)} ${fmtMin(p.timer)}</button>` : ''}</div></li>`).join('')}</ol>`;
    } else if (tab === 'tips') {
      cuerpo = `${esT ? `<div class="caja datos-t"><p><b>Vaso:</b> ${esc(r.vaso || '—')}</p><p><b>Hielo:</b> ${esc(r.hielo || '—')}</p><p><b>Decoración:</b> ${esc(r.decoracion || '—')}</p>${r.maridaje ? `<p><b>Marida con:</b> ${esc(r.maridaje)}</p>` : ''}</div>` : ''}
      ${(r.tips || []).length ? `<div class="caja"><h2>Tips</h2><ul>${r.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      ${r.tip_bebe ? `<div class="caja bebe"><h2>👶 Porción para la bebé</h2><p>${esc(r.tip_bebe)}</p></div>` : ''}
      ${r.adelantar?.se_puede ? `<div class="caja"><h2>🗓 Para adelantar</h2><p>${esc(r.adelantar.que_preparar || '')}</p>
        <p class="sub">${r.adelantar.heladera_dias ? `Dura ${r.adelantar.heladera_dias} días en heladera. ` : ''}${r.adelantar.freezar ? 'Se puede freezar.' : 'No conviene freezar.'}</p></div>` : ''}
      ${(r.sobras_para || []).length ? `<h2>♻️ Con las sobras</h2><div class="filas">${r.sobras_para.map(porId).filter(Boolean).map(x => fila(x, 'Cociná de más y usalo acá')).join('')}</div>` : ''}`;
      if (!cuerpo.trim()) cuerpo = '<p class="sub">Sin tips por ahora. Podés sumarlos desde Editar.</p>';
    } else {
      cuerpo = `<div class="estrellas" aria-label="Puntaje">${[1, 2, 3, 4, 5].map(n => `<button data-a="puntaje" data-id="${esc(id)}" data-v="${n}" class="${(m.puntaje || 0) >= n ? 'on' : ''}">★</button>`).join('')}
        <span class="sub">${hechas ? `Hecha ${hechas} ${hechas === 1 ? 'vez' : 'veces'}` : 'Todavía no la hicieron'}</span></div>
        <textarea class="notas" data-i="notas" data-id="${esc(id)}" placeholder="Ej.: la próxima, menos sal y 5 minutos más de horno.">${esc(m.notas || '')}</textarea>`;
    }
    return `
    <div class="hero">${imagen(r, 'grande')}
      <a class="btn-flot izq" href="${volver}" data-a="atras" aria-label="Volver">${ic('back', 20)}</a>
      <button class="btn-flot der2" data-a="compartirReceta" data-id="${esc(id)}" aria-label="Compartir">${ic('share', 19)}</button>
      <button class="btn-flot der ${m.fav ? 'on' : ''}" data-a="fav" data-id="${esc(id)}" aria-label="Guardar">${ic('bookmark', 19, m.fav)}</button>
    </div>
    <article class="detalle">
      ${etiquetaTiempo(r)}
      <h1>${esc(r.nombre)}</h1>
      ${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
      <div class="etqs">${esT ? '' : `<span class="etq ${r.linea}">${LINEA[r.linea] || ''}</span><span class="etq">${esc((r.categoria || '')[0]?.toUpperCase() + (r.categoria || '').slice(1))}</span>`}
        ${(r.etiquetas || []).map(e => `<span class="etq">${esc(e)}</span>`).join('')}${r.propia ? '<span class="etq">Mía</span>' : ''}</div>
      <div class="stats">${stats.join('')}</div>

      <div class="tit-fila"><h2>Ingredientes</h2>
        <div class="stepper"><button data-a="porc" data-id="${esc(id)}" data-v="-1" aria-label="Menos">−</button><span>${porc} ${esT ? (porc === 1 ? 'trago' : 'tragos') : (porc === 1 ? 'porción' : 'porciones')}</span><button data-a="porc" data-id="${esc(id)}" data-v="1" aria-label="Más">+</button></div></div>
      <ul class="ings">${r.ingredientes.map((i, k) => { const t = textoIng(i, f); return `<li class="${tach[k] ? 'tachado' : ''}" data-a="tachar" data-id="${esc(id)}" data-v="${k}"><span class="chk">${tach[k] ? ic('check', 12) : ''}</span><span class="txt"><span class="cant">${esc(t.cant)}</span>${esc(t.nombre)}</span></li>`; }).join('')}</ul>

      <button class="btn empezar" data-a="cocinar" data-id="${esc(id)}">Empezar a ${esT ? 'preparar' : 'cocinar'} ${ic('next', 18)}</button>
      <div class="acciones dos-col">
        <button class="btn sec" data-a="aSemana" data-id="${esc(id)}">${ic('calendar', 17)} A la semana</button>
        <button class="btn sec" data-a="hecho" data-id="${esc(id)}">${ic('check', 17)} Ya lo hice</button>
      </div>

      <div class="tabs">${[['pasos', 'Pasos'], ['tips', 'Tips'], ['notas', 'Notas']].map(([v, t]) => `<button class="${tab === v ? 'on' : ''}" data-a="tab" data-id="${esc(id)}" data-v="${v}">${t}</button>`).join('')}</div>
      ${cuerpo}

      <div class="caja img-caja"><h2>Imagen</h2>
        <p class="sub">${r.imagen ? (r.regenerar ? 'Marcada para regenerar en la próxima corrida del script.' : 'Tiene imagen.') : 'Pendiente: la genera el script de imágenes.'}</p>
        <div class="acciones">
          <button class="btn-chico" data-a="copiarPrompt" data-id="${esc(id)}">Copiar prompt</button>
          <label class="btn-chico">Subir foto<input type="file" accept="image/*" hidden data-i="foto" data-id="${esc(id)}"></label>
          ${r.imagen ? `<button class="btn-chico" data-a="regenerar" data-id="${esc(id)}">${r.regenerar ? 'No regenerar' : 'Regenerar'}</button>` : ''}
        </div></div>

      <div class="acciones pie">
        <a class="btn sec" href="#/editar/${encodeURIComponent(id)}">Editar</a>
        <a class="btn sec" href="#/editar/duplicar/${encodeURIComponent(id)}">Duplicar</a>
        <button class="btn peligro" data-a="borrar" data-id="${esc(id)}">Borrar</button>
      </div>
    </article>`;
  },
};
function miniFila(r, extra = '') {
  return `<a class="mini" href="#/receta/${encodeURIComponent(r.id)}">${imagen(r, 'chica')}<span><b>${esc(r.nombre)}</b>${extra ? `<small>${extra}</small>` : ''}</span></a>`;
}

// ═════════════════════════ MODO COCINA ═════════════════════════
let wakeLock = null;
VISTAS.cocinar = {
  html: (id) => {
    const r = porId(id); if (!r) return '';
    const n = r.pasos.length; const i = Math.min(UI.paso, n - 1); const p = r.pasos[i];
    const f = (UI.porc[id] || r.porciones || 1) / (r.porciones || 1);
    return `<div class="cocinar">
      <header><button class="btn-icono" data-a="salirCocina" data-id="${esc(id)}" aria-label="Salir">✕</button><span>${esc(r.nombre)}</span><span>${i + 1}/${n}</span></header>
      <div class="barra"><i style="width:${((i + 1) / n) * 100}%"></i></div>
      <div class="paso-grande"><small>Paso ${i + 1}</small><p>${esc(p.texto)}</p>
        ${p.timer ? `<button class="btn grande" data-a="timer" data-min="${p.timer}" data-lbl="${esc(r.nombre)} · paso ${i + 1}">⏱ Iniciar ${p.timer} min</button>` : ''}</div>
      <details class="ings-cocina"><summary>Ver ingredientes</summary><ul>${r.ingredientes.map(x => { const t = textoIng(x, f); return `<li><b>${esc(t.cant)}</b> ${esc(t.nombre)}</li>`; }).join('')}</ul></details>
      <footer><button class="btn sec grande" data-a="paso" data-v="-1" ${i === 0 ? 'disabled' : ''}>‹ Anterior</button>
      ${i < n - 1 ? `<button class="btn grande" data-a="paso" data-v="1">Siguiente ›</button>` : `<button class="btn grande" data-a="terminar" data-id="${esc(id)}">✓ ¡Listo!</button>`}</footer>
    </div>`;
  },
  despues: async () => { try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* no soportado */ } },
};
function salirCocina() { if (wakeLock && !location.hash.startsWith('#/cocinar')) { wakeLock.release().catch(() => {}); wakeLock = null; } }

// ═════════════════════════ TIMERS ═════════════════════════
function tickTimers() {
  const el = $('#timers'); if (!el) return;
  const ahora = Date.now();
  S.timers.forEach(t => { if (!t.sonado && t.fin <= ahora) { t.sonado = true; alarma(t.lbl); } });
  el.innerHTML = S.timers.map(t => {
    const s = Math.max(0, Math.round((t.fin - ahora) / 1000));
    return `<div class="timer ${t.sonado ? 'listo' : ''}"><span>${esc(t.lbl)}</span><b>${t.sonado ? '¡Listo!' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</b><button data-a="quitarTimer" data-v="${t.id}" aria-label="Quitar">✕</button></div>`;
  }).join('');
  el.classList.toggle('visible', S.timers.length > 0);
}
function alarma(lbl) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.4, 0.8].forEach(t => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.3, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3); });
  } catch { /* sin audio */ }
  navigator.vibrate?.([300, 150, 300, 150, 300]);
  toast(`⏱ ${lbl}: ¡tiempo!`);
}

// ═════════════════════════ SEMANA ═════════════════════════
const extrasDe = (plan, d, slot) => plan.dias.reduce((acc, dia) => acc + Object.values(dia).filter(s => s && s.sobrasDe === `${d}:${slot}`).reduce((a, s) => a + (s.porc || 0), 0), 0);
function rangoSemana(wk) { return `${fechaCorta(wk)} – ${fechaCorta(sumarDias(wk, 6))}`; }

VISTAS.semana = {
  html: () => {
    const wk = UI.semana; const plan = S.semanas[wk];
    if (!plan) return `<div class="vacio"><p>Cargando…</p></div>`;
    const esta = wk === lunesDe(hoy());
    return `
    <header class="top"><h1>Semana</h1><button class="btn-icono" data-a="plantillas" aria-label="Plantillas">${ic('book', 19)}</button></header>
    <div class="semana-nav"><button data-a="semanaMov" data-v="-7" aria-label="Semana anterior">${ic('back', 18)}</button><div><b>${rangoSemana(wk)}</b>${esta ? '<small>Esta semana</small>' : ''}</div><button data-a="semanaMov" data-v="7" aria-label="Semana siguiente">${ic('next', 18)}</button></div>
    <div class="acciones">
      <button class="btn" data-a="sugerir">✨ Sugerir semana</button>
      <a class="btn sec" href="#/domingo">🗓 Preparar el domingo</a>
      <a class="btn sec" href="#/compras">🛒 Lista de compras</a>
    </div>
    ${plan.dias.map((dia, d) => {
      const fecha = sumarDias(wk, d);
      const slots = d >= 4 ? ['almuerzo', 'cena', 'trago'] : ['almuerzo', 'cena'];
      return `<section class="dia ${fecha === hoy() ? 'hoy' : ''} ${fecha < hoy() ? 'pasado' : ''}"><h3>${DIAS[d]} <small>${fechaCorta(fecha)}</small></h3>
        ${slots.map(slot => {
          const s = dia[slot]; const r = s && porId(s.id);
          if (!r) return `<button class="slot vacio-slot" data-a="elegir" data-d="${d}" data-s="${slot}"><span>${SLOTS[slot]}</span><b>＋ Agregar</b></button>`;
          const ex = extrasDe(plan, d, slot);
          const [od, os] = (s.sobrasDe || ':').split(':');
          const origen = s.sobrasDe ? porId(plan.dias[+od]?.[os]?.id) : null;
          return `<div class="slot lleno">
            <a href="#/receta/${encodeURIComponent(r.id)}">${imagen(r, 'chica')}</a>
            <div class="slot-b"><span>${SLOTS[slot]}</span><a href="#/receta/${encodeURIComponent(r.id)}"><b>${esc(r.nombre)}</b></a>
              ${origen ? `<small class="sobra">♻️ con sobras de ${esc(origen.nombre)}</small>` : ''}
              ${ex ? `<small class="sobra">♻️ +${ex} porc. para las sobras</small>` : ''}
              <div class="stepper chico"><button data-a="slotPorc" data-d="${d}" data-s="${slot}" data-v="-1" aria-label="Menos">−</button><span>${s.porc} porc.</span><button data-a="slotPorc" data-d="${d}" data-s="${slot}" data-v="1" aria-label="Más">+</button></div>
            </div>
            <button class="quitar" data-a="quitarSlot" data-d="${d}" data-s="${slot}" aria-label="Quitar">✕</button></div>`;
        }).join('')}</section>`;
    }).join('')}`;
  },
};

function elegirReceta(d, slot) {
  const esT = slot === 'trago';
  const pool = esT ? tragos() : comidas();
  const favs = pool.filter(r => meta(r.id).fav);
  const ultimas = [...new Set(S.historial.slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).map(e => e.receta_id))].map(porId).filter(r => r && pool.includes(r)).slice(0, 12);
  const lista = (arr) => arr.map(r => `<button class="mini" data-a="asignar" data-d="${d}" data-s="${slot}" data-id="${esc(r.id)}">${imagen(r, 'chica')}<span><b>${esc(r.nombre)}</b><small>${esT ? (r.alcohol ? 'Con alcohol' : 'Sin alcohol') : `${LINEA[r.linea]} · ${r.categoria}`}</small></span></button>`).join('') || '<p class="sub">Nada por acá todavía.</p>';
  modal(`<h2>${DIAS[d]} · ${SLOTS[slot]}</h2>
    <input class="buscar" type="search" placeholder="Buscar…" id="buscar-elegir">
    ${seg([['todas', 'Todas'], ['favs', 'Guardadas'], ['ult', 'Recientes']], 'todas', 'tabElegir')}
    <div class="mini-lista scroll" id="elegir-lista">${lista(pool.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)))}</div>`, (m) => {
    const listas = { todas: pool.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)), favs, ult: ultimas };
    let actual = 'todas';
    const pintar = () => { const q = norm($('#buscar-elegir').value); $('#elegir-lista').innerHTML = lista(listas[actual].filter(r => norm(r.nombre).includes(q))); };
    $('#buscar-elegir').oninput = pintar;
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-a="tabElegir"]'); if (!b) return; e.stopPropagation(); actual = b.dataset.v; $$('.seg button', m).forEach(x => x.classList.toggle('on', x === b)); pintar(); }, true);
  });
}

async function asignar(d, slot, id, wk = UI.semana) {
  const plan = await cargarSemana(wk);
  const r = porId(id);
  plan.dias[d][slot] = { id, porc: slot === 'trago' ? S.ajustes.porcionesTrago : S.ajustes.porciones };
  await guardarSemana(wk);
  cerrarModal(); render();
  // Sugerencia de sobras para el día siguiente
  if (r && (r.sobras_para || []).length && d < 6 && slot !== 'trago') {
    const sig = plan.dias[d + 1];
    const libre = !sig.almuerzo ? 'almuerzo' : (!sig.cena ? 'cena' : null);
    if (!libre) return;
    const opciones = r.sobras_para.map(porId).filter(Boolean);
    modal(`<h2>♻️ ¿Aprovechamos las sobras?</h2>
      <p>Si cocinás de más <b>${esc(r.nombre)}</b>, el ${DIAS[d + 1].toLowerCase()} (${SLOTS[libre].toLowerCase()}) podés hacer:</p>
      <div class="mini-lista">${opciones.map(o => `<button class="mini" data-a="usarSobras" data-d="${d}" data-s="${slot}" data-dd="${d + 1}" data-ss="${libre}" data-id="${esc(o.id)}" data-wk="${wk}">${imagen(o, 'chica')}<span><b>${esc(o.nombre)}</b><small>Suma porciones a ${esc(r.nombre)}</small></span></button>`).join('')}</div>
      <button class="btn sec ancho" data-a="cerrarModal">No, gracias</button>`);
  }
}

function sugerirSemana() {
  const wk = UI.semana; const plan = S.semanas[wk];
  const reciente = new Set(S.historial.filter(e => diasEntre(e.fecha, hoy()) <= 14).map(e => e.receta_id));
  const enSemana = new Set(plan.dias.flatMap(d => Object.values(d).filter(Boolean).map(s => s.id)));
  const base = comidas().filter(r => r.linea === 'liviano' && ['principales', 'sopas', 'ensaladas'].includes(r.categoria));
  const mezclar = (a) => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  let pool = mezclar(base.filter(r => !reciente.has(r.id) && !enSemana.has(r.id)));
  let resto = mezclar(base.filter(r => !pool.includes(r)));
  let prevProt = null; let cambios = 0;
  plan.dias.forEach((dia) => {
    for (const slot of ['almuerzo', 'cena']) {
      if (dia[slot]) { prevProt = proteina(porId(dia[slot].id) || { ingredientes: [] }); continue; }
      const pick = (arr) => arr.findIndex(r => proteina(r) !== prevProt || prevProt === 'vegetal');
      let i = pick(pool); let arr = pool;
      if (i < 0) { i = pick(resto); arr = resto; }
      if (i < 0) { i = 0; arr = pool.length ? pool : resto; }
      const r = arr.splice(i, 1)[0]; if (!r) continue;
      dia[slot] = { id: r.id, porc: S.ajustes.porciones }; prevProt = proteina(r); cambios++;
      if (!pool.length) { pool = mezclar(base); resto = []; }
    }
  });
  return cambios;
}

// ═════════════════════════ PREPARAR EL DOMINGO ═════════════════════════
function tareasDomingo(wk) {
  const plan = S.semanas[wk]; const vistas = new Set(); const tareas = [];
  plan.dias.forEach((dia) => Object.values(dia).forEach(s => {
    const r = s && porId(s.id);
    if (!r || vistas.has(r.id) || !r.adelantar?.se_puede || s.sobrasDe) return;
    vistas.add(r.id); tareas.push(r);
  }));
  return tareas.sort((a, b) => (b.adelantar.horno - a.adelantar.horno) || ((b.adelantar.min || 0) - (a.adelantar.min || 0)));
}
VISTAS.domingo = {
  nav: 'semana',
  html: () => {
    const wk = UI.semana; const t = tareasDomingo(wk); const hechos = S.domingo[wk] || {};
    const total = t.reduce((a, r) => a + (r.adelantar.min || 0), 0);
    const horno = t.filter(r => r.adelantar.horno); const resto = t.filter(r => !r.adelantar.horno);
    const fila = (r) => `<li class="${hechos[r.id] ? 'hecho' : ''}"><label><input type="checkbox" data-i="domingo" data-id="${esc(r.id)}" ${hechos[r.id] ? 'checked' : ''}>
      <span><b>${esc(r.nombre)}</b>${esc(r.adelantar.que_preparar)}<small>${r.adelantar.min ? `~${r.adelantar.min} min · ` : ''}${r.adelantar.heladera_dias ? `${r.adelantar.heladera_dias} días en heladera` : ''}${r.adelantar.freezar ? ' · se freeza' : ''}</small></span></label>
      ${r.adelantar.freezar ? `<button class="btn-chico" data-a="alFreezer" data-id="${esc(r.id)}">＋ Freezer</button>` : ''}</li>`;
    return `
    <header class="top"><a class="btn-icono" href="#/semana" aria-label="Volver">${ic('back', 20)}</a><h1>Preparar el domingo</h1><span></span></header>
    <p class="sub centro">${rangoSemana(wk)}</p>
    ${!t.length ? `<div class="vacio"><p>No hay recetas para adelantar en esta semana.</p><a class="btn" href="#/semana">Ir a la semana</a></div>` : `
    <div class="caja resumen"><b>${t.length} tareas · ~${Math.round(total / 5) * 5} min</b><span class="sub">El orden aprovecha el horno primero; mientras se hornea, avanzá con las hornallas y los cortes.</span></div>
    ${horno.length ? `<h2>🔥 Horno (primero)</h2><ul class="tareas">${horno.map(fila).join('')}</ul>` : ''}
    ${resto.length ? `<h2>🍳 Hornallas, cortes y heladera</h2><ul class="tareas">${resto.map(fila).join('')}</ul>` : ''}
    <p class="nota">Tip: etiquetá con fecha todo lo que va al freezer. Con “＋ Freezer” queda registrado en tu despensa.</p>`}`;
  },
};

// ═════════════════════════ COMPRAS ═════════════════════════
function listaCompras(wk) {
  const plan = S.semanas[wk]; const m = new Map();
  plan.dias.forEach((dia, d) => Object.entries(dia).forEach(([slot, s]) => {
    const r = s && porId(s.id); if (!r) return;
    const f = ((s.porc || 0) + extrasDe(plan, d, slot)) / (r.porciones || 1);
    r.ingredientes.forEach(i => {
      if (esBasico(i.nombre) || i.unidad === 'c/n' && /hielo/.test(norm(i.nombre))) return;
      const casera = /cocid|casera/.test(norm(i.nombre));
      if (casera && s.sobrasDe) return;
      const k = norm(i.nombre) + '|' + (i.cant == null ? '-' : i.unidad);
      const it = m.get(k) || { k, nombre: i.nombre, unidad: i.unidad, cant: i.cant == null ? null : 0, recetas: new Set(), g: casera ? 'Preparaciones caseras' : gondola(i.nombre) };
      if (i.cant != null) it.cant += i.cant * f;
      it.recetas.add(r.nombre); m.set(k, it);
    });
  }));
  // Lo que se compra por unidad se redondea para arriba
  const enteros = ['u', 'diente', 'atado', 'lata', 'paquete'];
  return [...m.values()].map(it => (it.cant != null && enteros.includes(it.unidad) ? { ...it, cant: Math.ceil(it.cant - 0.05) } : it));
}
VISTAS.compras = {
  html: () => {
    const wk = UI.semana; const c = S.compras[wk] || { marcados: {}, extra: [] };
    const items = listaCompras(wk);
    const ya = items.filter(i => !c.marcados[i.k] && tengo(i.nombre));
    const comprar = items.filter(i => !ya.includes(i));
    const grupos = ORDEN_GONDOLAS.map(g => [g, comprar.filter(i => i.g === g).sort((a, b) => a.nombre.localeCompare(b.nombre))]).filter(([, l]) => l.length);
    const pend = comprar.filter(i => !c.marcados[i.k]).length + c.extra.filter(e => !e.ok).length;
    const fila = (i) => `<li class="${c.marcados[i.k] ? 'hecho' : ''}"><label><input type="checkbox" data-i="marcar" data-k="${esc(i.k)}" ${c.marcados[i.k] ? 'checked' : ''}>
      <span><b>${esc(i.nombre)}</b>${i.cant != null ? ` <em>${esc(fmtCant(i.cant, i.unidad))}</em>` : (i.unidad && i.unidad !== 'a gusto' ? ` <em>${esc(i.unidad)}</em>` : '')}<small>${esc([...i.recetas].join(', '))}</small></span></label></li>`;
    return `
    <header class="top"><h1>Compras</h1><button class="btn-icono" data-a="compartir" aria-label="Compartir">${ic('share', 19)}</button></header>
    <div class="semana-nav"><button data-a="semanaMov" data-v="-7" aria-label="Semana anterior">${ic('back', 18)}</button><div><b>${rangoSemana(wk)}</b><small>${pend} pendientes</small></div><button data-a="semanaMov" data-v="7" aria-label="Semana siguiente">${ic('next', 18)}</button></div>
    ${!items.length && !c.extra.length ? `<div class="vacio"><p>La lista se arma sola con las recetas de la semana.</p><a class="btn" href="#/semana">Planificar la semana</a></div>` : ''}
    ${grupos.map(([g, l]) => `<h2 class="gondola">${g}</h2>${g === 'Preparaciones caseras' ? '<p class="nota">Salen de otra receta (sobras o algo que cocinás antes). Si no, comprá o prepará.</p>' : ''}<ul class="compras">${l.map(fila).join('')}</ul>`).join('')}
    <h2 class="gondola">Otras cosas</h2>
    <ul class="compras">${c.extra.map(e => `<li class="${e.ok ? 'hecho' : ''}"><label><input type="checkbox" data-i="marcarExtra" data-id="${e.id}" ${e.ok ? 'checked' : ''}><span><b>${esc(e.nombre)}</b></span></label><button class="quitar" data-a="quitarExtra" data-id="${e.id}" aria-label="Quitar">✕</button></li>`).join('')}</ul>
    <form class="agregar" id="f-extra"><input name="n" placeholder="Agregar algo más (ej.: pañales, café)"><button class="btn">＋</button></form>
    ${ya.length ? `<details class="caja"><summary>Ya tenés en la despensa (${ya.length})</summary><ul class="compras">${ya.map(i => `<li><span><b>${esc(i.nombre)}</b>${i.cant != null ? ` <em>${esc(fmtCant(i.cant, i.unidad))}</em>` : ''}</span></li>`).join('')}</ul></details>` : ''}
    <div class="acciones pie"><button class="btn" data-a="compartir">Compartir por WhatsApp</button><button class="btn sec" data-a="limpiarCompras">Destildar todo</button></div>
    <p class="nota">Al tachar algo se suma a la despensa. Los básicos (sal, aceite, especias…) no aparecen: se editan en <a href="#/despensa">Despensa</a>.</p>`;
  },
  despues: () => {
    const f = $('#f-extra'); if (!f) return;
    f.onsubmit = async (e) => {
      e.preventDefault(); const n = f.n.value.trim(); if (!n) return;
      const wk = UI.semana;
      S.compras[wk] = await DB.actualizar('compras:' + wk, { marcados: {}, extra: [] }, c => ({ ...c, extra: [...c.extra, { id: Date.now(), nombre: n, ok: false }] }));
      render();
    };
  },
};
function lugarPara(nombre) { const g = gondola(nombre); return g === 'Bebidas' ? 'barra' : (g === 'Almacén' ? 'alacena' : 'heladera'); }

// ═════════════════════════ MÁS ═════════════════════════
VISTAS.mas = {
  html: () => {
    const pend = S.recetas.filter(r => !r.imagen || r.regenerar).length;
    const it = (h, i, t, s = '') => `<a class="menu-it" href="${h}"><span class="ic-caja">${ic(i, 19)}</span><span><b>${t}</b>${s ? `<small>${s}</small>` : ''}</span>${ic('next', 18)}</a>`;
    return `<header class="top"><h1>Más</h1></header>
    <nav class="menu">
      ${it('#/despensa', 'basket', 'Despensa', 'Stock, básicos y freezer')}
      ${it('#/historial', 'book', 'Historial', 'Qué comimos y hace cuánto')}
      ${it('#/favoritos', 'bookmark', 'Guardadas', `${Object.values(S.meta).filter(m => m.fav).length} guardados`)}
    </nav>
    <nav class="menu">
      ${it('#/editar/nueva/comida', 'plus', 'Agregar receta')}
      ${it('#/editar/nueva/trago', 'plus', 'Agregar trago')}
      ${it('#/importar', 'down', 'Importar recetas', 'Pegá recetas en formato JSON')}
      ${it('#/imagenes', 'image', 'Imágenes pendientes', `${pend} sin imagen o para regenerar`)}
    </nav>
    <nav class="menu">${it('#/ajustes', 'gear', 'Ajustes', 'Porciones, cuenta')}</nav>
    <p class="nota centro">${S.recetas.length} recetas y tragos · ${DB.usaSupabase ? 'sincronizado' : 'modo vista previa (los datos quedan en este navegador)'}</p>`;
  },
};

// ═════════════════════════ DESPENSA ═════════════════════════
VISTAS.despensa = {
  nav: 'mas',
  html: () => {
    const d = S.despensa; const tab = UI.despTab;
    let cuerpo = '';
    if (tab === 'stock') {
      cuerpo = LUGARES.filter(l => l !== 'freezer').map(l => {
        const items = d.stock.filter(s => s.lugar === l);
        return `<h2>${{ heladera: '🧊 Heladera', alacena: '🥫 Alacena', barra: '🍾 Barra' }[l]}</h2>
        <div class="chips wrap">${items.map(s => `<span class="chip on">${esc(s.nombre)}<button data-a="quitarStock" data-v="${esc(s.nombre)}" aria-label="Se terminó">✕</button></span>`).join('') || '<p class="sub">Vacío.</p>'}</div>`;
      }).join('') + `<form class="agregar" id="f-stock"><input name="n" placeholder="Agregar (ej.: gin, limones)" list="dl-ings"><select name="l"><option value="heladera">Heladera</option><option value="alacena">Alacena</option><option value="barra">Barra</option></select><button class="btn">＋</button></form>
      <p class="nota">Tocá ✕ cuando algo se termina. Lo que tachás en la lista de compras se suma solo.</p>`;
    } else if (tab === 'basicos') {
      cuerpo = `<p class="sub">Lo que siempre hay en casa. Nunca aparece en la lista de compras.</p>
      <div class="chips wrap">${d.basicos.map(b => `<span class="chip on">${esc(b)}<button data-a="quitarBasico" data-v="${esc(b)}" aria-label="Quitar">✕</button></span>`).join('')}</div>
      <form class="agregar" id="f-basico"><input name="n" placeholder="Agregar básico" list="dl-ings"><button class="btn">＋</button></form>`;
    } else {
      cuerpo = `<p class="sub">Preparaciones congeladas y desde cuándo.</p>
      <ul class="compras">${d.freezer.slice().sort((a, b) => a.desde.localeCompare(b.desde)).map((f, i) => {
        const dias = diasEntre(f.desde, hoy());
        return `<li><span><b>${esc(f.nombre)}</b><small>${fechaCorta(f.desde)} · hace ${dias} días${dias > 90 ? ' · ⚠️ usar pronto' : ''}</small></span><button class="btn-chico" data-a="usarFreezer" data-v="${esc(f.id || i)}">Se usó</button></li>`;
      }).join('') || '<p class="sub">Nada congelado.</p>'}</ul>
      <form class="agregar" id="f-freezer"><input name="n" placeholder="Ej.: 4 porciones de guiso de lentejas"><button class="btn">＋</button></form>`;
    }
    return `<header class="top"><a class="btn-icono" href="#/mas" aria-label="Volver">${ic('back', 20)}</a><h1>Despensa</h1><span></span></header>
    ${seg([['stock', 'Stock'], ['basicos', 'Básicos'], ['freezer', `Freezer (${d.freezer.length})`]], tab, 'despTab')}${cuerpo}`;
  },
  despues: () => {
    const hook = (sel, fn) => { const f = $(sel); if (f) f.onsubmit = async (e) => { e.preventDefault(); const n = f.n.value.trim(); if (!n) return; await guardarDespensa(d => fn(d, n, f)); render(); }; };
    hook('#f-stock', (d, n, f) => { d.stock = d.stock.filter(s => norm(s.nombre) !== norm(n)); d.stock.push({ nombre: n, lugar: f.l.value }); });
    hook('#f-basico', (d, n) => { if (!d.basicos.some(b => norm(b) === norm(n))) d.basicos.push(n); });
    hook('#f-freezer', (d, n) => { d.freezer.push({ id: String(Date.now()), nombre: n, desde: hoy() }); });
  },
};

// ═════════════════════════ HISTORIAL ═════════════════════════
VISTAS.historial = {
  nav: 'mas',
  html: () => {
    const h = S.historial.filter(e => porId(e.receta_id)).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const porSemana = {};
    h.forEach(e => { (porSemana[lunesDe(e.fecha)] ||= []).push(e); });
    const ultimo = {}; const cuenta = {};
    h.forEach(e => { if (!ultimo[e.receta_id]) ultimo[e.receta_id] = e.fecha; cuenta[e.receta_id] = (cuenta[e.receta_id] || 0) + 1; });
    const hace = comidas().map(r => [r, ultimo[r.id]]).sort((a, b) => (a[1] || '0').localeCompare(b[1] || '0'));
    const top = Object.entries(cuenta).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const mejores = S.recetas.filter(r => meta(r.id).puntaje).sort((a, b) => meta(b.id).puntaje - meta(a.id).puntaje).slice(0, 8);
    return `<header class="top"><a class="btn-icono" href="#/mas" aria-label="Volver">${ic('back', 20)}</a><h1>Historial</h1><span></span></header>
    ${!h.length ? '<div class="vacio"><p>Todavía no hay registros. Se llena solo con la semana planificada y con “Ya lo hice”.</p></div>' : ''}
    ${Object.entries(porSemana).slice(0, 6).map(([wk, es]) => `<h2>${rangoSemana(wk)}</h2><div class="mini-lista">${es.map(e => miniFila(porId(e.receta_id), `${DIAS[(deIso(e.fecha).getDay() + 6) % 7]} ${fechaCorta(e.fecha)}${e.slot !== 'manual' ? ' · ' + (SLOTS[e.slot] || '') : ''}`)).join('')}</div>`).join('')}
    ${top.length ? `<h2>🏆 Lo más hecho</h2><div class="mini-lista">${top.map(([id, n]) => miniFila(porId(id), `${n} ${n === 1 ? 'vez' : 'veces'}`)).join('')}</div>` : ''}
    ${mejores.length ? `<h2>★ Mejor puntuadas</h2><div class="mini-lista">${mejores.map(r => miniFila(r, '★'.repeat(meta(r.id).puntaje))).join('')}</div>` : ''}
    <h2>⏳ Hace cuánto no comemos…</h2><div class="mini-lista">${hace.map(([r, f]) => miniFila(r, f ? `hace ${diasEntre(f, hoy())} días` : 'nunca')).join('')}</div>`;
  },
};

VISTAS.favoritos = {
  nav: 'mas',
  html: () => {
    const fav = S.recetas.filter(r => meta(r.id).fav);
    return `<header class="top"><a class="btn-icono" href="#/mas" aria-label="Volver">${ic('back', 20)}</a><h1>Guardadas</h1><span></span></header>
    ${grilla(fav.filter(r => r.tipo !== 'trago'), 'Tocá el marcador en cualquier receta para guardarla acá.')}
    ${fav.some(r => r.tipo === 'trago') ? `<h2>Tragos</h2>${grilla(fav.filter(r => r.tipo === 'trago'))}` : ''}`;
  },
};

// ═════════════════════════ EDITOR ═════════════════════════
const UNIDADES = ['g', 'kg', 'ml', 'l', 'u', 'cda', 'cdita', 'taza', 'diente', 'atado', 'lata', 'paquete', 'pizca', 'a gusto', 'c/n'];
function filaIng(i = {}) {
  return `<div class="fila-ing"><input class="cant" inputmode="decimal" placeholder="Cant." value="${i.cant ?? ''}"><input class="uni" list="dl-unidades" placeholder="Unidad" value="${esc(i.unidad || '')}"><input class="nom" list="dl-ings" placeholder="Ingrediente" value="${esc(i.nombre || '')}"><button type="button" class="quitar" data-a="quitarFila" aria-label="Quitar">✕</button></div>`;
}
function filaPaso(p = {}) {
  return `<div class="fila-paso"><textarea rows="2" placeholder="Describí el paso">${esc(p.texto || '')}</textarea><input class="tmin" inputmode="numeric" placeholder="⏱ min" value="${p.timer ?? ''}"><button type="button" class="quitar" data-a="quitarFila" aria-label="Quitar">✕</button></div>`;
}
VISTAS.editar = {
  nav: '',
  html: (a, b) => {
    let r; let modo = 'editar';
    if (a === 'nueva') { modo = 'nueva'; r = { tipo: b === 'trago' ? 'trago' : 'comida', ingredientes: [{}, {}, {}], pasos: [{}, {}], linea: 'liviano', categoria: 'principales', porciones: b === 'trago' ? 1 : 4, alcohol: true, adelantar: {} }; }
    else if (a === 'duplicar') { modo = 'nueva'; r = structuredClone(porId(b)); if (r) { r.nombre += ' (copia)'; r.imagen = null; } }
    else r = porId(a);
    if (!r) return '<div class="vacio"><p>No encontramos esa receta.</p></div>';
    UI.editando = { modo, id: modo === 'editar' ? r.id : null, base: r };
    UI.fotoPendiente = null;
    const esT = r.tipo === 'trago';
    const ad = r.adelantar || {};
    const sel = (name, opts, val) => `<select name="${name}">${opts.map(([v, t]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    return `<header class="top"><a class="btn-icono" href="javascript:history.back()" aria-label="Cancelar">✕</a><h1>${modo === 'nueva' ? (esT ? 'Nuevo trago' : 'Nueva receta') : 'Editar'}</h1><button class="btn" form="f-receta">Guardar</button></header>
    <form id="f-receta" class="form" data-tipo="${r.tipo}">
      <label>Nombre *<input name="nombre" required value="${esc(r.nombre || '')}"></label>
      <label>Descripción corta <small>(también se usa para la imagen)</small><input name="descripcion" value="${esc(r.descripcion || '')}" placeholder="${esT ? 'vaso alto con…' : 'plato con…, presentado en…'}"></label>
      ${esT ? `<div class="dos">
        <label>Tipo${sel('alcohol', [['1', 'Con alcohol'], ['0', 'Sin alcohol']], r.alcohol ? '1' : '0')}</label>
        <label>Técnica${sel('tecnica', [['directo', 'Directo'], ['batido', 'Batido'], ['revuelto', 'Revuelto'], ['licuado', 'Licuado']], r.tecnica)}</label></div>
        <div class="dos"><label>Vaso<input name="vaso" value="${esc(r.vaso || '')}"></label><label>Hielo<input name="hielo" value="${esc(r.hielo || '')}"></label></div>
        <div class="dos"><label>Decoración<input name="decoracion" value="${esc(r.decoracion || '')}"></label><label>Marida con<input name="maridaje" value="${esc(r.maridaje || '')}"></label></div>`
      : `<div class="dos">
        <label>Línea${sel('linea', [['liviano', 'Liviano'], ['dia-libre', 'Día libre']], r.linea)}</label>
        <label>Categoría${sel('categoria', CATS.map(c => [c, c[0].toUpperCase() + c.slice(1)]), r.categoria)}</label></div>
        <div class="tres"><label>Prep. (min)<input name="prep_min" inputmode="numeric" value="${r.prep_min ?? ''}"></label><label>Cocción (min)<input name="coccion_min" inputmode="numeric" value="${r.coccion_min ?? ''}"></label>
        <label>Dificultad${sel('dificultad', [['fácil', 'Fácil'], ['media', 'Media'], ['difícil', 'Difícil']], r.dificultad || 'fácil')}</label></div>`}
      <div class="dos"><label>${esT ? 'Rinde (tragos)' : 'Porciones'}<input name="porciones" inputmode="numeric" value="${r.porciones ?? ''}"></label><label>Kcal por porción<input name="kcal" inputmode="numeric" value="${r.kcal ?? ''}"></label></div>
      <label>Etiquetas <small>(separadas por coma)</small><input name="etiquetas" value="${esc((r.etiquetas || []).join(', '))}" placeholder="vegetariano, sin TACC, alto en proteína"></label>

      <h2>Ingredientes *</h2><div id="ings">${r.ingredientes.map(filaIng).join('')}</div>
      <button type="button" class="btn sec" data-a="masIng">＋ Ingrediente</button>
      <h2>Pasos *</h2><div id="pasos">${r.pasos.map(filaPaso).join('')}</div>
      <button type="button" class="btn sec" data-a="masPaso">＋ Paso</button>

      <h2>Tips</h2><label><small>Uno por línea</small><textarea name="tips" rows="3">${esc((r.tips || []).join('\n'))}</textarea></label>
      ${esT ? '' : `<label>👶 Porción para la bebé<textarea name="tip_bebe" rows="2">${esc(r.tip_bebe || '')}</textarea></label>
      <h2>Para adelantar</h2>
      <label class="check"><input type="checkbox" name="ad_ok" ${ad.se_puede ? 'checked' : ''}> Se puede preparar por adelantado</label>
      <label>Qué preparar antes<input name="ad_que" value="${esc(ad.que_preparar || '')}"></label>
      <div class="tres"><label>Días en heladera<input name="ad_h" inputmode="numeric" value="${ad.heladera_dias ?? ''}"></label><label>Minutos de prep.<input name="ad_min" inputmode="numeric" value="${ad.min ?? ''}"></label><label class="check"><input type="checkbox" name="ad_f" ${ad.freezar ? 'checked' : ''}> Se freeza</label></div>
      <label class="check"><input type="checkbox" name="ad_horno" ${ad.horno ? 'checked' : ''}> Usa horno</label>
      <label>♻️ Sus sobras sirven para<select name="sobras" multiple size="4">${comidas().filter(x => x.id !== r.id).sort((x, y) => x.nombre.localeCompare(y.nombre)).map(x => `<option value="${esc(x.id)}" ${(r.sobras_para || []).includes(x.id) ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label>`}

      <h2>Imagen</h2>
      <div class="foto-edit">${imagen(r, 'chica')}<label class="btn sec">Subir foto propia<input type="file" accept="image/*" hidden data-i="fotoForm"></label><span class="sub" id="foto-estado">${r.imagen ? '' : 'Sin foto: la genera el script.'}</span></div>
      <label>Prompt de imagen <small>(se arma solo; podés editarlo)</small><textarea name="prompt_imagen" rows="4" data-auto="${modo === 'nueva' || !r.prompt_imagen || r.prompt_imagen === armarPrompt(r) ? '1' : '0'}">${esc(r.prompt_imagen || armarPrompt(r))}</textarea></label>
      <button class="btn grande ancho">Guardar</button>
    </form>`;
  },
  despues: () => {
    const f = $('#f-receta'); if (!f) return;
    const pr = f.prompt_imagen;
    pr.oninput = () => { pr.dataset.auto = '0'; };
    const auto = () => { if (pr.dataset.auto === '1') pr.value = armarPrompt({ tipo: f.dataset.tipo, nombre: f.nombre.value, descripcion: f.descripcion.value }); };
    f.nombre.oninput = auto; f.descripcion.oninput = auto;
    f.onsubmit = (e) => { e.preventDefault(); guardarForm(f); };
  },
};

async function guardarForm(f) {
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
  const esT = f.dataset.tipo === 'trago';
  const ings = $$('.fila-ing', f).map(row => {
    const q = $('.cant', row).value.trim();
    let cant = null;
    if (q) cant = q.includes('/') ? (() => { const [x, y] = q.split('/').map(Number); return x / y; })() : num(q);
    return { cant, unidad: $('.uni', row).value.trim(), nombre: $('.nom', row).value.trim() };
  }).filter(i => i.nombre);
  const pasos = $$('.fila-paso', f).map(row => ({ texto: $('textarea', row).value.trim(), timer: num($('.tmin', row).value) })).filter(p => p.texto);
  if (!f.nombre.value.trim() || !ings.length || !pasos.length) { toast('Faltan nombre, ingredientes o pasos'); return; }
  const ed = UI.editando; const base = ed.modo === 'editar' ? ed.base : {};
  let id = ed.id;
  if (!id) { id = slug(f.nombre.value); let k = 2; while (porId(id)) id = `${slug(f.nombre.value)}-${k++}`; }
  const r = {
    ...base, id, tipo: esT ? 'trago' : 'comida', nombre: f.nombre.value.trim(), descripcion: f.descripcion.value.trim(),
    porciones: num(f.porciones.value) || (esT ? 1 : 4), kcal: num(f.kcal.value),
    etiquetas: f.etiquetas.value.split(',').map(s => s.trim()).filter(Boolean),
    ingredientes: ings, pasos, tips: f.tips.value.split('\n').map(s => s.trim()).filter(Boolean),
    prompt_imagen: f.prompt_imagen.value.trim(),
    propia: ed.modo === 'nueva' ? true : !!base.propia,
    imagen: base.imagen || null, regenerar: !!base.regenerar,
  };
  if (esT) Object.assign(r, { alcohol: f.alcohol.value === '1', tecnica: f.tecnica.value, vaso: f.vaso.value.trim(), hielo: f.hielo.value.trim(), decoracion: f.decoracion.value.trim(), maridaje: f.maridaje.value.trim() });
  else Object.assign(r, {
    linea: f.linea.value, categoria: f.categoria.value, prep_min: num(f.prep_min.value) || 0, coccion_min: num(f.coccion_min.value) || 0,
    dificultad: f.dificultad.value, tip_bebe: f.tip_bebe.value.trim(),
    adelantar: { se_puede: f.ad_ok.checked, que_preparar: f.ad_que.value.trim(), heladera_dias: num(f.ad_h.value), freezar: f.ad_f.checked, horno: f.ad_horno.checked, min: num(f.ad_min.value) || 0 },
    sobras_para: [...f.sobras.selectedOptions].map(o => o.value),
  });
  try {
    if (UI.fotoPendiente) { $('#foto-estado').textContent = 'Subiendo foto…'; r.imagen = await DB.subirFoto(id, UI.fotoPendiente); r.regenerar = false; UI.fotoPendiente = null; }
    await DB.guardarRecetas([r]);
    const i = S.recetas.findIndex(x => x.id === id);
    if (i >= 0) S.recetas[i] = r; else S.recetas.push(r);
    datalists(); toast('Guardado'); ir('#/receta/' + encodeURIComponent(id));
  } catch (err) { toast('No se pudo guardar: ' + err.message); }
}

// ═════════════════════════ IMPORTAR ═════════════════════════
const EJEMPLO = `[
  {
    "tipo": "comida",
    "nombre": "Pollo al curry",
    "linea": "liviano",
    "categoria": "principales",
    "porciones": 4, "prep_min": 15, "coccion_min": 25,
    "dificultad": "fácil", "kcal": 420,
    "descripcion": "pollo al curry con arroz en bowl",
    "etiquetas": ["sin TACC"],
    "ingredientes": [
      { "cant": 600, "unidad": "g", "nombre": "pechuga de pollo" }
    ],
    "pasos": [ { "texto": "Dorá el pollo.", "timer": 8 } ],
    "tips": ["…"], "tip_bebe": "…",
    "adelantar": { "se_puede": true, "que_preparar": "…",
      "heladera_dias": 3, "freezar": true, "horno": false, "min": 20 },
    "sobras_para": []
  }
]`;
VISTAS.importar = {
  nav: 'mas',
  html: () => `<header class="top"><a class="btn-icono" href="#/mas" aria-label="Volver">${ic('back', 20)}</a><h1>Importar</h1><span></span></header>
    <p>Pegá una o varias recetas o tragos en formato JSON. Pedíselas a Claude así: <em>“pasame 5 recetas de pescado para mi app de cocina, en el formato de importación”</em>.</p>
    <textarea id="json-import" rows="12" class="mono" placeholder="Pegá acá el JSON…"></textarea>
    <button class="btn grande ancho" data-a="importar">Importar</button>
    <p id="import-res" class="nota"></p>
    <details class="caja"><summary>Ver formato</summary><pre class="mono">${esc(EJEMPLO)}</pre>
    <p class="sub">Para tragos: <code>"tipo": "trago"</code>, <code>"alcohol": true/false</code>, <code>vaso</code>, <code>hielo</code>, <code>decoracion</code>, <code>tecnica</code>, <code>maridaje</code>. Si no traen <code>id</code> o <code>prompt_imagen</code>, se generan solos. El formato completo está en <code>formato-recetas.md</code> del repositorio.</p></details>`,
};
async function importar() {
  const out = $('#import-res');
  let data;
  try { data = JSON.parse($('#json-import').value); } catch (e) { out.textContent = '⚠️ El texto no es un JSON válido: ' + e.message; return; }
  const lista = Array.isArray(data) ? data : (data.recetas || [data]);
  const ok = []; const errores = [];
  const ids = new Set(S.recetas.map(r => r.id));
  lista.forEach((x, n) => {
    if (!x || !x.nombre || !Array.isArray(x.ingredientes) || !Array.isArray(x.pasos)) { errores.push(`#${n + 1}: falta nombre, ingredientes o pasos`); return; }
    const r = { ...x };
    r.tipo = r.tipo === 'trago' ? 'trago' : 'comida';
    if (!r.id || ids.has(r.id)) { let id = slug(r.nombre); let k = 2; while (ids.has(id)) id = `${slug(r.nombre)}-${k++}`; r.id = id; }
    ids.add(r.id);
    r.pasos = r.pasos.map(p => typeof p === 'string' ? { texto: p, timer: null } : p);
    r.ingredientes = r.ingredientes.map(i => typeof i === 'string' ? { cant: null, unidad: '', nombre: i } : i);
    if (r.tipo === 'comida') { r.linea ||= 'liviano'; r.categoria ||= 'principales'; r.adelantar ||= { se_puede: false }; r.sobras_para ||= []; }
    r.porciones ||= r.tipo === 'trago' ? 1 : 4;
    r.prompt_imagen ||= armarPrompt(r);
    r.propia = true; r.imagen ||= null; r.regenerar = false;
    ok.push(r);
  });
  if (ok.length) { await DB.guardarRecetas(ok); S.recetas.push(...ok); }
  out.innerHTML = `✓ ${ok.length} importadas.${ok.length ? ' Corré el script de imágenes para generarles la foto.' : ''}${errores.length ? '<br>⚠️ ' + errores.map(esc).join('<br>⚠️ ') : ''}`;
  if (ok.length) $('#json-import').value = '';
}

// ═════════════════════════ IMÁGENES ═════════════════════════
VISTAS.imagenes = {
  nav: 'mas',
  html: () => {
    const pend = S.recetas.filter(r => !r.imagen || r.regenerar);
    const repo = (window.APP_CONFIG || {}).repoUrl;
    return `<header class="top"><a class="btn-icono" href="#/mas" aria-label="Volver">${ic('back', 20)}</a><h1>Imágenes</h1><span></span></header>
    <div class="caja"><b>${pend.length} pendientes</b>
      <p class="sub">Se generan todas juntas con el script de GitHub Actions: Actions → “Generar imágenes” → Run workflow. Solo genera las que faltan o están marcadas para regenerar.</p>
      ${repo ? `<a class="btn" href="${esc(repo)}/actions" target="_blank" rel="noopener">Abrir GitHub Actions</a>` : ''}</div>
    <div class="mini-lista">${pend.map(r => `<div class="mini">${imagen(r, 'chica')}<span><b>${esc(r.nombre)}</b><small>${r.regenerar ? 'Para regenerar' : 'Sin imagen'}</small></span>
      <span class="mini-acc"><button class="btn-chico" data-a="copiarPrompt" data-id="${esc(r.id)}">Prompt</button><label class="btn-chico">Foto<input type="file" accept="image/*" hidden data-i="foto" data-id="${esc(r.id)}"></label></span></div>`).join('') || '<p class="sub">¡Todas tienen imagen!</p>'}</div>`;
  },
};

// ═════════════════════════ AJUSTES ═════════════════════════
VISTAS.ajustes = {
  nav: 'mas',
  html: () => `<header class="top"><a class="btn-icono" href="#/mas" aria-label="Volver">${ic('back', 20)}</a><h1>Ajustes</h1><span></span></header>
    <form class="form" id="f-ajustes">
      <label>Tu nombre <small>(para el saludo, solo en este celular)</small><input name="nombre" value="${esc(nombrePropio())}"></label>
      <label>Porciones por comida en el planificador<input name="p" inputmode="numeric" value="${S.ajustes.porciones}"></label>
      <label>Tragos por defecto en el planificador<input name="t" inputmode="numeric" value="${S.ajustes.porcionesTrago}"></label>
      <button class="btn">Guardar</button>
    </form>
    <div class="caja"><p><b>Cuenta:</b> ${esc(S.usuario?.email || '')}</p>${DB.usaSupabase ? '<button class="btn sec" data-a="salir">Cerrar sesión</button>' : '<p class="sub">Vista previa: sin cuenta. Los datos quedan solo en este navegador.</p>'}</div>
    <div class="caja"><p><b>Recetas iniciales</b></p><p class="sub">Vuelve a cargar las recetas y tragos originales que hayas borrado. No toca las tuyas ni las editadas.</p><button class="btn sec" data-a="resembrar">Restaurar recetas iniciales</button></div>`,
  despues: () => {
    $('#f-ajustes').onsubmit = async (e) => {
      e.preventDefault();
      try { localStorage.setItem('cyt:nombre', e.target.nombre.value.trim()); } catch { UI.nombre = e.target.nombre.value.trim(); }
      S.ajustes = { porciones: parseInt(e.target.p.value) || 3, porcionesTrago: parseInt(e.target.t.value) || 2 };
      await DB.escribir('ajustes', S.ajustes); toast('Guardado');
    };
  },
};

// ═════════════════════════ ACCIONES ═════════════════════════
const A = {
  cerrarModal,
  atras: (el, e) => { if (history.length > 1) { e.preventDefault(); history.back(); } },
  linea: (el) => { UI.cocina.linea = el.dataset.v; if (el.closest('.chips') && !el.closest('#modal')) UI.cocina.cat = 'todas'; refrescarFiltros(); },
  cat: (el) => { const v = el.dataset.v; UI.cocina.cat = UI.cocina.cat === v && !el.closest('#modal') ? 'todas' : v; refrescarFiltros(); },
  filtro: (el) => { const f = UI.cocina.f; f.has(el.dataset.v) ? f.delete(el.dataset.v) : f.add(el.dataset.v); refrescarFiltros(); },
  filtros: () => modalFiltros(),
  limpiarFiltros: () => { Object.assign(UI.cocina, { linea: 'todas', cat: 'todas', q: '', f: new Set() }); cerrarModal(); render(); },
  verLinea: (el) => { UI.cocina.linea = el.dataset.v; render(true); },
  verFiltro: (el) => { UI.cocina.f.add(el.dataset.v); render(true); },
  alcohol: (el) => { UI.tragos.alcohol = el.dataset.v; if (el.dataset.v === 'todos') UI.tragos.tengo = false; render(); },
  tengo: () => { UI.tragos.tengo = !UI.tragos.tengo; render(); },
  limpiarTragos: () => { Object.assign(UI.tragos, { alcohol: 'todos', q: '', tengo: false }); render(); },
  tab: (el) => { UI.tab[el.dataset.id] = el.dataset.v; const y = window.scrollY; render(); window.scrollTo(0, y); },
  compartirReceta: async (el) => {
    const r = porId(el.dataset.id);
    const txt = `${r.nombre}\n\nIngredientes:\n${r.ingredientes.map(i => { const t = textoIng(i); return `• ${t.cant ? t.cant + ' ' : ''}${t.nombre}`; }).join('\n')}\n\nPreparación:\n${r.pasos.map((p, i) => `${i + 1}. ${p.texto}`).join('\n')}`;
    try { if (navigator.share) { await navigator.share({ title: r.nombre, text: txt }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(txt); toast('Receta copiada'); } catch { modal(`<h2>${esc(r.nombre)}</h2><textarea rows="12">${esc(txt)}</textarea>`); }
  },
  despTab: (el) => { UI.despTab = el.dataset.v; render(); },
  fav: async (el) => {
    const id = el.dataset.id; const on = !meta(id).fav;
    S.meta[id] = { ...meta(id), fav: on }; // respuesta inmediata
    $$(`[data-a="fav"][data-id="${CSS.escape(id)}"]`).forEach(b => { b.classList.toggle('on', on); b.innerHTML = ic('bookmark', b.classList.contains('marca') ? 16 : (b.classList.contains('btn-flot') ? 19 : 18), on); });
    toast(on ? 'Guardada' : 'Quitada de guardadas');
    await guardarMeta(id, { fav: on });
  },
  puntaje: async (el) => { const id = el.dataset.id; const v = +el.dataset.v; await guardarMeta(id, { puntaje: meta(id).puntaje === v ? 0 : v }); render(); },
  porc: (el) => { const r = porId(el.dataset.id); const v = (UI.porc[r.id] || r.porciones || 1) + (+el.dataset.v); UI.porc[r.id] = Math.max(1, v); const y = window.scrollY; render(); window.scrollTo(0, y); },
  tachar: (el) => { const t = (UI.tachados[el.dataset.id] ||= {}); t[el.dataset.v] = !t[el.dataset.v]; el.classList.toggle('tachado'); el.querySelector('.chk').innerHTML = t[el.dataset.v] ? ic('check', 12) : ''; },
  timer: (el) => { const min = +el.dataset.min; S.timers.push({ id: Date.now(), lbl: el.dataset.lbl, fin: Date.now() + min * 60000 }); tickTimers(); toast(`⏱ Timer de ${min} min iniciado`); },
  quitarTimer: (el) => { S.timers = S.timers.filter(t => t.id !== +el.dataset.v); tickTimers(); },
  cocinar: (el) => { UI.paso = 0; ir('#/cocinar/' + encodeURIComponent(el.dataset.id)); },
  paso: (el) => { UI.paso = Math.max(0, UI.paso + (+el.dataset.v)); render(); },
  salirCocina: (el) => ir('#/receta/' + encodeURIComponent(el.dataset.id)),
  terminar: async (el) => { await A.hecho(el, null, true); ir('#/receta/' + encodeURIComponent(el.dataset.id)); },
  hecho: async (el, e, silencio) => {
    const id = el.dataset.id; const fecha = hoy();
    if (S.historial.some(x => x.receta_id === id && x.fecha === fecha)) { if (!silencio) toast('Ya estaba registrada hoy'); return; }
    const ent = { id: `m-${Date.now()}`, receta_id: id, fecha, slot: 'manual' };
    await DB.guardarHistorial([ent]); S.historial.push(ent);
    toast('¡Anotado en el historial!'); if (!silencio) render();
  },
  aSemana: (el) => {
    const id = el.dataset.id; const r = porId(id); const esT = r.tipo === 'trago';
    const wks = [lunesDe(hoy()), sumarDias(lunesDe(hoy()), 7)];
    modal(`<h2>Agregar a la semana</h2>${seg([[wks[0], 'Esta semana'], [wks[1], 'La próxima']], wks[0], 'wkModal')}
      <div class="grid-dias" id="grid-dias" data-wk="${wks[0]}">${DIAS.map((d, i) => `<div><b>${d.slice(0, 3)}</b>${(esT ? (i >= 4 ? ['trago'] : []) : ['almuerzo', 'cena']).map(s => `<button class="btn-chico" data-a="asignarDesde" data-d="${i}" data-s="${s}" data-id="${esc(id)}">${SLOTS[s]}</button>`).join('') || '<small class="sub">—</small>'}</div>`).join('')}</div>`);
  },
  wkModal: (el) => { $('#grid-dias').dataset.wk = el.dataset.v; $$('#modal .seg button').forEach(b => b.classList.toggle('on', b === el)); },
  asignarDesde: async (el) => { const wk = $('#grid-dias').dataset.wk; await asignar(+el.dataset.d, el.dataset.s, el.dataset.id, wk); toast(`Agregado al ${DIAS[+el.dataset.d].toLowerCase()}`); },
  copiarPrompt: async (el) => { const r = porId(el.dataset.id); try { await navigator.clipboard.writeText(r.prompt_imagen || armarPrompt(r)); toast('Prompt copiado'); } catch { modal(`<h2>Prompt</h2><textarea rows="8" class="mono">${esc(r.prompt_imagen)}</textarea>`); } },
  regenerar: async (el) => { const r = porId(el.dataset.id); r.regenerar = !r.regenerar; await DB.guardarRecetas([r]); toast(r.regenerar ? 'Se regenerará en la próxima corrida' : 'Listo'); render(); },
  borrar: async (el) => {
    const r = porId(el.dataset.id);
    if (!(await confirmar(`¿Borrar “${r.nombre}”? No se puede deshacer.`, 'Borrar'))) return;
    await DB.borrarReceta(r.id); S.recetas = S.recetas.filter(x => x.id !== r.id);
    toast('Borrada'); ir(r.tipo === 'trago' ? '#/tragos' : '#/cocina');
  },
  semanaMov: async (el) => { UI.semana = sumarDias(UI.semana, +el.dataset.v); await cargarSemana(UI.semana); render(); },
  elegir: (el) => elegirReceta(+el.dataset.d, el.dataset.s),
  asignar: (el) => asignar(+el.dataset.d, el.dataset.s, el.dataset.id),
  usarSobras: async (el) => {
    const wk = el.dataset.wk; const plan = S.semanas[wk];
    plan.dias[+el.dataset.dd][el.dataset.ss] = { id: el.dataset.id, porc: S.ajustes.porciones, sobrasDe: `${el.dataset.d}:${el.dataset.s}` };
    await guardarSemana(wk); cerrarModal(); render(); toast('♻️ Sobras planificadas');
  },
  quitarSlot: async (el) => {
    const plan = S.semanas[UI.semana]; const key = `${el.dataset.d}:${el.dataset.s}`;
    plan.dias[+el.dataset.d][el.dataset.s] = null;
    plan.dias.forEach(dia => Object.values(dia).forEach(s => { if (s && s.sobrasDe === key) delete s.sobrasDe; }));
    await guardarSemana(UI.semana); render();
  },
  slotPorc: async (el) => { const s = S.semanas[UI.semana].dias[+el.dataset.d][el.dataset.s]; s.porc = Math.max(1, s.porc + (+el.dataset.v)); await guardarSemana(UI.semana); render(); },
  sugerir: async () => { const n = sugerirSemana(); await guardarSemana(UI.semana); render(); toast(n ? `✨ Se sumaron ${n} comidas livianas` : 'La semana ya está completa'); },
  plantillas: () => {
    modal(`<h2>Plantillas de semana</h2>
      <form class="agregar" id="f-plantilla"><input name="n" placeholder="Nombre (ej.: Semana liviana)"><button class="btn">Guardar actual</button></form>
      <div class="mini-lista">${S.plantillas.map((p, i) => `<div class="mini"><span><b>${esc(p.nombre)}</b><small>${p.plan.dias.reduce((a, d) => a + Object.values(d).filter(Boolean).length, 0)} comidas</small></span><span class="mini-acc"><button class="btn-chico" data-a="aplicarPlantilla" data-v="${i}">Usar</button><button class="btn-chico" data-a="borrarPlantilla" data-v="${i}">✕</button></span></div>`).join('') || '<p class="sub">Todavía no guardaste ninguna.</p>'}</div>`, () => {
      $('#f-plantilla').onsubmit = async (e) => {
        e.preventDefault(); const n = e.target.n.value.trim() || `Semana del ${fechaCorta(UI.semana)}`;
        S.plantillas = await DB.actualizar('plantillas', [], p => [...p, { nombre: n, plan: structuredClone(S.semanas[UI.semana]) }]);
        toast('Plantilla guardada'); A.plantillas();
      };
    });
  },
  aplicarPlantilla: async (el) => {
    if (!(await confirmar('¿Reemplazar la semana actual por esta plantilla?', 'Reemplazar'))) return;
    S.semanas[UI.semana] = structuredClone(S.plantillas[+el.dataset.v].plan); await guardarSemana(UI.semana); cerrarModal(); render();
  },
  borrarPlantilla: async (el) => { const i = +el.dataset.v; S.plantillas = await DB.actualizar('plantillas', [], p => p.filter((_, k) => k !== i)); A.plantillas(); },
  alFreezer: async (el) => { const r = porId(el.dataset.id); await guardarDespensa(d => d.freezer.push({ id: String(Date.now()), nombre: r.nombre, desde: hoy() })); toast('Anotado en el freezer'); },
  compartir: () => {
    const wk = UI.semana; const c = S.compras[wk]; const items = listaCompras(wk).filter(i => !c.marcados[i.k] && !tengo(i.nombre));
    let txt = `🛒 Compras ${rangoSemana(wk)}\n`;
    ORDEN_GONDOLAS.forEach(g => { const l = items.filter(i => i.g === g); if (l.length) txt += `\n*${g}*\n` + l.map(i => `• ${i.nombre}${i.cant != null ? ' — ' + fmtCant(i.cant, i.unidad) : ''}`).join('\n') + '\n'; });
    const ex = c.extra.filter(e => !e.ok); if (ex.length) txt += `\n*Otras cosas*\n` + ex.map(e => `• ${e.nombre}`).join('\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
  },
  limpiarCompras: async () => { const wk = UI.semana; S.compras[wk] = await DB.actualizar('compras:' + wk, { marcados: {}, extra: [] }, c => ({ marcados: {}, extra: c.extra.map(e => ({ ...e, ok: false })) })); render(); },
  quitarExtra: async (el) => { const wk = UI.semana; S.compras[wk] = await DB.actualizar('compras:' + wk, { marcados: {}, extra: [] }, c => ({ ...c, extra: c.extra.filter(e => e.id !== +el.dataset.id) })); render(); },
  quitarStock: async (el) => { await guardarDespensa(d => { d.stock = d.stock.filter(s => s.nombre !== el.dataset.v); }); render(); },
  quitarBasico: async (el) => { await guardarDespensa(d => { d.basicos = d.basicos.filter(b => b !== el.dataset.v); }); render(); },
  usarFreezer: async (el) => { await guardarDespensa(d => { d.freezer = d.freezer.filter((f, i) => String(f.id || i) !== el.dataset.v); }); render(); },
  masIng: () => $('#ings').insertAdjacentHTML('beforeend', filaIng()),
  masPaso: () => $('#pasos').insertAdjacentHTML('beforeend', filaPaso()),
  quitarFila: (el) => el.parentElement.remove(),
  importar,
  salir: async () => { await DB.salir(); location.reload(); },
  resembrar: async () => {
    const seed = await cargarSeed(); const ya = new Set(S.recetas.map(r => r.id));
    const nuevas = seed.filter(r => !ya.has(r.id));
    if (nuevas.length) { await DB.guardarRecetas(nuevas); S.recetas.push(...nuevas); }
    toast(nuevas.length ? `Se restauraron ${nuevas.length}` : 'No faltaba ninguna');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  if (el.tagName !== 'A' || el.dataset.a === 'atras') { if (el.dataset.a !== 'atras') e.preventDefault(); }
  Promise.resolve(fn(el, e)).catch(err => { console.error(err); toast('Error: ' + err.message); });
});

const INPUTS = {
  qCocina: (el) => { UI.cocina.q = el.value; $('#lista').innerHTML = filtrandoCocina() ? resultadosCocina() : inicioCocina(); },
  qTragos: (el) => { UI.tragos.q = el.value; $('#lista').innerHTML = filtrandoTragos() ? resultadosTragos() : inicioTragos(); },
};
document.addEventListener('input', (e) => { const el = e.target.closest('[data-i]'); if (el && INPUTS[el.dataset.i]) INPUTS[el.dataset.i](el); });
const CAMBIOS = {
  notas: (el) => guardarMeta(el.dataset.id, { notas: el.value }).then(() => toast('Nota guardada')),
  foto: async (el) => {
    const file = el.files[0]; if (!file) return; const r = porId(el.dataset.id);
    toast('Subiendo foto…');
    const blob = await comprimir(file); r.imagen = await DB.subirFoto(r.id, blob); r.regenerar = false;
    await DB.guardarRecetas([r]); toast('Foto guardada'); render();
  },
  fotoForm: async (el) => {
    const file = el.files[0]; if (!file) return;
    UI.fotoPendiente = await comprimir(file);
    const url = URL.createObjectURL(UI.fotoPendiente);
    const prev = $('.foto-edit .foto'); prev.outerHTML = `<img class="foto chica" src="${url}" alt="">`;
    $('#foto-estado').textContent = 'Se sube al guardar.';
  },
  domingo: async (el) => { const wk = UI.semana; S.domingo[wk] = await DB.actualizar('domingo:' + wk, {}, d => ({ ...d, [el.dataset.id]: el.checked })); render(); },
  marcar: async (el) => {
    const wk = UI.semana; const k = el.dataset.k; const ok = el.checked;
    S.compras[wk] = await DB.actualizar('compras:' + wk, { marcados: {}, extra: [] }, c => ({ ...c, marcados: { ...c.marcados, [k]: ok } }));
    if (ok) { const it = listaCompras(wk).find(i => i.k === k); if (it && !/cocid|casera/.test(norm(it.nombre))) await guardarDespensa(d => { if (!d.stock.some(s => norm(s.nombre) === norm(it.nombre))) d.stock.push({ nombre: it.nombre, lugar: lugarPara(it.nombre) }); }); }
    render();
  },
  marcarExtra: async (el) => { const wk = UI.semana; const id = +el.dataset.id; const ok = el.checked; S.compras[wk] = await DB.actualizar('compras:' + wk, { marcados: {}, extra: [] }, c => ({ ...c, extra: c.extra.map(e => e.id === id ? { ...e, ok } : e) })); render(); },
};
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-i]'); if (!el || !CAMBIOS[el.dataset.i]) return;
  Promise.resolve(CAMBIOS[el.dataset.i](el)).catch(err => { console.error(err); toast('Error: ' + err.message); });
});

function refrescarFiltros() { render(); if ($('#modal')) modalFiltros(); }

// datalists globales para el editor y la despensa
function datalists() {
  const nombres = [...new Set(S.recetas.flatMap(r => r.ingredientes.map(i => i.nombre)))].sort();
  $('#dl-ings').innerHTML = nombres.map(n => `<option value="${esc(n)}">`).join('');
  $('#dl-unidades').innerHTML = UNIDADES.map(u => `<option value="${u}">`).join('');
}

$('#nav').innerHTML = [['cocina', 'home', 'Cocina'], ['tragos', 'glass', 'Tragos'], ['semana', 'calendar', 'Semana'], ['compras', 'list', 'Compras'], ['mas', 'menu', 'Más']]
  .map(([r, i, t]) => `<a href="#/${r}" data-r="${r}">${ic(i, 23)}${t}</a>`).join('');
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.SEED) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
