import cloudinary from '../config/cloudinary.js';
import AppError from '../errors/AppError.js';

export function uploadFileToCloudinary(buffer, carpeta) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `sivpro/${carpeta}`,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error.http_code, error.message);
          return reject(
            new AppError('No se pudo subir el archivo a Cloudinary.', 502)
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
