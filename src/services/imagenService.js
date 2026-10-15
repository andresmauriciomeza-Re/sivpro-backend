import cloudinary from '../config/cloudinary.js';
import AppError from '../errors/AppError.js';

export function subirImagen(buffer, carpeta = 'sivpro/productos') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: carpeta,
        resource_type: 'image',
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', {
            http_code: error.http_code,
            message: error.message,
            name: error.name,
          });
          return reject(
            new AppError('No se pudo subir la imagen a Cloudinary.', 502)
          );
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    stream.end(buffer);
  });
}

export async function borrarImagen(publicId) {
  if (!publicId) return { result: 'not_found' };

  try {
    const respuesta = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
    });
    return respuesta;
  } catch (error) {
    console.error('Cloudinary destroy error:', {
      publicId,
      http_code: error?.error?.http_code,
      message: error?.error?.message || error.message,
    });
    throw new AppError('No se pudo eliminar la imagen de Cloudinary.', 502);
  }
}
