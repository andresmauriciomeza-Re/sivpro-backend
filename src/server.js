import 'dotenv/config';
import app from './app.js';
import { verificarCloudinary } from './config/cloudinary.js';

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
});
