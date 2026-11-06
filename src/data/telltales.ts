/**
 * Catálogo de testigos del tablero, para elegirlos a mano: cuando la IA está apagada, falla o el usuario lo prefiere.
 * Las respuestas con IA no salen de aquí: las redacta el modelo y las limita el piso de seguridad del servidor.
 *
 * PENDIENTE ANTES DE LA ENTREGA: este contenido debe ser revisado por una persona con conocimiento mecánico.
 * Es orientación general redactada sin datos del fabricante; los símbolos y el comportamiento cambian entre marcas.
 *
 * Reglas al editarlo (las verifica test/telltales.test.ts):
 * - Los id son estables: el historial guarda el id, así que no se renombran.
 * - neverDrive=true implica severidad 'rojo'. Un rojo sin neverDrive (airbag) exige atención hoy, pero no ordena detenerse.
 * - puedesRevisar solo admite comprobaciones seguras que un conductor hace sin herramientas.
 * - Sin cifras inventadas: las presiones y los niveles se remiten al manual o a la etiqueta del vehículo.
 */

export type TelltaleSeverity = 'rojo' | 'amarillo' | 'informativo';
export type TelltalePowertrain = 'gasolina' | 'diesel' | 'hibrido' | 'electrico';

export interface Telltale {
  id: string;
  nombre: string;
  alias: string[];
  descripcionSimbolo: string;
  severidad: TelltaleSeverity;
  /** true si nunca se debe decir que puede seguir manejando. */
  neverDrive: boolean;
  /** Si existe, un parpadeo confirmado se trata como rojo, sin cambiar la severidad base. */
  siParpadea?: { cuandoIrAlMecanico: string };
  significado: string;
  /** De la más común a la menos común. */
  causasProbables: string[];
  puedesRevisar: string[];
  noHagas: string[];
  /** Con el motivo concreto y qué puede pasar si se ignora. */
  cuandoIrAlMecanico: string;
  aplicaA: TelltalePowertrain[];
}

const TODOS: TelltalePowertrain[] = ['gasolina', 'diesel', 'hibrido', 'electrico'];
const CON_MOTOR: TelltalePowertrain[] = ['gasolina', 'diesel', 'hibrido'];

export const TELLTALES: readonly Telltale[] = [
  // --- Rojos: nunca se debe decir que puede seguir manejando ---
  {
    id: 'presion_aceite',
    nombre: 'Presión de aceite',
    alias: ['aceitera', 'lámpara de aceite', 'lámpara de Aladino', 'genio', 'luz del aceite'],
    descripcionSimbolo: 'Aceitera roja, como una lámpara antigua, con una gota en la punta.',
    severidad: 'rojo',
    neverDrive: true,
    significado: 'El aceite no está llegando al motor con la presión necesaria. Sin esa presión, las piezas internas rozan entre sí.',
    causasProbables: ['Nivel de aceite muy bajo', 'Fuga de aceite', 'Bomba de aceite con falla', 'Sensor de presión dañado'],
    puedesRevisar: [
      'Con el motor apagado y en terreno plano, espera unos minutos y mira el nivel en la varilla.',
      'Mira debajo del vehículo si hay un charco o goteo de aceite.'
    ],
    noHagas: ['No sigas manejando para "llegar al taller".', 'No vuelvas a encender el motor para ver si se apaga el testigo.', 'No des por hecho que es el sensor.'],
    cuandoIrAlMecanico: 'De inmediato y con grúa, incluso si el nivel de aceite parece bien: solo un taller puede medir la presión real. Si se ignora, el motor puede fundirse en poco tiempo, y esa es una de las averías más costosas.',
    aplicaA: CON_MOTOR
  },
  {
    id: 'temperatura_motor',
    nombre: 'Temperatura del motor',
    alias: ['termómetro', 'recalentamiento', 'motor caliente', 'temperatura'],
    descripcionSimbolo: 'Termómetro rojo sumergido en líneas onduladas que representan líquido.',
    severidad: 'rojo',
    neverDrive: true,
    significado: 'El motor está más caliente de lo que debe. El sistema de refrigeración no está logrando enfriarlo.',
    causasProbables: ['Falta de refrigerante por una fuga', 'Ventilador del radiador que no funciona', 'Termostato trabado', 'Bomba de agua o correa con falla'],
    puedesRevisar: [
      'Cuando el motor esté completamente frío, mira el nivel en el depósito de refrigerante sin abrir la tapa.',
      'Mira si hay vapor o charcos de líquido debajo del vehículo.'
    ],
    noHagas: ['No abras la tapa del radiador ni la del depósito con el motor caliente: el líquido a presión puede quemarte.', 'No sigas manejando.', 'No eches agua fría sobre el motor caliente.'],
    cuandoIrAlMecanico: 'De inmediato y con grúa: hay que encontrar por qué se calentó, aunque el testigo se apague al enfriarse. Si se ignora, se puede dañar el empaque de culata o deformar el motor.',
    aplicaA: CON_MOTOR
  },
  {
    id: 'sistema_frenos',
    nombre: 'Sistema de frenos',
    alias: ['freno', 'admiración en círculo', 'signo de exclamación', 'BRAKE'],
    descripcionSimbolo: 'Signo de exclamación rojo dentro de un círculo con paréntesis a los lados, o la palabra BRAKE.',
    severidad: 'rojo',
    neverDrive: true,
    significado: 'Hay un problema en el sistema de frenos, como poco líquido o pérdida de presión. Frenar puede tomar más distancia o dejar de funcionar bien.',
    causasProbables: ['Nivel bajo de líquido de frenos', 'Fuga en el circuito de frenos', 'Pastillas muy desgastadas', 'Falla en un sensor o en el circuito hidráulico'],
    puedesRevisar: [
      'Confirma que el freno de mano esté totalmente abajo o liberado.',
      'Con el motor apagado, mira el nivel del depósito de líquido de frenos sin abrirlo.',
      'Mira si hay líquido cerca de las ruedas o debajo del vehículo.'
    ],
    noHagas: ['No sigas manejando si el freno de mano ya está liberado.', 'No rellenes el líquido y sigas como si nada: si bajó, puede haber una fuga.'],
    cuandoIrAlMecanico: 'De inmediato y con grúa si sigue encendido con el freno de mano liberado: es la pieza de seguridad más importante del vehículo. Si se ignora, puedes quedarte sin capacidad de frenar y causar un choque.',
    aplicaA: TODOS
  },
  {
    id: 'airbag',
    nombre: 'Airbag',
    alias: ['bolsa de aire', 'SRS', 'muñeco con bola', 'pretensores'],
    descripcionSimbolo: 'Persona sentada de perfil con un círculo grande delante del pecho, o las letras SRS o AIRBAG.',
    severidad: 'rojo',
    neverDrive: false,
    significado: 'El sistema de bolsas de aire detectó una falla. En un choque las bolsas o los pretensores de los cinturones podrían no activarse, o activarse cuando no deben.',
    causasProbables: ['Conector suelto debajo de un asiento', 'Falla en un sensor o en el módulo del sistema', 'Pretensor del cinturón con falla', 'Choque anterior mal reparado'],
    puedesRevisar: ['Confirma si hubo un golpe o una reparación reciente, para contárselo al taller.', 'Mira que nada esté aplastando los cables debajo de los asientos, sin desconectarlos.', 'Comprueba que todos los cinturones abrochen y se ajusten bien.'],
    noHagas: ['No desconectes ni manipules conectores amarillos: el sistema puede activarse.', 'No dependas de esa protección: en un choque las bolsas y los pretensores pueden no activarse.', 'No dejes la revisión para después ni hagas viajes largos antes de hacerla.'],
    cuandoIrAlMecanico: 'Hoy mismo, para revisarlo con un escáner especializado: el vehículo puede moverse, pero las bolsas y los pretensores pueden no activarse en un choque. Si se ignora, puedes quedar sin esa protección justo cuando la necesites.',
    aplicaA: TODOS
  },
  {
    id: 'direccion_asistida',
    nombre: 'Dirección asistida',
    alias: ['timón', 'volante con admiración', 'dirección hidráulica', 'EPS'],
    descripcionSimbolo: 'Volante con un signo de exclamación al lado, o las letras EPS.',
    severidad: 'rojo',
    neverDrive: true,
    significado: 'La asistencia de la dirección falló o puede fallar. El volante se puede poner muy duro de un momento a otro.',
    causasProbables: ['Falla en el sistema eléctrico de la dirección', 'Falta de líquido hidráulico por una fuga', 'Correa o bomba de dirección con falla', 'Voltaje bajo por un problema de batería'],
    puedesRevisar: ['Con el motor apagado, si tu vehículo tiene depósito de líquido hidráulico, mira su nivel sin abrirlo.', 'Mira si hay goteo debajo de la parte delantera.'],
    noHagas: ['No sigas manejando.', 'No gires el volante con fuerza hasta su tope para "probarlo".'],
    cuandoIrAlMecanico: 'De inmediato y con grúa: hay que revisar la dirección antes de volver a circular. Si se ignora, puedes perder control en una curva o en una maniobra de emergencia.',
    aplicaA: TODOS
  },
  {
    id: 'bateria_alternador',
    nombre: 'Batería y alternador',
    alias: ['batería', 'alternador', 'sistema de carga', 'pila'],
    descripcionSimbolo: 'Rectángulo rojo con un signo + y un signo −, como una batería.',
    severidad: 'rojo',
    neverDrive: true,
    significado: 'El sistema eléctrico no está cargando la batería. El vehículo está gastando lo que le queda y se puede apagar sin aviso.',
    causasProbables: ['Alternador con falla', 'Correa de accesorios rota o floja', 'Bornes de la batería sueltos o sulfatados', 'Batería al final de su vida útil'],
    puedesRevisar: ['Con el motor apagado, mira si los bornes de la batería están sueltos o tienen polvo blanco o verde.', 'Con el motor apagado, mira si la correa visible está rota.'],
    noHagas: ['No sigas manejando: en algunos motores esa correa también mueve la bomba de agua, y el motor podría recalentarse.', 'No desconectes la batería con el motor encendido.'],
    cuandoIrAlMecanico: 'Llama a un taller o a una grúa ahora: hay que medir la carga y revisar la correa. Si se ignora, el vehículo puede apagarse en plena vía, perdiendo asistencias de dirección y frenos.',
    aplicaA: CON_MOTOR
  },
  {
    id: 'transmision',
    nombre: 'Transmisión o caja',
    alias: ['caja', 'caja automática', 'AT', 'engranaje', 'temperatura de la caja'],
    descripcionSimbolo: 'Engranaje con un signo de exclamación o un termómetro, o las letras AT u OIL en la zona de la palanca.',
    severidad: 'rojo',
    neverDrive: true,
    significado: 'La caja de cambios detectó una falla o se está calentando. Puede dejar de hacer los cambios o entrar a un modo de emergencia.',
    causasProbables: ['Temperatura alta del aceite de la caja', 'Nivel bajo de aceite de la caja por una fuga', 'Falla de un sensor o del control electrónico', 'Desgaste interno'],
    puedesRevisar: ['Detente, deja la palanca en P (o con el freno de mano si es manual) y observa si el testigo se apaga tras un rato con el motor apagado.', 'Mira si hay goteo rojizo o marrón debajo del vehículo.'],
    noHagas: ['No sigas manejando, aunque el vehículo todavía avance.', 'No fuerces los cambios ni aceleres para "sacarlo".'],
    cuandoIrAlMecanico: 'Llama a un taller o a una grúa: la caja necesita escáner y revisión del aceite. Si se ignora, un problema reparable se puede convertir en el cambio completo de la caja.',
    aplicaA: CON_MOTOR
  },
  {
    id: 'sistema_hibrido_electrico',
    nombre: 'Sistema de carga de híbrido o eléctrico',
    alias: ['alta tensión', 'carro con admiración', 'sistema híbrido', 'batería de tracción', 'EV'],
    descripcionSimbolo: 'Silueta de carro con un signo de exclamación, o un rayo con el texto de revisar sistema híbrido o eléctrico.',
    severidad: 'rojo',
    neverDrive: true,
    significado: 'El sistema de alta tensión que mueve el vehículo tiene una falla. El vehículo puede perder potencia o apagarse.',
    causasProbables: ['Falla en la batería de tracción o en su refrigeración', 'Falla del inversor o del cargador', 'Falla en un sensor del sistema de alta tensión'],
    puedesRevisar: ['Mira en la pantalla del tablero si hay un mensaje adicional y toma nota para el taller.', 'Mira si hay humo, olor a quemado o ruidos, y aléjate del vehículo si los notas.'],
    noHagas: ['No toques cables ni conectores naranja: son de alta tensión.', 'No sigas manejando.', 'No intentes cargarlo hasta que lo revisen.'],
    cuandoIrAlMecanico: 'Llama a un taller con experiencia en híbridos o eléctricos, o a una grúa: solo personal capacitado debe intervenir la alta tensión. Si se ignora, el vehículo puede apagarse en la vía y la batería puede sufrir daños.',
    aplicaA: ['hibrido', 'electrico']
  },

  // --- Amarillos: requieren revisión pronto ---
  {
    id: 'check_engine',
    nombre: 'Check engine',
    alias: ['motor', 'motorcito', 'luz del motor', 'chequeo', 'MIL', 'CHECK'],
    descripcionSimbolo: 'Silueta de un motor en amarillo o ámbar, a veces con la palabra CHECK.',
    severidad: 'amarillo',
    neverDrive: false,
    siParpadea: {
      cuandoIrAlMecanico: 'De inmediato: detente en un lugar seguro y llama a un taller, porque un testigo que parpadea indica que el motor está fallando en la combustión. Si se ignora, se puede dañar el catalizador y aumentar el costo de la reparación.'
    },
    significado: 'La computadora del motor registró una falla relacionada con el motor o con las emisiones. Puede ser algo menor o algo serio.',
    causasProbables: ['Tapa del tanque floja', 'Sensor de oxígeno o de aire con falla', 'Bujías o bobinas en mal estado', 'Falla en el catalizador'],
    puedesRevisar: ['Revisa que la tapa del tanque esté bien cerrada.', 'Observa si el motor tiembla, pierde fuerza o gasta más combustible, y si el testigo está fijo o parpadeando.'],
    noHagas: ['Si parpadea, no sigas acelerando: detente en un lugar seguro.', 'No borres el código sin saber qué lo causó.', 'No lo ignores durante semanas.'],
    cuandoIrAlMecanico: 'En los próximos días, para leer el código con un escáner. Si parpadea o el motor tiembla, detente en un lugar seguro y llama a un taller: el motor está fallando en la combustión. Si se ignora, se puede dañar el catalizador y aumentar el costo de la reparación.',
    aplicaA: CON_MOTOR
  },
  {
    id: 'nivel_aceite_bajo',
    nombre: 'Nivel de aceite bajo',
    alias: ['aceitera amarilla', 'falta aceite', 'OIL LEVEL'],
    descripcionSimbolo: 'Aceitera amarilla, a veces con una línea ondulada debajo o el texto OIL LEVEL.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El sensor detecta que el nivel de aceite está por debajo de lo recomendado, aunque todavía no haya un problema de presión.',
    causasProbables: ['Consumo normal de aceite entre cambios', 'Pequeña fuga', 'Mantenimiento de aceite atrasado'],
    puedesRevisar: ['Con el motor apagado y en terreno plano, revisa el nivel con la varilla.', 'Busca en el manual o en la tapa el tipo de aceite que usa tu vehículo.', 'Mira si hay manchas de aceite donde parqueas.'],
    noHagas: ['No uses un aceite distinto al indicado en el manual.', 'No llenes por encima de la marca máxima.', 'Si aparece el testigo rojo de la aceitera, no sigas manejando.'],
    cuandoIrAlMecanico: 'Pronto, si el nivel baja seguido o ves manchas: puede haber una fuga o un consumo anormal. Si se ignora, el nivel puede caer hasta perder la presión de aceite y dañar el motor.',
    aplicaA: CON_MOTOR
  },
  {
    id: 'abs',
    nombre: 'ABS',
    alias: ['frenos antibloqueo', 'antibloqueo'],
    descripcionSimbolo: 'Las letras ABS en amarillo dentro de un círculo.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El sistema antibloqueo está desactivado por una falla. Los frenos normales suelen seguir funcionando, pero las ruedas se pueden bloquear en una frenada fuerte.',
    causasProbables: ['Sensor de rueda sucio o dañado', 'Cable de un sensor roto', 'Falla en el módulo de ABS', 'Voltaje bajo de la batería'],
    puedesRevisar: ['Si también está encendido el testigo rojo de frenos, trátalo como una falla de frenos y detente.', 'Comprueba que el pedal de freno se sienta como siempre.'],
    noHagas: ['No frenes tarde ni con fuerza confiando en el ABS.', 'No lo dejes para después si llueve o viajas por carretera.'],
    cuandoIrAlMecanico: 'En los próximos días, para leer el código del sensor o del módulo. Si se ignora, en una frenada de emergencia o sobre piso mojado puedes patinar y perder el control de la dirección.',
    aplicaA: TODOS
  },
  {
    id: 'pastillas_freno',
    nombre: 'Pastillas de freno gastadas',
    alias: ['pastillas', 'bandas', 'círculo con líneas punteadas'],
    descripcionSimbolo: 'Círculo amarillo con líneas punteadas o paréntesis punteados a los lados.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El sensor indica que las pastillas de freno llegaron a su límite de desgaste y hay que cambiarlas.',
    causasProbables: ['Desgaste normal de las pastillas', 'Sensor de desgaste dañado', 'Frenos que se quedan pegados'],
    puedesRevisar: ['Pon atención a chillidos o raspones al frenar.', 'Si se ve por entre el rin, mira el grosor de la pastilla sin tocar el disco: puede estar caliente.'],
    noHagas: ['No lo aplaces hasta que suene a metal contra metal.', 'No hagas viajes largos ni bajadas prolongadas antes de cambiarlas.'],
    cuandoIrAlMecanico: 'Lo antes posible, para medirlas y cambiarlas. Si el freno se siente distinto, detente y llama a un taller. Si se ignora, se daña el disco, la reparación sale más cara y aumenta la distancia de frenado.',
    aplicaA: TODOS
  },
  {
    id: 'freno_mano',
    nombre: 'Freno de mano puesto',
    alias: ['freno de parqueo', 'freno de estacionamiento', 'P en círculo', 'PARK'],
    descripcionSimbolo: 'Letra P dentro de un círculo con paréntesis, a veces el mismo signo de exclamación del sistema de frenos.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El freno de mano está aplicado. Es normal con el vehículo parqueado, y se debe apagar al liberarlo por completo.',
    causasProbables: ['Freno de mano aplicado o sin liberar del todo', 'Interruptor del freno de mano desajustado', 'Si sigue encendido al liberarlo, nivel bajo de líquido de frenos'],
    puedesRevisar: ['Libera por completo la palanca o el botón y mira si el testigo se apaga.', 'Si sigue encendido, detente y mira el depósito de líquido de frenos sin abrirlo.'],
    noHagas: ['No arranques con el freno de mano puesto.', 'Si el testigo no se apaga al liberarlo, no sigas manejando: trátalo como una falla del sistema de frenos.'],
    cuandoIrAlMecanico: 'Si sigue encendido con el freno liberado, llama a un taller o a una grúa: puede ser una falla real de frenos. Si se ignora y manejas con el freno puesto, los frenos traseros se recalientan y se desgastan.',
    aplicaA: TODOS
  },
  {
    id: 'freno_electrico_falla',
    nombre: 'Falla del freno de mano eléctrico',
    alias: ['EPB', 'freno electrónico', 'P con llave'],
    descripcionSimbolo: 'Letra P en un círculo acompañada de una llave de mecánico o de un signo de exclamación, o las letras EPB.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El freno de mano eléctrico tiene una falla. Puede no aplicarse o no liberarse cuando se lo pidas.',
    causasProbables: ['Voltaje bajo de la batería', 'Falla en un motor del freno trasero', 'Interruptor o módulo con falla'],
    puedesRevisar: ['Parquea en terreno plano y usa una marcha o la posición P, porque el freno podría no sostener el vehículo.', 'Comprueba si el testigo apareció junto con el de batería.'],
    noHagas: ['No dejes el vehículo en una pendiente confiando en ese freno.', 'No intentes liberarlo a la fuerza.'],
    cuandoIrAlMecanico: 'En los próximos días y evitando pendientes: necesita un escáner. Si se ignora, el vehículo se puede mover estando parqueado o quedar con el freno trabado.',
    aplicaA: TODOS
  },
  {
    id: 'tpms',
    nombre: 'Presión de llantas (TPMS)',
    alias: ['herradura', 'llanta con admiración', 'presión de llantas', 'TPMS'],
    descripcionSimbolo: 'Silueta de una llanta vista de frente, parecida a una herradura, con un signo de exclamación en el centro.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'Una o más llantas tienen una presión distinta a la esperada, o el sistema que las vigila tiene una falla.',
    causasProbables: ['Llanta con poca presión o pinchada', 'Cambio de clima', 'Sensor de presión sin batería o dañado', 'Llantas cambiadas sin reiniciar el sistema'],
    puedesRevisar: ['Mira las cuatro llantas buscando alguna visiblemente baja, un clavo o un corte.', 'Mide la presión en frío y compárala con la etiqueta del marco de la puerta o con el manual.'],
    noHagas: ['No sigas rodando sobre una llanta visiblemente desinflada.', 'No infles a ojo ni por encima de lo indicado.'],
    cuandoIrAlMecanico: 'A una montallantas o a un taller hoy mismo si una llanta pierde aire o si el testigo sigue tras corregir la presión. Si se ignora, la llanta se puede destruir o estallar y el vehículo pierde estabilidad.',
    aplicaA: TODOS
  },
  {
    id: 'control_estabilidad',
    nombre: 'Control de estabilidad o tracción',
    alias: ['ESP', 'ESC', 'TCS', 'VSC', 'carro derrapando', 'patinando'],
    descripcionSimbolo: 'Silueta de carro con dos líneas curvas detrás, como si derrapara. A veces las letras ESP, ESC o TCS.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'Si parpadea un momento, el sistema está actuando porque una rueda patina. Si se queda fijo, el sistema está inactivo por una falla.',
    causasProbables: ['El sistema actuando sobre piso resbaloso (parpadeo)', 'Sensor de una rueda con falla', 'Falla relacionada con el ABS o con el check engine', 'Sensor de ángulo de la dirección con falla'],
    puedesRevisar: ['Observa si parpadea solo al perder agarre o si queda fijo.', 'Mira si hay un botón de apagado del sistema activado por error.', 'Comprueba si también está encendido el ABS o el check engine.'],
    noHagas: ['No manejes rápido en lluvia o curvas con el testigo fijo.', 'No aceleres a fondo sobre piso resbaloso mientras parpadea.'],
    cuandoIrAlMecanico: 'En los próximos días si queda fijo, para leer el código. Si se ignora, el vehículo no corregirá un derrape y puedes perder el control sobre piso mojado o en una curva.',
    aplicaA: TODOS
  },
  {
    id: 'nivel_refrigerante',
    nombre: 'Nivel de refrigerante',
    alias: ['agua del radiador', 'depósito de agua', 'coolant', 'anticongelante'],
    descripcionSimbolo: 'Rectángulo con ondas o un termómetro y una línea de nivel, normalmente en amarillo.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El nivel de líquido refrigerante está bajo. Si sigue bajando, el motor se puede recalentar.',
    causasProbables: ['Evaporación o consumo lento', 'Fuga en una manguera o en el radiador', 'Tapa del depósito en mal estado', 'Falla del empaque de culata'],
    puedesRevisar: ['Con el motor completamente frío, mira el depósito y compáralo con las marcas de mínimo y máximo.', 'Mira si hay manchas de líquido debajo del vehículo.'],
    noHagas: ['No abras la tapa con el motor caliente: puede quemarte.', 'Si aparece el termómetro rojo, no sigas manejando.', 'No rellenes con un líquido distinto al indicado en el manual sin consultarlo.'],
    cuandoIrAlMecanico: 'Hoy o mañana, y sin viajes largos: si el nivel bajó, hay que encontrar la fuga. Si se ignora, el motor se puede recalentar y dañar el empaque de culata.',
    aplicaA: CON_MOTOR
  },
  {
    id: 'tapa_tanque',
    nombre: 'Tapa del tanque',
    alias: ['tapa de la gasolina', 'CHECK FUEL CAP', 'tapa suelta'],
    descripcionSimbolo: 'Surtidor de combustible con una tapa abierta al lado, o el texto CHECK FUEL CAP.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'La tapa del tanque está suelta, mal cerrada o el sistema detectó una pérdida de vapores de combustible.',
    causasProbables: ['Tapa floja después de tanquear', 'Empaque de la tapa dañado', 'Pequeña fuga en el sistema de vapores'],
    puedesRevisar: ['Retira la tapa, mira si el empaque está roto o sucio y ciérrala hasta que haga clic.', 'Observa si el testigo se apaga después de unos recorridos.'],
    noHagas: ['No manipules la tapa con el motor encendido ni cerca de chispas o cigarrillos.', 'No dejes el vehículo sin tapa.'],
    cuandoIrAlMecanico: 'Si sigue encendido varios recorridos después de cerrarla bien, para revisar la tapa o el sistema de vapores. Si se ignora, pierdes combustible por evaporación y puede activarse el check engine.',
    aplicaA: CON_MOTOR
  },
  {
    id: 'puerta_capo_baul',
    nombre: 'Puerta, capó o baúl abierto',
    alias: ['puerta abierta', 'capó abierto', 'baúl abierto', 'carro con puertas abiertas'],
    descripcionSimbolo: 'Silueta de carro vista desde arriba o de lado, con una puerta, el capó o el baúl abierto.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El vehículo detecta que una puerta, el capó o el baúl no está bien cerrado.',
    causasProbables: ['Puerta, capó o baúl mal cerrado', 'Sensor o interruptor de la chapa sucio o dañado'],
    puedesRevisar: ['Detente en un lugar seguro y abre y cierra con firmeza cada puerta, el baúl y el capó.', 'Mira si hay algo atrapado en el cierre, como un cinturón o una tela.'],
    noHagas: ['No sigas en movimiento si no sabes cuál está abierto: un capó o una puerta se pueden abrir del todo.', 'No lleves niños sin confirmar que las puertas cerraron.'],
    cuandoIrAlMecanico: 'Si sigue encendido con todo bien cerrado, para revisar el interruptor de la chapa. Si se ignora, se oculta un aviso real: una puerta o el capó se pueden abrir en marcha.',
    aplicaA: TODOS
  },
  {
    id: 'filtro_particulas',
    nombre: 'Filtro de partículas (diésel)',
    alias: ['DPF', 'FAP', 'filtro diésel', 'regeneración'],
    descripcionSimbolo: 'Rectángulo con puntos en su interior, como un filtro visto de frente, o las letras DPF.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El filtro que retiene el hollín del escape se está llenando y necesita limpiarse (regenerarse).',
    causasProbables: ['Muchos recorridos cortos o a baja velocidad', 'Regeneración interrumpida varias veces', 'Sensor o inyección con falla', 'Aceite o combustible distinto al indicado'],
    puedesRevisar: ['Consulta en el manual cómo se hace la regeneración en tu vehículo.', 'Observa si también se encendió el check engine o si el motor perdió fuerza.'],
    noHagas: ['No apagues el motor repetidamente durante una regeneración.', 'No parquees sobre pasto seco justo después de una regeneración: el escape queda muy caliente.', 'No retires ni anules el filtro.'],
    cuandoIrAlMecanico: 'Pronto si no se apaga tras seguir las indicaciones del manual o si el motor pierde fuerza. Si se ignora, el filtro se tapa, el motor entra a potencia reducida y la limpieza o el cambio salen mucho más caros.',
    aplicaA: ['diesel']
  },
  {
    id: 'agua_filtro_diesel',
    nombre: 'Agua en el filtro de combustible (diésel)',
    alias: ['agua en el combustible', 'gota en filtro', 'trampa de agua'],
    descripcionSimbolo: 'Gota de agua sobre líneas onduladas o dentro de la silueta de un filtro.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El filtro de combustible acumuló agua y hay que drenarlo. El agua puede dañar la inyección diésel.',
    causasProbables: ['Combustible con agua', 'Condensación en el tanque', 'Filtro de combustible con mantenimiento atrasado'],
    puedesRevisar: ['Recuerda dónde tanqueaste por última vez, para contárselo al taller.', 'Observa si el motor pierde fuerza o tiembla.'],
    noHagas: ['No sigas haciendo recorridos largos sin drenarlo.', 'No sigas usando la misma estación si sospechas de ese combustible.'],
    cuandoIrAlMecanico: 'Hoy o mañana, para drenar o cambiar el filtro. Si se ignora, el agua puede dañar la bomba y los inyectores, que son piezas costosas.',
    aplicaA: ['diesel']
  },
  {
    id: 'adblue',
    nombre: 'Nivel de AdBlue (diésel)',
    alias: ['urea', 'DEF', 'SCR'],
    descripcionSimbolo: 'Depósito o gota con líneas de salpicadura, o las palabras AdBlue, DEF o UREA.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'Queda poco líquido de tratamiento de emisiones (AdBlue) o el sistema tiene una falla. Algunos vehículos limitan su uso si se acaba.',
    causasProbables: ['Consumo normal del AdBlue', 'Sensor de nivel con falla', 'Falla en el sistema de inyección de AdBlue'],
    puedesRevisar: ['Confirma en el manual si tu vehículo usa AdBlue y dónde está su tapa.', 'Mira en la pantalla del tablero si indica cuánto recorrido queda.'],
    noHagas: ['No lo eches en el tanque de diésel.', 'No lo reemplaces con agua u otros líquidos.', 'No esperes a que se acabe del todo.'],
    cuandoIrAlMecanico: 'Si sigue encendido después de rellenarlo, para leer el código. Si se ignora, el vehículo puede reducir su potencia o negarse a arrancar.',
    aplicaA: ['diesel']
  },
  {
    id: 'inmovilizador_llave',
    nombre: 'Inmovilizador o llave',
    alias: ['llave', 'carro con candado', 'inmovilizador', 'antirrobo', 'llave no detectada'],
    descripcionSimbolo: 'Llave dentro de la silueta de un carro, o un candado, a veces parpadeando.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El vehículo no está reconociendo la llave o el sistema antirrobo tiene una falla. Si parpadea con el vehículo apagado y cerrado suele ser normal.',
    causasProbables: ['Batería de la llave agotada', 'Parpadeo normal del antirrobo con el vehículo cerrado', 'Llave dañada o no programada', 'Falla en la antena o en el módulo del inmovilizador'],
    puedesRevisar: ['Prueba con la llave de repuesto.', 'Cambia la batería del control de la llave, siguiendo el manual.', 'Aleja otras llaves, tarjetas o celulares de la zona de arranque.'],
    noHagas: ['No apagues el motor en la vía si el testigo apareció andando: podría no volver a arrancar.', 'No intentes puentear el sistema.'],
    cuandoIrAlMecanico: 'Si tampoco arranca con la otra llave o el testigo sigue encendido con el motor andando, llama a un taller especializado o a un cerrajero automotriz. Si se ignora, el vehículo puede dejar de arrancar en cualquier momento.',
    aplicaA: TODOS
  },
  {
    id: 'potencia_reducida',
    nombre: 'Potencia reducida',
    alias: ['tortuga', 'modo seguro', 'modo de emergencia', 'limp mode'],
    descripcionSimbolo: 'Tortuga, o un signo de exclamación con el texto de potencia reducida.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El vehículo limitó su potencia para protegerse de una falla, o en un eléctrico porque queda poca batería o está muy caliente.',
    causasProbables: ['Falla del motor o del acelerador electrónico', 'Filtro de partículas tapado', 'Batería de tracción baja o a temperatura alta', 'Falla de un sensor'],
    puedesRevisar: ['Observa qué otros testigos están encendidos, para contárselo al taller.', 'En un eléctrico, mira el nivel de carga.'],
    noHagas: ['No hagas adelantamientos ni entres a vías rápidas con poca potencia.', 'No apagues y enciendas repetidamente para intentar borrarlo.'],
    cuandoIrAlMecanico: 'Hoy mismo, por el camino más corto y seguro, y con grúa si pierde fuerza para circular con tráfico. Si se ignora, la falla que lo causó puede dañar otras piezas y dejarte varado.',
    aplicaA: TODOS
  },
  {
    id: 'luz_exterior_fundida',
    nombre: 'Luz exterior con falla',
    alias: ['bombillo fundido', 'bombillo con admiración', 'luz quemada'],
    descripcionSimbolo: 'Bombillo con un signo de exclamación o una cruz en su interior.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El vehículo detecta que una luz exterior no funciona, como un farol, una luz de freno o una direccional.',
    causasProbables: ['Bombillo fundido', 'Fusible quemado', 'Conector flojo o sulfatado'],
    puedesRevisar: ['Camina alrededor del vehículo con las luces encendidas, y pide a alguien que mire las de freno.', 'Con el vehículo apagado, mira el fusible correspondiente en la caja indicada en el manual.'],
    noHagas: ['No manejes de noche o con lluvia sin confirmar que tienes luces delanteras y de freno.', 'No pongas un fusible de mayor valor al indicado.'],
    cuandoIrAlMecanico: 'En los próximos días si cambiar el bombillo o el fusible no lo arregla. Si se ignora, otros conductores no te verán o no sabrán que estás frenando, y te pueden chocar.',
    aplicaA: TODOS
  },
  {
    id: 'frenado_emergencia_falla',
    nombre: 'Frenado de emergencia desactivado',
    alias: ['precolisión', 'AEB', 'FCW', 'autos chocando', 'asistente de frenado'],
    descripcionSimbolo: 'Dos carros muy juntos con una estrella o un signo de exclamación, o las letras AEB o FCW.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El sistema que avisa o frena ante un posible choque no está disponible, por una falla o porque el sensor no ve bien.',
    causasProbables: ['Sensor o cámara sucios, con barro o lluvia fuerte', 'Sistema apagado desde el menú', 'Golpe que desalineó el sensor', 'Falla del sensor o del módulo'],
    puedesRevisar: ['Limpia con un paño suave la zona del parabrisas frente a la cámara y el emblema o la rejilla donde va el radar.', 'Revisa en el menú del vehículo si el sistema quedó apagado.'],
    noHagas: ['No confíes en que el vehículo frenará por ti.', 'No pegues adhesivos ni accesorios frente a la cámara o el radar.'],
    cuandoIrAlMecanico: 'En los próximos días si sigue encendido tras limpiar: puede necesitar calibración. Si se ignora, pierdes esa protección justamente cuando ocurra un descuido.',
    aplicaA: TODOS
  },
  {
    id: 'bateria_traccion_baja',
    nombre: 'Carga baja de la batería de tracción',
    alias: ['batería baja eléctrico', 'poca carga', 'enchufe', 'autonomía baja'],
    descripcionSimbolo: 'Batería con poca carga, o un enchufe en amarillo.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'Queda poca carga en la batería que mueve el vehículo. Si se agota, el vehículo se detiene.',
    causasProbables: ['Uso normal sin haber recargado', 'Trayecto más largo de lo previsto', 'Autonomía reducida por aire acondicionado, carga o velocidad'],
    puedesRevisar: ['Mira la autonomía que indica el tablero y ubica el punto de carga más cercano.', 'Apaga el aire acondicionado y baja la velocidad para rendir la carga.'],
    noHagas: ['No sigas hacia un destino que no alcanzas.', 'No dejes que llegue a cero en plena vía.'],
    cuandoIrAlMecanico: 'Si la autonomía cae mucho más rápido de lo normal o el vehículo no carga, para revisar la batería y el cargador. Si se ignora, te puedes quedar sin energía en un lugar inseguro y necesitar una grúa.',
    aplicaA: ['hibrido', 'electrico']
  },

  {
    id: 'epc',
    nombre: 'Control electrónico de potencia (EPC)',
    alias: ['EPC', 'acelerador electrónico', 'control de potencia'],
    descripcionSimbolo: 'Las letras EPC en amarillo.',
    severidad: 'amarillo',
    neverDrive: false,
    significado: 'El sistema que controla electrónicamente la potencia del motor detectó una falla. El vehículo puede responder menos al acelerador o entrar a potencia reducida.',
    causasProbables: ['Falla del cuerpo de aceleración o de su sensor', 'Sensor del pedal del acelerador con falla', 'Sensor del motor con falla', 'Interruptor de la luz de freno con falla'],
    puedesRevisar: ['Observa si el motor pierde fuerza o responde tarde al acelerador.', 'Comprueba si también está encendido el check engine, para contárselo al taller.'],
    noHagas: ['No hagas adelantamientos ni entres a vías rápidas si el vehículo pierde fuerza.', 'No apagues y enciendas repetidamente para intentar borrarlo.'],
    cuandoIrAlMecanico: 'Hoy o mañana, para leer el código con un escáner. Si pierde fuerza para circular con tráfico, detente en un lugar seguro y llama a un taller. Si se ignora, el vehículo puede quedar con poca potencia en plena vía.',
    aplicaA: ['gasolina', 'diesel']
  },

  // --- Informativos: avisan de un estado, no de una falla ---
  {
    id: 'asistente_carril',
    nombre: 'Asistente de carril',
    alias: ['carril', 'LKA', 'LDW', 'carro entre líneas', 'mantenimiento de carril'],
    descripcionSimbolo: 'Silueta de carro entre dos líneas de carril, a veces con las letras LKA o LDW.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'Muestra el estado del sistema que vigila las líneas del carril. No indica una falla, salvo que aparezca en amarillo con un mensaje de error o se quede parpadeando.',
    causasProbables: ['Sistema activado o apagado desde su botón', 'Líneas del carril poco visibles, o cámara sucia', 'Si aparece en amarillo con un mensaje: falla de la cámara o del sistema'],
    puedesRevisar: ['Mira en el menú del vehículo si el sistema está activado.', 'Limpia con un paño suave la zona del parabrisas frente a la cámara.'],
    noHagas: ['No sueltes el volante confiando en el sistema.', 'No pegues adhesivos ni accesorios frente a la cámara.'],
    cuandoIrAlMecanico: 'Solo si sigue en amarillo o con un mensaje de error tras limpiar la cámara, para leer el código. Si se ignora, el sistema no te avisará al salirte del carril; la conducción normal no se afecta.',
    aplicaA: TODOS
  },
  {
    id: 'cinturon',
    nombre: 'Cinturón sin abrochar',
    alias: ['cinturón', 'persona con cinturón', 'muñeco con banda'],
    descripcionSimbolo: 'Persona sentada de frente con una banda cruzada sobre el pecho, en rojo o naranja, a veces con pitidos.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'Alguien que va en el vehículo no tiene el cinturón abrochado. No indica una falla mecánica.',
    causasProbables: ['Conductor o pasajero sin abrochar', 'Objeto pesado sobre el asiento del copiloto', 'Hebilla o sensor sucio o dañado'],
    puedesRevisar: ['Abrocha el cinturón de todos los ocupantes.', 'Quita bolsos u objetos pesados del asiento delantero.'],
    noHagas: ['No abroches el cinturón por detrás ni uses adaptadores para silenciar la alarma.', 'No arranques hasta que todos lo tengan puesto.'],
    cuandoIrAlMecanico: 'Solo si sigue encendido con todos los cinturones abrochados, para revisar la hebilla o el sensor. Si se ignora, una alerta real de un pasajero sin cinturón pasará inadvertida.',
    aplicaA: TODOS
  },
  {
    id: 'combustible_bajo',
    nombre: 'Falta de combustible',
    alias: ['reserva', 'surtidor', 'gasolina baja', 'bomba de gasolina'],
    descripcionSimbolo: 'Surtidor de combustible en amarillo o naranja.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'Queda poco combustible y estás usando la reserva. No indica una falla.',
    causasProbables: ['Nivel de combustible bajo', 'Sensor del tanque impreciso, si el testigo aparece recién tanqueado'],
    puedesRevisar: ['Mira la autonomía en el tablero, si tu vehículo la muestra, y ubica la estación más cercana.'],
    noHagas: ['No sigas hasta que el motor se apague: puedes quedar varado en un lugar inseguro.', 'No circules seguido en reserva.'],
    cuandoIrAlMecanico: 'Solo si el testigo sigue encendido con el tanque lleno, para revisar el sensor de nivel. Si se ignora y ruedas seguido en reserva, puedes quedarte varado y la bomba de combustible trabaja con menos lubricación y enfriamiento.',
    aplicaA: CON_MOTOR
  },
  {
    id: 'limpiabrisas_bajo',
    nombre: 'Nivel de líquido limpiabrisas',
    alias: ['agua del limpiaparabrisas', 'chorritos', 'limpiavidrios'],
    descripcionSimbolo: 'Parabrisas con un chorro de agua en forma de abanico.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'Queda poco líquido para limpiar el parabrisas. No indica una falla del motor.',
    causasProbables: ['Nivel bajo por el uso normal', 'Sensor de nivel con falla', 'Fuga en el depósito o en una manguera'],
    puedesRevisar: ['Abre el capó con el motor apagado y localiza el depósito con el símbolo del parabrisas.', 'Rellénalo con líquido limpiabrisas o con agua limpia.'],
    noHagas: ['No lo confundas con el depósito de refrigerante ni con el de frenos: mira el símbolo en la tapa.', 'No uses los limpiabrisas en seco sobre un vidrio muy sucio.'],
    cuandoIrAlMecanico: 'Solo si se vacía muy rápido o el testigo sigue tras rellenar, para revisar fugas o el sensor. Si se ignora, con polvo o barro en el parabrisas puedes quedarte sin visibilidad.',
    aplicaA: TODOS
  },
  {
    id: 'bujias_precalentamiento',
    nombre: 'Bujías de precalentamiento (diésel)',
    alias: ['resistencia', 'espiral', 'calentadores', 'resorte'],
    descripcionSimbolo: 'Espiral o resorte en amarillo, parecido a una línea en forma de bucles.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'Al dar contacto en un diésel, avisa que las bujías están calentando la cámara para arrancar. Es normal que se encienda un momento y se apague. No indica una falla si se apaga.',
    causasProbables: ['Precalentamiento normal antes de arrancar', 'Si parpadea o sigue encendido andando: bujía de precalentamiento o relé con falla', 'Falla en el sistema de inyección'],
    puedesRevisar: ['Espera a que se apague antes de dar arranque.', 'Observa si parpadea o permanece encendido con el motor en marcha.'],
    noHagas: ['No des arranque antes de que se apague, sobre todo en clima frío.', 'No ignores si parpadea en marcha.'],
    cuandoIrAlMecanico: 'Si parpadea o sigue encendido con el motor andando, en los próximos días para leer el código. Si se ignora, el vehículo puede costar para arrancar o dejar de arrancar en frío.',
    aplicaA: ['diesel']
  },
  {
    id: 'mantenimiento',
    nombre: 'Mantenimiento programado',
    alias: ['llave inglesa', 'SERVICE', 'servicio', 'cambio de aceite', 'herramienta'],
    descripcionSimbolo: 'Llave de mecánico, o el texto SERVICE, MAINT REQD u OIL CHANGE.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'El vehículo avisa que se cumplió el tiempo o el kilometraje de un mantenimiento. No indica una falla.',
    causasProbables: ['Se cumplió el intervalo de mantenimiento', 'El contador no se reinició después del último servicio'],
    puedesRevisar: ['Busca en el manual qué incluye el mantenimiento de ese kilometraje.', 'Revisa cuándo fue el último cambio de aceite.'],
    noHagas: ['No reinicies el aviso sin haber hecho el mantenimiento.', 'No lo aplaces por meses.'],
    cuandoIrAlMecanico: 'Agenda una cita en las próximas semanas para hacer el mantenimiento. Si se ignora, el aceite y los filtros pierden sus propiedades y aumenta el riesgo de una avería mayor.',
    aplicaA: TODOS
  },
  {
    id: 'luces_altas',
    nombre: 'Luces altas',
    alias: ['altas', 'farolas altas', 'luz azul', 'D con rayas'],
    descripcionSimbolo: 'Forma de D en azul con líneas horizontales rectas al lado.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'Tienes las luces altas encendidas. No indica una falla.',
    causasProbables: ['Luces altas encendidas a propósito o por error', 'Función de luces altas automáticas activa'],
    puedesRevisar: ['Mueve la palanca de luces para bajarlas.'],
    noHagas: ['No las uses con tráfico de frente o detrás de otro vehículo: encandilas al otro conductor.'],
    cuandoIrAlMecanico: 'Solo si el testigo no se apaga al cambiar a luces bajas, para revisar la palanca. Si se ignora, puedes encandilar a otros conductores y causar un accidente.',
    aplicaA: TODOS
  },
  {
    id: 'antiniebla_delanteras',
    nombre: 'Luces antiniebla delanteras',
    alias: ['exploradoras', 'neblineras', 'antinieblas'],
    descripcionSimbolo: 'Forma de D en verde con líneas inclinadas hacia abajo, cruzadas por una línea ondulada.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'Las luces antiniebla delanteras están encendidas. No indica una falla.',
    causasProbables: ['Antiniebla encendidas a propósito o por error'],
    puedesRevisar: ['Busca el botón o la posición de la palanca para apagarlas.'],
    noHagas: ['No las dejes encendidas con buena visibilidad si encandilas a otros.'],
    cuandoIrAlMecanico: 'Solo si el testigo no se apaga con el mando, para revisar el interruptor. Si se ignora, solo gastas más los bombillos y puedes molestar a otros conductores.',
    aplicaA: TODOS
  },
  {
    id: 'antiniebla_traseras',
    nombre: 'Luz antiniebla trasera',
    alias: ['neblinero trasero', 'antiniebla atrás'],
    descripcionSimbolo: 'Forma de D en amarillo mirando hacia el lado contrario, con líneas horizontales cruzadas por una línea ondulada.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'La luz antiniebla trasera está encendida. No indica una falla.',
    causasProbables: ['Antiniebla trasera encendida a propósito o por error'],
    puedesRevisar: ['Busca el botón o la posición de la palanca para apagarla.'],
    noHagas: ['No la dejes encendida sin niebla: es muy intensa y se puede confundir con la luz de freno.'],
    cuandoIrAlMecanico: 'Solo si no se apaga con el mando, para revisar el interruptor. Si se ignora, quien viene detrás puede encandilarse o creer que estás frenando.',
    aplicaA: TODOS
  },
  {
    id: 'direccionales',
    nombre: 'Direccionales',
    alias: ['flechas', 'pito de las direccionales', 'intermitentes', 'estacionarias'],
    descripcionSimbolo: 'Una o dos flechas verdes que parpadean, apuntando a la izquierda y a la derecha.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'Las direccionales o las luces de parqueo están encendidas. No indica una falla, salvo que parpadeen mucho más rápido de lo normal.',
    causasProbables: ['Direccional o luces de parqueo activadas', 'Si parpadea muy rápido: un bombillo fundido'],
    puedesRevisar: ['Apaga la palanca o el botón de las luces de parqueo.', 'Si parpadea rápido, camina alrededor del vehículo para ver qué direccional no enciende.'],
    noHagas: ['No circules con la direccional puesta sin querer: confundes a los demás.'],
    cuandoIrAlMecanico: 'Solo si sigue parpadeando rápido después de cambiar el bombillo, para revisar el relé o el cableado. Si se ignora, los demás no sabrán hacia dónde vas a girar.',
    aplicaA: TODOS
  },
  {
    id: 'crucero',
    nombre: 'Control de crucero',
    alias: ['velocímetro con flecha', 'CRUISE', 'piloto de velocidad'],
    descripcionSimbolo: 'Velocímetro con una flecha en verde o blanco, o la palabra CRUISE.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'El control de crucero está activado o listo para usarse. No indica una falla, salvo que aparezca en amarillo o parpadeando.',
    causasProbables: ['Control de crucero activado', 'Si está en amarillo: el sistema se desactivó por una falla o un sensor sucio'],
    puedesRevisar: ['Apágalo con el botón del volante si no lo quieres usar.', 'Si está en amarillo, limpia con un paño suave el sensor frontal, si tu vehículo lo tiene.'],
    noHagas: ['No lo uses con lluvia fuerte, tráfico denso o curvas.'],
    cuandoIrAlMecanico: 'Solo si queda en amarillo o no responde, para leer el código. Si se ignora, el sistema no estará disponible; la conducción normal no se afecta.',
    aplicaA: TODOS
  },
  {
    id: 'estabilidad_apagado',
    nombre: 'Control de estabilidad apagado',
    alias: ['ESP OFF', 'TCS OFF', 'carro derrapando con OFF'],
    descripcionSimbolo: 'Silueta de carro derrapando con la palabra OFF.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'El control de estabilidad se apagó desde el botón del vehículo. No indica una falla si tú lo desactivaste.',
    causasProbables: ['Botón de apagado presionado', 'Se desactivó solo por otra falla del vehículo'],
    puedesRevisar: ['Presiona el botón del control de estabilidad para volver a activarlo.', 'Mira si hay otro testigo encendido, como el check engine o el ABS.'],
    noHagas: ['No lo dejes apagado para circular normalmente, sobre todo con lluvia.'],
    cuandoIrAlMecanico: 'Solo si no se vuelve a activar con el botón, para leer el código. Si se ignora, el vehículo no corregirá un derrape en piso resbaloso.',
    aplicaA: TODOS
  },
  {
    id: 'start_stop',
    nombre: 'Start-Stop',
    alias: ['A con flecha', 'apagado automático', 'auto stop'],
    descripcionSimbolo: 'Letra A dentro de una flecha circular, en verde, blanco o amarillo.',
    severidad: 'informativo',
    neverDrive: false,
    significado: 'Muestra el estado del sistema que apaga el motor en los semáforos y lo vuelve a encender. No indica una falla, salvo que parpadee o aparezca en amarillo.',
    causasProbables: ['Sistema activo o apagado con su botón', 'Batería con poca carga, aire acondicionado alto o motor frío, que impiden el apagado', 'Si parpadea: falla de un sensor o de la batería'],
    puedesRevisar: ['Mira si está activado desde su botón.', 'Observa si el motor reanuda solo al soltar el freno.'],
    noHagas: ['No te bajes del vehículo mientras el motor está en pausa automática.'],
    cuandoIrAlMecanico: 'Solo si parpadea o queda en amarillo, para revisar la batería y los sensores. Si se ignora, el sistema no funciona y gastas algo más de combustible, pero también puede anticipar una batería débil.',
    aplicaA: ['gasolina', 'diesel', 'hibrido']
  }
];

const BY_ID = new Map(TELLTALES.map((telltale) => [telltale.id, telltale]));

export function findTelltale(id: string): Telltale | null {
  return BY_ID.get(id) ?? null;
}

/** Vista resumida para que el usuario elija el testigo a mano. */
export const telltaleSummaries = () => TELLTALES.map(({ id, nombre, alias, severidad, neverDrive }) => ({ id, nombre, alias, severidad, debeDetenerse: neverDrive }));
