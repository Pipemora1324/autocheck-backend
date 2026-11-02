# AutoCheck-CO Backend

API REST en Express 5 + TypeScript para AutoCheck-CO: registrar vehículos colombianos en un garaje personal, ver las vigencias de SOAT y RTM, obtener un concepto ("Sin alertas" / "Revisar" / "No recomendado") y consultar un informe de peritaje de demostración. Usa Postgres (Neon) y autenticación propia con JWT.

## Qué es real, qué es de demostración y qué depende de terceros

| Parte | Estado |
| --- | --- |
| Cuentas, login, sesiones con refresh rotativo, verificación de correo, recuperación de contraseña, borrado de cuenta, admin por `ADMIN_EMAILS` | **Real**: funciona contra Postgres |
| Garaje (`/garage`): vehículos que registra cada usuario, vigencias de SOAT/RTM y concepto | **Real**, pero calculado **solo con los datos que el usuario registra**. No es una consulta oficial (lo declara `basedOn`) |
| Informe de peritaje (`/vehicles`): placas ABC-1234, DEF-5678 y GHI-9012 con inspecciones | **Solo demostración**: datos ficticios cargados por una migración. No es el flujo real (que es `/garage`) y se eliminará más adelante |
| Lectura de la tarjeta de propiedad (`POST /garage/scan-card`) | **Real**, con un **proveedor externo** intercambiable (`SCAN_PROVIDER`): Gemini (plan gratuito, recomendado) o Anthropic. Apagada con `none` o sin la clave del proveedor |
| Consulta RUNT (`POST /garage/:plate/refresh-from-runt`) | **Proveedor externo**, apagada por defecto (`RUNT_PROVIDER=none`). El adaptador de Verifik es un **esqueleto** hasta confirmar su contrato. No hay scraping de RUNT |
| Correo (verificación y recuperación) | **Proveedor externo**: Brevo por HTTPS en producción (Render gratuito bloquea SMTP). En desarrollo los enlaces salen por consola |

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

Las variables se validan al arrancar con zod; si falta o es inválida alguna, el proceso termina indicando cuál. Ver `.env.example`.

## Scripts

| Comando                | Descripción                                           |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Servidor en modo watch (`tsx`, lee `.env`)            |
| `npm run build`        | Compila TypeScript a `dist/`                          |
| `npm start`            | Ejecuta la build compilada                            |
| `npm run typecheck`    | Verifica tipos de `src/` y de las pruebas             |
| `npm run migrate`      | Aplica las migraciones pendientes (lee `.env`)        |
| `npm run migrate:down` | Revierte la última migración                          |
| `npm run migrate:prod` | Migraciones desde `dist/` (lo usa Render al arrancar) |
| `npm test`             | Pruebas con el test runner de Node                    |

Las pruebas usan repositorios en memoria, un lector de tarjetas y un proveedor RUNT simulados: no necesitan base de datos ni llaman a APIs externas. Para correr también las de integración contra Postgres, define `TEST_DATABASE_URL` con una base desechable cuyo nombre contenga `test`; su esquema se borra en cada corrida.

## Endpoints

El contrato completo, con ejemplos de cuerpo y respuesta, está en [docs/API.md](docs/API.md). En resumen:

- **Públicos:** `GET /health`, `GET /config/public` (consentimiento y proveedor de lectura activo), `POST /auth/register` (exige `acceptedTerms: true`), `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`.
- **Con token:** `GET /auth/me`, `DELETE /auth/me`.
- **Con token y correo verificado** (si no: `403 EMAIL_NOT_VERIFIED`):
  - `GET/POST /garage`
  - `GET/PATCH/DELETE /garage/:plate`
  - `GET /garage/:plate/assessment`
  - `GET /garage/capabilities`
  - `POST /garage/scan-card`
  - `POST /garage/:plate/refresh-from-runt`
  - `/vehicles/*`: **solo demostración**, 3 placas ficticias; editar inspecciones exige rol `admin`. El flujo real es `/garage`

Las vigencias (`Vigente`, `Por Vencer` a 30 días o menos, `Vencido`) se calculan en cada consulta con la fecha de hoy en Colombia (`America/Bogota`).

## Tratamiento de datos personales (Ley 1581 de 2012)

> Texto base para un proyecto académico, no es asesoría legal.
>
> **Nota para confirmar (Juan Felipe Mora):** revisa que el nombre y el correo del responsable sean los correctos antes de abrir el servicio al público. Si cambias este texto o el de `REGISTRATION_CONSENT_TEXT`, sube `PRIVACY_POLICY_VERSION` en `src/services/privacyPolicy.ts`.

**Responsable del tratamiento:** Juan Felipe Mora · Correo de contacto para consultas, reclamos y solicitudes: `juan.morarevel@campusucc.edu.co`.

**Autorización.**

- El registro exige marcar `acceptedTerms: true`, con el texto de `GET /config/public` (`privacyPolicy.registrationConsent`).
- Se guardan la fecha de aceptación (`users.terms_accepted_at`) y la versión de esta política (`users.terms_version`, hoy `2026-11-02.2`) como prueba de la autorización previa, expresa e informada.

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

**Encargados externos**

- **Brevo:** envía los correos de verificación y recuperación (correo del usuario y enlace).
- **Neon:** aloja la base de datos.
- **Render:** aloja la API.
- **Proveedor de lectura de la tarjeta:** recibe la foto, solo si el usuario usa esa función.

**Foto de la tarjeta de propiedad**

- **Para qué se envía:** la foto se envía a un **proveedor externo** de inteligencia artificial solo para extraer los datos. El proveedor activo se informa en `GET /config/public` (`cardScan.provider` y `cardScan.notice`) y el frontend lo muestra antes de subirla.
  - Con `SCAN_PROVIDER=gemini`: Google, Gemini API, plan gratuito.
  - Con `SCAN_PROVIDER=anthropic`: Anthropic.
  - Ambos están en EE. UU., lo que implica una transmisión internacional de datos.
- **Plan gratuito de Gemini:** Google puede usar el contenido enviado, incluida la foto, para mejorar sus productos.
- **Qué hace AutoCheck-CO con ella:** la recibe en memoria y la descarta al terminar la petición. No la escribe en disco ni en la base de datos, y no la registra en logs.
- **Datos extraídos:** se devuelven únicamente al usuario para que los confirme, incluido el documento del propietario. No se guardan ni se escriben en logs.
- **Documento del propietario:** solo se usa, si el usuario lo decide, para la consulta al proveedor RUNT.
- **Tarjetas ajenas:** **no se debe subir la tarjeta de otra persona sin su autorización.** El usuario lo declara al aceptar la política.

**Consulta a proveedor RUNT** (desactivada por defecto). Si se activa, la placa y el documento del propietario se envían al proveedor configurado solo cuando el usuario lo pide y con consentimiento explícito en cada consulta (`consent: true`).

**Derechos del titular**

- **Conocer y actualizar:** `GET /auth/me` y la edición de los vehículos del garaje.
- **Suprimir:** `DELETE /auth/me` borra la cuenta, sus sesiones, sus tokens y sus vehículos.
- **Revocar la autorización:** se hace eliminando la cuenta.
- **Otras solicitudes:** al correo del responsable indicado arriba.

## Estructura

```
migrations/          SQL versionado (node-pg-migrate)
docs/API.md          Contrato HTTP para el frontend
src/config/          Validación de variables de entorno (zod)
src/db/              Pool de conexiones y runner de migraciones
src/routes/          Definición de rutas
src/domain/          Placas colombianas y firma de imágenes
src/providers/       Proveedores externos de consulta RUNT (none, verifik)
src/controllers/     Validación de entrada y respuesta HTTP
src/services/        Reglas de negocio (auth, garaje, concepto, lectura de tarjeta, correo)
src/repositories/    Acceso a datos (Postgres)
src/middleware/      Auth, roles, rate limit y manejo de errores
```

## Despliegue

Ver [DEPLOY.md](DEPLOY.md): Neon, Render, Vercel, SMTP, Anthropic, proveedor RUNT y la lista de pasos manuales pendientes.

## Frontend

El cliente Angular vive en [autocheck-frontend](https://github.com/Pipemora1324/autocheck-frontend).
