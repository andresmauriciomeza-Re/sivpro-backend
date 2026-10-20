import express from 'express';
import cors from 'cors';
import AppError from './errors/AppError.js';
import healthRouter from './routes/health.routes.js';
import authRouter from './routes/auth.routes.js';
import uploadsRouter from './routes/uploads.routes.js';
import recuperacionRouter from './routes/recuperacion.routes.js';
import usuariosRouter from './routes/usuarios.routes.js';
import rolesRouter from './routes/roles.routes.js';

const app = express();

function obtenerOrigenesPermitidos(valor) {
  return (valor || '')
    .split(',')
    .map((origen) => origen.trim().replace(/\/$/, ''))
    .filter((origen) => origen.length > 0);
}

const ORIGENES_PERMITIDOS = obtenerOrigenesPermitidos(process.env.FRONTEND_URL);

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin: (origen, callback) => {
      const normalizado =
        typeof origen === 'string' ? origen.trim().replace(/\/$/, '') : '';
      callback(null, !origen || ORIGENES_PERMITIDOS.includes(normalizado));
    },
  })
);
app.use(express.json());

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', uploadsRouter);
app.use('/api', recuperacionRouter);
app.use('/api', usuariosRouter);
app.use('/api', rolesRouter);

app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Ruta no encontrada.',
      statusCode: 404,
    },
  });
});

app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        statusCode: err.statusCode,
      },
    });
  }

  if (err.name === 'MulterError') {
    const statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'El archivo supera el máximo permitido de 5 MB.'
        : 'Error al procesar el archivo enviado.';

    return res.status(statusCode).json({
      error: {
        message,
        statusCode,
      },
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: {
        message: 'El cuerpo de la petición no es un JSON válido.',
        statusCode: 400,
      },
    });
  }

  console.error(err);
  res.status(500).json({
    error: {
      message: 'Error interno del servidor.',
      statusCode: 500,
    },
  });
});

export default app;
