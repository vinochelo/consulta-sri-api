# 🔧 Configuración de Service Account para Google Drive

## 📋 Paso 1: Crear Service Account en Google Cloud

### 1.1 Ve a Service Accounts
1. Abre: https://console.cloud.google.com/iam-admin/serviceaccounts
2. Selecciona tu proyecto: **sri-catastros-cdn** (o el que creaste)
3. Clic en **"+ CREAR CUENTA DE SERVICIO"** (arriba)

### 1.2 Configura la Cuenta
- **Nombre de la cuenta de servicio**: `sri-catastros-uploader`
- **ID de la cuenta de servicio**: Se genera automáticamente (ej: `sri-catastros-uploader@sri-catastros-cdn.iam.gserviceaccount.com`)
- **Descripción**: `Sube catastros del SRI a Google Drive automáticamente`
- Clic en **"CREAR Y CONTINUAR"**

### 1.3 Asigna Rol
- En **"Seleccionar un rol"**, busca y selecciona: **"Propietario"**
- Clic en **"CONTINUAR"**

### 1.4 Finaliza
- No otorgues acceso de usuario adicional (opcional)
- Clic en **"LISTO"**

---

## 🔑 Paso 2: Crear Clave JSON

### 2.1 Genera la Clave
1. En la lista de cuentas de servicio, busca `sri-catastros-uploader`
2. Clic en el **email** de la cuenta (se ve como: `sri-catastros-uploader@...iam.gserviceaccount.com`)
3. Ve a la pestaña **"CLAVES"** (arriba)
4. Clic en **"AÑADIR CLAVE"** → **"Crear nueva clave"**
5. Tipo: **JSON**
6. Clic en **"CREAR"**
7. **Se descarga un archivo JSON** - **GUÁRDALO INMEDIATAMENTE** (solo se muestra una vez)

### 2.2 Mueve el Archivo
1. **Renombra** el archivo descargado a: `service-account.json`
2. **Muévelo** a la raíz de tu proyecto (donde está el `package.json`)

Estructura final:
```
c:\Users\Mathew\.gemini\antigravity\scratch\consulta api SRI\
├── service-account.json          ← Tu archivo aquí
├── package.json
├── .env
├── src/
└── data/
```

---

## 📁 Paso 3: Compartir Carpeta con Service Account

### 3.1 Copia el Email del Service Account
Del archivo `service-account.json`, copia el valor de `"client_email"`:
```json
{
  "client_email": "sri-catastros-uploader@sri-catastros-cdn.iam.gserviceaccount.com",
  ...
}
```

### 3.2 Comparte la Carpeta de Drive
1. Abre Google Drive: https://drive.google.com/
2. Busca la carpeta `SRI-Catastros-CDN`
3. Clic derecho → **"Compartir"** → **"Compartir"**
4. En **"Agregar personas o grupos"**, pega el email del Service Account:
   ```
   sri-catastros-uploader@sri-catastros-cdn.iam.gserviceaccount.com
   ```
5. Permisos: **Editor** (para poder subir archivos)
6. **Desmarca** "Notificar a las personas"
7. Clic en **"Enviar"**

---

## ✅ Paso 4: Verificar Configuración

Tu archivo `.env` ya debe tener:

```env
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE=service-account.json
GOOGLE_DRIVE_FOLDER_ID=12ZAeJAa6mwBbB6JfUnzoOeh8mv9FWp8M
GOOGLE_DRIVE_MASTER=true
```

**Verifica que:**
- ✅ `service-account.json` está en la raíz del proyecto
- ✅ La carpeta `SRI-Catastros-CDN` está compartida con el email del Service Account
- ✅ El Folder ID es correcto

---

## 🚀 Paso 5: Reiniciar y Probar

### 5.1 Reinicia el Servidor
```bash
npm start
```

### 5.2 Sube los Catastros a Drive
```bash
curl -X POST http://localhost:3000/api/drive/subir-todos
```

**Respuesta esperada:**
```json
{
  "exito": true,
  "total": 9,
  "subidos": 9,
  "fallidos": 0,
  "resultados": [
    { "archivo": "grandes_contribuyentes.xlsx", "exito": true, ... },
    ...
  ]
}
```

### 5.3 Verifica en Google Drive
1. Abre: https://drive.google.com/
2. Ve a la carpeta `SRI-Catastros-CDN`
3. Deberías ver los 9 archivos Excel subidos ✅

---

## 🔄 Flujo Automático

Una vez configurado:

### Servidor Master (cada 15 días)
```
00:00 → Descarga catastros del SRI
00:05 → Compara con versión anterior
00:06 → Si cambió → Sube automáticamente a Drive
00:07 → Registra fecha de subida
✅ Listo por 15 días
```

### Todos los Usuarios (cada 24 horas)
```
00:00 → Verifica si Drive tiene archivos nuevos
00:01 → Si hay cambios → Descarga desde Drive
00:02 → Si no hay cambios → Mantiene datos locales
✅ Catastros siempre actualizados
```

---

## 📊 Verificar Estado

```bash
# Ver estadísticas de Drive
curl http://localhost:3000/api/drive/estadisticas

# Verificar actualizaciones
curl http://localhost:3000/api/drive/verificar
```

---

## 🚨 Solución de Problemas

### ❌ "Archivo de Service Account no encontrado"
- Verifica que `service-account.json` está en la raíz del proyecto
- Verifica que el nombre es exactamente `service-account.json`

### ❌ "File not found: 404"
- Verifica que la carpeta está compartida con el email del Service Account
- Verifica que el Folder ID es correcto

### ❌ "Permission denied"
- Verifica que el rol del Service Account es **"Propietario"** o **"Editor"**
- Verifica que la carpeta está compartida con permisos de **Editor**

### ❌ Los archivos no se suben
- Verifica los logs del servidor: `tail -f server.log`
- Verifica que `GOOGLE_DRIVE_MASTER=true` en `.env`

---

## 🎉 ¡Listo!

Ahora tu sistema:
- ✅ Sube automáticamente a Drive cada 15 días
- ✅ Todos los usuarios descargan desde Drive
- ✅ Si Drive no cambió → mantiene datos locales
- ✅ Si Drive falla → fallback al SRI
- ✅ **100% automático**

---

*Guía creada: 13 de abril de 2026*
