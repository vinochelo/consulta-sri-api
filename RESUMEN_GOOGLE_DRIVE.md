# ✅ Google Drive CDN - Implementación Completa

## 📊 Peso Total de Catastros

| Archivo | Tamaño |
|---------|--------|
| rimpe_negocios_populares.xlsx | 54.91 MB |
| rimpe_emprendedores.xlsx | 4.66 MB |
| agentes_retencion.xlsx | 3.78 MB |
| exportadores_bienes.xlsx | 2.56 MB |
| exportadores_servicios.xlsx | 1.50 MB |
| contribuyentes_especiales.xlsx | 1.23 MB |
| porcentajes_renta.xlsx | 0.32 MB |
| grandes_contribuyentes.xlsx | 0.05 MB |
| porcentajes_iva.xlsx | 0.03 MB |
| **TOTAL** | **69.04 MB** |

---

## 🎯 Sistema Implementado

### Flujo Automático

```
SERVIDOR MASTER (solo 1)
  ↓ Cada 15 días
  1. Descarga del SRI
  2. Sube a Google Drive automáticamente
  3. Registra fecha
  ↓
GOOGLE DRIVE (69.04 MB - 0.46% de 15GB gratis)
  ↓
TODOS LOS USUARIOS (ilimitados)
  ↓ Cada 6 horas
  1. Descargan desde Drive (rápido)
  2. Si Drive falla → SRI (fallback)
  3. Mantienen catastros actualizados
```

### Prioridad de Descarga

1. **Google Drive** (principal, más rápido)
2. **URLs personalizadas** (si están configuradas)
3. **SRI** (último recurso)

---

## 🔧 Configuración Simplificada

### Variables de Entorno (.env)

```env
# Google Drive CDN
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_FOLDER_ID=tu-folder-id
GOOGLE_DRIVE_API_KEY=tu-api-key

# Solo UN servidor es Master
GOOGLE_DRIVE_MASTER=true  # ← Servidor principal
GOOGLE_DRIVE_MASTER=false # ← Todos los demás
```

### Dependencia

```bash
npm install googleapis
```

---

## 📡 Endpoints Disponibles

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/drive/subir-todos` | Sube todos los catastros a Drive |
| `POST` | `/api/drive/descargar-todos` | Descarga todos desde Drive |
| `GET` | `/api/drive/verificar` | Verifica si hay actualizaciones |
| `GET` | `/api/drive/estadisticas` | Estadísticas de uso |
| `POST` | `/api/drive/sincronizar` | Sube solo archivos nuevos |

---

## 📝 Archivos Creados/Modificados

### Nuevos Archivos
- ✅ `src/googleDriveCdn.js` - Cliente de Google Drive simplificado
- ✅ `GOOGLE_DRIVE_GUIA_RAPIDA.md` - Guía paso a paso
- ✅ `.env.example` - Configuración actualizada

### Archivos Modificados
- ✅ `src/config.js` - Variables de Google Drive
- ✅ `src/catalogManager.js` - Prioridad Drive → URLs → SRI
- ✅ `src/catalogScheduler.js` - Modo Master/Usuario
- ✅ `src/routes.js` - Endpoints de Google Drive

---

## 🚀 Cómo Usar

### 1. Configurar Google Drive (5 minutos)
1. Crear proyecto en Google Cloud
2. Habilitar Google Drive API
3. Crear API Key
4. Crear carpeta en Drive
5. Configurar `.env`

### 2. Servidor Master (sube a Drive)
```env
GOOGLE_DRIVE_MASTER=true
```
- Descarga del SRI cada 15 días
- Sube automáticamente a Drive
- **Solo 1 servidor debe ser Master**

### 3. Servidores Usuarios (descargan de Drive)
```env
GOOGLE_DRIVE_MASTER=false
```
- Descargan desde Drive cada 6 horas
- Más rápido que SRI
- Fallback automático al SRI si Drive falla

---

## ✅ Beneficios

| Ventaja | Descripción |
|---------|-------------|
| **Velocidad** | Google Drive es más rápido que el SRI |
| **Confiabilidad** | No dependes de la disponibilidad del SRI |
| **Gratuito** | 15GB gratis (usas solo 69MB = 0.46%) |
| **Automático** | Se actualiza cada 15 días sin intervención |
| **Escalable** | Ilimitados usuarios descargan desde Drive |
| **Fallback** | Si Drive falla, usa SRI automáticamente |

---

## 📊 Estadísticas

| Métrica | Valor |
|---------|-------|
| Peso total | 69.04 MB |
| Espacio en Drive | 0.46% de 15GB |
| Costo mensual | $0 (gratis) |
| Actualización | Cada 15 días |
| Verificación | Cada 6 horas |
| Usuarios soportados | Ilimitados |

---

## 🎉 ¡Listo para Usar!

Una vez configurado:
- ✅ **No necesitas hacer nada más**
- ✅ Se actualiza automáticamente
- ✅ Todos los usuarios acceden rápido
- ✅ SRI solo como respaldo

---

*Implementación completada: 13 de abril de 2026*
