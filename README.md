# AutoCheck-CO Backend

API REST en Express + TypeScript para consultar vehículos por placa, escanear placas y actualizar inspecciones.

## Requisitos

- Node.js 24+
- npm 11+

## Configuración

```bash
cp .env.example .env
npm install
```

Variables disponibles (ver `.env.example`): `PORT`, `CORS_ORIGIN`, `NODE_ENV`.

## Scripts

| Comando         | Descripción                              |
| --------------- | ---------------------------------------- |
| `npm run dev`   | Servidor en modo watch (`tsx`)           |
| `npm run build` | Compila TypeScript a `dist/`             |
| `npm start`     | Ejecuta la build compilada               |
| `npm test`      | Pruebas con el test runner de Node       |

## Endpoints

- `GET /health`
- `GET /vehicles`
- `GET /vehicles/:plate`
- `POST /vehicles/scan`
- `PATCH /vehicles/:plate/inspections`

## Frontend

El cliente Angular vive en [autocheck-frontend](https://github.com/Pipemora1324/autocheck-frontend).
