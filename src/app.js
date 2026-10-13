import express from 'express';
import cors from 'cors';
import AppError from './errors/AppError.js';
import healthRouter from './routes/health.routes.js';
import authRouter from './routes/auth.routes.js';
import uploadsRouter from './routes/uploads.routes.js';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', uploadsRouter);

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

  console.error(err);
  res.status(500).json({
    error: {
      message: 'Error interno del servidor.',
      statusCode: 500,
    },
  });
});

export default app;
