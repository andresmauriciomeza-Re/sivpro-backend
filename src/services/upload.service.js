import { subirImagen } from './imagenService.js';

export function uploadFileToCloudinary(buffer, carpeta) {
  return subirImagen(buffer, `sivpro/${carpeta}`);
}
