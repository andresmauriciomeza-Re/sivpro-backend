#!/usr/bin/env node
/**
 * Carga las imágenes de los productos en Postgres (Neon).
 *
 * tb_productos.guarda en `imagen` SOLO el nombre del archivo (p. ej.
 * "pizza_pollo.webp"); este script lee ese archivo de la carpeta de imágenes
 * del frontend y escribe sus bytes en `imagen_data` (bytea) con su MIME en
 * `imagen_tipo`, que es lo que sirve el endpoint público
 * GET /api/productos/:id/imagen.
 *
 * Uso:
 *   node scripts/cargar-imagenes.js                       # carpeta por defecto
 *   node scripts/cargar-imagenes.js "D:\otra\carpeta"     # carpeta propia
 *
 * Es seguro correrlo varias veces: hace un UPDATE por producto (sobrescribe,
 * no duplica ni agrega filas).
 *
 * NO modifica nombres ni archivos: solo escribe imagen_data/imagen_tipo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** Carpeta de imágenes por defecto: la del menú público. */
const CARPETA_DEFECTO =
  'C:\\Users\\USUARIO\\Downloads\\descarga_zip\\src\\assets\\img';

/** Extensión → MIME enviado en `imagen_tipo` y en la cabecera Content-Type. */
const MIME_POR_EXTENSIÓN = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** Misma clave que usa el frontend (getImageUrl.ts): NFC + minúsculas, para
 * que "pizza_cañon.webp", "Pizza_Cañon.WEBP" o la versión descompuesta en
 * diacríticos de "cañón" apunten al mismo archivo. */
const normalizar = (valor) =>
  String(valor ?? '')
    .normalize('NFC')
    .toLowerCase()
    .trim();

// El .env del backend (DATABASE_URL de Neon) se carga desde la raíz del
// proyecto para que funcione aunque se ejecute desde otra carpeta. Va ANTES
// de importar config/db.js: ese módulo arma el Pool al importarse.
const raizBackend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(raizBackend, '.env') });

if (!String(process.env.DATABASE_URL || '').trim()) {
  console.error('Falta DATABASE_URL: no se encontró el archivo .env del backend.');
  process.exit(1);
}

const { pool } = await import('../src/config/db.js');

function listarImagenes(carpeta) {
  if (!fs.existsSync(carpeta)) {
    throw new Error(`La carpeta no existe: ${carpeta}`);
  }
  const porNombre = new Map();
  let ignorados = 0;
  for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
    if (!entrada.isFile()) continue;
    const ext = path.extname(entrada.name).toLowerCase();
    const mime = MIME_POR_EXTENSIÓN[ext];
    if (!mime) {
      ignorados += 1;
      continue;
    }
    porNombre.set(normalizar(entrada.name), {
      ruta: path.join(carpeta, entrada.name),
      nombre: entrada.name,
      mime,
    });
  }
  return { porNombre, ignorados };
}

function imprimirLista(titulo, filas, formato) {
  console.log(`\n${titulo} (${filas.length})`);
  if (filas.length === 0) {
    console.log('  — ninguna —');
    return;
  }
  for (const fila of filas) console.log(`  ${formato(fila)}`);
}

async function main() {
  const carpeta = path.resolve(process.argv[2] || CARPETA_DEFECTO);
  const { porNombre, ignorados } = listarImagenes(carpeta);

  console.log('Cargando imágenes de productos en la base de datos');
  console.log(`  Carpeta: ${carpeta}`);
  console.log(`  Archivos de imagen indexados: ${porNombre.size}${ignorados ? ` (${ignorados} con otra extensión ignorados)` : ''}`);

  const { rows } = await pool.query(
    'SELECT id_producto, nombre, imagen FROM tb_productos ORDER BY id_producto'
  );

  const actualizados = [];
  const sinImagen = [];
  const noEncontrados = [];

  for (const producto of rows) {
    const nombreArchivo = String(producto.imagen ?? '').trim();
    if (!nombreArchivo) {
      sinImagen.push(producto);
      continue;
    }
    const archivo = porNombre.get(normalizar(nombreArchivo));
    if (!archivo) {
      noEncontrados.push({ ...producto, archivoBuscado: nombreArchivo });
      continue;
    }
    const buffer = fs.readFileSync(archivo.ruta);
    await pool.query(
      'UPDATE tb_productos SET imagen_data = $1, imagen_tipo = $2 WHERE id_producto = $3',
      [buffer, archivo.mime, producto.id_producto]
    );
    actualizados.push({
      ...producto,
      archivo: archivo.nombre,
      mime: archivo.mime,
      bytes: buffer.length,
    });
  }

  console.log('\n────────── RESULTADO ──────────');
  imprimirLista(
    'PRODUCTOS ACTUALIZADOS (imagen_data escrita)',
    actualizados,
    (p) => `id ${String(p.id_producto).padEnd(3)} ${p.nombre} ← ${p.archivo} (${p.mime}, ${p.bytes} bytes)`
  );
  imprimirLista(
    'PRODUCTOS SIN IMAGEN ASIGNADA (columna imagen vacía o NULL)',
    sinImagen,
    (p) => `id ${String(p.id_producto).padEnd(3)} ${p.nombre}`
  );
  imprimirLista(
    'NOMBRES QUE NO SE ENCONTRARON EN LA CARPETA',
    noEncontrados,
    (p) => `id ${String(p.id_producto).padEnd(3)} ${p.nombre} → "${p.archivoBuscado}"`
  );

  console.log(
    `\nListo: ${actualizados.length} actualizado(s), ${sinImagen.length} sin imagen, ${noEncontrados.length} sin archivo.`
  );
}

try {
  await main();
} catch (error) {
  console.error('\nError al cargar las imágenes:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
