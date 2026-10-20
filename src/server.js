import 'dotenv/config';
import app from './app.js';
import { verificarCloudinary } from './config/cloudinary.js';
import { verificarCorreo } from './services/mail.service.js';

if (!String(process.env.SUPER_ADMIN_ID || '').trim()) {
  console.warn('SUPER_ADMIN_ID no está configurado; no se marcará ningún usuario como super administrador.');
}

if (!process.env.JWT_SECRET) {
  console.error(
    'Falta JWT_SECRET. Configure la variable de entorno JWT_SECRET para arrancar el servidor.'
  );
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`S.I.V.PRO backend escuchando en http://localhost:${PORT}`);
  verificarCloudinary();
  // Informa en consola si la conexión SMTP quedó lista; si falla, solo loguea
  // y el servidor sigue levantado.
  verificarCorreo();
});
