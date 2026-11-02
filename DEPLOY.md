# Despliegue de AutoCheck-CO

```
navegador ──► Vercel (frontend Angular + rewrite /api/*) ──► Render (esta API) ──► Neon (Postgres)
                                                              ├─► Brevo (correo por HTTPS)
                                                              ├─► Gemini o Anthropic (lectura de tarjeta, opcional)
                                                              └─► Verifik (RUNT, opcional, sin implementar)
```

## Pendientes manuales (TODO)

- [ ] **Render:** crear el servicio desde `render.yaml` y cargar las variables marcadas "cargar" (paso 2).
- [ ] **Brevo:** crear la cuenta, verificar el remitente y crear la clave de API (paso 4). Sin correo, nadie recibe el enlace de verificación.
- [ ] **Gemini (opcional):** crear la clave en Google AI Studio y cargarla en `GEMINI_API_KEY` (paso 6). Sin ella, `POST /garage/scan-card` responde 503.
- [ ] **Administrador:** poner tu correo en `ADMIN_EMAILS` (paso 5).
- [ ] **Ping de salud:** UptimeRobot o cron-job.org contra `/health` cada 10 minutos (paso 2.5).
- [ ] **Responsable del tratamiento:** confirmar los datos de contacto en la sección "Tratamiento de datos personales" del README.
- [ ] **Verifik (opcional):** pedir el contrato vigente y una clave (paso 7).

## 1. Neon (Postgres)

1. Crea el proyecto en <https://console.neon.tech> en la región AWS más cercana a Render (por ejemplo `aws-us-east-1` con Render `virginia`).
2. En **Connection Details**, desactiva **Connection pooling** y copia la cadena **directa** (host sin `-pooler`). La API usa esa misma cadena para migrar y en tiempo de ejecución, porque node-pg-migrate toma un *advisory lock* que no funciona detrás de PgBouncer.
3. Migraciones (Render también las corre en cada arranque):

   ```bash
   cp .env.example .env      # pega la cadena en DATABASE_URL
   npm ci
   npm run migrate
   ```

   Para revertir la última: `npm run migrate:down`.

| Migración | Qué crea |
| --- | --- |
| `1761800000000_create-auth-tables` | `users`, `password_reset_tokens`, `refresh_tokens` |
| `1761800100000_create-vehicle-tables` | `vehicles`, `inspections` (**demostración**) |
| `1761800200000_seed-demo-vehicles` | 3 placas ficticias (**demostración**) |
| `1762100000000_add-email-verification` | `users.email_verified_at`, `email_verification_tokens` |
| `1762100100000_add-terms-consent` | `users.terms_accepted_at`, `users.terms_version` |
| `1762100200000_create-user-vehicles` | `user_vehicles` (garaje real) |

La conexión exige TLS con verificación del certificado (ver `src/db/pool.ts`).

## 2. Render (API)

1. En <https://dashboard.render.com>, ve a **New → Blueprint** y elige el repo `autocheck-backend`. `render.yaml` define el build, el start (que corre las migraciones antes), el health check en `/health` y **solo** las variables de la configuración recomendada.
2. Variables. "Fija" ya viene con valor en `render.yaml`; "cargar" la escribes tú; "auto" la genera Render.

   **Obligatorias en producción** (sin ellas el servicio no arranca y el log nombra cada una):

   | Variable | Valor | En Render |
   | --- | --- | --- |
   | `NODE_ENV` | `production` | fija |
   | `NODE_VERSION` | `24` | fija |
   | `DATABASE_URL` | Cadena directa de Neon (paso 1.2) | **cargar** |
   | `JWT_SECRET`, `JWT_REFRESH_SECRET` | Secretos aleatorios | auto |
   | `CORS_ORIGIN` | URL de Vercel, p. ej. `https://autocheck-frontend.vercel.app` (sin `/` final) | **cargar** |
   | `APP_URL` | La misma URL de Vercel; los correos enlazan a `APP_URL/verify-email` y `APP_URL/reset-password` | **cargar** |
   | `EMAIL_PROVIDER` | `brevo` | fija |
   | `BREVO_API_KEY` | Clave de la API de Brevo (paso 4) | **cargar** |
   | `MAIL_FROM` | Solo el correo remitente verificado en Brevo, p. ej. `no-reply@tu-dominio.com` | **cargar** |

   **Con valor recomendado** (ya fijas en `render.yaml`; si faltan, se usan los valores por defecto indicados):

   | Variable | Valor en `render.yaml` | Por defecto en producción |
   | --- | --- | --- |
   | `MAIL_FROM_NAME` | `AutoCheck-CO` | `AutoCheck-CO` |
   | `COOKIE_PATH` | `/api/auth` | `/auth` (no sirve detrás de Vercel) |
   | `COOKIE_SAMESITE` | `strict` | `strict` |
   | `TRUST_PROXY` | `2` | `1` |
   | `SCAN_PROVIDER` | `gemini` | `none` |
   | `GEMINI_MODEL` | `gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` |
   | `RUNT_PROVIDER` | `none` | `none` |

   **Opcionales** (pueden quedar vacías; el servicio arranca igual):

   | Variable | Para qué | Si queda vacía |
   | --- | --- | --- |
   | `ADMIN_EMAILS` | Correos que reciben rol admin al verificar (paso 5) | Nadie es admin automáticamente |
   | `GEMINI_API_KEY` | Lectura de tarjeta con Gemini (paso 6) | `scan-card` responde 503 |
   | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Solo si cambias a `SCAN_PROVIDER=anthropic` (no están en `render.yaml`) | — |
   | `VERIFIK_API_KEY` | Solo si cambias a `RUNT_PROVIDER=verifik` (no está en `render.yaml`) | — |

   No hacen falta `SMTP_*`: Render gratuito bloquea los puertos SMTP 25/465/587, por eso el correo va por la API HTTPS de Brevo.
3. Verifica (la URL actual del servicio es `https://autocheck-backend-d2k2.onrender.com`):

   ```bash
   curl https://autocheck-backend-d2k2.onrender.com/health          # {"status":"ok",...}
   curl https://autocheck-backend-d2k2.onrender.com/config/public   # proveedor de lectura activo y textos de privacidad
   ```

   En los logs del arranque deben aparecer "Correo: proveedor brevo." y "Lectura de tarjeta: gemini (...)" (o el aviso de que falta la clave).

### 2.5 Mantener Render despierto

En el plan gratuito, Render se duerme a los ~15 minutos sin tráfico y tarda 30–60 s en despertar, lo que puede agotar el tiempo del rewrite de Vercel.

1. En <https://uptimerobot.com> (o <https://cron-job.org>), crea un monitor **HTTP(s)** a `https://autocheck-backend-d2k2.onrender.com/health` cada **10 minutos**.
2. Opcional: activa la alerta por correo.

Notas:

- Un servicio despierto todo el mes usa unas 730 de las 750 horas gratuitas de Render.
- `/health` no toca la base.

### Proxies y rate limit (`TRUST_PROXY`)

Camino de una petición: `navegador → Vercel (proxy 1) → balanceador de Render (proxy 2) → Express`. Express recibe `X-Forwarded-For: <cliente>, <IP de Vercel>`, y `TRUST_PROXY` es la cantidad de saltos en los que confía.

| Escenario | `TRUST_PROXY` | `req.ip` |
| --- | --- | --- |
| Vercel → Render (recomendado) | `2` | IP real del cliente |
| Directo a `*.onrender.com` | `1` | IP real del cliente |
| Desarrollo local | `0` | IP del socket |

- **Riesgo con `2`:** quien llame directo a `onrender.com` puede falsificar el primer valor de `X-Forwarded-For`. Por eso login, recuperación y reenvío de verificación limitan además por correo, y la lectura de tarjetas y la consulta RUNT limitan por usuario.
- **Cómo verificarlo:** `morgan` registra `req.ip` en cada línea de log. Compárala con <https://ifconfig.me>.

### Cookie de refresh detrás de `/api/*`

- **Ruta:** el navegador ve `https://<vercel>/api/auth/refresh`, así que la cookie usa `Path=/api/auth` (`COOKIE_PATH`) y `SameSite=Strict`.
- **Flags fijos:** siempre `HttpOnly`, y `Secure` en producción.

## 3. Vercel (frontend)

1. Importa `autocheck-frontend`. Su `vercel.json` ya define el build, la salida `dist/frontend/browser`, el rewrite `/api/:path*` → `https://autocheck-backend-d2k2.onrender.com/:path*` y el fallback a `index.html`.
2. Copia la URL final de Vercel en `CORS_ORIGIN` y `APP_URL` de Render y redespliega la API.
3. Orden: **primero la API**, después el frontend.
4. El frontend debe mostrar los textos de `GET /config/public`:
   - `privacyPolicy.registrationConsent` junto a la casilla del registro.
   - `cardScan.notice` antes de subir la foto.

## 4. Correo con Brevo (API HTTPS)

1. Crea una cuenta gratuita en <https://www.brevo.com>.
2. **Senders, Domains & Dedicated IPs → Senders:** agrega y verifica el remitente (por ejemplo `no-reply@tu-dominio.com`). Si tienes dominio, autentícalo (DKIM/DMARC) para que los correos no caigan en spam.
3. **SMTP & API → API keys:** crea una clave. TODO: cárgala en `BREVO_API_KEY` de Render; nunca en el repo.
4. En Render: `MAIL_FROM` = ese correo remitente (solo el correo), y `MAIL_FROM_NAME` = el nombre que verá el usuario (por defecto `AutoCheck-CO`).

Contrato usado (documentación oficial de Brevo): `POST https://api.brevo.com/v3/smtp/email`, cabecera `api-key`, cuerpo `{ sender, to, subject, htmlContent, textContent }`, respuesta `201`.

Comportamiento ante errores:

- **Si Brevo responde error o no responde,** el registro y la recuperación siguen respondiendo normal al usuario, sin detalles.
- **En el log** queda solo `Brevo respondió <código>.`, sin tokens, enlaces ni la clave.

| `EMAIL_PROVIDER` | Uso |
| --- | --- |
| `brevo` | Producción (por defecto cuando `NODE_ENV=production`). Exige `BREVO_API_KEY` y `MAIL_FROM` |
| `smtp` | Solo fuera de Render gratuito. Exige `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM` |
| `console` | Desarrollo (por defecto). Imprime los enlaces en la consola. Rechazado en producción |

## 5. Administrador sin SQL (`ADMIN_EMAILS`)

1. En Render, carga `ADMIN_EMAILS` con tu correo (varios separados por coma), por ejemplo `juan.morarevel@campusucc.edu.co`.
2. Regístrate en la app con ese correo y confírmalo con el enlace que llega por Brevo.
3. Al verificar el correo (o al iniciar sesión, si ya estaba verificado) la cuenta pasa a `admin`. **Nunca antes de verificar:** así nadie obtiene el rol registrándose con un correo ajeno.

Notas:

- El rol viaja en el access token; la app lo refleja en el siguiente refresh o login.
- Quitar un correo de la lista **no** revoca el rol. Para eso: `UPDATE users SET role = 'user' WHERE email = '...';` en el SQL Editor de Neon.

## 6. Lectura de la tarjeta (`SCAN_PROVIDER`)

| `SCAN_PROVIDER` | Proveedor | Variables |
| --- | --- | --- |
| `gemini` (recomendado, gratis) | Gemini API de Google AI Studio | `GEMINI_API_KEY`, `GEMINI_MODEL` (por defecto `gemini-3.5-flash-lite`) |
| `anthropic` | API de Claude (de pago) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (por defecto `claude-sonnet-5-5`) |
| `none` | Apagado | — |

**Gemini:**

1. TODO: crea la clave en <https://aistudio.google.com/apikey> y cárgala en `GEMINI_API_KEY` de Render.
2. Verifica con `GET /config/public` que aparezca `"cardScan": { "enabled": true, "provider": "gemini", ... }`.

Detalles del proveedor:

- **Contrato:** Interactions API (`POST https://generativelanguage.googleapis.com/v1beta/interactions`, cabecera `x-goog-api-key`), imagen en base64 y respuesta JSON con esquema. Tomado de la documentación oficial de Google AI Studio el 2026-11-02.
- **Modelo:** `gemini-3.5-flash-lite` está en el plan gratuito y su página de precios lista entrada de imágenes. Si la lectura es mala, puedes subir a otro modelo con `GEMINI_MODEL` (por ejemplo `gemini-3.8-flash`); revisa antes en la página de precios que acepte imágenes en tu plan.
- **Privacidad:** en el plan gratuito, Google puede usar lo enviado para mejorar sus productos. Esto está declarado en el consentimiento del registro y en `cardScan.notice`.
- **Saturación:** si el plan gratuito se satura (HTTP 429), la API responde `503 SCAN_PROVIDER_BUSY`: "El servicio gratuito de lectura está ocupado. Intenta en un minuto o ingresa los datos a mano."

**Anthropic** (si algún día lo prefieres):

- **Configuración:** `SCAN_PROVIDER=anthropic` y `ANTHROPIC_API_KEY`.
- **Modelo:** `claude-sonnet-5-5` basta para extraer datos de una foto. Si la lectura es mala, sube a `ANTHROPIC_MODEL=claude-opus-5-5`, que es más capaz y más costoso.

**Protecciones comunes:**

- La imagen se procesa en memoria y no se guarda ni se registra.
- El tipo se valida por la firma del archivo.
- Máximo 5 MB y 10 lecturas por hora por usuario.
- La respuesta solo precarga datos: el usuario los confirma con `POST /garage`.

## 7. Consulta RUNT por proveedor (desactivada)

No se hace scraping de RUNT ni de ningún sitio oficial.

- **`RUNT_PROVIDER=none` (por defecto):** `POST /garage/:plate/refresh-from-runt` responde 503 y la app usa el garaje manual.
- **`RUNT_PROVIDER=verifik`:** exige `VERIFIK_API_KEY`. El adaptador es un **esqueleto** y responde 501, porque la documentación pública de Verifik es inconsistente. El detalle está en `src/providers/verifikProvider.ts`.

Para activarlo:

1. Pide a Verifik el contrato vigente y una clave.
2. Implementa `lookupByPlate`, usando como guía `test/runtLookup.test.ts`.
3. Agrega en Render `RUNT_PROVIDER=verifik` y `VERIFIK_API_KEY`.

## 8. Secretos y rotación

- `.env` está en `.gitignore`. El hook `pre-push` (`scripts/check-secrets.sh`) bloquea los pushes que contengan `.env` o patrones de claves.
- **JWT:** genera valores nuevos en Render (**Environment**) y redespliega. Se cierran todas las sesiones.
- **Neon:** en **Roles → Reset password**, resetea la contraseña y actualiza `DATABASE_URL`.
- **Brevo, Gemini, Anthropic o Verifik:** revoca la clave en el proveedor, crea una nueva y actualízala en Render.
