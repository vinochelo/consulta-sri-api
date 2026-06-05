# Gestión de Catastros del SRI - Guía de Uso

## 📋 Descripción

Sistema automatizado de **descarga, almacenamiento y consulta** de los catastros del SRI (Servicio de Rentas Internas del Ecuador). Mantiene la información actualizada automáticamente cada **15 días** y permite validar retenciones contra los registros oficiales.

---

## 🚀 Características

### ✅ Descarga Automática Programada
- Los catastros se descargan **automáticamente cada 15 días**
- El scheduler verifica actualizaciones **cada 6 horas**
- Detecta cambios comparando el contenido (no solo la fecha)
- Registra historial de descargas exitosas y fallidas

### ✅ Tipos de Catastros Disponibles

| Tipo | Descripción | Uso |
|------|-------------|-----|
| **Grandes Contribuyentes** | Listado de grandes contribuyentes | Validación de obligados a declaración mensual |
| **Agentes de Retención** | Catastro de agentes autorizados | Verificar si un emisor puede emitir retenciones |
| **Exportadores Habituales (Bienes)** | Exportadores con certificado vigente | Retenciones especiales para exportadores |
| **Exportadores Habituales (Servicios)** | Exportadores de servicios | Validación de retenciones de servicios exportados |
| **RIMPE** | Régimen Simplificado (emprendedores y populares) | Validar régimen fiscal del contribuyente |
| **Contribuyentes Especiales** | Listado de contribuyentes especiales | Obligaciones tributarias especiales |

### ✅ Consulta de RUC en Catastros
- Busca un RUC en **todos los catastros descargados** simultáneamente
- Muestra información detallada del contribuyente
- Detecta inconsistencias (ej: emite retenciones pero no es agente de retención)

### ✅ Configuración de URLs Personalizadas
- Si el SRI cambia los enlaces de descarga, puedes **pegar los links manualmente**
- El sistema guarda las URLs y las usa para descargas futuras
- No necesitas reprogramar nada, solo actualizar el link

---

## 🛠️ Cómo Usar

### 1️⃣ Iniciar el Servidor

```bash
npm start
```

El scheduler de catastros se inicia **automáticamente** si está configurado.

### 2️⃣ Acceder al Dashboard

Abre tu navegador en: `http://localhost:3000`

Haz clic en la pestaña **"Catastros SRI"**

### 3️⃣ Configurar URLs de Descarga (Importante)

El SRI no expone URLs directas de descarga en su página. Debes obtenerlas manualmente:

#### Opción A: Obtener URLs desde la página del SRI

1. Ve a: https://www.sri.gob.ec/catastros
2. Haz clic derecho en el botón **"Descargar"** del catastro que quieres
3. Selecciona **"Copiar dirección de enlace"**
4. Pega esa URL en el campo correspondiente en la sección **"Configurar URLs de Descarga"**
5. Haz clic en **"Guardar"**

#### Opción B: Descarga Manual de Archivos

Si la descarga automática no funciona:

1. Descarga el archivo Excel desde la página del SRI
2. Ve a la pestaña de catastros y usa la opción de **carga manual** (próximamente)

### 4️⃣ Descargar Catastros

Una vez configuradas las URLs:

- Haz clic en **"Descargar Todos"** para bajar todos los catastros configurados
- O descarga individualmente cada catastro con el botón **"Descargar"**

### 5️⃣ Verificar Actualizaciones

- Haz clic en **"Verificar Ahora"** para forzar una comprobación de actualizaciones
- El sistema comparará el contenido remoto con el local
- Si hay cambios, descargará automáticamente las versiones actualizadas

### 6️⃣ Consultar un RUC

1. Ingresa el RUC en el campo de consulta (mínimo 10 dígitos)
2. Haz clic en **"Buscar en Catastros"**
3. El sistema buscará en todos los catastros descargados
4. Verás:
   - ✅ Si el RUC está encontrado (en qué catastros)
   - ❌ Si no está en ningún catastro
   - 📋 Datos detallados del contribuyente

---

## ⚙️ Configuración con Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Cada cuántos días actualizar catastros (default: 15)
CATASTRO_ACTUALIZACION_DIAS=15

# Activar/desactivar scheduler (default: true)
CATASTRO_SCHEDULER=true
```

---

## 📁 Estructura de Archivos

```
data/
└── catastros/
    ├── metadata.json           # Registro de descargas y hashes
    ├── scheduler.json          # Estado del programador
    ├── grandes_contribuyentes.xlsx
    ├── agentes_retencion.xlsx
    ├── exportadores_bienes.xlsx
    ├── exportadores_servicios.xlsx
    ├── rimpe_emprendedores.xlsx
    └── contribuyentes_especiales.xlsx
```

---

## 🔌 Endpoints de la API

### Gestión de Catastros

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/catastros` | Lista todos los catastros y su estado |
| `GET` | `/api/catastros/verificar-actualizaciones` | Verifica si hay actualizaciones |
| `POST` | `/api/catastros/:tipo/descargar` | Descarga un catastro específico |
| `POST` | `/api/catastros/descargar-todos` | Descarga todos los catastros |
| `DELETE` | `/api/catastros/:tipo` | Elimina un catastro descargado |

### Consulta de RUC

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/catastros/buscar/:ruc` | Busca un RUC en los catastros |
| `GET` | `/api/catastros/contribuyente/:ruc` | Obtiene info completa del contribuyente |

### URLs Personalizadas

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/catastros/urls` | Obtiene URLs guardadas |
| `POST` | `/api/catastros/urls/:tipo` | Guarda URL para un catastro |
| `DELETE` | `/api/catastros/urls/:tipo` | Elimina URL guardada |

### Scheduler

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/scheduler/estado` | Estado del programador |
| `POST` | `/api/scheduler/iniciar` | Inicia el scheduler |
| `POST` | `/api/scheduler/detener` | Detiene el scheduler |
| `POST` | `/api/scheduler/verificar` | Fuerza verificación manual |

---

## 🎯 Casos de Uso para Validación de Retenciones

### Ejemplo 1: Verificar si un emisor es Agente de Retención

```javascript
// Consulta desde el frontend
const response = await fetch('/api/catastros/buscar/1798001200100');
const datos = await response.json();

if (datos.busqueda.agentes_retencion.encontrado) {
  console.log('✅ Es agente de retención autorizado');
} else {
  console.log('❌ NO es agente de retención - Posible inconsistencia');
}
```

### Ejemplo 2: Validar Régimen RIMPE

```javascript
const response = await fetch('/api/catastros/contribuyente/1798001200100');
const datos = await response.json();

if (datos.catastros.includes('rimpe_emprendedores')) {
  console.log('⚠️ Contribuyente RIMPE - No debería aplicar retenciones de IVA');
}
```

### Ejemplo 3: Verificar Exportador Habitual

```javascript
const response = await fetch('/api/catastros/buscar/1798001200100');
const datos = await response.json();

if (datos.busqueda.exportadores_bienes.encontrado) {
  console.log('✅ Exportador habitual con certificado vigente');
  // Aplicar reglas especiales de retención
}
```

---

## 🔧 Solución de Problemas

### ❌ "Catastro no descargado"

**Causa:** No se ha configurado la URL de descarga o el scheduler no se ha ejecutado.

**Solución:**
1. Configura la URL de descarga desde la página del SRI
2. Haz clic en "Descargar" manualmente

### ❌ Error de conexión con el SRI

**Causa:** La página del SRI puede estar caída o el enlace cambió.

**Solución:**
1. Verifica que puedas acceder a https://www.sri.gob.ec/catastros
2. Actualiza la URL de descarga si el SRI la cambió

### ❌ El scheduler no se ejecuta

**Causa:** Puede estar desactivado en la configuración.

**Solución:**
```env
# En tu archivo .env
CATASTRO_SCHEDULER=true
```

O inicia manualmente desde la API:
```bash
curl -X POST http://localhost:3000/api/scheduler/iniciar
```

---

## 📝 Notas Importantes

1. **Los catastros se guardan localmente** en `data/catastros/`
2. **No se borran automáticamente** - debes eliminarlos manualmente si ya no los necesitas
3. **El hash del archivo** se usa para detectar cambios (no la fecha)
4. **El scheduler verifica cada 6 horas** pero solo descarga si han pasado 15 días
5. **Las URLs del SRI pueden cambiar** - mantén actualizadas las URLs configuradas

---

## 🔄 Flujo de Actualización Automática

```
Cada 6 horas:
  ↓
  Verificar si han pasado 15 días desde última descarga
  ↓
  Si SÍ → Descargar versión nueva
  ↓
  Comparar hash del archivo remoto vs local
  ↓
  Si son diferentes → Guardar nuevo archivo
  ↓
  Actualizar metadata con fecha y cantidad de registros
```

---

## 💡 Próximas Mejoras (Roadmap)

- [ ] Carga manual de archivos Excel (si falla la descarga automática)
- [ ] Validación automática de retenciones contra catastros
- [ ] Alertas cuando un contribuyente cambia de régimen
- [ ] Exportar reporte de validación a Excel
- [ ] Scraping automático para obtener URLs de descarga
- [ ] Notificaciones por email cuando hay actualizaciones

---

## 📞 Soporte

Si tienes problemas o preguntas, revisa:
- Los logs de la consola del servidor
- El archivo `data/catastros/metadata.json` para ver el estado de descargas
- La pestaña de catastros en el dashboard para ver información en tiempo real
