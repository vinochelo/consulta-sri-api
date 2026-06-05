# 🔧 Cómo Obtener los Links de Descarga de Catastros del SRI

## ⚠️ Problema

El SRI **NO expone los archivos Excel directamente** en la página de catastros. 
La URL `https://www.sri.gob.ec/catastros` muestra una página web con botones de descarga, 
pero no los enlaces reales a los archivos.

## ✅ Solución: Obtener Links Manualmente

### Método 1: Desde el Navegador (Chrome/Edge/Firefox)

1. **Abre la página de catastros:**
   ```
   https://www.sri.gob.ec/catastros
   ```

2. **Abre las herramientas de desarrollador:**
   - Presiona `F12` o `Ctrl + Shift + I`
   - Ve a la pestaña **"Network"** (Red)

3. **Haz clic en el botón "Descargar"** del catastro que quieres (ej: "Grandes Contribuyentes")

4. **En la pestaña Network aparecerá una nueva petición**
   - Haz clic derecho sobre ella
   - Selecciona **"Copy" → "Copy link address"**

5. **El link tendrá este formato:**
   ```
   https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/XXXXX
   ```

6. **Pega ese link en la configuración de tu aplicación:**
   - Ve a la pestaña **"Catastros SRI"** en tu dashboard
   - En la sección **"Configurar URLs de Descarga"**
   - Pega el link en el campo correspondiente
   - Haz clic en **"Guardar"**

### Método 2: Inspeccionando el HTML

1. Abre `https://www.sri.gob.ec/catastros`
2. Haz clic derecho en el botón **"Descargar"**
3. Selecciona **"Inspeccionar elemento"**
4. Busca un atributo `href` o `data-url` que contenga el enlace
5. Copia ese enlace

---

## 📋 Links Actuales (Pueden cambiar - verificar)

> ⚠️ **IMPORTANTE:** Estos links pueden cambiar cuando el SRI actualiza su página. 
> Si no funcionan, usa el Método 1 para obtener los nuevos.

### Ejemplo de formato esperado:
```
Grandes Contribuyentes:
https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/[ID-UNICO]

Agentes de Retención:
https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/[ID-UNICO]

Exportadores de Bienes:
https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/[ID-UNICO]
```

---

## 🚀 Una vez configurados los links:

1. Ve a la pestaña **"Catastros SRI"** en tu dashboard
2. Configura cada URL en la sección correspondiente
3. Haz clic en **"Descargar Todos"**
4. ¡Listo! Los archivos se guardarán localmente y se actualizarán automáticamente

---

## 💡 Tips

- Los links **NO cambian frecuentemente**, pero si falla la descarga, verifica que sigan funcionando
- Puedes descargar manualmente el Excel desde la página del SRI y luego cargarlo en la aplicación (próximamente)
- El sistema detectará automáticamente si el contenido cambió y actualizará el archivo local

---

## 🔍 Verificar que la descarga fue exitosa

Después de descargar, ejecuta:

```bash
curl http://localhost:3000/api/catastros
```

Deberías ver:
- `"disponible": true`
- `"registros":` (cantidad mayor a 0)
- `"error": null`

Si ves `"registros": 0` o un error, el archivo descargado NO es un Excel válido.
