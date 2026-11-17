# Formato de importación de recetas y tragos

La pantalla **Más → Importar recetas** acepta un JSON con una receta, una lista de recetas `[ … ]` o un objeto `{ "recetas": [ … ] }`.

Obligatorios: `nombre`, `ingredientes` y `pasos`. El resto es opcional. Si falta `id` o `prompt_imagen`, se generan solos.

## Comida

```json
{
  "tipo": "comida",
  "nombre": "Pollo al curry con arroz",
  "linea": "liviano",
  "categoria": "principales",
  "descripcion": "bowl de pollo al curry amarillo con arroz blanco y cilantro",
  "porciones": 4,
  "prep_min": 15,
  "coccion_min": 25,
  "dificultad": "fácil",
  "kcal": 450,
  "etiquetas": ["sin TACC", "alto en proteína"],
  "ingredientes": [
    { "cant": 600, "unidad": "g", "nombre": "pechuga de pollo" },
    { "cant": 1, "unidad": "u", "nombre": "cebolla" },
    { "cant": null, "unidad": "a gusto", "nombre": "sal" }
  ],
  "pasos": [
    { "texto": "Cortá el pollo en cubos.", "timer": null },
    { "texto": "Cociná a fuego bajo con la salsa.", "timer": 20 }
  ],
  "tips": ["Hacé el doble de arroz para la semana."],
  "tip_bebe": "Separá su porción antes de salar y del curry picante.",
  "adelantar": {
    "se_puede": true,
    "que_preparar": "Cortá el pollo y prepará la salsa.",
    "heladera_dias": 3,
    "freezar": true,
    "horno": false,
    "min": 20
  },
  "sobras_para": ["wraps-pollo"]
}
```

| Campo | Valores |
|---|---|
| `linea` | `liviano` o `dia-libre` |
| `categoria` | `entradas`, `principales`, `guarniciones`, `ensaladas`, `sopas`, `postres`, `panadería`, `salsas` |
| `dificultad` | `fácil`, `media`, `difícil` |
| `unidad` | `g`, `kg`, `ml`, `l`, `u`, `cda`, `cdita`, `taza`, `diente`, `atado`, `lata`, `paquete`, `pizca`, `a gusto`, `c/n` |
| `timer` | minutos, o `null` |
| `sobras_para` | ids de recetas que aprovechan las sobras de esta |
| `descripcion` | breve y visual: se usa para generar la foto |

Los ingredientes que salen de otra receta conviene nombrarlos con *cocido/a* o *casero/a* (por ejemplo `pollo cocido`, `salsa de tomate casera`): en la lista de compras van a un grupo aparte, y si vienen de sobras no se compran.

## Trago

```json
{
  "tipo": "trago",
  "nombre": "Paloma",
  "alcohol": true,
  "descripcion": "vaso alto con bebida rosada de pomelo, borde de sal y rodaja de pomelo",
  "vaso": "Vaso alto",
  "hielo": "Hielo en cubos",
  "decoracion": "Borde de sal y rodaja de pomelo",
  "tecnica": "directo",
  "maridaje": "Tacos, ceviche",
  "porciones": 1,
  "kcal": 180,
  "ingredientes": [
    { "cant": 50, "unidad": "ml", "nombre": "tequila" },
    { "cant": 150, "unidad": "ml", "nombre": "gaseosa de pomelo" },
    { "cant": null, "unidad": "c/n", "nombre": "hielo" }
  ],
  "pasos": [{ "texto": "Escarchá el vaso con sal.", "timer": null }],
  "tips": ["Con jugo de pomelo natural y soda queda menos dulce."]
}
```

`tecnica`: `directo`, `batido`, `revuelto` o `licuado`.
