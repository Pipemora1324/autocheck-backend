# Despliegue de AutoCheck-CO

Arquitectura: **Neon** (Postgres) ← **Render** (esta API) ← **Vercel** (frontend Angular, repo `autocheck-frontend`).

## Pendientes manuales (TODO)

- [ ] **Render**: crear el servicio desde `render.yaml` y cargar `DATABASE_URL`, `CORS_ORIGIN` y `APP_URL` (paso 2).
- [ ] **SMTP**: elegir proveedor y cargar `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM` en Render (paso 4). Sin esto, en producción no se envían los correos de recuperación.
- [ ] **Primer admin**: promover una cuenta a `admin` con SQL (paso 5).
- [ ] **Frontend**: hoy llama a `http://localhost:3000` fijo y no tiene login. Hay que agregarle el login y la URL de la API configurable antes de desplegarlo (paso 3).
- [ ] **Rotación**: si alguna vez se expone un secreto, regenerarlo en el proveedor (paso 6).

## 1. Neon

1. Crea el proyecto en <https://console.neon.tech>. Elige la región AWS más cercana a la región de Render (por ejemplo, `aws-us-east-1` con Render `virginia`).
2. En **Connection Details**, desactiva **Connection pooling** y copia la cadena **directa** (host sin `-pooler`). La API usa esta misma cadena para las migraciones y en tiempo de ejecución: node-pg-migrate toma un *advisory lock* que no funciona detrás de PgBouncer.
3. Migraciones desde tu equipo (opcional; Render también las corre en cada arranque):

   ```bash
   cp .env.example .env      # pega la cadena en DATABASE_URL
   npm ci
   npm run migrate           # crea tablas y carga las 3 placas ficticias
   ```

   Para revertir la última migración: `npm run migrate:down`.

> La conexión exige TLS con verificación del certificado. `sslmode` y `channel_binding` de la URL se ignoran porque el código ya fuerza `ssl.rejectUnauthorized=true` y channel binding (ver `src/db/pool.ts`).

## 2. Render (API)

1. En <https://dashboard.render.com>, ve a **New → Blueprint** y selecciona el repo `autocheck-backend`. Render lee `render.yaml`:
   - Build: `npm ci --include=dev && npm run build`
   - Start: `npm run migrate:prod && npm start` (si las migraciones fallan, el servicio no arranca)
   - Health check: `GET /health`
   - `JWT_SECRET` y `JWT_REFRESH_SECRET` los genera Render (`generateValue: true`). No los copies a ningún archivo.
2. Render pide los valores marcados `sync: false`:

   | Variable | Valor |
   | --- | --- |
   | `DATABASE_URL` | Cadena directa de Neon (paso 1.2) |
   | `CORS_ORIGIN` | URL del frontend en Vercel, p. ej. `https://autocheck-frontend.vercel.app` (varias separadas por coma, sin `/` final) |
   | `APP_URL` | URL pública del frontend; el correo enlaza a `APP_URL/reset-password?token=...` |
   | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Ver paso 4 (se pueden dejar vacías al principio) |

   Ya vienen fijas: `NODE_ENV=production`, `NODE_VERSION=24`, `SMTP_PORT=587`.
3. Si falta o es inválida alguna variable, el arranque falla con un mensaje que nombra cada variable (revisa los **Logs** del servicio).
4. Verifica:

   ```bash
   curl https://TU-SERVICIO.onrender.com/health          # {"status":"ok",...}
   curl -i https://TU-SERVICIO.onrender.com/vehicles     # 401 sin token
   ```

> En el plan gratuito el servicio se duerme tras unos 15 minutos sin tráfico, y la primera petición después tarda entre 30 y 60 s. Neon también suspende la base cuando no hay uso. Ver "Mantener Render despierto".

### Proxies y rate limit (`TRUST_PROXY`)

Camino de una petición en producción:

```
navegador → Vercel (rewrite /api/*) → balanceador de Render → Express
             proxy 1                    proxy 2
```

- Vercel reenvía la petición con `X-Forwarded-For: <IP del cliente>`.
- El balanceador de Render agrega la IP de salida de Vercel y se conecta a Express.
- Express ve `X-Forwarded-For: <cliente>, <Vercel>` y como conexión directa la del balanceador.
- `TRUST_PROXY` es la cantidad de saltos en los que se confía, contando desde la derecha:

| Escenario | `TRUST_PROXY` | `req.ip` resultante |
| --- | --- | --- |
| Vercel → Render (recomendado; ya está en `render.yaml`) | `2` | IP real del cliente |
| Llamadas directas a `*.onrender.com`, sin Vercel | `1` | IP real del cliente |
| Desarrollo local | `0` (por defecto) | IP del socket |

Con `1` detrás de Vercel, todos los usuarios compartirían la IP de Vercel y, por tanto, el mismo cupo de intentos de login.

**Límite conocido:** con `2`, quien llame directo a `onrender.com` puede inventar el primer valor de `X-Forwarded-For` y esquivar el límite por IP. Por eso login y recuperación tienen además un **límite por correo**, que no depende de la IP.

**Cómo verificarlo tras desplegar:** `morgan` registra `req.ip` en cada línea de log de Render. Haz una petición desde el navegador y compara la IP del log con la que muestra <https://ifconfig.me>. Si aparece una IP de Vercel, sube `TRUST_PROXY` en uno; si aparece una que no es la tuya, bájalo.

### Cookie de refresh detrás de `/api/*`

| Variable | Producción (Vercel → Render) | Desarrollo |
| --- | --- | --- |
| `COOKIE_PATH` | `/api/auth`, porque el navegador ve `https://<vercel>/api/auth/refresh` | `/auth` (por defecto) |
| `COOKIE_SAMESITE` | `strict`, porque todo es mismo origen | `lax` (por defecto) |

La cookie es siempre `HttpOnly` y, en producción, `Secure`.

- `none` solo se acepta en producción, y solo haría falta si el frontend llamara directo a `onrender.com`; no es lo recomendado (ver `docs/COOKIES.md` del frontend).
- Si `strict` diera problemas en algún navegador, usa `lax`: con mismo origen tiene la misma protección práctica.

### Mantener Render despierto

El rewrite de Vercel espera la respuesta de Render. Si Render está dormido (30–60 s para despertar), la primera petición puede agotar el tiempo del proxy. La solución más simple es un ping gratuito a `/health`, que no toca la base de datos:

1. Crea una cuenta en <https://uptimerobot.com> (o <https://cron-job.org>).
2. Agrega un monitor **HTTP(s)** a `https://TU-SERVICIO.onrender.com/health` con intervalo de **10 minutos**, menos que los 15 minutos de inactividad de Render.
3. Opcional: activa la alerta por correo. Te sirve además como monitor de caídas.

Notas:

- Un servicio despierto todo el mes consume unas 730 de las 750 horas gratuitas mensuales de Render: alcanza para **un** servicio.
- Si en algún momento quieres dejar que se duerma (por ejemplo, después de la entrega), pausa el monitor.
- El frontend muestra "Comprobando API…" o "API sin conexión" mientras Render despierta.
- Neon despierta en menos de un segundo con la primera consulta, así que no necesita ping.

## 3. Vercel (frontend)

1. **New Project** → importa `autocheck-frontend`. Framework preset: **Angular**. Build: `npm run build`. Output: `dist/frontend/browser`.
2. Las rutas del SPA (por ejemplo `/reset-password`) necesitan un rewrite a `index.html` en `vercel.json` del frontend:

   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```

3. Configura la URL de la API (`https://TU-SERVICIO.onrender.com`) en el frontend. Hoy está fija en `src/app/services/vehicle.service.ts`.
4. Copia la URL final de Vercel en `CORS_ORIGIN` y `APP_URL` de Render y redespliega la API.

**Contrato de autenticación para el frontend:**

- `POST /auth/login` y `/auth/register` devuelven `{ user, accessToken, tokenType, expiresIn }` y dejan una cookie httpOnly `autocheck_refresh` (path `COOKIE_PATH`).
- Envía `Authorization: Bearer <accessToken>` en cada `/vehicles/*`.
- El access token dura 15 minutos. Renuévalo con `POST /auth/refresh` usando `withCredentials: true`; cada llamada rota la cookie.
- `POST /auth/logout` también con `withCredentials: true`.
- En producción la cookie es `Secure; SameSite=Strict; Path=/api/auth`, porque el navegador solo habla con Vercel.

## 4. SMTP

Sirve cualquier proveedor SMTP (Brevo, Mailgun, SendGrid, Amazon SES, Gmail con contraseña de aplicación, etc.).

| Variable | Ejemplo |
| --- | --- |
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` (STARTTLS) o `465` (TLS directo) |
| `SMTP_USER` | usuario que entrega el proveedor |
| `SMTP_PASS` | TODO: clave SMTP del proveedor. Va solo en Render, nunca en el repo |
| `MAIL_FROM` | `AutoCheck-CO <no-reply@tu-dominio.com>` (dominio verificado en el proveedor) |

Hay que definir las cuatro variables o ninguna; si se define solo una parte, la API no arranca. Sin SMTP:

- **Desarrollo**: el enlace de restablecimiento se imprime en la consola.
- **Producción**: no se envía nada y se registra una advertencia. El enlace nunca se imprime.

## 5. Primer administrador

`PATCH /vehicles/:plate/inspections` requiere rol `admin`. Todas las cuentas se registran como `user`. Para promover una, regístrala y ejecuta en el **SQL Editor** de Neon:

```sql
UPDATE users SET role = 'admin' WHERE email = 'tu-correo@dominio.com';
```

El rol viaja dentro del access token, así que se aplica en el siguiente login o refresh.

## 6. Secretos y rotación

- `.env` está en `.gitignore` y el hook `pre-push` (`scripts/check-secrets.sh`) bloquea pushes con `.env` o con patrones de claves.
- **Rotar JWT**: en Render, entra a **Environment**, genera valores nuevos para `JWT_SECRET` / `JWT_REFRESH_SECRET` y redespliega. Todas las sesiones se cierran.
- **Rotar la base**: en Neon, ve a **Roles → Reset password**, actualiza `DATABASE_URL` en Render y en tu `.env` local.
- Para generar un secreto local: `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
