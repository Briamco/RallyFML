# RallyFML — Design System

## Dirección visual

RallyFML es una herramienta para organizar un juego comunitario en vivo, no una página promocional. La referencia de [FML](https://fmlasallista.org.do/) aporta su tono humano: fotografía real de misioneros, camisetas azules, el escudo lasallista, una estrella roja y acentos verdes. Llevaremos esa energía al evento con pantallas limpias y de lectura inmediata; no copiaremos la navegación ni los llamados a donar del sitio institucional.

Usar el logotipo y el escudo oficiales desde recursos aprobados. Reservar las fotografías para la bienvenida y la celebración; mantener los controles y el puntaje sobre fondos sólidos para que se lean durante la actividad.

## Color

Estos hex son una paleta inicial estimada a partir de las referencias; validar contra los archivos oficiales de marca antes de implementar.

| Token            | Color     | Uso                                 |
| ---------------- | --------- | ----------------------------------- |
| Tinta Lasallista | `#1E2A44` | Texto, navegación y estructura      |
| Azul Lasallista  | `#31549A` | Acción principal y estación activa  |
| Azul Misión      | `#167DAF` | Información y elementos secundarios |
| Estrella Roja    | `#D43F53` | Alarma, atención y acento de marca  |
| Verde Comunidad  | `#13B36A` | Actividad completada y confirmación |
| Oro Podio        | `#E7B642` | Primer lugar y celebración final    |

Usar blanco como fondo principal y grises neutros para bordes y superficies secundarias. El color nunca será la única señal: acompañar estados con texto e iconos, y validar contraste antes de fijar combinaciones.

## Tipografía

La familia indicada es [Indivisa](https://indivisafont.org/). Usar **Indivisa Text Sans** para instrucciones, formularios, botones y tablas; **Indivisa Display Sans** para títulos del rally y la revelación del podio. El temporizador y las puntuaciones usarán Text Sans Bold/Black con cifras tabulares para que el contador no salte de ancho.

Escala inicial: título de podio 56–72 px; título de pantalla 32–40 px; encabezado de sección 24–28 px; texto y controles 16–18 px; ayuda 14 px. Mantener instrucciones cortas, en español claro y con acentos correctos. Fallback: `system-ui, sans-serif`.

**Condición de licencia:** aunque el sitio describe Indivisa como gratuita, su EULA limita el uso a actividades y proyectos relacionados con Universidad La Salle A.C. y condiciona el uso web mediante `@font-face` a proteger los archivos contra descarga directa y solicitar los formatos correspondientes. Antes de incluir archivos en la app, confirmar que RallyFML está cubierto y obtener el paquete web autorizado; no convertir ni redistribuir fuentes por cuenta propia. Si no se autoriza el uso web, mantener el sistema tipográfico y utilizar el fallback aprobado. Consultar los [términos de Indivisa](https://indivisafont.org/).

## Composición y pantallas

- **Administración:** asistente de cuatro pasos —tiempos globales, equipos, estaciones y revisión— con progreso visible, validación junto a cada campo y controles para añadir o quitar equipos, estaciones y mandatos. La trivia muestra campos para cuatro opciones y una selección única de respuesta correcta. En móvil, apilar controles sin desplazamiento horizontal.
- Los controles de duración y cooldown permiten elegir minutos y segundos por separado; el almacenamiento conserva el total en segundos enteros.
- La misma guía sirve para editar un rally en configuración, entre rondas y después de finalizarlo. Al editar un rally cerrado se vuelve a ocultar el podio hasta que el administrador lo presente otra vez; los resultados anteriores se conservan aunque se retiren elementos de la configuración.
- **Moderación:** tablet o teléfono, una sola tarea por pantalla; mostrar estación y temporizador arriba, mandato en el centro y equipos como botones grandes. Para trivia, presentar cuatro opciones táctiles; para charadas, botones de correcta/incorrecta; para creatividad, dramatización y dinámica externa, selección directa de 0 a 5. No depender de escribir durante el juego.
- **Tabla en vivo:** pantalla independiente, legible a distancia, con equipos ordenados por puntos y empates visibles. Mantener estable la posición de las filas cuando cambian los puntajes.
- **Podio:** pantalla completa activada por el administrador al terminar; revelar los tres primeros lugares con una sola secuencia de animación y dejar visibles los empates. Usar el escudo o la estrella como detalle, no como fondo que compita con los nombres.

```text
Moderación (tablet)
┌─────────────────────────────────────┐
│ Estación                       01:24│
│ Pregunta de trivia                  │
│                                     │
│ [ A · Opción uno ] [ B · Opción dos ]│
│ [ C · Opción tres] [ D · Opción cuatro]│
│                                     │
│ Puntaje automático · 1 o 0          │
└─────────────────────────────────────┘
```

## Interacción y accesibilidad

- Áreas táctiles de al menos 48 × 48 px; estados de foco visibles y controles operables con teclado.
- En los últimos diez segundos, emitir un pulso de cuenta regresiva. Al finalizar la ronda común, mostrar una campana animada sobre fondo negro translúcido y repetir una alarma de tono distinto; solo el botón **Cerrar** la silencia y descarta.
- El panel administrador muestra el estado de preparación de todas las estaciones, el reloj compartido y controles para iniciar la ronda, terminarla o extenderla entre 1 y 300 segundos. El panel de cada estación permite preparar un equipo distinto; durante el cooldown deja elegir el próximo equipo, pero no iniciar su actividad.
- Si se finalizó el rally con estaciones pendientes, la administración ofrece **Retomar rally**. La acción conserva resultados y oculta el podio mientras se completa el trabajo pendiente.
- Respetar `prefers-reduced-motion`: conservar la señal visual sin movimiento intenso. No usar animaciones continuas; reservar Motion for React para respuestas a acciones, actualizaciones discretas del puntaje y el podio final.
- Mantener el mismo nombre para cada acción en todas las pantallas; confirmar guardados y explicar errores con el siguiente paso útil.
