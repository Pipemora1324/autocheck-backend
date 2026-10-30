# AutoCheck-CO Backend

API REST en Express 5 + TypeScript para consultar vehículos en Colombia y su informe de peritaje. Usa Postgres (Neon) y autenticación propia con JWT.

> Los vehículos son **datos ficticios de demostración** (placas ABC-1234, DEF-5678 y GHI-9012). No hay integración real con el RUNT ni con aseguradoras.

## Requisitos

- Node.js 24+
- Una base Postgres: [Neon](https://neon.tech), o un Postgres local para desarrollo

## Puesta en marcha

```bash
cp .env.example .env   # completa DATABASE_URL, JWT_SECRET y JWT_REFRESH_SECRET
npm install
npm run migrate        # crea las tablas y carga los datos de demostración
npm run dev
```

Las variables se validan al arrancar. Si falta alguna, el proceso termina indicando cuál. Ver `.env.example`.

## Scripts

| Comando                | Descripción                                          |
| ---------------------- | ---------------------------------------------------- |
| `npm run dev`          | Servidor en modo watch (`tsx`, lee `.env`)           |
| `npm run build`        | Compila TypeScript a `dist/`                         |
| `npm start`            | Ejecuta la build compilada                           |
| `npm run migrate`      | Aplica las migraciones pendientes (lee `.env`)       |
| `npm run migrate:down` | Revierte la última migración                         |
| `npm run migrate:prod` | Migraciones desde `dist/` (lo usa Render al arrancar) |
| `npm test`             | Pruebas con el test runner de Node                   |

Las pruebas usan repositorios en memoria y no necesitan base de datos. Para correr también las de integración contra Postgres, define `TEST_DATABASE_URL` con una base desechable cuyo nombre contenga `test`; su esquema se borra en cada corrida.

## Endpoints

Públicos:

- `GET /health`
- `POST /auth/register`: `{ email, password }` (mínimo 8 caracteres)
- `POST /auth/login`: `{ email, password }`
- `POST /auth/refresh`: rota el refresh token de la cookie httpOnly
- `POST /auth/logout`
- `POST /auth/forgot-password`: `{ email }`. Responde siempre lo mismo
- `POST /auth/reset-password`: `{ token, password }`

Requieren `Authorization: Bearer <accessToken>`:

- `GET /auth/me`
- `GET /vehicles`
- `GET /vehicles/:plate`
- `POST /vehicles/scan`: `{ plate, source?: 'manual' | 'image' }`
- `PATCH /vehicles/:plate/inspections`: solo `admin`; `{ inspectionId, status, result, notes }`

Los estados de RUNT, SOAT y RTM (`Vigente`, `Por Vencer` a 30 días o menos, `Vencido`) se calculan en cada consulta con la fecha actual de Colombia.

## Estructura

```
migrations/          SQL versionado (node-pg-migrate)
src/config/          Validación de variables de entorno (zod)
src/db/              Pool de conexiones y runner de migraciones
src/routes/          Definición de rutas
src/controllers/     Validación de entrada y respuesta HTTP
src/services/        Reglas de negocio (auth, vehículos, correo)
src/repositories/    Acceso a datos (Postgres)
src/middleware/      Auth, roles, rate limit y manejo de errores
```

## Despliegue

Ver [DEPLOY.md](DEPLOY.md) (Neon, Render y Vercel).

## Frontend

El cliente Angular vive en [autocheck-frontend](https://github.com/Pipemora1324/autocheck-frontend).
