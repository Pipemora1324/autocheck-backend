# API de AutoCheck-CO

Contrato HTTP del backend para el frontend. Todas las respuestas son JSON en español.

> **Diagnóstico de testigos:** el usuario registra sus vehículos en `/garage` y pide un diagnóstico con foto, descripción o eligiendo el testigo de `GET /telltales`. La IA solo identifica el testigo; todo el contenido sale del catálogo del servidor.

- **Base URL**
  - Producción: `https://<proyecto>.vercel.app/api` (Vercel reenvía `/api/*` al backend en Render).
  - Desarrollo: `http://localhost:3000`.
- **Autenticación:** `Authorization: Bearer <accessToken>`. El access token dura 15 minutos.
- **Cookie de sesión:** el refresh token viaja en la cookie httpOnly `autocheck_refresh` (ruta `COOKIE_PATH`, en producción `/api/auth`). Envía `withCredentials: true` en `/auth/*`.
- **Fechas:** los instantes son ISO 8601 UTC.

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
| 400 | `IMAGE_REQUIRED`, `INVALID_UPLOAD` | `scan-card` sin imagen, otro campo de archivo o un campo de texto demasiado grande |
| 400 | `DIAGNOSIS_INPUT_REQUIRED`, `UNKNOWN_TELLTALE` | Diagnóstico sin foto, descripción ni testigo, o con un `telltaleId` fuera del catálogo |
| 401 | — | Falta el token, es inválido o expiró. El frontend renueva con `/auth/refresh` y reintenta una vez |
| 403 | `EMAIL_NOT_VERIFIED` | `/garage/*` con el correo sin confirmar |
| 403 | `INVALID_PASSWORD` | `DELETE /auth/me` con contraseña incorrecta (no es 401, para no cerrar la sesión) |
| 404 | — | Recurso inexistente o vehículo que no está en tu garaje |
| 404 | `TELLTALE_NOT_IN_CATALOG` | Detalle de un diagnóstico cuyo testigo salió del catálogo |
| 409 | `DUPLICATE_PLATE`, `GARAGE_LIMIT_REACHED` / — | Placa repetida, más de 50 vehículos, o correo ya registrado |
| 413 | `IMAGE_TOO_LARGE` | Imagen de más de 5 MB |
| 415 | `UNSUPPORTED_IMAGE` | El archivo no es JPEG, PNG ni WEBP (se valida la firma real) |
| 422 | `CARD_UNREADABLE`, `NOT_A_VEHICLE_DOCUMENT` | No se pudo leer la tarjeta |
| 429 | `RATE_LIMITED` / — | **Límite propio de AutoCheck** por usuario o IP (ver tabla al final). En diagnósticos incluye `limite`: `ia`, `manual` o `total`. Con `ia`, ofrece la lista |
| 503 | `VISION_NOT_CONFIGURED`, `VISION_UNAVAILABLE` | Lectura de tarjeta apagada o caída |
| 503 | `AI_NOT_CONFIGURED`, `DIAGNOSIS_UNAVAILABLE` | Diagnóstico con IA apagado o caído. Ofrece elegir el testigo de la lista, que sigue funcionando |
| 503 | `DIAGNOSIS_PROVIDER_BUSY` | **Cuota del proveedor:** Gemini respondió 429, por su plan gratuito y no por este usuario. Incluye `retryAfterSeconds: 60`; muestra el `message` y ofrece la lista |
| 503 | `SCAN_PROVIDER_BUSY` | El proveedor gratuito de lectura está saturado (429). Incluye `retryAfterSeconds: 60`; muestra el `message` y ofrece ingresar los datos a mano |

---

## Salud y configuración pública

`GET /health` (público): `{ "status": "ok", "service": "AutoCheck-CO" }`.

`GET /config/public` (público, sin token). Úsalo para mostrar el consentimiento del registro y los avisos antes de subir la foto de la tarjeta o del tablero:

```json
{
  "privacyPolicy": {
    "version": "2026-11-04.1",
    "registrationConsent": "Autorizo a AutoCheck-CO a tratar mis datos personales ... La foto no se guarda en los servidores de AutoCheck-CO. El diagnóstico es orientación general y un mecánico debe confirmarlo."
  },
  "cardScan": {
    "enabled": true,
    "provider": "gemini",
    "notice": "La foto de la tarjeta se envía a Google (Gemini API, plan gratuito) solo para extraer los datos; ... En el plan gratuito, Google puede usar el contenido enviado para mejorar sus productos. ..."
  },
  "diagnosis": {
    "enabled": true,
    "provider": "gemini",
    "manualSelection": true,
    "notice": "La foto del tablero y tu descripción se envían a un proveedor externo de inteligencia artificial (Google, Gemini API, plan gratuito) ... La foto no se guarda en nuestros servidores. ..."
  }
}
```

- **`cardScan.provider`:** `gemini`, `anthropic` o `none`.
- **`cardScan.notice`:** es `null` si la lectura está apagada.
- **`diagnosis.enabled`:** indica si la **IA** está activa. Solo es `true` con `SCAN_PROVIDER=gemini` y clave. `manualSelection` siempre es `true`.
- **`diagnosis.notice`:** muéstralo antes de subir la foto del tablero. Es `null` si la IA está apagada.

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

- **Éxito:** `204`. Borra la cuenta, sus sesiones, sus tokens, los vehículos del garaje y sus diagnósticos, y limpia la cookie.
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
  "mileageKm": 85000,
  "source": "manual",
  "createdAt": "2026-11-02T17:00:00.000Z",
  "updatedAt": "2026-11-02T17:00:00.000Z",
  "kind": "carro"
}
```

- **`model`:** la línea del vehículo (por ejemplo, `Sandero`). **`year`:** el año del modelo.
- **`mileageKm`:** kilometraje opcional, entero entre 0 y 9.999.999.
- **`fuelType`:** `Gasolina`, `Diésel`, `Eléctrico`, `Híbrido`, `Gas natural`, `Gasolina y gas`, `Otro`.
- **`serviceType`:** `Particular`, `Público`, `Oficial`, `Diplomático`, `Otro`.
- **`source`:** `manual` o `scan` (datos precargados desde la tarjeta y confirmados por el usuario).

### Endpoints

| Método y ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `GET /garage` | — | `{ "vehicles": [Vehículo] }`, ordenados por placa |
| `POST /garage` | `{ plate, brand, model, ...opcionales, source?: "manual" \| "scan" }` | `201` Vehículo · `409 DUPLICATE_PLATE` |
| `GET /garage/:plate` | — | Vehículo · `404` si no está en tu garaje |
| `PATCH /garage/:plate` | Solo los campos a cambiar (`null` borra un dato opcional; la placa no se edita) | Vehículo |
| `DELETE /garage/:plate` | — | `204` |
| `GET /garage/capabilities` | — | `{ "cardScan": { "enabled": bool, "provider": "gemini" \| "anthropic" \| "none", "notice": string \| null }, "diagnosis": { "enabled": bool, "provider": "gemini" \| "none", "manualSelection": true, "notice": string \| null } }` (igual que en `/config/public`) |

**Reglas de los campos:**

- **Obligatorios en `POST`:** `plate`, `brand` y `model`.
- **Opcionales:** `year`, `color`, `cylinderCc` (cc, entero), `chassis`, `fuelType`, `serviceType`, `mileageKm`.
- **Campos desconocidos:** se rechazan con `400`, por ejemplo `ownerDocument`, porque el documento del propietario nunca se guarda.

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
  "warnings": ["La esquina inferior está borrosa."],
  "stored": false,
  "next": { "confirmWith": "POST /garage", "source": "scan" }
}
```

**Cómo leer la respuesta:**

- `value: null` con `confidence: 0` significa que el dato no se leyó o no pasó la validación. Resalta los campos con confianza baja.
- El nombre y el documento del propietario no se extraen.

**Confirmación:** el usuario revisa los datos y los confirma con `POST /garage` y `"source": "scan"`.

**Errores:** `415`, `413`, `422` y `503`, según la tabla de errores. Ante `503 SCAN_PROVIDER_BUSY`, muestra el mensaje y deja ingresar los datos a mano.

---

## Testigos del tablero

### `GET /telltales` (token)

Catálogo resumido, para que el usuario elija el testigo a mano si la foto no se reconoce.

```json
{
  "telltales": [
    { "id": "presion_aceite", "nombre": "Presión de aceite", "alias": ["aceitera", "lámpara de aceite"], "severidad": "rojo", "debeDetenerse": true }
  ]
}
```

- **`severidad`:** `rojo`, `amarillo` o `informativo`.
- **`debeDetenerse`:** `true` si el testigo ordena detenerse. El airbag es `rojo` con `debeDetenerse: false`: no muestres "Detente" solo por el color.

## Diagnósticos (`/garage/:plate/diagnoses`): token y correo verificado

Solo sobre vehículos del usuario autenticado. Una placa ajena responde `404`.

### `POST /garage/:plate/diagnoses`

`multipart/form-data` con **al menos uno** de estos campos:

| Campo | Tipo | Notas |
| --- | --- | --- |
| `image` | Archivo | JPEG, PNG o WEBP, validado por firma, de máximo 5 MB. Se procesa en memoria y no se guarda ni se registra |
| `description` | Texto | Máximo 500 caracteres. Se guarda en el historial |
| `telltaleId` | Texto | Un `id` de `GET /telltales`. Si viene, **no se llama a la IA**, y la foto no se envía a nadie |

La elección manual también se acepta como JSON: `{ "telltaleId": "tpms" }`.

Antes de subir la foto, muestra `diagnosis.notice`.

**`201`, testigo identificado:**

```json
{
  "status": "diagnosed",
  "id": "uuid",
  "origen": "ia",
  "confianza": 0.93,
  "createdAt": "2026-11-04T17:00:00.000Z",
  "telltale": { "id": "presion_aceite", "nombre": "Presión de aceite", "descripcionSimbolo": "Aceitera roja, ..." },
  "severidad": "rojo",
  "urgencia": {
    "semaforo": "rojo",
    "titulo": "Detente",
    "accion": "Detente en un lugar seguro en cuanto puedas, apaga el motor y llama a un taller o a una grúa. No sigas manejando.",
    "debeDetenerse": true,
    "esFalla": true
  },
  "significado": "El aceite no está llegando al motor con la presión necesaria. ...",
  "causasProbables": ["Nivel de aceite muy bajo", "Fuga de aceite"],
  "puedesRevisar": ["Con el motor apagado y en terreno plano, espera unos minutos y mira el nivel en la varilla."],
  "noHagas": ["No sigas manejando para \"llegar al taller\"."],
  "cuandoIrAlMecanico": "De inmediato y con grúa, ... Si se ignora, el motor puede fundirse en poco tiempo, ...",
  "notaEspecificaDelVehiculo": null,
  "avisoCompatibilidad": null,
  "aviso": "Orientación general. Un mecánico debe confirmar el diagnóstico."
}
```

**Cómo leer la respuesta:**

- **`origen`:** `ia` o `manual`. En `manual`, `confianza` es `null`.
- **`urgencia.semaforo`:** `rojo`, `amarillo` o `informativo` (`esFalla: false`: explica que no es una falla).
- **`urgencia.debeDetenerse`:** decide el aviso de detenerse, no el color. El airbag es `rojo` con `debeDetenerse: false` y `titulo: "Revísalo hoy"`: el vehículo puede moverse, pero no se debe depender de esa protección.
- **`neverDrive`:** los testigos marcados así en el catálogo siempre responden rojo y con la orden de detenerse, aunque el modelo diga otra cosa. Incluyen presión de aceite, temperatura, frenos y dirección.
- **Check engine parpadeando:** si el modelo informa un parpadeo, responde `severidad: "rojo"` y `debeDetenerse: true`, y así queda en el historial. Su severidad base en el catálogo sigue siendo `amarillo`. Una foto fija casi nunca demuestra un parpadeo: el modelo lo sabe sobre todo por la descripción del usuario.
- **`notaEspecificaDelVehiculo`:** texto corto del modelo, o `null`. El servidor la descarta en los testigos rojos, y si da consejos de manejo o incluye enlaces.
- **`avisoCompatibilidad`:** aparece si el testigo no suele corresponder al combustible registrado. No oculta el diagnóstico.
- Muestra siempre `aviso`.

**`200`, no se pudo identificar con seguridad.** No se inventa nada ni se guarda en el historial. Ocurre en estos casos:

- El modelo no reconoce el testigo, su confianza es menor a 0.6 o su salida es inválida.
- El modelo duda entre dos testigos (`telltaleAlternativo`): nunca se elige uno.
- El color observado es incompatible con el testigo, por ejemplo `nivel_aceite_bajo` en rojo o `sistema_frenos` en amarillo.
- El color es desconocido y el testigo solo se distingue por el color de otro más grave (`nivel_aceite_bajo`, `nivel_refrigerante`).

`pista` cambia según el caso y según si llegó una foto:

```json
{
  "status": "needs_better_input",
  "pista": "No pudimos identificar el testigo con seguridad. Toma otra foto más cercana, sin reflejos y con el tablero encendido, o elígelo de la lista.",
  "avisoSeguridad": "Mientras lo identificas: si el testigo es rojo o notas algo raro al manejar, detente en un lugar seguro.",
  "puedeElegirDeLaLista": true
}
```

**Errores:** `400`, `404`, `413`, `415`, `429` y `503`, según la tabla de errores. Ante cualquier `503`, ofrece elegir el testigo de la lista.

**`429 RATE_LIMITED` o `503 DIAGNOSIS_PROVIDER_BUSY`:**

| | `429 RATE_LIMITED` | `503 DIAGNOSIS_PROVIDER_BUSY` |
| --- | --- | --- |
| Quién limita | AutoCheck, por usuario | Gemini, por su plan gratuito |
| Cuándo pasa | El usuario superó su límite por hora | Gemini respondió 429, aunque el usuario esté dentro de su límite |
| Qué hacer | Intentar más tarde. Con `limite: "ia"`, también elegir de la lista | Intentar en un minuto (`retryAfterSeconds`) o elegir de la lista |

### `GET /garage/:plate/diagnoses`

Historial del vehículo, del más reciente al más antiguo. Parámetros: `page` (por defecto 1) y `limit` (por defecto 20, máximo 50).

```json
{
  "items": [
    {
      "id": "uuid",
      "telltaleId": "tpms",
      "nombre": "Presión de llantas (TPMS)",
      "severidad": "amarillo",
      "debeDetenerse": false,
      "origen": "manual",
      "confianza": null,
      "descripcion": "una llanta baja",
      "createdAt": "2026-11-04T17:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1,
  "totalPages": 1
}
```

- **`severidad`:** la que se guardó al crear la entrada, incluido un check engine escalado a rojo.

### `GET /garage/:plate/diagnoses/:id`

Una entrada con su explicación completa. **Solo lee:** no crea otra entrada, no llama a la IA y no cuenta para ningún límite. Solo responde al dueño del vehículo.

`200` con los mismos campos de `201` en `POST`, más `descripcion` (el texto del usuario, o `null`).

- **Usa el catálogo vigente:** el historial guarda el id del testigo, no el texto. Si el catálogo cambió después, la explicación y la severidad son las actuales, y no necesariamente lo que el usuario leyó ese día.
- **Se conserva de la entrada:** `origen`, `confianza`, `createdAt`, `descripcion` y si el check engine se escaló a rojo por un parpadeo.
- **`notaEspecificaDelVehiculo`:** siempre `null`, porque la nota del modelo no se guarda.
- **`avisoCompatibilidad`:** se calcula con el combustible actual del vehículo.

**Errores:** `400` si el `id` no es un UUID. `404` si no está en el historial de ese vehículo o la placa no es tuya. `404 TELLTALE_NOT_IN_CATALOG` si el testigo salió del catálogo.

### `DELETE /garage/:plate/diagnoses/:id`

`204`. `404` si no está en el historial de ese vehículo, y `400` si el `id` no es un UUID. Borrar el vehículo o la cuenta también borra su historial.

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
| `POST /garage/:plate/diagnoses` con foto o descripción (llama a la IA) | 15 / hora (`limite: "ia"`) | por usuario |
| `POST /garage/:plate/diagnoses` con `telltaleId` (sin IA) | 60 / hora (`limite: "manual"`) | por usuario |
| `POST /garage/:plate/diagnoses`, tope de todas las solicitudes, antes de procesar la subida | 75 / hora (`limite: "total"`) | por usuario |

Los dos primeros contadores son independientes: agotar el de la IA no bloquea la lista, y usar la lista no gasta el cupo de la IA. Las solicitudes rechazadas con `4xx` (imagen inválida, placa ajena) no cuentan para ellos, pero sí para el tope. Sin IA configurada, no se gasta cupo de la IA. Leer el historial o el detalle no cuenta.

Estos son los límites de AutoCheck (`429 RATE_LIMITED`). El cupo del proveedor es aparte: llega como `503 DIAGNOSIS_PROVIDER_BUSY`.

Las respuestas incluyen las cabeceras `RateLimit` y `RateLimit-Policy` (borrador 8 del IETF).
