import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createVehicleRoutes } from './routes/vehicleRoutes.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(createVehicleRoutes());

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'AutoCheck-CO' });
});

app.use((_request, response) => {
  response.status(404).json({ message: 'No se encontró la ruta solicitada.' });
});

app.listen(port, () => {
  console.log(`AutoCheck-CO API activa en http://localhost:${port}`);
});
