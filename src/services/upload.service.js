import { subirImagen } from './imagenService.js';

export function uploadFileToCloudinary(buffer, carpeta, mimetype) {
  return subirImagen(buffer, `sivpro/${carpeta}`, mimetype);
}
