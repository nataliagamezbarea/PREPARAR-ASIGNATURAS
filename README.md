# Preparar tests

Aplicación JavaScript para practicar bancos JSON por asignatura y generar preguntas originales desde tus apuntes privados o desde texto libre con Ollama local (Docker, gratis, sin claves de API y sin límites de uso).

## Iniciar

Requisitos: Node.js 22.13 o posterior, Docker Compose y el contenedor Ollama del proyecto Generador de apuntes (misma red `docker_default`, contenedor `generador-apuntes-ollama`, modelo `qwen2.5vl:7b`). El lanzador usa `sudo -n` solo para los comandos de Docker; la cuenta debe tener permiso para ejecutarlos sin una solicitud interactiva de contraseña.

En Linux, inicia desde esta carpeta:

```bash
npm run iniciar
```

El lanzador recuerda la carpeta de apuntes elegida en `.env` y la propone la próxima vez; confirma esa ruta o elige otra. Si cancelas, no inicia la aplicación. Los apuntes se montan en Docker en modo de solo lectura y los bancos generados se guardan en `datos/bancos/`.

Para iniciar Compose directamente, configura `DIRECTORIO_APUNTES` en `.env` y ejecuta:

```bash
docker compose --project-directory . --env-file .env -f docker/compose.yaml up -d --build preparar-tests
```

La aplicación queda disponible en <http://127.0.0.1:8124>. El modelo predeterminado es `qwen2.5vl:7b`; se puede cambiar con `MODELO_IA` en `.env`.

El contenedor monta `public/` y `server/` desde el proyecto: los cambios de interfaz aparecen al recargar la página, y los cambios de servidor reinician Node automáticamente. No hace falta reconstruir para editar esos archivos. Los cambios en `docker/Dockerfile`, dependencias o configuración de Compose sí requieren volver a ejecutar el comando de arriba con `--build`.

Organiza el material dentro de la carpeta elegida así: `WEC/Tema 1/`, `WEC/Tema 2/`, etc. Puedes poner los ZIP junto al material del tema; también se reconocen archivos en la raíz llamados `Tema 1.zip` o `Tema 1.pdf`. El banco resultante se guarda aparte en `datos/bancos/WEC/`.

## Generar con IA (texto libre o apuntes privados)

Desde la pantalla de inicio, tras terminar un test o desde «Conceptos que más se te atragantan», puedes abrir «Generar con IA». La IA local redacta preguntas nuevas sin copiar los apuntes: parafrasea, añade casos prácticos y trampas de examen, y cada pregunta incluye explicación didáctica y, en código, traza paso a paso.

- **Contexto libre**: escribe los conceptos o temas a evaluar (por ejemplo, los que más se te atragantan) y la IA genera preguntas sobre ellos sin necesidad de PDF ni apuntes.
- **Apuntes privados**: si seleccionas una asignatura con temas en `apuntes-privados`, se genera a partir de esos archivos `.tex`/PDF/código.
- **No repite**: recuerda los enunciados ya generados de cada asignatura y el prompt les indica qué no repetir.
- **Conceptos débiles**: la pantalla de inicio calcula los apartados/etiquetas donde más fallas y ofrece un botón para generar preguntas específicamente de ellos.
- Al terminar, practicas directamente el banco generado con un clic.

## Funciones

- Selecciona una asignatura, importa bancos JSON y practica todos los temas, un tema o un tipo de pregunta.
- Genera tandas incrementales de preguntas desde los apuntes; se conservan los bancos previos y se descartan duplicados.
- En «Generar con IA», el formulario (asignatura, número de preguntas, tipo, contexto e instrucciones) se guarda como borrador local y se restaura al recargar o volver a entrar en esa pantalla hasta que pulses «Limpiar».
- Al terminar un test hay un acceso rápido «Generar más preguntas con IA» que parte de tus conceptos débiles y de los enunciados ya generados; desde el inicio, «Conceptos que más se te atragantan» ofrece lo mismo.
- Los bancos JSON se guardan con el nombre legible de la asignatura y una selección de tema (por ejemplo, `datos/bancos/WEC/WEC-temas-1-apartado-0.json`). Al generar para varios temas, se crea un JSON independiente por tema; las selecciones de varios temas combinan esos bancos al leerlos.
- Los bancos generados se organizan en carpetas legibles por asignatura, como `datos/bancos/WEC/`. Los bancos antiguos se migran conservando las preguntas; los multitema se separan usando el tema asignado a cada pregunta.
- Se leen fuentes `.tex`, PDF con texto seleccionable y archivos de texto o código. Los ZIP se dejan dentro de su carpeta `Tema N` —o en la raíz con un nombre como `Tema 1.zip`— y se procesan sin extraerlos. Carpetas y nombres numerados asignan el material a apartados; los PDF con encabezados numerados también se separan. Los PDF escaneados sin texto seleccionable requieren OCR y se notifican.
- La lectura de apuntes no impone un máximo fijo de tamaño o cantidad de archivos. Los ZIP se recorren entrada por entrada, sin acumular todos sus archivos descomprimidos en memoria, y se omiten dependencias o carpetas generadas como `node_modules`, `build` y `dist`, también cuando aparecen dentro del ZIP. El tamaño máximo práctico depende de la memoria disponible, del espacio y del texto que el lector PDF pueda procesar; ningún programa puede garantizar archivos literalmente ilimitados.
- Las preguntas nuevas priorizan comprensión y aplicación, varían los conceptos y la dificultad, y deben incluir opciones distintas y explicaciones didácticas. Si el material no justifica más preguntas nuevas, la generación lo indica en vez de rellenar con contenido inventado o repetido.
- La generación detecta ejemplos en prosa etiquetada y bloques de código de los apuntes. La cantidad solicitada es un mínimo: genera al menos una pregunta original ligada por ID a cada ejemplo detectado, revisa la cobertura y vuelve a pedir los que falten. Rechaza preguntas que copian literalmente el ejemplo; si algún ID sigue sin una pregunta válida tras los reintentos, informa cuáles faltaron en lugar de declarar cobertura completa. La detección se limita a ejemplos explícitos reconocibles; revisa el resultado si tus apuntes presentan ejemplos sin etiquetas o formatos especiales. «Refuerzo completo» recorre todas las preguntas disponibles y permite repetir todo el banco hasta terminar una ronda sin errores.
- Las preguntas y explicaciones se redactan siempre en castellano aunque los apuntes estén en otro idioma. Los conceptos se explican en castellano, pero no se traducen las palabras reservadas, nombres originales de funciones, APIs ni identificadores, tampoco al mencionarlos en prosa: `function` en JavaScript sigue siendo `function`, nunca `función` ni `FUNCTION`. El código conserva su sintaxis y capitalización originales.
- Al generar con varios temas o con un tema completo, cada pregunta conserva el tema y el apartado detectados en la ruta y el contenido de su material. Cuando el apartado no tiene numeración explícita, se muestra un nombre descriptivo inferido del contenido, sin inventar números; la pregunta enseña esa clasificación.
- Elige varios temas o todos, el formato del examen, el contexto y el tipo de preguntas.
- Consulta el progreso, cancela una generación y vuelve a practicar bancos guardados aunque Ollama no esté disponible.
- Las respuestas y explicaciones guardadas se conservan localmente en el navegador.

## Desarrollo y comprobaciones

El servidor, la interfaz y la integración con Ollama están implementados en JavaScript. No se necesita un servicio Python separado.

La interfaz está organizada en `public/assets/js/app/`: estado y almacenamiento, sesión, depurador, preguntas, fallos, IA, resultados e inicio. La práctica basada en apuntes está separada en `practicar-apuntes.js`; la API y la lógica del servidor permanecen en `server/`.

```bash
npm run comprobar
npm run probar
```

Los bancos incluidos están en `public/data/asignaturas/`. Los bancos generados se almacenan aparte bajo `datos/bancos/` y no reemplazan esos archivos.

## Cómo sacarle partido para el examen

1. **Diagnóstico**: haz un test completo con la corrección inmediata activada y apunta en los resultados el panel «Qué repasar primero».
2. **Repaso de los apartados flojos**: vuelve a tus apuntes sobre esos apartados y luego usa «Solo código», «Solo teoría» o un tema concreto.
3. **Repaso de fallos**: repite «Repaso de fallos» hasta que desaparezcan. Es lo que más sube la nota.
4. **Simulacro**: desactiva la corrección inmediata, elige un número de preguntas parecido al del examen y activa «Barajar el orden».
5. **Nuevas preguntas**: con «Tests desde apuntes» genera tandas nuevas de los temas que sigan fallando, o con «Generar con IA» a partir de tus conceptos débiles y de texto libre.

La nota de un test es una medida de ese conjunto concreto, no una garantía de la nota del examen. Para valorar mejor el dominio, combina tests de temas completos, preguntas de aplicación y un simulacro sin corrección inmediata; comprueba también los fallos frente a los apuntes.

Para leer mejor los enunciados:

- Antes de mirar las opciones, subraya qué te piden: salida, valor, tipo, definición o diferencia.
- Fíjate en las negaciones (NO, excepto, incorrecta): invierten la respuesta.
- En «¿Qué imprime este código?» (es la pregunta más repetida del banco) ejecuta el código a mano, línea a línea, y apunta el valor de cada variable. El depurador de la corrección te enseña cómo.
- Si el enunciado te suena distinto a los apuntes, reescríbelo con tus palabras antes de contestar.

## Cambios de esta versión

- El logo de arriba vuelve al inicio desde cualquier pantalla, sin recargar la página.
- La pantalla de inicio está ordenada en secciones: resumen, asignatura, entrenar, repasar fallos y opciones.
- La pantalla de «Tests desde apuntes» usa el mismo ancho y márgenes que el resto.
- En el banco WEC la respuesta correcta estaba en B en 61 de 100 preguntas. Ahora se reparte 25/25/25/25. Las preguntas generadas con Ollama también se barajan.
- Al terminar un test se muestran los apartados con más fallos.
- Nuevo test automático que vigila el reparto de letras y la coherencia del banco.

Nota: como las opciones cambiaron de sitio, la letra guardada en «tus respuestas anteriores» de los fallos antiguos puede no coincidir. Si te pasa, usa «Borrar historial» una vez.
