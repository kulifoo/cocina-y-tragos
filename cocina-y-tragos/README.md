# Cocina & Tragos

App personal de recetas, tragos con y sin alcohol, planificador semanal, lista de compras, despensa e historial. Es una PWA (se instala en el inicio del celular), se publica gratis con GitHub Pages y guarda los datos en Supabase, compartidos entre los dos usuarios.

Trae **30 recetas** (20 Liviano, 10 Día libre) y **20 tragos** (10 con alcohol, 10 sin alcohol), y un script que genera todas las fotos de una vez con IA.

---

## Puesta en marcha (una sola vez, ~30 minutos)

> Conviene hacerlo desde la computadora.

### 1. Supabase (la base de datos)

1. Entrá a [supabase.com](https://supabase.com) → **New project**. Usá un proyecto nuevo, separado del de finanzas (el plan gratis permite dos).
2. Abrí **SQL Editor → New query**, pegá todo el contenido de `schema.sql` y tocá **Run**. Crea las tablas, la seguridad y el espacio para las fotos.
3. **Authentication → Users → Add user → Create new user**: creá un usuario para vos y otro para tu esposa (email y contraseña; marcá *Auto Confirm User*).
4. **Authentication → Sign In / Providers**: desactivá *Allow new users to sign up*, así nadie más puede crear cuenta.
5. **Project Settings → API** y anotá tres datos:
   - **Project URL**
   - **anon public** key (va en la app)
   - **service_role** key (es secreta: va solo en GitHub, nunca en la app)

### 2. Configurar la app

Abrí `config.js` y completá:

```js
window.APP_CONFIG = {
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'la anon public key',
  repoUrl: 'https://github.com/TU-USUARIO/cocina-y-tragos',
};
```

### 3. GitHub (publicar la app)

1. En GitHub: **New repository** → nombre `cocina-y-tragos` → **Public** → Create.
2. **Add file → Upload files** y arrastrá todo el contenido de la carpeta (no la carpeta en sí). → **Commit changes**.
   - Si la carpeta `.github` no se subió (las carpetas que empiezan con punto a veces quedan ocultas): **Add file → Create new file**, escribí como nombre `.github/workflows/generar-imagenes.yml` (el contenido está en `generar-imagenes.yml`) y pegá el contenido de ese archivo.
3. **Settings → Pages** → *Source: Deploy from a branch* → Branch **main** y carpeta **/ (root)** → Save.
4. En un par de minutos la app queda en `https://TU-USUARIO.github.io/cocina-y-tragos/`.

### 4. Primer ingreso

Abrí esa dirección e ingresá con tu usuario. **En el primer ingreso se cargan solas las 50 recetas y tragos** en Supabase.

### 5. Generar las imágenes

1. Creá una clave en [platform.openai.com](https://platform.openai.com) → **API keys → Create new secret key**, y cargá saldo en **Billing**. Cada imagen cuesta unos centavos de dólar; los precios actuales están en la página de precios de OpenAI. Es posible que OpenAI te pida **verificar la organización** (Settings → Organization) para usar el modelo de imágenes.
2. En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**, y creá estos tres:

   | Nombre | Valor |
   |---|---|
   | `SUPABASE_URL` | la Project URL |
   | `SUPABASE_SERVICE_KEY` | la service_role key |
   | `OPENAI_API_KEY` | la clave de OpenAI |

3. **Actions → Generar imágenes → Run workflow**. Para probar, poné `3` en *Máximo de imágenes* y mirá cómo quedan en la app. Si te gustan, corrélo de nuevo con `0` para generar todas las que faltan.

Cada vez que sumes recetas, o marques una foto con **Regenerar**, volvé a correr el workflow: solo genera las pendientes.

> Para cambiar de modelo, agregá en el workflow `IMAGE_MODEL: nombre-del-modelo` (por ejemplo, uno más nuevo de OpenAI o `dall-e-3`).

### 6. Instalar en el celular

- **iPhone (Safari):** botón Compartir → *Agregar a inicio*.
- **Android (Chrome):** menú ⋮ → *Instalar app* o *Agregar a pantalla principal*.

---

## Cómo se usa

- **Cocina:** filtros Liviano / Día libre, categorías, búsqueda por ingrediente, y filtros rápidos (≤ 30 min, fácil, se adelanta, vegetariano, sin TACC, ≤ 400 kcal, favoritas, mías). En cada receta: porciones ajustables, timers en los pasos, tips, tip para la porción de la bebé, datos para adelantar, recetas que aprovechan las sobras, puntaje, notas y **Modo cocina** (pantalla siempre encendida, letra grande, paso a paso).
- **Tragos:** con y sin alcohol, y el filtro **Con lo que tengo en casa**, que mira lo cargado en Despensa → Barra.
- **Semana:** almuerzo y cena de lunes a domingo, más tragos de viernes a domingo. **Sugerir semana** completa los huecos con recetas Livianas, sin repetir proteína dos comidas seguidas ni lo que comieron las últimas dos semanas. Al agregar una receta que deja sobras, la app te propone qué hacer con ellas al día siguiente y suma las porciones extra. **Preparar el domingo** arma la lista de tareas para dejar adelantada la semana. También podés guardar semanas como plantilla (botón ☰).
- **Compras:** se arma sola con la semana, suma cantidades repetidas, agrupa por góndola, descuenta lo que hay en la despensa y se comparte por WhatsApp. Lo que tachás se suma a la despensa.
- **Más:** Despensa (stock, básicos que nunca se compran y freezer con fechas), Historial (qué comieron, hace cuánto no comen algo, lo más hecho y lo mejor puntuado), Favoritos, agregar recetas y tragos, importar, imágenes pendientes y ajustes.

## Sumar recetas

- **A mano:** botón ＋ en Cocina o Tragos. El prompt de la imagen se arma solo.
- **Duplicar:** abrí una receta → *Duplicar* y modificala.
- **Importar:** Más → Importar recetas, y pegá un JSON. Pedíselas a Claude así:

  > Pasame 5 recetas livianas de pescado para mi app de cocina, en el formato de importación de `formato-recetas.md`.

## Actualizar la app

Subí los archivos modificados al repositorio (Add file → Upload files). Si cambiás algo de la app, aumentá la versión en la primera línea de `sw.js` (`cyt-v1` → `cyt-v2`) para que los celulares tomen la versión nueva.

## Probar sin Supabase

Si `config.js` queda vacío, la app funciona en **modo vista previa**: los datos se guardan solo en ese navegador. Sirve para probar cambios.
