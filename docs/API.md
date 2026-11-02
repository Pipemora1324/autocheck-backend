# API de AutoCheck-CO

Contrato HTTP del backend para el frontend. Todas las respuestas son JSON en español.

> **El flujo real es `/garage`.** `/vehicles` y sus 3 placas (`ABC-1234`, `DEF-5678`, `GHI-9012`) son **solo de demostración**: datos ficticios para mostrar el informe de peritaje. No los uses para datos de usuarios.

- **Base URL**
  - Producción: `https://<proyecto>.vercel.app/api` (Vercel reenvía `/api/*` al backend en Render).
  - Desarrollo: `http://localhost:3000`.
- **Autenticación:** `Authorization: Bearer <accessToken>`. El access token dura 15 minutos.
- **Cookie de sesión:** el refresh token viaja en la cookie httpOnly `autocheck_refresh` (ruta `COOKIE_PATH`, en producción `/api/auth`). Envía `withCredentials: true` en `/auth/*`.
- **Fechas:**
  - Las calendario son `AAAA-MM-DD`.
  - Los instantes son ISO 8601 UTC.
  - Las vigencias se calculan con la fecha de hoy en Colombia (`America/Bogota`).

## Convenciones de error

```json
{ "message": "Texto para mostrar al usuario.", "code": "CODIGO_OPCIONAL" }
```

Validación (400):

```json
{
  "message": "Los datos enviados no son válidos.",
  "errors": [{ "field": "plate", "message": "Ingresa una placa colombiana válida: ABC-123 (carro) o ABC-12D (moto)." }]
}
```

| HTTP | `code` | Cuándo |
| --- | --- | --- |
| 400 | — | Validación (`errors[]`) o JSON mal formado |
| 400 | `IMAGE_REQUIRED`, `INVALID_UPLOAD` | `scan-card` sin imagen o con otro campo |
| 401 | — | Falta el token, es inválido o expiró. El frontend renueva con `/auth/refresh` y reintenta una vez |
| 403 | `EMAIL_NOT_VERIFIED` | `/vehicles/*` y `/garage/*` con el correo sin confirmar |
| 403 | `INVALID_PASSWORD` | `DELETE /auth/me` con contraseña incorrecta (no es 401, para no cerrar la sesión) |
| 403 | — | Rol insuficiente (por ejemplo, editar inspecciones sin ser `admin`) |
| 404 | `RUNT_NOT_FOUND` / — | Recurso inexistente o vehículo que no está en tu garaje |
| 409 | `DUPLICATE_PLATE`, `GARAGE_LIMIT_REACHED` / — | Placa repetida, más de 50 vehículos, o correo ya registrado |
| 413 | `IMAGE_TOO_LARGE` | Imagen de más de 5 MB |
| 415 | `UNSUPPORTED_IMAGE` | El archivo no es JPEG, PNG ni WEBP (se valida la firma real) |
| 422 | `CARD_UNREADABLE`, `NOT_A_VEHICLE_DOCUMENT` | No se pudo leer la tarjeta |
| 429 | `RATE_LIMITED` / — | Límite de intentos (ver tabla al final) |
| 501 | `RUNT_PROVIDER_NOT_IMPLEMENTED` | Proveedor RUNT configurado pero sin implementar |
| 503 | `VISION_NOT_CONFIGURED`, `VISION_UNAVAILABLE`, `RUNT_PROVIDER_DISABLED`, `RUNT_UNAVAILABLE` | Servicio opcional apagado o caído |
| 503 | `SCAN_PROVIDER_BUSY` | El proveedor gratuito de lectura está saturado (429). Incluye `retryAfterSeconds: 60`; muestra el `message` y ofrece ingresar los datos a mano |

---

## Salud y configuración pública

`GET /health` (público): `{ "status": "ok", "service": "AutoCheck-CO" }`.

`GET /config/public` (público, sin token). Úsalo para mostrar el consentimiento del registro y el aviso antes de subir la foto de la tarjeta:

```json
{
  "privacyPolicy": {
    "version": "2026-11-02.2",
    "registrationConsent": "Autorizo a AutoCheck-CO a tratar mis datos personales ... No subiré la tarjeta de otra persona sin su autorización."
  },
  "cardScan": {
    "enabled": true,
    "provider": "gemini",
    "notice": "La foto de la tarjeta se envía a Google (Gemini API, plan gratuito) solo para extraer los datos; ... En el plan gratuito, Google puede usar el contenido enviado para mejorar sus productos. ..."
  },
  "runtLookup": { "enabled": false, "provider": "none" }
}
```

- **`cardScan.provider`:** `gemini`, `anthropic` o `none`.
- **`cardScan.notice`:** es `null` si la lectura está apagada.

## Autenticación (`/auth`)

### `POST /auth/register`

```json
{ "email": "ana@example.com", "password": "tu contraseña", "acceptedTerms": true }
```

- **Validación:** `acceptedTerms` debe ser exactamente `true`. Muestra junto a la casilla el texto `privacyPolicy.registrationConsent` de `GET /config/public`. El backend guarda la fecha y la versión de la política. `password` debe tener entre 8 y 128 caracteres.
- **Al registrarse:** se envía el correo con `APP_URL/verify-email?token=...`.
- **Respuesta:** `201`, con la cookie de refresh y el siguiente cuerpo (igual en `login` y `refresh`):

```json
{
  "user": { "id": "uuid", "email": "ana@example.com", "role": "user", "emailVerified": false },
  "accessToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

- **Correo ya registrado:** `409`.

### `POST /auth/login`

```json
{ "email": "ana@example.com", "password": "tu contraseña" }
```

- **Éxito:** `200`, mismo cuerpo que `register`. Se puede iniciar sesión sin haber verificado el correo.
- **Credenciales erradas:** `401 { "message": "Credenciales inválidas." }`, tanto si la contraseña es incorrecta como si el correo no existe.

### `POST /auth/refresh`

- **Petición:** sin cuerpo; usa la cookie y la rota en cada llamada.
- **Éxito:** `200` con el cuerpo de sesión.
- **Cookie inválida o reutilizada:** `401`, y se revoca toda la sesión.

### `POST /auth/logout`

`204`. Revoca la sesión y borra la cookie.

### `GET /auth/me` (token)

```json
{
  "user": {
    "id": "uuid",
    "email": "ana@example.com",
    "role": "user",
    "emailVerified": true,
    "createdAt": "2026-11-02T17:00:00.000Z",
    "termsAcceptedAt": "2026-11-02T17:00:00.000Z",
    "termsVersion": "2026-11-02"
  }
}
```

### `DELETE /auth/me` (token)

```json
{ "password": "tu contraseña" }
```

- **Éxito:** `204`. Borra la cuenta, sus sesiones, sus tokens y los vehículos del garaje, y limpia la cookie.
- **Contraseña incorrecta:** `403 INVALID_PASSWORD`.

### `POST /auth/verify-email`

```json
{ "token": "<token del enlace>" }
```

- **Éxito:** `200 { "message": "Tu correo fue confirmado.", "emailVerified": true }`. El mismo access token deja de recibir `EMAIL_NOT_VERIFIED` de inmediato.
- **Token inválido, expirado (24 h) o ya usado:** `400`.

### `POST /auth/resend-verification`

```json
{ "email": "ana@example.com" }
```

Responde siempre `202`, con el mismo mensaje exista o no el correo.

### `POST /auth/forgot-password`

`{ "email" }`. Responde siempre `202` con el mismo mensaje. El enlace `APP_URL/reset-password?token=...` vence en 30 minutos.

### `POST /auth/reset-password`

```json
{ "token": "<token del enlace>", "password": "tu nueva contraseña" }
```

- **Éxito:** `200`, y se cierran todas las sesiones.
- **Token inválido, expirado o usado:** `400`.

---

## Garaje (`/garage`): token y correo verificado

Placas colombianas: `ABC-123` (carro) o `ABC-12D` (moto). Se aceptan en minúsculas, con espacios o sin guion, y siempre se devuelven normalizadas.

### Objeto vehículo

```json
{
  "plate": "ABC-123",
  "brand": "Renault",
  "model": "Sandero",
  "year": 2019,
  "color": "Gris",
  "cylinderCc": 1598,
  "chassis": "9FBBSRADDKM123456",
  "fuelType": "Gasolina",
  "serviceType": "Particular",
  "soatExpiresOn": "2027-06-30",
  "rtmExpiresOn": null,
  "runtStatus": null,
  "source": "manual",
  "createdAt": "2026-11-02T17:00:00.000Z",
  "updatedAt": "2026-11-02T17:00:00.000Z",
  "kind": "carro",
  "soat": { "status": "Vigente", "expirationDate": "2027-06-30", "daysToExpire": 240, "alert": "verde" },
  "rtm": { "status": "Sin información", "expirationDate": null, "daysToExpire": null, "alert": "gris" }
}
```

- **`soat.status` / `rtm.status`:**
  - `Vigente` (verde): más de 30 días por delante.
  - `Por Vencer` (amarillo): 30 días o menos, incluido el día del vencimiento.
  - `Vencido` (rojo).
  - `Sin información` (gris): no hay fecha registrada.
- **`fuelType`:** `Gasolina`, `Diésel`, `Eléctrico`, `Híbrido`, `Gas natural`, `Gasolina y gas`, `Otro`.
- **`serviceType`:** `Particular`, `Público`, `Oficial`, `Diplomático`, `Otro`.
- **`source`:** `manual`, `scan` (datos precargados desde la tarjeta y confirmados por el usuario) o `runt` (actualizado por el proveedor).

### Endpoints

| Método y ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `GET /garage` | — | `{ "vehicles": [Vehículo] }`, ordenados por placa |
| `POST /garage` | `{ plate, brand, model, ...opcionales, source?: "manual" \| "scan" }` | `201` Vehículo · `409 DUPLICATE_PLATE` |
| `GET /garage/:plate` | — | Vehículo · `404` si no está en tu garaje |
| `PATCH /garage/:plate` | Solo los campos a cambiar (`null` borra un dato opcional; la placa no se edita) | Vehículo |
| `DELETE /garage/:plate` | — | `204` |
| `GET /garage/:plate/assessment` | — | Concepto (abajo) |
| `GET /garage/capabilities` | — | `{ "cardScan": { "enabled": bool, "provider": "gemini" \| "anthropic" \| "none", "notice": string \| null }, "runtLookup": { "enabled": bool, "provider": "none" \| "verifik" } }` (igual que en `/config/public`) |

**Reglas de los campos:**

- **Obligatorios en `POST`:** `plate`, `brand` y `model`.
- **Opcionales:** `year`, `color`, `cylinderCc` (cc, entero), `chassis`, `fuelType`, `serviceType`, `soatExpiresOn`, `rtmExpiresOn`, `runtStatus`.
- **Campos desconocidos:** se rechazan con `400`, por ejemplo `ownerDocument`, porque el documento del propietario nunca se guarda.

### `GET /garage/:plate/assessment`

```json
{
  "plate": "ABC-123",
  "verdict": "Revisar",
  "reasons": [
    { "code": "RTM_EXPIRING", "severity": "media", "message": "La revisión técnico-mecánica vence en 18 día(s) (20/11/2026)." },
    { "code": "MISSING_DATA", "severity": "media", "message": "Falta el número de chasis: sin él no se puede contrastar el vehículo con sus documentos." }
  ],
  "missingFields": ["chassis", "runtStatus"],
  "basedOn": {
    "source": "datos_registrados_por_el_usuario",
    "dataOrigin": "manual",
    "official": false,
    "evaluatedAt": "2026-11-02T17:00:00.000Z",
    "evaluatedOn": "2026-11-02",
    "timeZone": "America/Bogota",
    "disclaimer": "Concepto calculado únicamente con los datos registrados en tu garaje. No es una consulta oficial al RUNT, ..."
  }
}
```

**Cómo se decide `verdict`:**

- **`No recomendado`:** hay alguna razón `alta`, es decir, `SOAT_EXPIRED`, `RTM_EXPIRED` o `RUNT_NOT_ACTIVE`.
- **`Revisar`:** hay alguna razón `media`, es decir, `SOAT_EXPIRING`, `RTM_EXPIRING`, `SOAT_MISSING`, `RTM_MISSING` o `MISSING_DATA` (faltan el año o el chasis).
- **`Sin alertas`:** no hay ninguna de las anteriores.
- **Razones `info`:** no cambian el veredicto. Por ejemplo, `RTM_PROBABLY_EXEMPT` para un vehículo nuevo sin fecha de RTM.

Muestra siempre `basedOn.disclaimer`.

### `POST /garage/scan-card`

Lee la tarjeta de propiedad (licencia de tránsito) con visión, usando el proveedor de `cardScan.provider` (Gemini o Anthropic). Antes de subir la foto, muestra `cardScan.notice`.

- **Petición:** `multipart/form-data` con un solo archivo en el campo `image`.
  - **Formato:** JPEG, PNG o WEBP, de máximo 5 MB.
  - **Límite:** 10 lecturas por hora por usuario.
- **Privacidad:** la imagen no se guarda, y la respuesta **no** crea el vehículo.

```json
{
  "vehicle": {
    "plate": { "value": "ABC-123", "confidence": 0.98 },
    "brand": { "value": "RENAULT", "confidence": 0.95 },
    "model": { "value": "SANDERO", "confidence": 0.9 },
    "year": { "value": 2019, "confidence": 0.92 },
    "color": { "value": "GRIS ESTRELLA", "confidence": 0.9 },
    "cylinderCc": { "value": 1598, "confidence": 0.8 },
    "chassis": { "value": "9FBBSRADDKM123456", "confidence": 0.7 },
    "fuelType": { "value": "Gasolina", "confidence": 0.9 },
    "serviceType": { "value": "Particular", "confidence": 0.85 }
  },
  "kind": "carro",
  "ownerDocument": { "value": "C.C. 79123456", "confidence": 0.85 },
  "warnings": ["La esquina inferior está borrosa."],
  "stored": false,
  "next": { "confirmWith": "POST /garage", "source": "scan" }
}
```

**Cómo leer la respuesta:**

- `value: null` con `confidence: 0` significa que el dato no se leyó o no pasó la validación. Resalta los campos con confianza baja.
- `ownerDocument` solo sirve para la consulta RUNT. **No lo envíes a `POST /garage`.**

**Confirmación:** el usuario revisa los datos y los confirma con `POST /garage` y `"source": "scan"`.

**Errores:** `415`, `413`, `422` y `503`, según la tabla de errores. Ante `503 SCAN_PROVIDER_BUSY`, muestra el mensaje y deja ingresar los datos a mano.

### `POST /garage/:plate/refresh-from-runt`

Actualiza un vehículo del garaje con datos del proveedor RUNT.

- **Requisitos:**
  - Solo funciona si `runtLookup.enabled` es `true`.
  - Exige consentimiento en cada consulta.
  - Límite: 5 consultas por hora por usuario.

```json
{ "consent": true, "ownerDocument": { "type": "CC", "number": "79123456" } }
```

- **`ownerDocument`:**
  - También se acepta como texto, tal como lo devuelve `scan-card` (`"C.C. 79.123.456"`).
  - Tipos válidos: `CC`, `CE`, `PA`, `NIT`, `RC`.
  - No se guarda.

```json
{
  "vehicle": { "...": "Vehículo con source \"runt\"" },
  "lookup": { "provider": "verifik", "queriedAt": "2026-11-02T17:00:00.000Z", "fieldsUpdated": ["brand", "soatExpiresOn", "rtmExpiresOn", "runtStatus"] }
}
```

**Errores:**

- `400`: falta `consent: true` o el documento es inválido.
- `404`: el vehículo no está en tu garaje, o el proveedor no lo encontró (`RUNT_NOT_FOUND`).
- `501`: el adaptador está sin implementar.
- `503`: el proveedor está apagado o caído.

---

## Vehículos de demostración (`/vehicles`): token y correo verificado

> **Solo demostración.** Datos **ficticios** con placas de formato antiguo (`ABC-1234`, `DEF-5678`, `GHI-9012`), cargados por una migración para mostrar el informe de peritaje. No representan vehículos reales ni se conectan con el garaje. El flujo real es `/garage`. Se eliminarán en una versión futura.

| Método y ruta | Notas |
| --- | --- |
| `GET /vehicles` | `{ "vehicles": [...] }` |
| `GET /vehicles/:plate` | Informe con RUNT/SOAT/RTM calculados e inspecciones |
| `POST /vehicles/scan` | `{ plate, source?: "manual" \| "image" }`; busca entre los datos de demostración |
| `PATCH /vehicles/:plate/inspections` | Solo `admin`. `{ inspectionId, status: "Aprobado" \| "Atención" \| "No aprobado", result, notes }`. `updatedBy` sale del usuario autenticado |

---

## Límites de intentos

| Ruta | Límite | Clave |
| --- | --- | --- |
| `POST /auth/login` | 10 / 15 min | por IP **y** por correo |
| `POST /auth/register` | 10 / 15 min | por IP |
| `POST /auth/forgot-password` | 5 / 15 min por IP, 3 / 15 min por correo | IP y correo |
| `POST /auth/reset-password` | 10 / 15 min | por IP |
| `POST /auth/verify-email` | 10 / 15 min | por IP |
| `POST /auth/resend-verification` | 5 / 15 min por IP, 3 / 15 min por correo | IP y correo |
| `DELETE /auth/me` | 5 / 15 min | por IP |
| `POST /garage/scan-card` | 10 / hora | por usuario |
| `POST /garage/:plate/refresh-from-runt` | 5 / hora | por usuario |

Las respuestas incluyen las cabeceras `RateLimit` y `RateLimit-Policy` (borrador 8 del IETF).
