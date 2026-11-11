# S.I.V.PRO - Backend

Backend de S.I.V.PRO construido con Node.js + Express. Expone endpoints de salud, autenticación, recuperación de contraseña y subida de archivos a Cloudinary.

## Índice

1. [Requisitos](#requisitos)
2. [Instalación y ejecución](#instalación-y-ejecución)
3. [Variables de entorno](#variables-de-entorno)
4. [Formato de errores](#formato-de-errores)
5. [Endpoints](#endpoints)
   - [Salud](#salud)
   - [Autenticación](#autenticación)
   - [Recuperación de contraseña](#recuperación-de-contraseña)
   - [Subida de archivos](#subida-de-archivos)
6. [Estructura del proyecto](#estructura-del-proyecto)
7. [Notas](#notas)

## Requisitos

- Node.js >= 18
- PostgreSQL accesible
- Cuenta de Cloudinary
- Cuenta Gmail con contraseña de aplicación (para enviar los códigos de recuperación)

## Instalación y ejecución

```bash
npm install
cp .env.example .env
npm run dev   # desarrollo (node --watch)
npm start     # producción
```

Completa las variables en `.env` (solo nombres aquí; no se publican valores).

## Variables de entorno

### Servidor

| Variable | Descripción |
| --- | --- |
| `PORT` | Puerto del servidor (por defecto `3000`) |
| `FRONTEND_URL` | Orígenes permitidos por CORS, separados por coma (ej. `http://localhost:5173`) |
| `NODE_ENV` | Con `production` se activa `trust proxy` |

### Base de datos

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión de PostgreSQL |

### Autenticación (JWT)

| Variable | Descripción |
| --- | --- |
| `JWT_SECRET` | Secreto para firmar tokens (HS256) |
| `JWT_EXPIRES_IN` | Vigencia del token (por defecto `8h`) |

### Cloudinary

| Variable | Descripción |
| --- | --- |
| `CLOUDINARY_CLOUD_NAME` | Nombre del cloud de Cloudinary |
| `CLOUDINARY_API_KEY` | API key de Cloudinary |
| `CLOUDINARY_API_SECRET` | API secret de Cloudinary |

### Correo

| Variable | Descripción |
| --- | --- |
| `MAIL_USER` | Usuario SMTP |
| `MAIL_APP_PASSWORD` | Contraseña de aplicación SMTP |

## Formato de errores

Todos los errores responden con el formato:

```json
{ "error": { "message": "...", "statusCode": 400 } }
```

| Código | Causa |
| --- | --- |
| 400 | Validación de datos, cuerpo JSON inválido o falta el campo `archivo` |
| 401 | Token ausente, inválido o expirado; correo o contraseña incorrectos |
| 404 | Ruta inexistente |
| 409 | Documento o correo ya registrado |
| 413 | El archivo supera los 5 MB |
| 415 | Tipo de archivo no permitido |
| 429 | Límite de peticiones (login, registro o solicitud de código) |
| 500 | Error interno no previsto |
| 502 | Cloudinary rechazó la subida |
| 503 | Sin conexión a la base de datos |

## Endpoints

### Preparación de pizzas

Las líneas nuevas de preparación de pizzas se crean sin `tamano`: `cantidad`
representa pizzas completas. Al completar se envían `id_detalle_op` y
`cantidad_real`; cada pizza suma 24 partes de inventario compartido. Una
porción mediana consume 3 partes y una grande 4. Los productos exponen
`stock_partes`, `disponibles_mediana` y `disponibles_grande`; ambas
disponibilidades comparten el mismo inventario y no se pueden sumar.
Se exigen precios positivos para ambos tamaños. Las líneas antiguas con
tamaño también producen 24 partes por pizza.

Las preparaciones en proceso se completan automáticamente al cumplirse su
tiempo estimado, o pueden completarse manualmente antes. Si falta un precio
de pizza, el avance automático lo asigna a partir de los costos y deja aviso
en el historial. Si faltan datos de costos o no se puede asignar un precio
válido sin cambiar el existente, la orden queda en proceso y el error se
registra en el servidor.

La migración [017_stock_pizza_partes.sql](migrations/017_stock_pizza_partes.sql)
requiere las migraciones anteriores y debe ejecutarse una sola vez antes de
desplegar el backend actualizado. Los clientes deben adaptarse al nuevo
contrato antes de utilizarlo.

### Compras: IVA por ítem y presentaciones

Cada línea de compra y de orden de compra indica su propio modo de IVA con el
campo `modo_iva`: `incluido` (el monto unitario ya trae el IVA), `mas_iva` (el
monto unitario es la base y el IVA se suma aparte) o `exento` (tarifa 0 %; el
porcentaje se fuerza a 0). Si una línea no envía `modo_iva`, se usa el
`iva_incluido` global de la petición (retrocompatibilidad) y, en su defecto,
`incluido`. `tb_compras.iva_incluido` quedó como dato derivado: `true` si todas
las líneas son `incluido`, `false` si todas son `mas_iva` y `NULL` si la factura
mezcla modos. Los totales siempre cumplen `subtotal_sin_iva + total_iva = total`.

Las líneas pueden pedir una presentación de compra (`paq`, `paca`, `caja`,
`bolsa`, `sixpack`) en vez de la unidad base del insumo. El factor (cuántas
unidades base trae cada presentación) se configura una vez por insumo con los
endpoints de presentaciones, o puede enviarse en la propia línea con
`factor_presentacion`. El inventario siempre se mueve en la unidad base del
insumo: cada línea guarda `unidades_base` y `unidad_base`, de modo que al
anular una compra se devuelve exactamente lo que entró y la recepción de una
orden compara lo pedido con lo recibido en unidades base (20 kg cumplen
1 paca). Un insumo nuevo recibido como presentación exige `unidad_base` y
`factor_presentacion` en la línea.

#### `GET /api/insumos/:id/presentaciones`

Lista las presentaciones configuradas del insumo. Permiso: Compras (Insumos
Ver, Compra Crear u Orden de Compra Ver/Crear).

**Respuesta:**

```json
[
  { "id_presentacion": 1, "id_insumo": 12, "presentacion": "paca", "unidades_base": 20, "estado": true }
]
```

#### `POST /api/insumos/:id/presentaciones`

Crea o actualiza una presentación (upsert por insumo + presentación). Permiso:
Compras (Insumos Editar, Compra Crear u Orden de Compra Crear).

```json
{ "presentacion": "paca", "unidades_base": 20, "estado": true }
```

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `presentacion` | string | Obligatorio. `paq`, `paca`, `caja`, `bolsa` o `sixpack` |
| `unidades_base` | number | Obligatorio. Cuántas unidades base trae cada presentación; mayor que cero |
| `estado` | boolean | Opcional. Por defecto `true`; `false` desactiva la presentación sin borrarla |

La migración [018_iva_por_item_y_presentaciones.up.sql](migrations/018_iva_por_item_y_presentaciones.up.sql)
agrega `modo_iva`, `unidades_base` y `unidad_base` a las líneas de compra y de
orden de compra, relaja `tb_compras.iva_incluido` y crea la tabla
`tb_insumo_presentacion`. Debe ejecutarse una sola vez antes de desplegar el
backend actualizado.

### Salud

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| GET | `/api/health` | no | `200 { "ok": true }` |
| GET | `/api/health/db` | Bearer | Verifica la conexión a la base de datos |

### Autenticación

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | no | Registro de cliente; responde `201` con el usuario |
| POST | `/api/auth/login` | no | `200 { "token": "...", "usuario": { ... } }` |
| GET | `/api/auth/me` | Bearer | Perfil del usuario autenticado |

### Recuperación de contraseña

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/auth/recuperar/solicitar` | Envía un código de 6 dígitos al correo registrado |
| POST | `/api/auth/recuperar/verificar` | Valida el código |
| POST | `/api/auth/recuperar/restablecer` | Cambia la contraseña |

Cuerpos:

```json
// solicitar
{ "correo": "usuario@ejemplo.com" }

// verificar
{ "correo": "usuario@ejemplo.com", "codigo": "123456" }

// restablecer
{ "correo": "usuario@ejemplo.com", "codigo": "123456", "contrasena": "NuevaClave1" }
```

Respuestas de éxito:

```json
// solicitar (siempre, aunque el correo no esté registrado)
{ "mensaje": "Si el correo está registrado, te enviamos un código." }

// verificar
{ "valido": true }

// restablecer
{ "mensaje": "Contraseña actualizada. Ya puedes iniciar sesión." }
```

El código vence en 15 minutos y se invalida tras 5 intentos fallidos.

### Subida de archivos

#### `POST /api/uploads`

`Content-Type: multipart/form-data`
`Authorization: Bearer <token>` (obligatorio)

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `archivo` | file | Obligatorio. JPEG, PNG o WEBP, máximo 5 MB |
| `carpeta` | text | Opcional. Valores permitidos: `productos`, `comprobantes`, `proveedores`, `no-conformes`. Cualquier otro valor se guarda en `otros` |

Los archivos se guardan en Cloudinary dentro de la carpeta `sivpro/<carpeta>`.

**Respuesta (201):**

```json
{
  "url": "https://res.cloudinary.com/<cloud>/image/upload/v1/...",
  "publicId": "sivpro/productos/abc123"
}
```

| Código | Causa |
| --- | --- |
| 400 | Falta el campo `archivo` o el multipart está mal formado |
| 401 | Token faltante, inválido o expirado |
| 413 | El archivo supera los 5 MB |
| 415 | Tipo de archivo no permitido |
| 404 | Ruta inexistente |
| 429 | Demasiadas subidas desde la IP (máx. 20 cada 15 minutos) |
| 502 | Cloudinary rechazó la subida |
| 500 | Error interno no previsto |

**Ejemplo con curl:**

```bash
curl -X POST http://localhost:3000/api/uploads \
  -H "Authorization: Bearer <token>" \
  -F "archivo=@./foto.jpg" \
  -F "carpeta=productos"
```

## Estructura del proyecto

```text
src/
├── assets/        # logo usado en el correo de recuperación
├── config/        # configuración (Cloudinary, base de datos)
├── controllers/   # req/res
├── services/      # auth, recuperación, correo, subida, salud
├── models/        # (pendiente)
├── routes/        # definición de rutas
├── middlewares/   # JWT, multer y normalización de carpeta
├── utils/         # rate limiters y emailTemplates.js (plantilla HTML del correo)
├── errors/        # AppError
├── validators/    # validación de datos, tipo, tamaño y carpeta
├── app.js         # express + CORS + manejo de errores
└── server.js      # arranque
tests/
```

## Notas

- El código de recuperación vence en **15 minutos** y se invalida tras **5 intentos fallidos**.
- Los archivos se suben con un máximo de **5 MB**.
- Tipos de archivo permitidos: **JPEG, PNG y WEBP**.
- `POST /api/uploads` exige **Bearer token** y permite un máximo de **20 subidas por IP cada 15 minutos**.
