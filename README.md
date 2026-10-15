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

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `archivo` | file | Obligatorio. JPEG, PNG, WEBP o PDF, máximo 5 MB |
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
| 413 | El archivo supera los 5 MB |
| 415 | Tipo de archivo no permitido |
| 404 | Ruta inexistente |
| 502 | Cloudinary rechazó la subida |
| 500 | Error interno no previsto |

**Ejemplo con curl:**

```bash
curl -X POST http://localhost:3000/api/uploads \
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
- Tipos de archivo permitidos: **JPEG, PNG, WEBP y PDF**.
