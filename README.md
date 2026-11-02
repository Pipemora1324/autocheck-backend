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

## Tratamiento de datos personales (Ley 1581 de 2012)

> Texto base para un proyecto académico, no es asesoría legal. Antes de abrir el servicio al público, revísalo y completa los datos del responsable (TODO en `DEPLOY.md`).

**Autorización.** El registro exige marcar `acceptedTerms: true`. Se guarda la fecha de aceptación (`users.terms_accepted_at`) y la versión de esta política (`users.terms_version`, ver `src/services/privacyPolicy.ts`) como prueba de la autorización previa, expresa e informada.

**Qué se guarda y para qué**

| Dato | Dónde | Finalidad |
| --- | --- | --- |
| Correo electrónico | `users` | Identificar la cuenta, iniciar sesión, enviar enlaces de verificación y recuperación |
| Contraseña | `users.password_hash` | Solo el hash argon2id; la contraseña nunca se guarda ni se registra |
| Rol, fechas de registro, verificación y aceptación | `users` | Control de acceso y evidencia del consentimiento |
| Sesiones | `refresh_tokens` | Identificador y vigencia de cada sesión (no el token) para poder revocarlas |
| Tokens de verificación y recuperación | `email_verification_tokens`, `password_reset_tokens` | Solo el hash sha256; expiran en 24 h y 30 min y son de un solo uso |
| Vehículos del garaje | `user_vehicles` | Datos que el usuario registra (placa, marca, modelo, vigencias de SOAT/RTM, etc.) para calcular alertas. **No** se guarda el documento del propietario |
| Registros técnicos | Logs de Render | IP, método, ruta, código de respuesta y hora, para seguridad y diagnóstico. No se registran cuerpos de petición, tokens ni datos extraídos de documentos |

**Imagen de la tarjeta de propiedad**

- Se recibe en memoria y no se escribe en disco ni en la base de datos.
- Se envía a la API de Anthropic (proveedor en EE. UU., transmisión internacional de datos) solo para extraer el texto, y se descarta al terminar la petición.
- Los datos extraídos, incluido el documento del propietario, se devuelven únicamente al usuario para que los confirme. No se guardan ni se escriben en logs.
- El documento del propietario solo se usa, si el usuario lo decide, para la consulta al proveedor RUNT.

**Consulta a proveedor RUNT** (desactivada por defecto). Si se activa, la placa y el documento del propietario se envían al proveedor configurado, solo cuando el usuario lo pide y con consentimiento explícito en cada consulta (`consent: true`).

**Derechos del titular**

- **Conocer y actualizar:** `GET /auth/me` y la edición de los vehículos del garaje.
- **Suprimir:** `DELETE /auth/me` borra la cuenta, sus sesiones, sus tokens y sus vehículos.
- **Revocar la autorización:** se hace eliminando la cuenta.
- Para cualquier otra solicitud, el canal de contacto del responsable (TODO en `DEPLOY.md`).

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
