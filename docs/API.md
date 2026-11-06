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
| 503 | `CHAT_PROVIDER_BUSY`, `CHAT_UNAVAILABLE` | El chat no pudo responder: cuota del proveedor o falla del servicio. No se guarda nada |
| 503 | `SCAN_PROVIDER_BUSY` | El proveedor gratuito de lectura está saturado (429). Incluye `retryAfterSeconds: 60`; muestra el `message` y ofrece ingresar los datos a mano |

---

## Salud y configuración pública

`GET /health` (público): `{ "status": "ok", "service": "AutoCheck-CO" }`.

`GET /config/public` (público, sin token). Úsalo para mostrar el consentimiento del registro y los avisos antes de subir la foto de la tarjeta o del tablero:

```json
{
  "privacyPolicy": {
    "version": "2026-11-05.1",
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
| `parpadea` | `true` o `false` | Opcional. Una foto fija no demuestra un parpadeo: envíalo solo si el usuario lo indica |

La elección manual también se acepta como JSON: `{ "telltaleId": "tpms" }`.

Antes de subir la foto, muestra `diagnosis.notice`.

**`201`, testigos identificados.** Con IA, una foto puede dar hasta 8 testigos, ordenados del más grave al menos grave. La elección manual responde igual, con uno solo y con el texto del catálogo:

```json
{
  "status": "diagnosed",
  "id": "uuid",
  "origen": "ia",
  "confianza": 0.95,
  "descripcion": null,
  "createdAt": "2026-11-05T17:00:00.000Z",
  "urgenciaGeneral": "rojo",
  "debeDetenerse": true,
  "accionGeneral": "Detente en un lugar seguro en cuanto puedas, apaga el motor y llama a un taller o a una grúa. No sigas manejando.",
  "mensajeGeneral": "Se ven varios testigos encendidos.",
  "mejorFoto": null,
  "testigos": [
    {
      "nombre": "Presión de aceite",
      "descripcionSimbolo": "Aceitera, a la izquierda del display.",
      "color": "rojo",
      "parpadeando": null,
      "categoria": "aceite",
      "urgencia": "rojo",
      "debeDetenerse": true,
      "accion": "Detente en un lugar seguro en cuanto puedas, ...",
      "significado": "El aceite no está llegando al motor con la presión necesaria.",
      "porQuePasa": ["Nivel de aceite muy bajo"],
      "puedesRevisar": ["Con el motor apagado, mira si hay manchas debajo del vehículo."],
      "noHagas": ["No sigas manejando."],
      "cuandoIrAlMecanico": "Ahora: no sigas manejando. Llama a un taller o a una grúa ...",
      "notaDelVehiculo": null,
      "confianza": 0.95
    }
  ],
  "aviso": "Orientación general. Un mecánico debe confirmar el diagnóstico."
}
```

**Cómo leer la respuesta:**

- **`origen`:** `ia` o `manual`. En `manual`, `confianza` es `null`. En `ia`, es la mayor confianza entre los testigos.
- **`urgenciaGeneral`:** la del testigo más grave: `rojo`, `amarillo` o `informativo`.
- **`debeDetenerse`:** decide el aviso de detenerse, no el color. El airbag es `rojo` con `debeDetenerse: false`.
- **`categoria`:** `aceite`, `temperatura`, `frenos`, `freno_mano`, `direccion`, `airbag`, `bateria_carga`, `motor_emisiones`, `transmision`, `llantas`, `estabilidad_abs`, `combustible`, `luces`, `informativo` u `otro`.
- **`mejorFoto`:** si se pudo leer la foto pero conviene repetirla, el motivo.
- Un texto del modelo que sugiera seguir manejando puede llegar vacío: oculta esa sección. Muestra siempre `aviso`.

**Piso de seguridad.** Lo aplica el servidor (`src/domain/diagnosisSafety.ts`), sin importar lo que diga el modelo:

| Caso | Resultado |
| --- | --- |
| `aceite`, `temperatura`, `frenos`, `direccion` | Rojo y orden de detenerse |
| `bateria_carga` | Rojo y orden de detenerse, igual que en el catálogo |
| `transmision` en rojo | Orden de detenerse, igual que en el catálogo |
| `airbag` | Como mínimo rojo, sin ordenar detenerse |
| `freno_mano` | Informativo o amarillo, aunque se vea rojo. Pasa a `frenos` si el usuario dice que el freno está liberado, o si el nombre deja cualquier duda ("Freno de mano o nivel de líquido de frenos") |
| `motor_emisiones` parpadeando | Rojo y orden de detenerse |
| `otro` en rojo | Rojo |

En todos se eliminan las frases que sugieran seguir manejando. El color solo informa la urgencia: no rechaza la foto, porque muchos tableros se iluminan de rojo.

**`200`, sin testigos.** No se inventa nada ni se guarda en el historial:

| `status` | Cuándo | `reason` |
| --- | --- | --- |
| `not_recognized` | No es un tablero o no hay testigos encendidos. `pista` lo explica | |
| `needs_better_input` | La foto no deja leer los testigos | `no_telltales_found` |
| `needs_better_input` | Todos los testigos tienen confianza menor a 0.3 y ninguno es rojo | `low_confidence` |

```json
{
  "status": "needs_better_input",
  "reason": "no_telltales_found",
  "pista": "La foto está muy oscura. Toma otra foto más cercana, sin reflejos y con el tablero encendido, o elígelo de la lista.",
  "avisoSeguridad": "Mientras lo identificas: si el testigo es rojo o notas algo raro al manejar, detente en un lugar seguro.",
  "puedeElegirDeLaLista": true
}
```

**Errores:** `400`, `404`, `413`, `415`, `429` y `503`, según la tabla de errores. Ante cualquier `503`, ofrece elegir el testigo de la lista.

**Fallas del proveedor.** Nunca se disfrazan de "toma otra foto", y los logs solo registran el código HTTP y el tipo de error. Los 5xx se reintentan dos veces antes de responder.

| `status` | `code` | Cuándo | Qué hacer |
| --- | --- | --- | --- |
| `provider_busy` | `503 DIAGNOSIS_PROVIDER_BUSY` | Gemini respondió 429: cupo del plan gratuito, por minuto o por día | Intentar más tarde (`retryAfterSeconds`) o elegir de la lista |
| `provider_error` | `503 DIAGNOSIS_UNAVAILABLE` | 400, 401, 403 o 5xx de Gemini, JSON inválido o tiempo agotado | Intentar más tarde o elegir de la lista |
| `provider_error` | `503 AI_NOT_CONFIGURED` | `SCAN_PROVIDER` distinto de `gemini` o sin clave | Elegir de la lista |

`429 RATE_LIMITED` es distinto: es el límite de AutoCheck por usuario. Con `limite: "ia"`, también se puede elegir de la lista.

### `GET /garage/:plate/diagnoses`

Historial del vehículo, del más reciente al más antiguo. Parámetros: `page` (por defecto 1) y `limit` (por defecto 20, máximo 50).

```json
{
  "items": [
    {
      "id": "uuid",
      "telltaleId": "tpms",
      "nombre": "Presión de llantas (TPMS)",
      "totalTestigos": 1,
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

- **`telltaleId`:** solo en la elección manual; `null` con IA.
- **`nombre`:** el testigo más grave. `totalTestigos` dice cuántos eran.
- **`severidad`:** la urgencia general que se guardó al crear la entrada.

### `GET /garage/:plate/diagnoses/:id`

Una entrada con su explicación completa. **Solo lee:** no crea otra entrada, no llama a la IA y no cuenta para ningún límite. Solo responde al dueño del vehículo.

`200` con los mismos campos de `201` en `POST`: lo que se le explicó al usuario ese día, guardado en JSON y sin la imagen. Las entradas anteriores a esta versión no lo tienen, y se recomponen desde el catálogo vigente.

**Errores:** `400` si el `id` no es un UUID. `404` si no está en el historial de ese vehículo o la placa no es tuya. `404 TELLTALE_NOT_IN_CATALOG` si es una entrada anterior y el testigo salió del catálogo.

### `DELETE /garage/:plate/diagnoses/:id`

`204`. `404` si no está en el historial de ese vehículo, y `400` si el `id` no es un UUID. Borrar el vehículo o la cuenta también borra su historial. La conversación se borra con el diagnóstico.

### `GET /garage/:plate/diagnoses/:id/messages`

La conversación, de la más antigua a la más reciente, y cuántos mensajes le quedan al usuario en este diagnóstico. No llama a la IA.

```json
{
  "messages": [{ "id": "uuid", "role": "user", "content": "¿Puedo seguir manejando?", "createdAt": "2026-11-05T17:00:00.000Z" }],
  "restantes": 19
}
```

### `POST /garage/:plate/diagnoses/:id/messages`

Cuerpo: `{ "message": "texto" }`, de máximo 500 caracteres. Solo texto. Responde `201` con la pregunta y la respuesta, ya guardadas:

```json
{
  "question": { "id": "uuid", "role": "user", "content": "...", "createdAt": "..." },
  "answer": { "id": "uuid", "role": "assistant", "content": "...", "createdAt": "..." },
  "restantes": 19
}
```

El modelo recibe el vehículo (marca, línea, año, combustible y kilometraje, nunca la placa), los testigos con su explicación y los últimos 10 mensajes.

**Seguridad, aplicada por el servidor:**

- **Si el diagnóstico ordena detenerse** y la respuesta sugiere seguir manejando, se descarta y se entrega una respuesta fija. Lo decide lo que declara el modelo (`sugiereSeguirManejando`) y también una revisión del texto, porque el modelo puede declararlo mal.
- **Tema ajeno al vehículo:** se entrega una respuesta fija.
- **Diagnóstico en rojo:** siempre se añade un recordatorio fijo al final.
- **Siempre** se añade "Orientación general. Un mecánico debe confirmar el diagnóstico."

**Errores:** `400` si el mensaje no es válido. `404` si el diagnóstico o la placa no son tuyos. `429 CHAT_LIMIT_REACHED` al llegar a 20 mensajes del usuario en el diagnóstico. `429 RATE_LIMITED` al superar 40 por hora. `503 CHAT_PROVIDER_BUSY` (`provider_busy`), `503 CHAT_UNAVAILABLE` o `503 AI_NOT_CONFIGURED` (`provider_error`). Si falla, no se guarda nada.

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
| `POST /garage/:plate/diagnoses/:id/messages` | 40 / hora, y 20 mensajes por diagnóstico | por usuario |

Los dos primeros contadores son independientes: agotar el de la IA no bloquea la lista, y usar la lista no gasta el cupo de la IA. Las solicitudes rechazadas con `4xx` (imagen inválida, placa ajena) no cuentan para ellos, pero sí para el tope. Sin IA configurada, no se gasta cupo de la IA. Leer el historial o el detalle no cuenta.

Estos son los límites de AutoCheck (`429 RATE_LIMITED`). El cupo del proveedor es aparte: llega como `503 DIAGNOSIS_PROVIDER_BUSY`.

Las respuestas incluyen las cabeceras `RateLimit` y `RateLimit-Policy` (borrador 8 del IETF).
