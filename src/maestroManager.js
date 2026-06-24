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
async function obtenerResumenFiscal(ruc, estadosAnteriores = []) {
  const resultados = await buscarRUCEnCatastro(ruc, 'todos');
  
  // Si los catastros principales no están disponibles, no podemos saber el estado real,
  // así que para evitar falsos negativos (volver a todos "Régimen General"), omitimos.
  const totalCatastros = Object.keys(resultados).length;
  const noDisponibles = Object.values(resultados).filter(r => !r.disponible).length;
  if (totalCatastros > 0 && noDisponibles === totalCatastros) {
    return null;
  }

  const estados = [];
  
  // Grande Contribuyente
  if (resultados.grandes_contribuyentes?.disponible) {
    if (resultados.grandes_contribuyentes.encontrado) estados.push('Grande Contribuyente');
  } else if (estadosAnteriores.includes('Grande Contribuyente')) {
    estados.push('Grande Contribuyente');
  }

  // Agente de Retención
  if (resultados.agentes_retencion?.disponible) {
    if (resultados.agentes_retencion.encontrado) estados.push('Agente de Retención');
  } else if (estadosAnteriores.includes('Agente de Retención')) {
    estados.push('Agente de Retención');
  }

  // Exportador Bienes
  if (resultados.exportadores_bienes?.disponible) {
    if (resultados.exportadores_bienes.encontrado) estados.push('Exportador Bienes');
  } else if (estadosAnteriores.includes('Exportador Bienes')) {
    estados.push('Exportador Bienes');
  }

  // Exportador Servicios
  if (resultados.exportadores_servicios?.disponible) {
    if (resultados.exportadores_servicios.encontrado) estados.push('Exportador Servicios');
  } else if (estadosAnteriores.includes('Exportador Servicios')) {
    estados.push('Exportador Servicios');
  }

  // RIMPE Emprendedor
  if (resultados.rimpe_emprendedores?.disponible) {
    if (resultados.rimpe_emprendedores.encontrado) estados.push('RIMPE Emprendedor');
  } else if (estadosAnteriores.includes('RIMPE Emprendedor')) {
    estados.push('RIMPE Emprendedor');
  }

  // RIMPE Negocio Popular
  if (resultados.rimpe_negocios_populares?.disponible) {
    if (resultados.rimpe_negocios_populares.encontrado) estados.push('RIMPE Negocio Popular');
  } else if (estadosAnteriores.includes('RIMPE Negocio Popular')) {
    estados.push('RIMPE Negocio Popular');
  }

  // Contribuyente Especial
  if (resultados.contribuyentes_especiales?.disponible) {
    if (resultados.contribuyentes_especiales.encontrado) estados.push('Contribuyente Especial');
  } else if (estadosAnteriores.includes('Contribuyente Especial')) {
    estados.push('Contribuyente Especial');
  }

  // Buscar nombre de forma robusta en los catastros donde se haya encontrado
  let nombre = 'Nombre no encontrado';
  for (const r of Object.values(resultados)) {
    if (r.datos) {
      const val = r.datos.nombre || r.datos.razonSocial || r.datos.razon_social || 
                  r.datos['Razón Social'] || r.datos['RAZON SOCIAL'] || 
                  r.datos['Nombre'] || r.datos['NOMBRE'];
      if (val && val !== 'Nombre no encontrado') {
        nombre = String(val).trim();
        break;
      }
    }
  }

  return {
    ruc,
    nombre,
    estados: estados.length > 0 ? estados : ['Régimen General'],
    ultimaVerificacion: new Date().toISOString(),
    detalleCompleto: resultados
  };
}

/**
 * Sincroniza todo el maestro contra los catastros del SRI
 */
async function sincronizarMaestroCompleto() {
  console.log('[MAESTRO] 🔄 Sincronizando Maestro de Proveedores...');
  const maestro = await cargarMaestro();
  const notificaciones = await cargarNotificaciones();
  const rucs = Object.keys(maestro);
  let cambiosDetectados = 0;

  for (const ruc of rucs) {
    const estadoAnterior = maestro[ruc].estados.join(', ');
    const nuevoResumen = await obtenerResumenFiscal(ruc, maestro[ruc].estados);
    if (!nuevoResumen) {
      console.log(`[MAESTRO] ⚠️ Omitiendo sincronización para RUC ${ruc} por indisponibilidad de catastros.`);
      continue;
    }
    const estadoNuevo = nuevoResumen.estados.join(', ');

    // Preservar nombre anterior si el nuevo no tiene un nombre válido
    const nombreAnterior = maestro[ruc].nombre;
    const nombreFinal = (nuevoResumen.nombre && nuevoResumen.nombre !== 'Nombre no encontrado')
      ? nuevoResumen.nombre
      : (nombreAnterior && nombreAnterior !== 'Nombre no encontrado')
        ? nombreAnterior
        : 'Nombre no encontrado';

    if (estadoAnterior !== estadoNuevo) {
      console.log(`[MAESTRO] 🔔 CAMBIO DETECTADO: ${ruc} | ${estadoAnterior} -> ${estadoNuevo}`);
      
      notificaciones.push({
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        ruc,
        nombre: nombreFinal,
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
      nombre: nombreFinal,
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
    const resumen = await obtenerResumenFiscal(ruc, maestro[ruc].estados);
    if (!resumen) return maestro[ruc];
    const nombreFinal = (resumen.nombre && resumen.nombre !== 'Nombre no encontrado')
      ? resumen.nombre
      : (maestro[ruc].nombre && maestro[ruc].nombre !== 'Nombre no encontrado')
        ? maestro[ruc].nombre
        : (nombre || 'Nombre no encontrado');
    maestro[ruc] = { 
      ...maestro[ruc], 
      ...resumen,
      nombre: nombreFinal
    };
  } else {
    console.log(`[MAESTRO] ✨ Añadiendo nuevo proveedor: ${ruc}`);
    const resumen = await obtenerResumenFiscal(ruc);
    if (resumen) {
      if (nombre && resumen.nombre === 'Nombre no encontrado') {
        resumen.nombre = nombre;
      }
      maestro[ruc] = resumen;
    } else {
      maestro[ruc] = {
        ruc,
        nombre: nombre || 'Nombre no encontrado',
        estados: ['Pendiente sincronizar'],
        ultimaVerificacion: new Date().toISOString()
      };
    }
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
