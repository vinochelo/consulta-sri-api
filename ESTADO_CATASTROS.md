# 📋 Estado de Catastros - URLs Configuradas

## ✅ Catastros con URLs Configuradas (Descarga Automática Activa)

Estas URLs ya están guardadas en el sistema y se usan para descargas automáticas:

| # | Catastro | URL | Estado | Registros |
|---|----------|-----|--------|-----------|
| 1 | **Grandes Contribuyentes** | [Descargar Excel](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/42c75ec2-95cb-4fa3-9d7b-dc5f59e9e4e2/Catastro%20Grandes%20Contribuyentes.xlsx) | ✅ Activo | 521 |
| 2 | **Agentes de Retención** | [Descargar PDF](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/d23fe911-81c1-4e64-a1d0-d6e0a1f519ca/02%20Agentes%20de%20retenci%C3%B3n.pdf) | ⚠️ PDF (no Excel) | 41,060 |
| 3 | **Exportadores Hab. de Bienes** | [Descargar XLS](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/42ca9c72-324c-4f96-9f64-4743c3b8ddc6/Catastro_de_exportadores_bienes.xls) | ✅ Activo | 1,669 |
| 4 | **Exportadores Hab. de Servicios** | [Descargar XLS](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/2a87d5b1-7f66-448a-ad8f-2c9a417a5bb9/Catastro_de_exportadores_servicios.xls) | ✅ Activo | 1,586 |
| 5 | **Contribuyentes Especiales** | [Descargar XLS](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/d913cbd7-09aa-40a5-aa87-ed78d8c6ee41/INFORMACI%C3%93N%20DE%20CONTRIBUYENTES%20ESPECIALES.xls) | ✅ Activo | 1,586 |
| 6 | **Porcentajes Retención - Renta** | [Descargar XLS](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/e7df4e4f-ed02-4530-82f9-98a5b99b3392/porcentajes%20de%20retencion%20impuesto%20a%20la%20renta.xls) | ✅ Activo | 130 |
| 7 | **Porcentajes Retención - IVA** | [Descargar XLS](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/b809a747-e553-433b-aaec-7d89f88a6ef3/Retenciones_IVA.xls) | ✅ Activo | 21 |

---

## ⏳ Catastros Pendientes de Configurar

Estos catastros necesitan que pegues las URLs de descarga desde la web del SRI:

| # | Catastro | Descripción | Estado |
|---|----------|-------------|--------|
| 8 | **RIMPE - Emprendedores (2023)** | Información de emprendedores sujetos al RIMPE para el periodo fiscal 2023 | ⏳ URL pendiente |
| 9 | **RIMPE - Negocios Populares (2022)** | Información de negocios populares sujetos al RIMPE para el periodo fiscal 2022 | ⏳ URL pendiente |

---

## 🔧 Cómo Configurar las URLs de RIMPE

### Paso 1: Obtener las URLs desde la Web del SRI

1. Ve a: **https://www.sri.gob.ec/catastros**
2. Busca la sección: **"Listado referencial del Régimen Simplificado para Emprendedores y Negocios Populares (RIMPE)"**
3. Verás 2 enlaces:
   - ✅ "Información de emprendedores sujetos al RIMPE para el periodo fiscal 2023"
   - ✅ "Información de negocios populares sujetos al RIMPE para el periodo fiscal 2022"

### Paso 2: Copiar los Enlaces de Descarga

Para cada enlace:
1. Haz clic derecho en el botón **"Ir a la página"**
2. Selecciona **"Copiar dirección de enlace"**
3. El enlace tendrá este formato:
   ```
   https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/[ID-UNICO]/[nombre-archivo].xls
   ```

### Paso 3: Pegar en la Aplicación

1. Abre tu dashboard: **http://localhost:3000**
2. Ve a la pestaña **"Catastros SRI"**
3. En la sección **"Configurar URLs de Descarga"**, busca:
   - **RIMPE - Emprendedores (2023)**
   - **RIMPE - Negocios Populares (2022)**
4. Pega la URL correspondiente en cada campo
5. Haz clic en **"Guardar"**

### Paso 4: Descargar los Catastros

1. Haz clic en el botón **"Descargar Todos"**
2. O descarga individualmente cada catastro
3. El sistema guardará los archivos y los mantendrá actualizados

---

## 📊 Resumen del Sistema

| Métrica | Valor |
|---------|-------|
| Total de catastros | 9 |
| URLs configuradas | 7/9 |
| Catastros descargados | 8/9 |
| Catastros activos | 8 |
| Catastros pendientes | 1 (RIMPE Negocios Populares) |

---

## ⚠️ Notas Importantes

### Agentes de Retención (PDF)
El archivo de Agentes de Retención es un **PDF**, no un Excel. El sistema puede leerlo pero con limitaciones. Si necesitas datos estructurados, considera convertirlo a Excel manualmente.

### RIMPE - 2 Categorías Separadas
El SRI divide RIMPE en:
- **Emprendedores**: Personas naturales con actividades empresariales (periodo 2023)
- **Negocios Populares**: Pequeños negocios con ingresos menores (periodo 2022)

Cada categoría tiene su propio archivo y debe configurarse por separado.

---

## 🔄 Actualización Automática

Una vez configuradas todas las URLs:
- ✅ El sistema verificará actualizaciones **cada 6 horas**
- ✅ Descargar nuevas versiones **cada 15 días**
- ✅ Comparará el contenido para detectar cambios
- ✅ Mantendrá un registro de todas las descargas

---

## 📁 Archivos Almacenados

Todos los archivos se guardan en:
```
data/catastros/
├── grandes_contribuyentes.xlsx          ✅ (47 KB - 521 registros)
├── agentes_retencion.pdf                 ⚠️ (3.8 MB - 41,060 registros)
├── exportadores_bienes.xls               ✅ (2.6 MB - 1,669 registros)
├── exportadores_servicios.xls            ✅ (1.6 MB - 1,586 registros)
├── rimpe_emprendedores.xlsx              ⏳ (Pendiente de URL)
├── rimpe_negocios_populares.xlsx         ⏳ (Pendiente de URL)
├── contribuyentes_especiales.xls         ✅ (1.6 MB - 1,586 registros)
├── porcentajes_renta.xls                 ✅ (333 KB - 130 registros)
├── porcentajes_iva.xls                   ✅ (29 KB - 21 registros)
├── metadata.json                         📋 (Registro de descargas)
└── scheduler.json                        ⚙️ (Estado del programador)
```

---

## ✅ Próximos Pasos

1. **Obtener URLs de RIMPE** desde la web del SRI
2. **Configurar las 2 URLs** en el dashboard
3. **Descargar los catastros** con el botón "Descargar Todos"
4. **Verificar** que los archivos se guardaron correctamente
5. **¡Listo!** El sistema mantendrá todo actualizado automáticamente

---

## 🔗 Enlaces Rápidos

- **Dashboard**: http://localhost:3000
- **Pestaña Catastros**: http://localhost:3000 → "Catastros SRI"
- **Web del SRI**: https://www.sri.gob.ec/catastros
- **API de Catastros**: http://localhost:3000/api/catastros
- **API de URLs**: http://localhost:3000/api/catastros/urls

---

*Última actualización: 13 de abril de 2026*
