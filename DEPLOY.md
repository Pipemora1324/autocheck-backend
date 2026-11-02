# Despliegue de AutoCheck-CO

```
navegador ──► Vercel (frontend Angular + rewrite /api/*) ──► Render (esta API) ──► Neon (Postgres)
                                                              ├─► Anthropic (lectura de tarjeta, opcional)
                                                              ├─► SMTP (correos)
                                                              └─► Verifik (RUNT, opcional, sin implementar)
```

## Pendientes manuales (TODO)

- [ ] **Render:** crear el servicio desde `render.yaml` y cargar las variables `sync: false` (paso 2).
- [ ] **SMTP:** cargar `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM` (paso 4). **Sin SMTP los usuarios no reciben el enlace de verificación y no pueden usar el garaje** (ver la salida temporal del paso 5).
- [ ] **TODO clave Anthropic:** crear una clave en <https://console.anthropic.com> y cargarla en `ANTHROPIC_API_KEY` de Render (paso 6). Sin ella, `POST /garage/scan-card` responde 503.
- [ ] **TODO Verifik:** pedir a Verifik la especificación vigente del endpoint RUNT y una clave (`VERIFIK_API_KEY`). El adaptador es un esqueleto (paso 7).
- [ ] **Ping de salud:** configurar UptimeRobot o cron-job.org contra `/health` (paso 2.5).
- [ ] **Primer administrador:** paso 5.
- [ ] **Responsable del tratamiento de datos (Ley 1581):** completar nombre, correo de contacto y canal de solicitudes en la sección "Tratamiento de datos personales" del README.
- [ ] **Frontend:** agregar las pantallas que ya soporta la API (paso 3).
- [ ] **Rotación:** si se expone una clave, rotarla en el proveedor (paso 8).

## 1. Neon (Postgres)

1. Crea el proyecto en <https://console.neon.tech> en la región AWS más cercana a Render (por ejemplo `aws-us-east-1` con Render `virginia`).
2. En **Connection Details**, desactiva **Connection pooling** y copia la cadena **directa** (host sin `-pooler`). La API usa esa misma cadena para migrar y en tiempo de ejecución, porque node-pg-migrate toma un *advisory lock* que no funciona detrás de PgBouncer.
3. Migraciones (Render también las corre en cada arranque):

   ```bash
   cp .env.example .env      # pega la cadena en DATABASE_URL
   npm ci
   npm run migrate           # tablas, verificación de correo, consentimiento, garaje y datos de demostración
   ```

   Para revertir la última: `npm run migrate:down`.

| Migración | Qué crea |
| --- | --- |
| `1761800000000_create-auth-tables` | `users`, `password_reset_tokens`, `refresh_tokens` |
| `1761800100000_create-vehicle-tables` | `vehicles`, `inspections` (demostración) |
| `1761800200000_seed-demo-vehicles` | 3 placas ficticias |
| `1762100000000_add-email-verification` | `users.email_verified_at`, `email_verification_tokens` |
| `1762100100000_add-terms-consent` | `users.terms_accepted_at`, `users.terms_version` |
| `1762100200000_create-user-vehicles` | `user_vehicles` (garaje) |

La conexión exige TLS con verificación del certificado. `sslmode` y `channel_binding` de la URL se ignoran, porque el código ya los fuerza (ver `src/db/pool.ts`).

## 2. Render (API)

1. En <https://dashboard.render.com>, ve a **New → Blueprint** y elige el repo `autocheck-backend`. Render lee `render.yaml`:
   - **Build:** `npm ci --include=dev && npm run build`
   - **Start:** `npm run migrate:prod && npm start`. Si las migraciones fallan, el servicio no arranca.
   - **Health check:** `GET /health`
   - **Secretos JWT:** `JWT_SECRET` y `JWT_REFRESH_SECRET` los genera Render.
2. Variables:

   | Variable | Valor | En `render.yaml` |
   | --- | --- | --- |
   | `NODE_ENV` | `production` | fija |
   | `NODE_VERSION` | `24` | fija |
   | `DATABASE_URL` | Cadena directa de Neon | **cargar** |
   | `JWT_SECRET`, `JWT_REFRESH_SECRET` | Generadas por Render | automática |
   | `CORS_ORIGIN` | URL de Vercel, p. ej. `https://autocheck-frontend.vercel.app` (sin `/` final; varias separadas por coma) | **cargar** |
   | `APP_URL` | Misma URL de Vercel; los correos enlazan a `APP_URL/verify-email` y `APP_URL/reset-password` | **cargar** |
   | `COOKIE_PATH` | `/api/auth` | fija |
   | `COOKIE_SAMESITE` | `strict` (o `lax` si `strict` diera problemas) | fija |
   | `TRUST_PROXY` | `2` (Vercel + Render) | fija |
   | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Paso 4 | **cargar** |
   | `SMTP_PORT` | `587` | fija |
   | `ANTHROPIC_API_KEY` | TODO, paso 6 (vacía = lectura de tarjeta apagada) | **cargar** |
   | `ANTHROPIC_MODEL` | `claude-opus-5-5` | fija |
   | `RUNT_PROVIDER` | `none` (paso 7) | fija |
   | `VERIFIK_API_KEY` | TODO, paso 7 (solo con `RUNT_PROVIDER=verifik`) | **cargar** |

3. Si falta o es inválida alguna variable, el arranque falla con un mensaje que nombra cada una (revisa los **Logs**).
4. Verifica (la URL actual del servicio es `https://autocheck-backend-d2k2.onrender.com`):

   ```bash
   curl https://autocheck-backend-d2k2.onrender.com/health   # {"status":"ok",...}
   curl -i https://autocheck-backend-d2k2.onrender.com/garage   # 401 sin token
   ```

### 2.5 Mantener Render despierto

En el plan gratuito, Render se duerme a los ~15 minutos sin tráfico y tarda 30–60 s en despertar, lo que puede agotar el tiempo del rewrite de Vercel.

1. En <https://uptimerobot.com> (o <https://cron-job.org>), crea un monitor **HTTP(s)** a `https://autocheck-backend-d2k2.onrender.com/health` cada **10 minutos**.
2. Opcional: activa la alerta por correo, que de paso sirve como monitor de caídas.

Notas:

- Un servicio despierto todo el mes usa unas 730 de las 750 horas gratuitas de Render: alcanza para **uno**.
- `/health` no consulta la base, y Neon despierta solo en menos de un segundo.
- Pausa el monitor cuando no lo necesites.

### Proxies y rate limit (`TRUST_PROXY`)

Camino de una petición: `navegador → Vercel (proxy 1) → balanceador de Render (proxy 2) → Express`. Express recibe `X-Forwarded-For: <cliente>, <IP de Vercel>`, y `TRUST_PROXY` es la cantidad de saltos en los que confía, contando desde la derecha.

| Escenario | `TRUST_PROXY` | `req.ip` |
| --- | --- | --- |
| Vercel → Render (recomendado) | `2` | IP real del cliente |
| Directo a `*.onrender.com` | `1` | IP real del cliente |
| Desarrollo local | `0` | IP del socket |

- **Riesgo con `1` detrás de Vercel:** todos los usuarios compartirían el cupo de intentos.
- **Riesgo con `2`:** quien llame directo a `onrender.com` puede falsificar el primer valor de `X-Forwarded-For`. Por eso login, recuperación y reenvío de verificación tienen además un **límite por correo**, y la lectura de tarjetas y la consulta RUNT limitan **por usuario**.
- **Cómo verificarlo:** `morgan` registra `req.ip` en cada línea de log. Compara la IP de tu petición con <https://ifconfig.me>. Si aparece una IP de Vercel, sube el valor en uno; si aparece una IP que no es la tuya, bájalo.

### Cookie de refresh detrás de `/api/*`

- **Ruta:** el navegador ve `https://<vercel>/api/auth/refresh`, así que la cookie debe tener `Path=/api/auth` (`COOKIE_PATH`).
- **SameSite:** todo es mismo origen, por eso `strict` basta.
- **Flags fijos:** la cookie es siempre `HttpOnly`, y `Secure` en producción.
- **`none`:** solo se acepta en producción y solo haría falta llamando directo a Render, que no es lo recomendado (ver `docs/COOKIES.md` del frontend).

## 3. Vercel (frontend)

1. Importa `autocheck-frontend`. Su `vercel.json` ya define el build, la salida `dist/frontend/browser`, el rewrite `/api/:path*` → `https://autocheck-backend-d2k2.onrender.com/:path*` y el fallback a `index.html`.
2. Copia la URL final de Vercel en `CORS_ORIGIN` y `APP_URL` de Render y redespliega la API.
3. Orden de despliegue: **primero la API** con `COOKIE_PATH=/api/auth`, después el frontend.
4. Pantallas que el frontend todavía necesita para usar lo nuevo (contrato en `docs/API.md`):
   - `/verify-email?token=...` y un aviso "confirma tu correo" ante `403 EMAIL_NOT_VERIFIED`, con botón de reenvío.
   - Casilla obligatoria de aceptación de la política de datos en el registro (`acceptedTerms: true`).
   - Garaje: lista, alta, edición, borrado, vigencias y concepto con su `disclaimer`.
   - Lectura de tarjeta: subir la foto, revisar los datos precargados y confirmar con `POST /garage`.
   - "Eliminar mi cuenta" con confirmación de contraseña (`DELETE /auth/me`).
   - Mostrar u ocultar botones según `GET /garage/capabilities`.

## 4. SMTP

Sirve cualquier proveedor SMTP (Brevo, Mailgun, SendGrid, Amazon SES, Gmail con contraseña de aplicación).

| Variable | Ejemplo |
| --- | --- |
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` (STARTTLS) o `465` (TLS directo) |
| `SMTP_USER` | Usuario del proveedor |
| `SMTP_PASS` | TODO: clave SMTP del proveedor; va solo en Render |
| `MAIL_FROM` | `AutoCheck-CO <no-reply@tu-dominio.com>` (remitente verificado en el proveedor) |

Hay que definir las cuatro variables o ninguna. Sin SMTP:

- **Desarrollo:** los enlaces de verificación y recuperación se imprimen en la consola.
- **Producción:** no se envía nada y se registra una advertencia; los enlaces nunca se imprimen.

## 5. Primer administrador y verificación manual

Todas las cuentas se registran como `user` y sin verificar. En el **SQL Editor** de Neon:

```sql
-- Promover a admin (necesario para PATCH /vehicles/:plate/inspections)
UPDATE users SET role = 'admin' WHERE email = 'tu-correo@dominio.com';

-- Solo mientras no haya SMTP: marcar un correo como verificado a mano
UPDATE users SET email_verified_at = now() WHERE email = 'tu-correo@dominio.com';
```

- El rol viaja en el access token, así que el cambio se aplica en el siguiente login o refresh.
- La verificación se lee de la base en cada petición, así que se aplica de inmediato.

## 6. Lectura de la tarjeta con visión (Anthropic)

1. TODO: crea una clave en <https://console.anthropic.com> (**Settings → API keys**) y define un límite de gasto mensual en **Billing**.
2. En Render, carga `ANTHROPIC_API_KEY`. `ANTHROPIC_MODEL` ya viene en `claude-opus-5-5`; puedes cambiarlo sin tocar código.
3. Verifica con `GET /garage/capabilities` → `"cardScan": { "enabled": true }`.

Comportamiento:

- **Rechazos:** usa salida estructurada validada con zod y fallback del servidor ante rechazos del modelo (`server-side-fallback-2026-07-01`).
- **Límites de la subida:** 10 lecturas por hora por usuario e imágenes de máximo 5 MB.
- **Privacidad:** la imagen se procesa en memoria y no se guarda. Los datos extraídos no se registran en logs.
- **Aviso al usuario:** la imagen se envía a Anthropic (EE. UU.). Está declarado en la sección de tratamiento de datos del README; muéstralo también al usuario antes de subir la foto.

## 7. Consulta RUNT por proveedor (desactivada por defecto)

No se hace scraping de RUNT ni de ningún sitio oficial: solo se admiten APIs de proveedores con contrato.

- **`RUNT_PROVIDER=none` (por defecto):** `POST /garage/:plate/refresh-from-runt` responde 503 y la app trabaja con el garaje manual.
- **`RUNT_PROVIDER=verifik`:** exige `VERIFIK_API_KEY`. **El adaptador es un esqueleto** y responde `501 RUNT_PROVIDER_NOT_IMPLEMENTED`. La documentación pública de Verifik revisada el 2026-11-02 es inconsistente:
  - Muestra dos formatos de respuesta distintos para el mismo `GET /v2/co/runt/vehiculo`.
  - La autenticación aparece como `Bearer` en la referencia y como `jwt` en los ejemplos.
  - El endpoint con SOAT/RTM (`/v2/co/runt/vehicle-by-plate`) no tiene la respuesta documentada.

  El detalle está en el TODO de `src/providers/verifikProvider.ts`.

Para activarlo:

1. TODO: contrata Verifik y pide la especificación vigente del endpoint de vehículo con SOAT y RTM (colección Postman u OpenAPI) y una clave.
2. Implementa `lookupByPlate` en `src/providers/verifikProvider.ts` siguiendo ese contrato. Las pruebas de `test/runtLookup.test.ts` muestran el comportamiento esperado.
3. En Render: `RUNT_PROVIDER=verifik` y `VERIFIK_API_KEY=<clave>`.
4. Verifica `GET /garage/capabilities` → `"runtLookup": { "enabled": true, "provider": "verifik" }` y haz una consulta con un vehículo propio.

Cada consulta exige `consent: true` en el cuerpo y el documento del propietario, que se envía al proveedor y no se guarda.

## 8. Secretos y rotación

- `.env` está en `.gitignore`. El hook `pre-push` (`scripts/check-secrets.sh`) bloquea los pushes que contengan `.env` o patrones de claves.
- **JWT:** en Render (**Environment**), genera valores nuevos para `JWT_SECRET` y `JWT_REFRESH_SECRET` y redespliega. Se cierran todas las sesiones.
- **Base de datos:** en Neon (**Roles → Reset password**), resetea la contraseña y actualiza `DATABASE_URL` en Render y en tu `.env`.
- **Anthropic, SMTP o Verifik:** revoca la clave en el proveedor, crea una nueva y actualízala en Render.
- **Secreto local nuevo:** `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
