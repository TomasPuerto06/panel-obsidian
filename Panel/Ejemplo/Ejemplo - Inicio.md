---
tipo: panel
pagina: ejemplo-inicio
cssclasses: [panel, panel-inicio]
---

> [!nav]
> [[Ejemplo - Inicio|Inicio]] · [[Ejemplo - Salud|Salud]] · [[Ejemplo - Estudios|Estudios]] · [[Ejemplo - Proyectos|Proyectos]] · [[Ejemplo - Finanzas|Finanzas]]

# Inicio (ejemplo)

> [!info] Datos inventados, fijados al 22 de octubre de 2026 (carpeta `Panel/Ejemplo`). Los botones y enlaces de las tarjetas actúan sobre tus datos reales, no sobre estos.

```dataviewjs
await dv.view("Panel/Scripts/salud", {"modo":"inicio","carpeta":"Panel/Ejemplo/Diario","carpetaFinanzas":"Panel/Ejemplo/Finanzas","carpetaTareas":"Panel/Ejemplo/Tareas","carpetaCalendario":"Panel/Ejemplo/Calendario","carpetaProyectos":"Panel/Ejemplo/Proyectos","carpetaDiario":"Panel/Ejemplo/Diario","hoy":"2026-10-22"});
```
