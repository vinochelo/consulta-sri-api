#  Google Drive CDN - Guía Rápida

## 📊 Resumen

- **Peso total de catastros**: **69.04 MB**
- **Espacio en Drive**: 0.46% de 15GB gratis
- **Actualización**: Cada 15 días automática
- **Costo**: **GRATIS**

---

## 🎯 ¿Cómo Funciona?

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUJO AUTOMÁTICO                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  SERVIDOR MASTER (solo 1)                                   │
│  ┌──────────────────────────────────────┐                   │
│  │ 1. Descarga del SRI cada 15 días     │                   │
│  │ 2. Sube automáticamente a Drive      │                   │
│  │ 3. Guarda registro                   │                   │
│  └──────────────────────────────────────┘                   │
│                      ↓                                        │
│              GOOGLE DRIVE (69 MB)                            │
│              📁 SRI-Catastros-CDN                            │
│                      ↓                                        │
│  TODOS LOS USUARIOS (ilimitados)                            │
│  ┌──────────────────────────────────────┐                   │
│  │ 1. Descargan desde Drive             │                   │
│  │ 2. Más rápido que SRI                │                   │
│  │ 3. Si Drive falla → SRI (fallback)   │                   │
│  └──────────────────────────────────────┘                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Configuración en 5 Minutos

### Paso 1: Crear Proyecto Google Cloud (3 min)

1. Ve a: https://console.cloud.google.com/
2. Clic en **"Seleccionar proyecto"** → **"Nuevo proyecto"**
3. Nombre: `sri-catastros`
4. Clic en **"Crear"**

### Paso 2: Habilitar Google Drive API (1 min)

1. Menú lateral: **"APIs y servicios"** → **"Biblioteca"**
2. Buscar: **"Google Drive API"**
3. Clic en **"Habilitar"**

### Paso 3: Crear API Key (1 min)

1. Menú lateral: **"APIs y servicios"** → **"Credenciales"**
2. Clic en **"Crear credenciales"** → **"Clave de API"**
3. **Copiar la API Key** (se ve así: `AIzaSy...`)

### Paso 4: Crear Carpeta en Drive (30 seg)

1. Abre: https://drive.google.com/
2. Clic en **"Nuevo"** → **"Carpeta"**
3. Nombre: `SRI-Catastros-CDN`
4. Clic derecho en carpeta → **"Compartir"**
5. Configura: **"Cualquier persona con el enlace"**
6. **Copiar el Folder ID** del enlace:
   ```
   https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
                                         ↑ ESTE ES EL ID
   ```

### Paso 5: Configurar .env (30 seg)

Crea archivo `.env` en la raíz del proyecto:

```env
# Google Drive CDN
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
GOOGLE_DRIVE_API_KEY=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123456789

# Solo UN servidor es Master (el que sube)
GOOGLE_DRIVE_MASTER=true  # ← Solo en el servidor principal
```

### Paso 6: Instalar Dependencia

```bash
npm install googleapis
```

### Paso 7: Subir Catastros (Primera Vez)

```bash
# Desde el dashboard
http://localhost:3000 → Pestaña "Catastros SRI" → "Subir a Google Drive"

# O desde la API
curl -X POST http://localhost:3000/api/drive/subir-todos
```

---

## 📁 Estructura en Google Drive

```
📁 SRI-Catastros-CDN/
  ├── 📄 grandes_contribuyentes.xlsx (0.05 MB)
  ├── 📄 agentes_retencion.xlsx (3.78 MB)
  ├── 📄 exportadores_bienes.xlsx (2.56 MB)
  ├── 📄 exportadores_servicios.xlsx (1.50 MB)
  ├── 📄 contribuyentes_especiales.xlsx (1.23 MB)
  ├── 📄 rimpe_emprendedores.xlsx (4.66 MB)
  ├── 📄 rimpe_negocios_populares.xlsx (54.91 MB)
  ├── 📄 porcentajes_renta.xlsx (0.32 MB)
  └──  porcentajes_iva.xlsx (0.03 MB)
  
  TOTAL: 69.04 MB
```

---

## 🔄 Flujo Automático

### Servidor Master (cada 15 días)
```
00:00 → Verifica si hay actualizaciones
00:01 → Descarga catastros nuevos del SRI
00:05 → Sube archivos actualizados a Drive
00:06 → Registra fecha de subida
✅ Listo por 15 días
```

### Servidores Usuarios (cada 6 horas)
```
00:00 → Verifica si Drive tiene archivos nuevos
00:01 → Descarga desde Drive (rápido)
00:05 → Catastros actualizados localmente
✅ Si Drive falla → Intenta SRI
```

---

## 💡 Configuración por Tipo de Servidor

### Servidor Principal (Master)
```env
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_MASTER=true  # ← SUBE a Drive
```

### Servidores Secundarios (Usuarios)
```env
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_MASTER=false  # ← SOLO DESCARGA de Drive
```

### Desarrollo Local
```env
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_MASTER=false  # ← Descarga desde Drive
```

---

## ✅ Verificación

### Verificar estado
```bash
curl http://localhost:3000/api/drive/estadisticas
```

**Respuesta esperada:**
```json
{
  "exito": true,
  "totalArchivos": 9,
  "tamañoTotalMB": "69.04",
  "ultimaSubida": "2026-04-13T16:45:00.000Z",
  "archivos": [
    { "nombre": "rimpe_negocios_populares.xlsx", "tamañoMB": "54.91" },
    ...
  ]
}
```

### Verificar logs
```
[SCHEDULER] 🌟 Modo MASTER: Descargando del SRI y subiendo a Drive
[SCHEDULER] ⬆️ Subiendo catastros a Google Drive...
[SCHEDULER] ✅ 9 archivos subidos a Drive
```

---

## 🚨 Solución de Problemas

### ❌ "No se encontró la API"
```bash
npm install googleapis
```

### ❌ "Permission denied"
- Verifica que la carpeta sea **"Cualquier persona con el enlace"**
- Verifica que la API Key tenga acceso a Drive API

### ❌ "Folder not found"
- Verifica el Folder ID (debe empezar con `1`)
- Asegúrate de que la carpeta existe en Drive

### ❌ Drive lento o caído
- El sistema usa **SRI como fallback** automáticamente
- Los catastros locales se mantienen mientras Drive vuelve

---

## 📊 Estadísticas de Uso

| Métrica | Valor |
|---------|-------|
| Archivos subidos | 9 |
| Tamaño total | 69.04 MB |
| Espacio usado en Drive | 0.46% de 15GB |
| Actualización | Cada 15 días |
| Verificación | Cada 6 horas |
| Costo mensual | $0 (gratis) |

---

## 🎉 ¡Listo!

Una vez configurado:
- ✅ **No necesitas hacer nada más**
- ✅ Se actualiza automáticamente cada 15 días
- ✅ Todos los usuarios acceden desde Drive (rápido)
- ✅ SRI solo como respaldo si Drive falla

---

*Guía creada: 13 de abril de 2026*
