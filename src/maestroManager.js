const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { buscarRUCEnCatastro, CATASTROS_CONFIG } = require('./catalogManager');

const MAESTRO_FILE = path.join(DATA_DIR, 'maestro_proveedores.json');
const NOTIFICACIONES_FILE = path.join(DATA_DIR, 'notificaciones_cambios.json');

/**
 * Carga el maestro de proveedores desde el disco
 */
async function cargarMaestro() {
  try {
    if (!fsSync.existsSync(MAESTRO_FILE)) return {};
    const data = await fs.readFile(MAESTRO_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[MAESTRO] Error cargando maestro:', error);
    return {};
  }
}

/**
 * Guarda el maestro de proveedores
 */
async function guardarMaestro(data) {
  try {
    await fs.writeFile(MAESTRO_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[MAESTRO] Error guardando maestro:', error);
  }
}

/**
 * Carga o inicializa notificaciones
 */
async function cargarNotificaciones() {
  try {
    if (!fsSync.existsSync(NOTIFICACIONES_FILE)) return [];
    const data = await fs.readFile(NOTIFICACIONES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

/**
 * Guarda notificaciones
 */
async function guardarNotificaciones(notificaciones) {
  try {
    await fs.writeFile(NOTIFICACIONES_FILE, JSON.stringify(notificaciones.slice(-50), null, 2)); // Guardar últimas 50
  } catch (error) {
    console.error('[MAESTRO] Error guardando notificaciones:', error);
  }
}

/**
 * Obtiene el resumen fiscal de un RUC cruzando todos los catastros
 */
async function obtenerResumenFiscal(ruc) {
  const resultados = await buscarRUCEnCatastro(ruc, 'todos');
  const estados = [];
  
  // Extraer etiquetas relevantes
  if (resultados.grandes_contribuyentes?.encontrado) estados.push('Grande Contribuyente');
  if (resultados.agentes_retencion?.encontrado) estados.push('Agente de Retención');
  if (resultados.exportadores_bienes?.encontrado) estados.push('Exportador Bienes');
  if (resultados.exportadores_servicios?.encontrado) estados.push('Exportador Servicios');
  
  // RIMPE
  if (resultados.rimpe_emprendedores?.encontrado) estados.push('RIMPE Emprendedor');
  if (resultados.rimpe_negocios_populares?.encontrado) estados.push('RIMPE Negocio Popular');
  
  if (resultados.contribuyentes_especiales?.encontrado) estados.push('Contribuyente Especial');

  return {
    ruc,
    nombre: Object.values(resultados).find(r => r.datos)?.datos?.nombre || 'Nombre no encontrado',
    estados: estados.length > 0 ? estados : ['Régimen General'],
    ultimaVerificacion: new Date().toISOString(),
    detalleCompleto: resultados
  };
}

/**
 * Sincroniza todo el maestro contra los catastros del SRI
 */
async function sincronizarMaestroCompleto() {
  console.log('[MAESTRO] 🔄 Iniciando sincronización automática del Maestro de Proveedores...');
  const maestro = await cargarMaestro();
  const notificaciones = await cargarNotificaciones();
  const rucs = Object.keys(maestro);
  let cambiosDetectados = 0;

  for (const ruc of rucs) {
    const estadoAnterior = maestro[ruc].estados.join(', ');
    const nuevoResumen = await obtenerResumenFiscal(ruc);
    const estadoNuevo = nuevoResumen.estados.join(', ');

    if (estadoAnterior !== estadoNuevo) {
      console.log(`[MAESTRO] 🔔 CAMBIO DETECTADO: ${ruc} | ${estadoAnterior} -> ${estadoNuevo}`);
      
      notificaciones.push({
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        ruc,
        nombre: nuevoResumen.nombre,
        tipo: 'cambio_estado',
        anterior: estadoAnterior,
        nuevo: estadoNuevo,
        fecha: new Date().toISOString(),
        leida: false
      });

      cambiosDetectados++;
    }

    // Actualizar registro
    maestro[ruc] = {
      ...maestro[ruc],
      ...nuevoResumen,
      ultimoEstado: estadoNuevo
    };
  }

  await guardarMaestro(maestro);
  await guardarNotificaciones(notificaciones);
  
  console.log(`[MAESTRO] ✅ Sincronización finalizada. ${cambiosDetectados} cambios notificados.`);
  return { exito: true, total: rucs.length, cambios: cambiosDetectados };
}

/**
 * Añade un nuevo proveedor al maestro (desde búsqueda o factura)
 */
async function agregarAlMaestro(ruc, nombre = null) {
  const maestro = await cargarMaestro();
  
  if (maestro[ruc]) {
    // Si ya existe, solo actualizar datos fiscales
    const resumen = await obtenerResumenFiscal(ruc);
    maestro[ruc] = { ...maestro[ruc], ...resumen };
  } else {
    console.log(`[MAESTRO] ✨ Añadiendo nuevo proveedor: ${ruc}`);
    const resumen = await obtenerResumenFiscal(ruc);
    if (nombre) resumen.nombre = nombre;
    maestro[ruc] = resumen;
  }
  
  await guardarMaestro(maestro);
  return maestro[ruc];
}

/**
 * Procesa un buffer de Excel y extrae los proveedores para el maestro
 */
async function procesarExcelMaestro(buffer) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheet = workbook.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
  
  const maestro = await cargarMaestro();
  let nuevos = 0;
  
  for (const row of data) {
    // Buscar columnas que parezcan RUC y Nombre
    const rucKey = Object.keys(row).find(k => k.toLowerCase().includes('ruc') || k.toLowerCase().includes('identificacion'));
    const nombreKey = Object.keys(row).find(k => k.toLowerCase().includes('nombre') || k.toLowerCase().includes('razon') || k.toLowerCase().includes('proveedor'));
    
    if (rucKey && row[rucKey]) {
      const ruc = String(row[rucKey]).trim().replace(/\D/g, '');
      if (ruc.length >= 10) {
        if (!maestro[ruc]) {
          maestro[ruc] = {
            ruc,
            nombre: nombreKey ? String(row[nombreKey]).trim() : 'Cargado por Excel',
            estados: ['Pendiente sincronizar'],
            ultimaVerificacion: new Date().toISOString()
          };
          nuevos++;
        } else if (nombreKey && row[nombreKey]) {
          // Actualizar nombre si viene en el Excel
          maestro[ruc].nombre = String(row[nombreKey]).trim();
        }
      }
    }
  }
  
  await guardarMaestro(maestro);
  return { exito: true, procesados: data.length, nuevos };
}

module.exports = {
  sincronizarMaestroCompleto,
  agregarAlMaestro,
  procesarExcelMaestro,
  cargarMaestro,
  cargarNotificaciones,
  guardarNotificaciones
};
