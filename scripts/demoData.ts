// Datos FICTICIOS de la cuenta de demostración (npm run seed:demo). No corresponden a vehículos ni personas reales.
// Todas las placas usan la serie DEM para que se reconozcan como de demostración; no se guarda chasis.
import type { FuelType } from '../src/repositories/garageRepository.js';
import type { OBSERVED_COLORS } from '../src/services/telltaleIdentifier.js';

type ObservedColor = (typeof OBSERVED_COLORS)[number];

export interface DemoVehicle {
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  /** null en los eléctricos: no tienen cilindraje. */
  cylinderCc: number | null;
  fuelType: FuelType;
  mileageKm: number;
  /** Hace cuántos días se registró en el garaje. Siempre antes de su primer diagnóstico. */
  addedDaysAgo: number;
}

export interface DemoChatTurn {
  question: string;
  /** Respuesta escrita a mano. El servidor le agrega el recordatorio de seguridad y el aviso fijo, como en el chat real. */
  answer: string;
}

/** Un testigo tal como lo devolvería el modelo; el texto sale del catálogo y luego pasa por el piso de seguridad. */
export interface DemoReadingItem {
  telltaleId: string;
  color: ObservedColor;
  confianza: number;
  parpadeando?: boolean;
  /** Nota específica del vehículo, como la que redacta el modelo. */
  nota?: string;
}

interface DemoDiagnosisBase {
  plate: string;
  daysAgo: number;
  /** Hora local de Colombia (UTC-5). */
  hour: number;
  minute: number;
  /** Lo que escribió el usuario. */
  description?: string;
  chat?: DemoChatTurn[];
}

export interface DemoManualDiagnosis extends DemoDiagnosisBase {
  kind: 'manual';
  telltaleId: string;
  blinking?: boolean;
}

export interface DemoAiDiagnosis extends DemoDiagnosisBase {
  kind: 'ia';
  description: string;
  blinking?: boolean;
  mensajeGeneral: string;
  testigos: DemoReadingItem[];
}

export type DemoDiagnosis = DemoManualDiagnosis | DemoAiDiagnosis;

export const DEMO_VEHICLES: readonly DemoVehicle[] = [
  {
    plate: 'DEM-101',
    brand: 'Chevrolet',
    model: 'Spark GT',
    year: 2016,
    color: 'Rojo',
    cylinderCc: 1206,
    fuelType: 'Gasolina',
    mileageKm: 92_400,
    addedDaysAgo: 89
  },
  {
    plate: 'DEM-102',
    brand: 'Renault',
    model: 'Logan',
    year: 2012,
    color: 'Gris estrella',
    cylinderCc: 1598,
    fuelType: 'Gasolina',
    mileageKm: 178_500,
    addedDaysAgo: 88
  },
  {
    plate: 'DEM-103',
    brand: 'Mazda',
    model: 'Mazda 3',
    year: 2019,
    color: 'Azul',
    cylinderCc: 1998,
    fuelType: 'Gasolina',
    mileageKm: 54_300,
    addedDaysAgo: 86
  },
  {
    plate: 'DEM-104',
    brand: 'Kia',
    model: 'Picanto',
    year: 2021,
    color: 'Blanco',
    cylinderCc: 1248,
    fuelType: 'Gasolina',
    mileageKm: 31_800,
    addedDaysAgo: 84
  },
  {
    plate: 'DEM-105',
    brand: 'Toyota',
    model: 'Hilux',
    year: 2018,
    color: 'Plata',
    cylinderCc: 2393,
    fuelType: 'Diésel',
    mileageKm: 142_000,
    addedDaysAgo: 83
  },
  {
    plate: 'DEM-106',
    brand: 'Chevrolet',
    model: 'D-Max',
    year: 2010,
    color: 'Blanco',
    cylinderCc: 2999,
    fuelType: 'Diésel',
    mileageKm: 236_700,
    addedDaysAgo: 80
  },
  {
    plate: 'DEM-107',
    brand: 'Renault',
    model: 'Duster',
    year: 2020,
    color: 'Café',
    cylinderCc: 1998,
    fuelType: 'Gasolina',
    mileageKm: 67_200,
    addedDaysAgo: 82
  },
  {
    plate: 'DEM-108',
    brand: 'Nissan',
    model: 'Frontier',
    year: 2022,
    color: 'Negro',
    cylinderCc: 2298,
    fuelType: 'Diésel',
    mileageKm: 48_900,
    addedDaysAgo: 60
  },
  {
    plate: 'DEM-109',
    brand: 'Toyota',
    model: 'Corolla Cross Hybrid',
    year: 2023,
    color: 'Blanco perla',
    cylinderCc: 1798,
    fuelType: 'Híbrido',
    mileageKm: 18_400,
    addedDaysAgo: 40
  },
  {
    plate: 'DEM-110',
    brand: 'Renault',
    model: 'Kwid E-Tech',
    year: 2024,
    color: 'Blanco',
    cylinderCc: null,
    fuelType: 'Eléctrico',
    mileageKm: 6_200,
    addedDaysAgo: 50
  },
  {
    plate: 'DEM-111',
    brand: 'BYD',
    model: 'Dolphin',
    year: 2023,
    color: 'Gris',
    cylinderCc: null,
    fuelType: 'Eléctrico',
    mileageKm: 21_500,
    addedDaysAgo: 75
  },
  {
    plate: 'DEM-112',
    brand: 'Ford',
    model: 'Escape Hybrid',
    year: 2021,
    color: 'Azul oscuro',
    cylinderCc: 2488,
    fuelType: 'Híbrido',
    mileageKm: 39_000,
    addedDaysAgo: 87
  },
  {
    plate: 'DEM-113',
    brand: 'Chevrolet',
    model: 'Aveo',
    year: 2004,
    color: 'Plata',
    cylinderCc: 1598,
    fuelType: 'Gasolina',
    mileageKm: 265_300,
    addedDaysAgo: 70
  },
  {
    plate: 'DEM-114',
    brand: 'Hyundai',
    model: 'Atos',
    year: 2008,
    color: 'Verde',
    cylinderCc: 999,
    fuelType: 'Gasolina y gas',
    mileageKm: 210_800,
    addedDaysAgo: 65
  },
  {
    plate: 'DEM-20M',
    brand: 'Yamaha',
    model: 'FZ 2.0',
    year: 2019,
    color: 'Negro',
    cylinderCc: 149,
    fuelType: 'Gasolina',
    mileageKm: 38_700,
    addedDaysAgo: 58
  }
];

export const DEMO_DIAGNOSES: readonly DemoDiagnosis[] = [
  // --- Chevrolet Spark GT ---
  {
    plate: 'DEM-101',
    kind: 'manual',
    telltaleId: 'check_engine',
    blinking: true,
    daysAgo: 7,
    hour: 7,
    minute: 42,
    description: 'La luz del motor parpadea y el carro tiembla cuando acelero en subida.',
    chat: [
      {
        question: 'La luz del motor está parpadeando, ¿es grave?',
        answer:
          'Sí. Un check engine que parpadea indica que el motor está fallando en la combustión. El combustible sin quemar llega al catalizador, lo recalienta y lo puede dañar en poco tiempo. Por eso este diagnóstico pasa a rojo aunque el testigo sea amarillo.'
      },
      {
        question: '¿Puedo seguir manejando despacio?',
        answer:
          'No es recomendable: detente en un lugar seguro, apaga el motor y llama a un taller o a una grúa. Manejar despacio no evita el daño mientras el testigo siga parpadeando.'
      }
    ]
  },
  { plate: 'DEM-101', kind: 'manual', telltaleId: 'combustible_bajo', daysAgo: 60, hour: 18, minute: 5 },
  { plate: 'DEM-101', kind: 'manual', telltaleId: 'cinturon', daysAgo: 88, hour: 6, minute: 50 },

  // --- Renault Logan ---
  {
    plate: 'DEM-102',
    kind: 'ia',
    daysAgo: 3,
    hour: 17,
    minute: 20,
    description:
      'Se prendió una luz roja como una lámpara y también la del motor. El carro suena más duro de lo normal.',
    mensajeGeneral: 'Se ven dos testigos encendidos. El más grave es el de presión de aceite.',
    testigos: [
      {
        telltaleId: 'presion_aceite',
        color: 'rojo',
        confianza: 0.94,
        nota: 'En un Logan con más de 178.000 km es común que el nivel de aceite baje entre cambios. Revisa la varilla solo con el motor apagado.'
      },
      { telltaleId: 'check_engine', color: 'amarillo', confianza: 0.81, parpadeando: false }
    ],
    chat: [
      {
        question: '¿Por qué está en rojo?',
        answer:
          'Porque la luz de presión de aceite indica que el motor no está recibiendo aceite con la presión necesaria. Sin esa presión las piezas internas rozan y el daño aparece en minutos. Por eso el diagnóstico queda en rojo, aunque el check engine sea amarillo: manda el testigo más grave.'
      },
      {
        question: '¿Puedo seguir manejando hasta mi casa? Estoy a 10 minutos.',
        answer:
          'No. Con la luz de aceite encendida no sigas manejando, ni siquiera unos minutos. Detente en un lugar seguro, apaga el motor y llama a un taller o a una grúa. Con el motor apagado y frío puedes mirar el nivel en la varilla, pero aunque esté bajo y lo completes, que un mecánico lo revise antes de volver a usarlo.'
      },
      {
        question: '¿Qué le digo al mecánico?',
        answer:
          'Cuéntale que se encendió la luz roja de presión de aceite junto con el check engine, que el motor sonaba más duro y que el carro tiene unos 178.000 km. Pídele que revise el nivel y las fugas de aceite, la bomba y el sensor de presión antes de encenderlo de nuevo.'
      }
    ]
  },
  { plate: 'DEM-102', kind: 'manual', telltaleId: 'mantenimiento', daysAgo: 40, hour: 9, minute: 15 },

  // --- Mazda 3 ---
  {
    plate: 'DEM-103',
    kind: 'ia',
    daysAgo: 12,
    hour: 8,
    minute: 3,
    description: 'Después de pasar un hueco salió una luz amarilla con un signo de admiración dentro de una herradura.',
    mensajeGeneral: 'Se ve un testigo amarillo de presión de llantas.',
    testigos: [
      {
        telltaleId: 'tpms',
        color: 'amarillo',
        confianza: 0.9,
        nota: 'En el Mazda 3 la presión recomendada está en la etiqueta del marco de la puerta del conductor.'
      }
    ],
    chat: [
      {
        question: '¿Puedo seguir manejando con esta luz?',
        answer:
          'Es un testigo amarillo: atiéndelo pronto. Mira las cuatro llantas; si alguna se ve baja o dañada, no la uses así y cambia a la de repuesto o pide ayuda. Si todas se ven bien, ve con cuidado a una estación cercana y mide la presión en frío con el valor de la etiqueta del marco de la puerta.'
      },
      {
        question: 'Ya la inflé y la luz sigue prendida.',
        answer:
          'En algunos modelos el testigo tarda unos minutos en apagarse o hay que reiniciar el sistema desde el menú; el manual explica cómo. Si vuelve a encenderse en pocos días, puede haber un pinchazo lento o un sensor con falla: pide que revisen la llanta y el sensor.'
      }
    ]
  },
  { plate: 'DEM-103', kind: 'manual', telltaleId: 'cinturon', daysAgo: 75, hour: 12, minute: 30 },

  // --- Kia Picanto ---
  {
    plate: 'DEM-104',
    kind: 'ia',
    daysAgo: 5,
    hour: 18,
    minute: 47,
    description: 'En el trancón la aguja de temperatura subió y salió una luz roja de un termómetro.',
    mensajeGeneral: 'Se ven dos testigos relacionados con la temperatura del motor.',
    testigos: [
      { telltaleId: 'temperatura_motor', color: 'rojo', confianza: 0.92 },
      {
        telltaleId: 'nivel_refrigerante',
        color: 'amarillo',
        confianza: 0.77,
        nota: 'En el Picanto el depósito de refrigerante es translúcido y tiene marcas de mínimo y máximo; míralo solo con el motor frío.'
      }
    ],
    chat: [
      {
        question: '¿Por qué está en rojo?',
        answer:
          'Porque el testigo de temperatura indica que el motor se está recalentando, y el de refrigerante sugiere que falta líquido. Un motor recalentado puede deformar la culata o dañar el empaque en poco tiempo.'
      },
      {
        question: '¿Le echo agua al radiador ya mismo?',
        answer:
          'No abras la tapa del radiador ni la del depósito con el motor caliente: el líquido sale a presión y puede quemarte. Detente en un lugar seguro, apaga el motor y llama a un taller o a una grúa. Cuando el motor esté frío, el mecánico revisará el nivel, las mangueras y el ventilador.'
      }
    ]
  },
  { plate: 'DEM-104', kind: 'manual', telltaleId: 'tpms', daysAgo: 50, hour: 7, minute: 10 },

  // --- Toyota Hilux ---
  {
    plate: 'DEM-105',
    kind: 'ia',
    daysAgo: 9,
    hour: 15,
    minute: 35,
    description: 'Después de tanquear en carretera se prendió la luz amarilla del motor y otra con una gota.',
    mensajeGeneral: 'Se ven dos testigos amarillos: el del motor y el de agua en el filtro de combustible.',
    testigos: [
      { telltaleId: 'check_engine', color: 'amarillo', confianza: 0.86, parpadeando: false },
      {
        telltaleId: 'agua_filtro_diesel',
        color: 'amarillo',
        confianza: 0.74,
        nota: 'En la Hilux diésel este aviso suele aparecer después de tanquear combustible con agua; el filtro tiene un purgador que debe drenar un técnico.'
      }
    ]
  },
  { plate: 'DEM-105', kind: 'manual', telltaleId: 'abs', daysAgo: 30, hour: 10, minute: 0 },

  // --- Chevrolet D-Max ---
  {
    plate: 'DEM-106',
    kind: 'ia',
    daysAgo: 2,
    hour: 11,
    minute: 12,
    description: 'Luz roja con un signo de admiración dentro de un círculo y la de ABS. El pedal se siente más bajo.',
    mensajeGeneral: 'Se ven el testigo rojo de frenos y el de ABS al mismo tiempo.',
    testigos: [
      {
        telltaleId: 'sistema_frenos',
        color: 'rojo',
        confianza: 0.9,
        nota: 'Con más de 236.000 km, en esta D-Max conviene revisar también las mangueras y los cilindros de rueda.'
      },
      { telltaleId: 'abs', color: 'amarillo', confianza: 0.88 }
    ],
    chat: [
      {
        question: 'El pedal se siente más bajo, ¿qué significa?',
        answer:
          'Junto con el testigo rojo de frenos, un pedal más bajo puede indicar poco líquido de frenos, una fuga o pastillas muy gastadas. El testigo de ABS encendido a la vez indica que el antibloqueo también puede estar desactivado.'
      },
      {
        question: '¿Puedo seguir manejando hasta el taller?',
        answer:
          'No. Con una posible falla de frenos no sigas manejando, ni siquiera hasta un taller cercano. Detente en un lugar seguro, apaga el motor y llama a un taller o a una grúa para que la revisen en el sitio o la trasladen.'
      },
      {
        question: '¿Qué le digo al mecánico?',
        answer:
          'Dile que se encendieron el testigo rojo de frenos y el de ABS, que el pedal baja más de lo normal y desde cuándo lo notas. Pídele que revise el nivel de líquido, posibles fugas, las pastillas y el sensor de ABS.'
      }
    ]
  },
  { plate: 'DEM-106', kind: 'manual', telltaleId: 'combustible_bajo', daysAgo: 65, hour: 16, minute: 40 },

  // --- Renault Duster ---
  {
    plate: 'DEM-107',
    kind: 'ia',
    daysAgo: 15,
    hour: 19,
    minute: 25,
    description: 'En una curva mojada se prendieron varias luces amarillas, una de un carrito con rayas.',
    mensajeGeneral: 'Se ven tres testigos amarillos de estabilidad, ABS y presión de llantas.',
    testigos: [
      {
        telltaleId: 'control_estabilidad',
        color: 'amarillo',
        confianza: 0.83,
        nota: 'Si en la Duster el testigo solo destella en la curva y luego se apaga, el control de estabilidad estaba actuando.'
      },
      { telltaleId: 'abs', color: 'amarillo', confianza: 0.8 },
      { telltaleId: 'tpms', color: 'amarillo', confianza: 0.71 }
    ]
  },
  { plate: 'DEM-107', kind: 'manual', telltaleId: 'cinturon', daysAgo: 80, hour: 7, minute: 55 },

  // --- Nissan Frontier ---
  {
    plate: 'DEM-108',
    kind: 'ia',
    daysAgo: 20,
    hour: 13,
    minute: 50,
    description: 'El timón se puso muy duro y salió una luz de un volante con un signo de admiración.',
    mensajeGeneral: 'Se ven el testigo de dirección asistida y el del motor.',
    testigos: [
      { telltaleId: 'direccion_asistida', color: 'rojo', confianza: 0.89 },
      { telltaleId: 'check_engine', color: 'amarillo', confianza: 0.7, parpadeando: false }
    ],
    chat: [
      {
        question: 'El timón se puso muy duro, ¿por qué?',
        answer:
          'El testigo de dirección asistida indica que la asistencia falló. Sin ella el timón queda muy pesado y en una maniobra brusca puedes perder el control del vehículo.'
      },
      {
        question: '¿Puedo seguir manejando si voy despacio?',
        answer:
          'No. Sin asistencia de dirección no sigas manejando, aunque vayas despacio. Detente en un lugar seguro, apaga el motor y llama a un taller o a una grúa.'
      }
    ]
  },
  { plate: 'DEM-108', kind: 'manual', telltaleId: 'mantenimiento', daysAgo: 55, hour: 8, minute: 20 },

  // --- Toyota Corolla Cross Hybrid ---
  {
    plate: 'DEM-109',
    kind: 'ia',
    daysAgo: 4,
    hour: 6,
    minute: 35,
    description: 'Salió un aviso amarillo de batería y una llave inglesa en el tablero.',
    mensajeGeneral: 'Se ven un aviso de carga baja de la batería híbrida y el recordatorio de mantenimiento.',
    testigos: [
      {
        telltaleId: 'bateria_traccion_baja',
        color: 'amarillo',
        confianza: 0.84,
        nota: 'En el Corolla Cross Hybrid el motor a gasolina recarga la batería híbrida; el aviso suele aparecer tras muchos días sin uso.'
      },
      { telltaleId: 'mantenimiento', color: 'amarillo', confianza: 0.9 }
    ]
  },
  { plate: 'DEM-109', kind: 'manual', telltaleId: 'cinturon', daysAgo: 34, hour: 17, minute: 0 },

  // --- Renault Kwid E-Tech ---
  {
    plate: 'DEM-110',
    kind: 'ia',
    daysAgo: 6,
    hour: 21,
    minute: 10,
    description: 'Se prendió una batería amarilla y la luz del cinturón.',
    mensajeGeneral: 'Se ven el aviso de carga baja de la batería y el del cinturón.',
    testigos: [
      {
        telltaleId: 'bateria_traccion_baja',
        color: 'amarillo',
        confianza: 0.91,
        nota: 'El Kwid E-Tech tiene poca autonomía en carretera; planea la recarga en el cargador más cercano.'
      },
      { telltaleId: 'cinturon', color: 'rojo', confianza: 0.95 }
    ]
  },
  { plate: 'DEM-110', kind: 'manual', telltaleId: 'tpms', daysAgo: 45, hour: 9, minute: 45 },

  // --- BYD Dolphin ---
  {
    plate: 'DEM-111',
    kind: 'ia',
    daysAgo: 10,
    hour: 7,
    minute: 5,
    description: 'Al arrancar se quedaron encendidas la luz de ABS y la de estabilidad.',
    mensajeGeneral: 'Se ven los testigos de ABS y de control de estabilidad.',
    testigos: [
      { telltaleId: 'abs', color: 'amarillo', confianza: 0.87 },
      { telltaleId: 'control_estabilidad', color: 'amarillo', confianza: 0.82 }
    ]
  },
  { plate: 'DEM-111', kind: 'manual', telltaleId: 'mantenimiento', daysAgo: 70, hour: 14, minute: 25 },

  // --- Ford Escape Hybrid ---
  {
    plate: 'DEM-112',
    kind: 'manual',
    telltaleId: 'check_engine',
    blinking: false,
    daysAgo: 18,
    hour: 10,
    minute: 40,
    description: 'Luz amarilla del motor fija, sin parpadear.'
  },
  {
    plate: 'DEM-112',
    kind: 'ia',
    daysAgo: 85,
    hour: 16,
    minute: 15,
    description: 'Tanqueé y salió la luz de la tapa del tanque junto con la de combustible.',
    mensajeGeneral: 'Se ven el aviso de la tapa del tanque y el de combustible.',
    testigos: [
      { telltaleId: 'tapa_tanque', color: 'amarillo', confianza: 0.76 },
      { telltaleId: 'combustible_bajo', color: 'amarillo', confianza: 0.93 }
    ]
  },

  // --- Chevrolet Aveo ---
  {
    plate: 'DEM-113',
    kind: 'ia',
    daysAgo: 1,
    hour: 12,
    minute: 18,
    description:
      'En la subida se prendieron varias luces rojas a la vez: la de batería, la del aceite y la del termómetro.',
    mensajeGeneral: 'Se ven cuatro testigos encendidos; tres son rojos.',
    testigos: [
      { telltaleId: 'presion_aceite', color: 'rojo', confianza: 0.9 },
      {
        telltaleId: 'bateria_alternador',
        color: 'rojo',
        confianza: 0.85,
        nota: 'En el Aveo la misma correa mueve el alternador y otros accesorios; si se rompe, varios testigos se encienden juntos.'
      },
      { telltaleId: 'temperatura_motor', color: 'rojo', confianza: 0.8 },
      { telltaleId: 'check_engine', color: 'amarillo', confianza: 0.78, parpadeando: false }
    ],
    chat: [
      {
        question: '¿Por qué está en rojo?',
        answer:
          'Hay cuatro testigos y tres son rojos: presión de aceite, batería y temperatura. Que se enciendan juntos puede indicar, por ejemplo, que se rompió la correa de accesorios, que mueve el alternador y en muchos motores también la bomba de agua. Un mecánico debe confirmarlo.'
      },
      {
        question: '¿Qué hago ahora?',
        answer:
          'Detente en un lugar seguro, apaga el motor y llama a un taller o a una grúa. No intentes encenderlo de nuevo para probar ni abras la tapa del radiador con el motor caliente.'
      }
    ]
  },
  {
    plate: 'DEM-113',
    kind: 'manual',
    telltaleId: 'sistema_frenos',
    daysAgo: 45,
    hour: 8,
    minute: 50,
    description: 'Luz roja de frenos con el freno de mano ya abajo.'
  },

  // --- Hyundai Atos ---
  {
    plate: 'DEM-114',
    kind: 'manual',
    telltaleId: 'check_engine',
    blinking: false,
    daysAgo: 25,
    hour: 15,
    minute: 5,
    description: 'Se prendió la luz del motor después de cambiar de gasolina a gas.'
  },
  { plate: 'DEM-114', kind: 'manual', telltaleId: 'combustible_bajo', daysAgo: 60, hour: 19, minute: 30 },

  // --- Yamaha FZ 2.0 (moto) ---
  {
    plate: 'DEM-20M',
    kind: 'ia',
    daysAgo: 8,
    hour: 18,
    minute: 0,
    blinking: true,
    description: 'La luz del motor de la moto titila cuando acelero.',
    mensajeGeneral: 'Se ve el testigo del motor parpadeando.',
    testigos: [
      {
        telltaleId: 'check_engine',
        color: 'amarillo',
        confianza: 0.8,
        parpadeando: true,
        nota: 'En la FZ 2.0 con inyección, un parpadeo suele indicar una falla de encendido o de inyección.'
      }
    ],
    chat: [
      {
        question: '¿Puedo seguir en la moto hasta la casa?',
        answer:
          'No. Con el testigo del motor parpadeando no sigas en la moto. Oríllate en un lugar seguro, apaga el motor y llama a un taller o a una grúa para motos.'
      },
      {
        question: '¿Qué le digo al mecánico?',
        answer:
          'Cuéntale que la luz del motor titila al acelerar, desde cuándo pasa y si la moto pierde fuerza o se apaga. Pídele que lea los códigos de falla y revise la bujía, la inyección y el combustible.'
      }
    ]
  },
  { plate: 'DEM-20M', kind: 'manual', telltaleId: 'combustible_bajo', daysAgo: 52, hour: 13, minute: 10 }
];
