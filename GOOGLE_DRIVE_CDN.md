# 🌐 Google Drive CDN para Catastros SRI

## 📊 Peso Total de Archivos

| Archivo | Tamaño |
|---------|--------|
| agentes_retencion.xlsx | 3.78 MB |
| contribuyentes_especiales.xlsx | 1.23 MB |
| exportadores_bienes.xlsx | 2.56 MB |
| exportadores_servicios.xlsx | 1.50 MB |
| grandes_contribuyentes.xlsx | 0.05 MB |
| porcentajes_iva.xlsx | 0.03 MB |
| porcentajes_renta.xlsx | 0.32 MB |
| rimpe_emprendedores.xlsx | 4.66 MB |
| rimpe_negocios_populares.xlsx | 54.91 MB |
| **TOTAL** | **69.04 MB** |

---

## 🎯 ¿Qué es Google Drive CDN?

Google Drive CDN permite usar **Google Drive como fuente de descarga** para los catastros en lugar del SRI. Esto tiene varias ventajas:

### Ventajas
- ✅ **Más rápido**: Google Drive es más rápido que el SRI
- ✅ **Más confiable**: No depende de la disponibilidad del SRI
- ✅ **Reduce carga**: No saturas al SRI con descargas repetidas
- ✅ **Gratuito**: Google Drive ofrece 15GB gratis (suficiente para ~69MB)
- ✅ **Automático**: Se sincroniza cada 15 días automáticamente

### Flujo de Trabajo
```
Servidor Principal (tu PC/servidor):
  1. Descarga del SRI cada 15 días
  2. Sube a Google Drive automáticamente
  3. Guarda registro de subida

Otros Servidores/Instancias:
  1. Descargan desde Google Drive (más rápido)
  2. Si falla Drive → fallback al SRI
  3. Mantienen catastros actualizados
```

---

## 🔧 Configuración Paso a Paso

### Paso 1: Crear Proyecto en Google Cloud

1. Ve a: https://console.cloud.google.com/
2. Crea un nuevo proyecto (ej: "sri-catastros-cdn")
3. Habilita la **Google Drive API**:
   - Ve a "APIs y servicios" → "Biblioteca"
   - Busca "Google Drive API"
   - Haz clic en "Habilitar"

### Paso 2: Crear API Key

1. Ve a "APIs y servicios" → "Credenciales"
2. Haz clic en "Crear credenciales" → "Clave de API"
3. **Guarda la API Key** (la necesitarás después)
4. (Opcional) Restringe la API Key a solo Google Drive API

### Paso 3: Crear Carpeta en Google Drive

1. Abre Google Drive: https://drive.google.com/
2. Crea una nueva carpeta llamada: `SRI-Catastros-CDN`
3. Haz clic derecho en la carpeta → "Compartir"
4. Configura como **"Cualquier persona con el enlace puede ver"**
5. **Obtén el Folder ID**:
   - El enlace se ve así: `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz`
   - El **Folder ID** es: `1AbCdEfGhIjKlMnOpQrStUvWxYz`

### Paso 4: Configurar Variables de Entorno

Crea o edita el archivo `.env` en la raíz del proyecto:

```env
# ─── Google Drive CDN ─────────────────────────────────
# Activa el modo CDN (descarga desde Drive en lugar del SRI)
GOOGLE_DRIVE_CDN=true

# ID de la carpeta en Google Drive
GOOGLE_DRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz

# API Key de Google Cloud
GOOGLE_DRIVE_API_KEY=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123456789
```

### Paso 5: Instalar Dependencia

```bash
npm install googleapis
```

### Paso 6: Subir Catastros a Google Drive (Primera Vez)

#### Desde el Dashboard:
1. Ve a la pestaña **"Catastros SRI"**
2. Haz clic en **"Subir a Google Drive"**
3. Espera a que se suban todos los archivos

#### Desde la API:
```bash
curl -X POST http://localhost:3000/api/drive/subir-todos
```

### Paso 7: Verificar Estadísticas

```bash
curl http://localhost:3000/api/drive/estadisticas
```

---

## 📡 Endpoints de Google Drive

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/drive/subir-todos` | Sube todos los catastros a Drive |
| `POST` | `/api/drive/descargar-todos` | Descarga todos desde Drive |
| `GET` | `/api/drive/estadisticas` | Estadísticas de uso |
| `GET` | `/api/drive/listar` | Lista archivos en Drive |
| `POST` | `/api/drive/sincronizar` | Sube nuevos archivos a Drive |

---

## 🔄 Flujo Automático

Una vez configurado, el sistema funciona así:

### Servidor Principal (donde descargas del SRI)
```
Cada 15 días:
  1. Descarga catastros del SRI
  2. Detecta si hay cambios (hash)
  3. Si cambió → Sube automáticamente a Google Drive
  4. Registra fecha de subida
```

### Servidores Secundarios (donde consultas)
```
Cada 6 horas (scheduler):
  1. Verifica si hay actualización en Drive
  2. Si Drive tiene versión nueva → Descarga desde Drive
  3. Si Drive falla → Fallback al SRI
  4. Mantiene catastros locales actualizados
```

---

## 💡 Casos de Uso

### Caso 1: Múltiples Servidores
Tienes 3 servidores en diferentes ubicaciones. Configuras:
- **Servidor 1**: Descarga del SRI + sube a Drive
- **Servidor 2 y 3**: Descargan desde Drive (más rápido)

### Caso 2: Backup en la Nube
- Catastros siempre disponibles en Google Drive
- No pierdes información si se daña el servidor local
- Puedes restaurar en cualquier momento

### Caso 3: Desarrollo y Producción
- **Desarrollo**: Descarga desde Drive (rápido)
- **Producción**: Descarga desde Drive (rápido)
- **Ambos**: Fallback al SRI si Drive falla

---

## 📊 Estadísticas de Ejemplo

```json
{
  "exito": true,
  "totalArchivos": 9,
  "tamañoTotal": 72400000,
  "tamañoTotalMB": "69.04",
  "tiposArchivos": {
    "xlsx": 9
  },
  "archivos": [
    {
      "nombre": "rimpe_negocios_populares.xlsx",
      "tamaño": 57580000,
      "tamañoMB": "54.91",
      "modificado": "2026-04-13T16:45:00.000Z",
      "link": "https://drive.google.com/file/d/1Abc.../view"
    },
    ...
  ]
}
```

---

## ⚠️ Notas Importantes

### Cuotas de Google Drive
- **Gratuito**: 15 GB (suficiente para ~200 actualizaciones de 69MB)
- **Google One**: 100 GB por ~$2/mes (si necesitas más espacio)
- Los archivos se **sobreescriben** automáticamente (no ocupan más espacio)

### Seguridad
- ✅ Los catastros son **información pública** del SRI
- ✅ La carpeta es de **solo lectura** para otros servidores
- ✅ La API Key puede restringirse a solo lectura
- ⚠️ No compartas la API Key públicamente

### Fallback Automático
Si Google Drive falla:
1. El sistema intenta descargar desde Drive
2. Si falla → intenta desde SRI automáticamente
3. Registra el error en logs
4. Notifica en el dashboard

---

## 🚀 Comandos Rápidos

### Subir todos los catastros
```bash
curl -X POST http://localhost:3000/api/drive/subir-todos
```

### Descargar todos desde Drive
```bash
curl -X POST http://localhost:3000/api/drive/descargar-todos
```

### Ver estadísticas
```bash
curl http://localhost:3000/api/drive/estadisticas
```

### Sincronizar (subir solo los nuevos)
```bash
curl -X POST http://localhost:3000/api/drive/sincronizar
```

---

## 📝 Resumen

| Configuración | Valor |
|---------------|-------|
| Peso total | **69.04 MB** |
| Espacio en Drive | ~69 MB (0.46% de 15GB gratis) |
| Actualización | Cada 15 días |
| Verificación | Cada 6 horas |
| Fallback | Automático al SRI |
| Costo | **GRATIS** (15GB de Google Drive) |

---

*Guía creada: 13 de abril de 2026*
