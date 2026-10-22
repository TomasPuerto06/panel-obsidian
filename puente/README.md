# Puente con Google (opcional)

Conecta el Panel en Obsidian con **Google Sheets** y **Google Calendar**, en los dos sentidos: lo que registras en Obsidian llega a la hoja y a tus calendarios, y lo que cambias allí llega a Obsidian al pulsar **Sincronizar**.

Es un script de Google Apps Script (`Puente.gs`) que vive en **tu** cuenta de Google. Solo sabe tocar:

- Una hoja de cálculo con cuatro pestañas: **Gimnasio, Hábitos, Finanzas y Tareas**.
- Dos calendarios elegidos por su nombre exacto: **"Exámenes y entregas"** (se leen, crean, cambian y borran exámenes) y **"Trabajo"** (se leen y solo se pueden **crear** turnos; nunca cambiar ni borrar los que ya hay).

No ve tus otros calendarios ni tu correo.

## Cómo se protege

La dirección del puente es pública (Google la sirve como una aplicación web), pero **solo responde a quien tenga el secreto**, que únicamente está en las propiedades de tu script y en tu Obsidian.

- Cada petición va **firmada con HMAC-SHA256**: el secreto nunca viaja por internet.
- La firma incluye la hora y un número de un solo uso: una petición copiada no sirve pasados 5 minutos ni una segunda vez.
- Tras 10 intentos fallidos se bloquea todo durante 15 minutos.
- Los errores siempre dicen lo mismo ("no autorizado"): no dan pistas.
- Solo acepta datos de una lista blanca (entrenos, hábitos, tipos de movimiento, con sus rangos) y nunca guarda como fórmula un texto que empiece por `=`, `+`, `-` o `@`.
- Interruptor de emergencia: la propiedad del script `ACTIVO = no` lo apaga al instante.

Límites que conviene conocer:

- Quien consiga tu secreto podría leer y escribir esas cuatro pestañas, leer título, fecha y hora de los dos calendarios, cambiar los exámenes y crear turnos. Nada más. Si crees que se ha filtrado, ejecuta `crearSecreto` otra vez y pon el nuevo en Obsidian ("Configurar puente").
- El secreto se guarda en `Panel/Scripts/.puente/conexion.json`, dentro de tu bóveda. Si la sincronizas con un servicio en la nube, quien entre en esa cuenta podría verlo. Nunca subas esa carpeta a un repositorio (ya está en el `.gitignore`).
- Técnicamente, el permiso que Google concede al script es sobre todos tus calendarios, aunque el código solo toca esos dos por su nombre.

## Puesta en marcha (unos 10 minutos)

En Google:

1. Entra en <https://script.google.com> y crea un **Proyecto nuevo**. Llámalo, por ejemplo, "Panel Puente".
2. Borra el contenido de `Código.gs` y pega **todo** el contenido de `puente/Puente.gs`. Guarda.
3. Engranaje (**Configuración del proyecto**): activa "Mostrar el archivo de manifiesto appsscript.json en el editor". En el editor, abre `appsscript.json`, sustituye su contenido por el de `puente/appsscript.json` y guarda.
4. Elige la función **`prepararTodo`** y pulsa **Ejecutar**. Google te pedirá permisos (hojas de cálculo y calendario). Saldrá el aviso "Google no ha verificado esta aplicación": es tu propio script, pulsa "Avanzado" > "Ir a Panel Puente" > "Permitir".
   - Crea la hoja **"Panel de vida"** con sus cuatro pestañas y guarda su ID en la propiedad `HOJA`.
   - Crea los calendarios **"Exámenes y entregas"** y **"Trabajo"** si no los tienes.
   - Si ya tienes una hoja propia con esas pestañas, pon antes su ID en **Configuración del proyecto > Propiedades del script** (`HOJA` = el texto largo de su dirección, entre `/d/` y `/edit`) y `prepararTodo` solo añadirá lo que falte.
5. Ejecuta **`crearSecreto`**, abre el **Registro de ejecución** y copia el secreto (64 caracteres). No lo compartas.
6. Ejecuta **`comprobar`**: debe decir cuántas filas hay en cada pestaña, que encuentra los dos calendarios y "SECRETO configurado: sí".
7. **Implementar > Nueva implementación** > tipo **Aplicación web** > Ejecutar como: **Yo** > Quién tiene acceso: **Cualquier persona** > Implementar. Copia la URL (termina en `/exec`).

En Obsidian:

8. `Ctrl+P` > **"QuickAdd: Configurar puente"** > pega la URL y el secreto. Debe avisar "Conexión correcta".
9. Pulsa **Sincronizar**. La primera vez sube lo que ya tengas en Obsidian y trae 60 días de la hoja; después, 14 días y todos los movimientos, tareas y eventos (de 30 días atrás a 120 adelante).

**Cada vez que cambies `Puente.gs`:** pega el código nuevo, guarda y en **Implementar > Gestionar implementaciones** edita la implementación (lápiz) > **Versión: Nueva versión** > Implementar. La URL no cambia.

## Personalizar

Al principio de `Puente.gs`:

- `PESTANAS`: nombres de las pestañas de la hoja.
- `CALENDARIOS`: nombres exactos de los dos calendarios (por ejemplo, para llamar al de exámenes solo "Exámenes"). Si los cambias, vuelve a ejecutar `prepararTodo` o crea esos calendarios a mano.
- `HABITOS`, `ENTRENOS` y `TIPOS`: la lista blanca de lo que se acepta.

## Qué se guarda dónde

| En Obsidian | En Google |
|---|---|
| Nota del día: `entreno` | Pestaña **Gimnasio** (`Fecha`, `Entreno`, `Estado`, `Notas`): entreno `pht`, `eba` o `pierna` con estado `hecho`. "Descanso" no escribe fila |
| Nota del día: `cinta_min`, `agua_litros`, `sueno_horas`, `animo` | Pestaña **Hábitos** (`Fecha`, `Hábito`, `Valor`): hábitos `cinta`, `agua`, `sueno`, `animo` |
| Nota del día: `pasos`, `lectura`, `preparar_dia`, `proyecto` | Pestaña **Hábitos**, valor 1 (si es "No", no hay fila) |
| Una nota por movimiento en `Panel/Finanzas/Movimientos` | Pestaña **Finanzas** (`Fecha`, `Concepto`, `Tipo`, `Categoría`, `Cantidad`, `ID`), con el mismo ID |
| Una nota por tarea en `Panel/Tareas` | Pestaña **Tareas** (`ID`, `Tarea`, `Fecha`, `Categoría`, `Hecha`, `Creada`), con el mismo ID |
| Una nota por evento en `Panel/Calendario` | Calendarios **"Exámenes y entregas"** y **"Trabajo"** (de "Trabajo" no se lee la descripción) |
| Texto libre de las notas, calificación y apunte de los exámenes | Solo en Obsidian |

**Google manda:** al sincronizar, primero se envía lo pendiente y después las notas se ajustan a lo que digan la hoja y los calendarios. Sin conexión, lo que registres queda en `Panel/Scripts/.puente/pendiente.json` y se envía en la siguiente sincronización; lo que el puente rechace queda en `rechazadas.json`.
