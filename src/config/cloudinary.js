import dotenv from 'dotenv';
dotenv.config();
import { v2 as cloudinary } from 'cloudinary';

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
  process.env;

for (const [k, v] of Object.entries({
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
})) {
  if (!v) throw new Error(`Falta la variable de entorno ${k}`);
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME.trim(),
  api_key: CLOUDINARY_API_KEY.trim(),
  api_secret: CLOUDINARY_API_SECRET.trim(),
  secure: true,
});

export async function verificarCloudinary() {
  try {
    await cloudinary.api.ping();
    console.log('✅ Cloudinary conectado');
  } catch (e) {
    console.error(
      '❌ Cloudinary no conecta:',
      e?.error?.message || e.message
    );
  }
}

export default cloudinary;
