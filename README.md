# S.I.V.PRO - Backend

Backend de S.I.V.PRO construido con Node.js + Express. Expone endpoints de salud, autenticación, recuperación de contraseña y subida de archivos a Cloudinary.

Todos los errores responden con el formato:

```json
{ "error": { "message": "...", "statusCode": 400 } }
```

## Requisitos

- Node.js >= 18
- PostgreSQL accesible
- Cuenta de Cloudinary
- Cuenta SMTP (Gmail) para enviar los códigos de recuperación

## Instalación

```bash
npm install
cp .env.example .env
```

Completa las variables en `.env` (solo nombres aquí; no se publican valores):

| Variable | Descripción |
| --- | --- |
| `PORT` | Puerto del servidor (por defecto `3000`) |
| `FRONTEND_URL` | Orígenes permitidos por CORS, separados por coma (ej. `http://localhost:5173`) |
| `NODE_ENV` | Con `production` se activa `trust proxy` |
| `DATABASE_URL` | Cadena de conexión de PostgreSQL |
| `JWT_SECRET` | Secreto para firmar tokens (HS256) |
| `JWT_EXPIRES_IN` | Vigencia del token (por defecto `8h`) |
| `CLOUDINARY_CLOUD_NAME` | Nombre del cloud de Cloudinary |
| `CLOUDINARY_API_KEY` | API key de Cloudinary |
| `CLOUDINARY_API_SECRET` | API secret de Cloudinary |
| `MAIL_USER` | Usuario SMTP |
| `MAIL_APP_PASSWORD` | Contraseña de aplicación SMTP |
| `MAIL_FROM_NAME` | Nombre remitente de los correos |

## Ejecución

```bash
npm run dev   # desarrollo (node --watch)
npm start     # producción
```

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

## Estructura

```
src/
├── config/        # configuración (Cloudinary, base de datos)
├── controllers/   # req/res
├── services/      # auth, recuperación, correo, subida, salud
├── models/        # (pendiente)
├── routes/        # definición de rutas
├── middlewares/   # JWT, multer y normalización de carpeta
├── utils/         # rate limiters
├── errors/        # AppError
├── validators/    # validación de datos, tipo, tamaño y carpeta
├── app.js         # express + CORS + manejo de errores
└── server.js      # arranque
tests/
```
