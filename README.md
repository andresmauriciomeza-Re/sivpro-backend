# S.I.V.PRO - Backend

Backend de S.I.V.PRO construido con Node.js + Express. Su única función es recibir archivos por multipart/form-data y subirlos a Cloudinary.

## Requisitos

- Node.js >= 18
- Cuenta y credenciales de Cloudinary

## Instalación

```bash
npm install
```

Copia el archivo de ejemplo de variables de entorno y completa tus credenciales:

```bash
cp .env.example .env
```

| Variable | Descripción |
| --- | --- |
| `PORT` | Puerto del servidor (por defecto `3000`) |
| `FRONTEND_URL` | Origen permitido por CORS |
| `CLOUDINARY_CLOUD_NAME` | Nombre del cloud de Cloudinary |
| `CLOUDINARY_API_KEY` | API key de Cloudinary |
| `CLOUDINARY_API_SECRET` | API secret de Cloudinary |

## Ejecución

```bash
npm run dev   # desarrollo (node --watch)
npm start     # producción
```

## Endpoint

### `POST /api/uploads`

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

**Errores:** todos responden con el formato `{ "error": { "message": "...", "statusCode": 400 } }`.

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
├── config/        # configuración (Cloudinary)
├── controllers/   # req/res
├── services/      # subida a Cloudinary
├── models/        # (pendiente)
├── routes/        # definición de rutas
├── middlewares/   # multer y normalización de carpeta
├── utils/         # utilidades
├── errors/        # AppError
├── validators/    # tipo, tamaño y carpeta
├── app.js         # express + CORS + manejo de errores
└── server.js      # arranque
tests/
```
