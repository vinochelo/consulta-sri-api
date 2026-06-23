const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const XLSX = require('xlsx');
const https = require('https');
const { config } = require('./config');

// Importar Google Drive CDN si está disponible
let googleDriveCdn;
try {
  googleDriveCdn = require('./googleDriveCdn');
} catch {
  googleDriveCdn = null;
}

// ─── Configuración de Catastros del SRI ─────────────────────────────────

/**
 * URLs de descarga de los catastros del SRI.
 * Estos links se obtienen de https://www.sri.gob.ec/catastros
 * El sistema verificará periódicamente si hay actualizaciones.
 */
const CATASTROS_CONFIG = {
  maestro_proveedores: {
    nombre: 'Maestro de Proveedores (Frecuentes)',
    descripcion: 'Listado prioritario de proveedores frecuentes del negocio',
    url: '', // Carga manual
    tipo: 'excel',
    prioridad: 1,
    campos: ['ruc', 'nombre', 'referencia'],
    actualizacionAutomatica: false,
  },
  grandes_contribuyentes: {
    nombre: 'Grandes Contribuyentes',
    descripcion: 'Listado de grandes contribuyentes del SRI',
    url: 'https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/42c75ec2-95cb-4fa3-9d7b-dc5f59e9e4e2/Catastro%20Grandes%20Contribuyentes.xlsx', // Enlace directo fallback
    tipo: 'excel',
    campos: ['ruc', 'nombre', 'categoria'],
    actualizacionAutomatica: true,
  },
  agentes_retencion: {
    nombre: 'Agentes de Retención',
    descripcion: 'Catastro de agentes de retención autorizados',
    url: 'https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/d23fe911-81c1-4e64-a1d0-d6e0a1f519ca/02%20Agentes%20de%20retenci%C3%B3n.pdf',
    tipo: 'excel',
    campos: ['ruc', 'nombre', 'tipo_retencion'],
    actualizacionAutomatica: true,
  },
  exportadores_bienes: {
    nombre: 'Exportadores Habituales de Bienes',
    descripcion: 'Catálogo de exportadores habituales de bienes (retención IVA)',
    url: 'https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/42ca9c72-324c-4f96-9f64-4743c3b8ddc6/Catastro_de_exportadores_bienes.xls',
    tipo: 'excel',
    campos: ['ruc', 'nombre', 'certificado', 'vigencia'],
    actualizacionAutomatica: true,
  },
  exportadores_servicios: {
    nombre: 'Exportadores Habituales de Servicios',
    descripcion: 'Catálogo de exportadores habituales de servicios (retención IVA)',
    url: 'https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/2a87d5b1-7f66-448a-ad8f-2c9a417a5bb9/Catastro_de_exportadores_servicios.xls',
    tipo: 'excel',
    campos: ['ruc', 'nombre', 'certificado', 'vigencia'],
    actualizacionAutomatica: true,
  },
  rimpe_emprendedores: {
    nombre: 'RIMPE - Emprendedores (Periodo Fiscal 2023)',
    descripcion: 'Información de emprendedores sujetos al RIMPE para el periodo fiscal 2023',
    url: 'https://www.sri.gob.ec/catastros',
    tipo: 'excel',
    campos: ['ruc', 'nombre', 'actividad'],
    actualizacionAutomatica: true,
  },
  rimpe_negocios_populares: {
    nombre: 'RIMPE - Negocios Populares (Periodo Fiscal 2022)',
    descripcion: 'Información de negocios populares sujetos al RIMPE para el periodo fiscal 2022',
    url: 'https://www.sri.gob.ec/catastros',
    tipo: 'excel',
    campos: ['ruc', 'nombre', 'actividad'],
    actualizacionAutomatica: true,
  },
  contribuyentes_especiales: {
    nombre: 'Contribuyentes Especiales',
    descripcion: 'Catastro de contribuyentes especiales',
    url: 'https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/d913cbd7-09aa-40a5-aa87-ed78d8c6ee41/INFORMACI%C3%93N%20DE%20CONTRIBUYENTES%20ESPECIALES.xls',
    tipo: 'excel',
    campos: ['ruc', 'nombre'],
    actualizacionAutomatica: true,
  },
  // ─── Porcentajes de Retención ───────────────────────────────────
  porcentajes_renta: {
    nombre: 'Porcentajes de Retención - Impuesto a la Renta',
    descripcion: 'Tabla de porcentajes de retención del impuesto a la renta según tipo de gasto',
    url: 'https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/e7df4e4f-ed02-4530-82f9-98a5b99b3392/porcentajes%20de%20retencion%20impuesto%20a%20la%20renta.xls',
    tipo: 'excel',
    campos: ['codigo', 'concepto', 'porcentaje', 'base_legal'],
    actualizacionAutomatica: true,
  },
  porcentajes_iva: {
    nombre: 'Porcentajes de Retención - IVA',
    descripcion: 'Tabla de porcentajes de retención del IVA según tipo de bien/servicio',
    url: 'https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/b809a747-e553-433b-aaec-7d89f88a6ef3/Retenciones_IVA.xls',
    tipo: 'excel',
    campos: ['codigo', 'concepto', 'porcentaje', 'aplicacion'],
    actualizacionAutomatica: true,
  },
};

// Directorio para almacenar catastros
const CATASTROS_DIR = path.join(__dirname, '..', 'data', 'catastros');
const METADATA_FILE = path.join(CATASTROS_DIR, 'metadata.json');

// ─── Memoria Caché para Consultas Ultra-Rápidas ──────────────────────────
// Mapa global para guardar los catastros en memoria y evitar lecturas de disco
// Estructura: Map<tipo, { registros, index, mtime, infoHojas }>
const CATALOGO_CACHE = new Map();

/**
 * Limpia un RUC de guiones y espacios para comparación eficiente
 */
function limpiarRUC(ruc) {
  if (!ruc) return '';
  return String(ruc).replace(/[-\s]/g, '').trim();
}

/**
 * Asegura que un catastro esté cargado en memoria y actualizado.
 */
async function asegurarCache(tipo) {
  const rutaArchivo = obtenerRutaArchivo(tipo);
  
  if (!fsSync.existsSync(rutaArchivo)) return null;

  const stats = fsSync.statSync(rutaArchivo);
  const mtime = stats.mtimeMs;

  if (CATALOGO_CACHE.has(tipo)) {
    const cached = CATALOGO_CACHE.get(tipo);
    if (cached.mtime === mtime) return cached;
  }

  // SEMÁFORO: Si ya se está cargando este tipo, esperar (evita cargas duplicadas)
  if (CATALOGO_CACHE.get(`${tipo}_loading`)) {
    while (CATALOGO_CACHE.get(`${tipo}_loading`)) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return CATALOGO_CACHE.get(tipo);
  }

  CATALOGO_CACHE.set(`${tipo}_loading`, true);
  console.log(`[Cache] 📥 Procesando catastro pesado: ${tipo}...`);
  
  try {
    const rutaCacheDisco = path.join(CATASTROS_DIR, `${tipo}.json_cache`);
    let resultado;

    // Intentar leer caché en disco (MUCHO más rápido que parsear Excel)
    if (fsSync.existsSync(rutaCacheDisco)) {
      const cacheStats = fsSync.statSync(rutaCacheDisco);
      // Solo usar si el caché es más nuevo que el Excel original
      if (cacheStats.mtimeMs > mtime) {
        try {
          console.log(`[Cache] ⚡ Cargando desde caché en disco: ${tipo}`);
          const raw = await fs.readFile(rutaCacheDisco, 'utf-8');
          resultado = JSON.parse(raw);
        } catch (e) {
          console.error(`[Cache] Error leyendo caché disco para ${tipo}, re-parseando Excel...`);
        }
      }
    }

    if (!resultado) {
      // Parseo Real (Solo si no hay caché o es vieja)
      if (tipo === 'grandes_contribuyentes') {
        resultado = await parsearGrandesContribuyentes();
      } else if (tipo === 'exportadores_bienes') {
        resultado = await parsearExportadoresBienes();
      } else if (tipo === 'exportadores_servicios') {
        resultado = await parsearExportadoresServicios();
      } else if (tipo === 'contribuyentes_especiales') {
        resultado = await parsearContribuyentesEspeciales();
      } else {
        // Optimización para RIMPE: Usar modo "raw" si es muy grande
        const isBig = stats.size > 10 * 1024 * 1024; // > 10MB
        const workbook = XLSX.readFile(rutaArchivo, { 
          type: 'file',
          cellDates: false,
          cellStyles: false,
          cellNF: false,
          cellText: false
        });
        const primeraHoja = workbook.SheetNames[0];
        const datos = XLSX.utils.sheet_to_json(workbook.Sheets[primeraHoja], { defval: '' });
        resultado = { registros: datos, infoHojas: { [primeraHoja]: { totalFilas: datos.length } } };
      }

      // Guardar en disco para la próxima vez (proceso en background)
      fs.writeFile(rutaCacheDisco, JSON.stringify(resultado)).catch(err => {
        console.error(`[Cache] Error guardando cache disco para ${tipo}:`, err.message);
      });
    }

    // Indexación en memoria (O(1))
    const index = new Map();
    resultado.registros.forEach(reg => {
      const rucRaw = reg.ruc || reg.RUC || reg.NUMERO_RUC || reg.B || reg['NÚMERO RUC'] || Object.values(reg)[0];
      const rucLimpio = limpiarRUC(rucRaw);
      if (rucLimpio) index.set(rucLimpio, reg);
    });

    const cacheData = {
      registros: resultado.registros,
      index,
      mtime,
      infoHojas: resultado.infoHojas
    };

    CATALOGO_CACHE.set(tipo, cacheData);
    return cacheData;
  } catch (error) {
    console.error(`Error cargando cache para ${tipo}:`, error);
    return null;
  } finally {
    CATALOGO_CACHE.set(`${tipo}_loading`, false);
  }
}

// Agente HTTPS que acepta certificados sin fallar
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

// ─── Funciones auxiliares ───────────────────────────────────────────────

/**
 * Asegura que el directorio de catastros exista
 */
async function asegurarDirectorio() {
  try {
    await fs.mkdir(CATASTROS_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

/**
 * Lee el archivo de metadatos (registra fecha de descarga, versión, etc.)
 */
async function leerMetadata() {
  try {
    const contenido = await fs.readFile(METADATA_FILE, 'utf-8');
    return JSON.parse(contenido);
  } catch {
    return { catastros: {}, ultimaVerificacion: null };
  }
}

/**
 * Guarda el archivo de metadatos
 */
async function guardarMetadata(metadata) {
  await asegurarDirectorio();
  await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * Obtiene la ruta del archivo de un catastro
 */
function obtenerRutaArchivo(tipo) {
  return path.join(CATASTROS_DIR, `${tipo}.xlsx`);
}

/**
 * Calcula si han pasado más de X días desde una fecha
 */
function hanPasadoDias(fechaISO, dias) {
  if (!fechaISO) return true;
  const fecha = new Date(fechaISO);
  const ahora = new Date();
  const diferenciaMs = ahora - fecha;
  const diasMs = dias * 24 * 60 * 60 * 1000;
  return diferenciaMs >= diasMs;
}

// ─── Scraping de URLs de descarga ──────────────────────────────────────

/**
 * Hace scraping de la página de catastros para obtener los URLs reales
 * de descarga. El SRI usa botones "Descargar" que apuntan a archivos
 * almacenados en su sistema.
 *
 * NOTA: El SRI no expone URLs directas en el HTML, sino que usa
 * JavaScript para activar la descarga. Esta función intenta extraer
 * los links reales.
 */
async function obtenerURLDescarga(tipo) {
  try {
    // Intentar obtener la página de catastros
    const response = await fetch('https://www.sri.gob.ec/catastros', {
      agent: httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status} al acceder a catastros del SRI`);
    }

    const html = await response.text();

    // Buscar patrones de descarga en el HTML
    // El SRI suele tener enlaces como: /o/sri-portlet-biblioteca-alfresco-internet/descargar/...
    const regexDescarga = /\/o\/sri-portlet-biblioteca-alfresco-internet\/descargar\/[^"'\s]+/g;
    const matches = html.match(regexDescarga);

    if (matches && matches.length > 0) {
      // Filtrar los matches según el tipo de catastro
      let keyword = '';
      if (tipo === 'grandes_contribuyentes') keyword = 'Grandes';
      else if (tipo === 'agentes_retencion') keyword = 'retencion';
      else if (tipo === 'exportadores_bienes') keyword = 'exportadores_bienes';
      else if (tipo === 'exportadores_servicios') keyword = 'exportadores_servicios';
      else if (tipo === 'rimpe_emprendedores') keyword = 'emprendedores';
      else if (tipo === 'rimpe_negocios_populares') keyword = 'negocios_populares';
      else if (tipo === 'contribuyentes_especiales') keyword = 'ESPECIALES';
      else if (tipo === 'porcentajes_renta') keyword = 'renta';
      else if (tipo === 'porcentajes_iva') keyword = 'IVA';

      if (keyword) {
        const matchFiltrado = matches.find(m => m.toLowerCase().includes(keyword.toLowerCase()));
        if (matchFiltrado) {
          return `https://www.sri.gob.ec${matchFiltrado}`;
        }
      }

      // Devolver el primer match encontrado (debería ser el más relevante)
      return `https://www.sri.gob.ec${matches[0]}`;
    }

    // Si no se encuentra un enlace directo, devolver la URL base
    // El usuario deberá proporcionar el link manualmente
    return null;
  } catch (error) {
    console.error(`Error obteniendo URL para ${tipo}:`, error.message);
    return null;
  }
}

// ─── Descarga de catastros ─────────────────────────────────────────────

/**
 * Descarga un catastro.
 * Prioridad: Google Drive → URLs personalizadas → SRI
 */
async function descargarCatastro(tipo, urlPersonalizada = null, forzarSRI = false) {
  await asegurarDirectorio();

  const configCatastro = CATASTROS_CONFIG[tipo];
  if (!configCatastro) {
    throw new Error(`Tipo de catastro no reconocido: ${tipo}`);
  }

  const metadata = await leerMetadata();
  const rutaArchivo = obtenerRutaArchivo(tipo);

  // ─── PRIORIDAD 1: Google Drive CDN (Solo si NO forzamos SRI) ────────
  if (!forzarSRI && config.googleDriveEnabled && googleDriveCdn && config.googleDriveFolderId) {
    try {
      console.log(`[CATASTRO] 🌐 Descargando ${configCatastro.nombre} desde Google Drive...`);

      const driveConfig = await googleDriveCdn.leerConfig();
      const archivos = await googleDriveCdn.listarArchivos(config.googleDriveFolderId);

      // Buscar archivo que coincida con el tipo
      const archivoDrive = archivos.find(a => a.name.includes(tipo));

      if (archivoDrive) {
        await googleDriveCdn.descargarArchivo(archivoDrive.id, rutaArchivo);
        console.log(`[CATASTRO] ✅ ${configCatastro.nombre} descargado desde Google Drive`);

        // Procesar archivo descargado
        return await procesarArchivoDescargado(tipo, configCatastro, metadata, rutaArchivo);
      } else {
        console.log(`[CATASTRO] ⚠️ ${configCatastro.nombre} no encontrado en Drive, intentando SRI...`);
      }
    } catch (error) {
      console.error(`[CATASTRO] ❌ Error descargando desde Drive: ${error.message}`);
      console.log('[CATASTRO] ⚠️ Reintentando desde SRI...');
    }
  }

  // ─── PRIORIDAD 2: URLs personalizadas guardadas ────────────────────
  const urlsGuardadas = metadata.urlsPersonalizadas || {};
  const urlDescarga = urlPersonalizada || urlsGuardadas[tipo] || configCatastro.url;

  if (urlDescarga && urlDescarga !== configCatastro.url) {
    console.log(`[CATASTRO] 📥 Descargando ${configCatastro.nombre} desde URL personalizada...`);

    try {
      const response = await fetch(urlDescarga, {
        agent: httpsAgent,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });

      if (response.ok) {
        const buffer = await response.buffer();
        await fs.writeFile(rutaArchivo, buffer);
        console.log(`[CATASTRO] ✅ ${configCatastro.nombre} descargado desde URL personalizada`);
        return await procesarArchivoDescargado(tipo, configCatastro, metadata, rutaArchivo, buffer);
      }
    } catch (error) {
      console.error(`[CATASTRO] ❌ Error con URL personalizada: ${error.message}`);
    }
  }

  // ─── PRIORIDAD 3: SRI (último recurso) ─────────────────────────────
  console.log(`[CATASTRO] 🏛️ Descargando ${configCatastro.nombre} desde SRI (último recurso)...`);

  try {
    const response = await fetch(configCatastro.url, {
      agent: httpsAgent,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.buffer();
    await fs.writeFile(rutaArchivo, buffer);

    return await procesarArchivoDescargado(tipo, configCatastro, metadata, rutaArchivo, buffer);
  } catch (error) {
    console.error(`[CATASTRO] ❌ Error descargando desde SRI:`, error.message);

    if (!metadata.catastros[tipo]) {
      metadata.catastros[tipo] = { nombre: configCatastro.nombre };
    }
    metadata.catastros[tipo].ultimoError = error.message;
    metadata.catastros[tipo].ultimoIntentoFallido = new Date().toISOString();
    await guardarMetadata(metadata);

    throw error;
  }
}

/**
 * Procesa un archivo recién descargado (calcula hash, cuenta registros, etc.)
 */
async function procesarArchivoDescargado(tipo, configCatastro, metadata, rutaArchivo, buffer = null) {
  // Calcular hash
  let hash;
  if (buffer) {
    hash = calcularHashSimple(buffer);
  } else {
    const contenido = await fs.readFile(rutaArchivo);
    hash = calcularHashSimple(contenido);
  }

  // Verificar actualización
  const datosPrevios = metadata.catastros[tipo];
  let hayActualizacion = !datosPrevios;

  if (datosPrevios && datosPrevios.hash && datosPrevios.hash !== hash) {
    hayActualizacion = true;
    console.log(`[CATASTRO] Se detectó actualización en ${configCatastro.nombre}`);
  } else if (datosPrevios && datosPrevios.hash === hash) {
    hayActualizacion = false;
    console.log(`[CATASTRO] ${configCatastro.nombre} ya está actualizado`);
  }

  // Actualizar metadata
  metadata.catastros[tipo] = {
    nombre: configCatastro.nombre,
    ultimaDescarga: new Date().toISOString(),
    tamaño: buffer ? buffer.length : (await fs.stat(rutaArchivo)).size,
    hash,
    url: configCatastro.url,
    actualizacion: hayActualizacion ? 'Sí' : 'No',
    registros: 0,
  };

  // Contar registros
  try {
    const workbook = XLSX.readFile(rutaArchivo);
    const primeraHoja = workbook.SheetNames[0];
    const datos = XLSX.utils.sheet_to_json(workbook.Sheets[primeraHoja]);
    metadata.catastros[tipo].registros = datos.length;
    metadata.catastros[tipo].hojas = workbook.SheetNames;
  } catch {
    // Si no se puede leer, se deja en 0
  }

  metadata.ultimaVerificacion = new Date().toISOString();
  await guardarMetadata(metadata);

  // INVALIDAR CACHÉ: Eliminar la entrada de memoria para que la próxima búsqueda
  // recargue el archivo con los datos nuevos.
  if (CATALOGO_CACHE.has(tipo)) {
    console.log(`[Cache] Invalidando cache por actualización de archivo: ${tipo}`);
    CATALOGO_CACHE.delete(tipo);
  }

  return {
    exito: true,
    tipo,
    nombre: configCatastro.nombre,
    registros: metadata.catastros[tipo].registros,
    tamaño: metadata.catastros[tipo].tamaño,
    actualizacion: hayActualizacion,
    mensaje: hayActualizacion
      ? `${configCatastro.nombre} descargado y actualizado correctamente`
      : `${configCatastro.nombre} ya estaba actualizado`,
  };
}

/**
 * Calcula un hash simple de un buffer para detectar cambios
 * Usa una suma de verificación simple (no criptográfica)
 */
function calcularHashSimple(buffer) {
  let hash = 0;
  const length = buffer.length;

  // Usar primeros 1000 bytes + tamaño para hash rápido
  const sampleSize = Math.min(length, 1000);
  for (let i = 0; i < sampleSize; i++) {
    hash = ((hash << 5) - hash + buffer[i]) | 0;
  }

  // Incorporar tamaño del archivo
  hash = hash ^ length;

  return hash.toString(16);
}

// ─── Carga manual de catastros ─────────────────────────────────────────

/**
 * Carga un catastro desde un buffer de archivo Excel (subido por el usuario)
 *
 * @param {string} tipo - Tipo de catastro
 * @param {Buffer} buffer - Contenido del archivo Excel
 * @param {string} url - URL de origen (opcional)
 * @returns {object} Resultado de la carga
 */
async function cargarCatastroManual(tipo, buffer, url = null) {
  await asegurarDirectorio();

  const configCatastro = CATASTROS_CONFIG[tipo];
  if (!configCatastro) {
    throw new Error(`Tipo de catastro no reconocido: ${tipo}`);
  }

  const rutaArchivo = obtenerRutaArchivo(tipo);
  const metadata = await leerMetadata();

  // Guardar archivo
  await fs.writeFile(rutaArchivo, buffer);

  // Calcular hash
  const hash = calcularHashSimple(buffer);

  // Verificar si hay actualización
  const datosPrevios = metadata.catastros[tipo];
  let hayActualizacion = !datosPrevios;

  if (datosPrevios && datosPrevios.hash && datosPrevios.hash !== hash) {
    hayActualizacion = true;
  }

  // Leer el archivo para obtener información
  const workbook = XLSX.readFile(rutaArchivo);
  const primeraHoja = workbook.SheetNames[0];
  const datos = XLSX.utils.sheet_to_json(workbook.Sheets[primeraHoja]);

  // Actualizar metadata
  metadata.catastros[tipo] = {
    nombre: configCatastro.nombre,
    ultimaDescarga: new Date().toISOString(),
    tamaño: buffer.length,
    hash: hash,
    url: url || 'Carga manual',
    actualizacion: hayActualizacion ? 'Sí' : 'No',
    registros: datos.length,
    hojas: workbook.SheetNames,
    columnas: datos.length > 0 ? Object.keys(datos[0]) : [],
  };

  metadata.ultimaVerificacion = new Date().toISOString();
  await guardarMetadata(metadata);

  // INVALIDAR CACHÉ: Forzar recarga de los nuevos datos subidos manualmente
  if (CATALOGO_CACHE.has(tipo)) {
    console.log(`[Cache] Invalidando cache por carga manual: ${tipo}`);
    CATALOGO_CACHE.delete(tipo);
  }

  return {
    exito: true,
    tipo,
    nombre: configCatastro.nombre,
    registros: datos.length,
    columnas: metadata.catastros[tipo].columnas,
    hojas: workbook.SheetNames,
    actualizacion: hayActualizacion,
    mensaje: `${configCatastro.nombre} cargado correctamente con ${datos.length} registros`,
  };
}

// ─── Consulta de catastros ─────────────────────────────────────────────

/**
 * Busca un RUC en un catastro específico
 *
 * @param {string} ruc - RUC a buscar
 * @param {string} tipo - Tipo de catastro (o 'todos' para buscar en todos)
 * @returns {object} Resultado de la búsqueda
 */
async function buscarRUCEnCatastro(ruc, tipo = 'todos') {
  const rucLimpio = limpiarRUC(ruc);
  const resultados = {};
  const tiposABuscar = tipo === 'todos' ? Object.keys(CATASTROS_CONFIG) : [tipo];

  // Ejecutar búsquedas secuencialmente para no saturar memoria/CPU con archivos grandes
  for (const tipoCatastro of tiposABuscar) {
    try {
      // Obtener datos de la caché (se cargan/actualizan automáticamente si es necesario)
      const cache = await asegurarCache(tipoCatastro);
      
      if (!cache) {
        resultados[tipoCatastro] = {
          encontrado: false,
          disponible: false,
          mensaje: 'Catastro no descargado',
        };
        continue;
      }

      // Búsqueda instantánea en el Map (O(1))
      const datosEncontrados = cache.index.get(rucLimpio);
      const encontrado = !!datosEncontrados;

      resultados[tipoCatastro] = {
        encontrado,
        disponible: true,
        datos: datosEncontrados,
        infoHojas: cache.infoHojas,
        mensaje: encontrado
          ? `Encontrado en ${CATASTROS_CONFIG[tipoCatastro].nombre}${datosEncontrados?._hojaOrigen ? ` (Hoja: ${datosEncontrados._hojaOrigen})` : ''}`
          : `No se encontró en ${CATASTROS_CONFIG[tipoCatastro].nombre}`,
      };
    } catch (error) {
      console.error(`Error buscando en ${tipoCatastro}:`, error);
      resultados[tipoCatastro] = {
        encontrado: false,
        disponible: false,
        error: error.message,
        mensaje: `Error leyendo catastro: ${error.message}`,
      };
    }
  }

  return resultados;
}

/**
 * Verifica si un RUC está en un catastro específico
 *
 * @param {string} ruc - RUC a verificar
 * @param {string} tipo - Tipo de catastro
 * @returns {boolean} True si está en el catastro
 */
async function estaEnCatastro(ruc, tipo) {
  const resultado = await buscarRUCEnCatastro(ruc, tipo);
  return resultado[tipo]?.encontrado || false;
}

/**
 * Obtiene información completa de un contribuyente buscando en todos
 * los catastros disponibles
 *
 * @param {string} ruc - RUC del contribuyente
 * @returns {object} Información del contribuyente
 */
async function obtenerInfoContribuyente(ruc) {
  const busqueda = await buscarRUCEnCatastro(ruc, 'todos');

  const info = {
    ruc,
    encontrado: false,
    catastros: [],
    detalles: {},
  };

  for (const [tipo, resultado] of Object.entries(busqueda)) {
    if (resultado.encontrado) {
      info.encontrado = true;
      info.catastros.push(tipo);
      info.detalles[tipo] = resultado.datos;
    }
  }

  return info;
}

// ─── Gestión de catastros ──────────────────────────────────────────────

/**
 * Lista todos los catastros disponibles y su estado
 */
async function listarCatastros() {
  const metadata = await leerMetadata();
  const resultados = [];

  for (const [tipo, config] of Object.entries(CATASTROS_CONFIG)) {
    const rutaArchivo = obtenerRutaArchivo(tipo);
    const existeArchivo = fsSync.existsSync(rutaArchivo);
    const meta = metadata.catastros[tipo] || {};

    resultados.push({
      tipo,
      nombre: config.nombre,
      descripcion: config.descripcion,
      disponible: existeArchivo,
      registros: meta.registros || 0,
      ultimaDescarga: meta.ultimaDescarga || null,
      actualizacion: meta.actualizacion || 'No verificado',
      tamaño: meta.tamaño || 0,
      url: meta.url || config.url,
      error: meta.ultimoError || null,
    });
  }

  return {
    catastros: resultados,
    ultimaVerificacionGeneral: metadata.ultimaVerificacion || null,
    totalCatastros: resultados.length,
    disponibles: resultados.filter((c) => c.disponible).length,
  };
}

/**
 * Elimina un catastro descargado
 */
async function eliminarCatastro(tipo) {
  const rutaArchivo = obtenerRutaArchivo(tipo);

  try {
    if (fsSync.existsSync(rutaArchivo)) {
      await fs.unlink(rutaArchivo);
    }

    const metadata = await leerMetadata();
    delete metadata.catastros[tipo];
    await guardarMetadata(metadata);

    return {
      exito: true,
      tipo,
      mensaje: `Catastro ${tipo} eliminado correctamente`,
    };
  } catch (error) {
    throw new Error(`Error eliminando catastro ${tipo}: ${error.message}`);
  }
}

/**
 * Descarga todos los catastros configurados para actualización automática
 */
async function descargarTodosCatastros(urlsPersonalizadas = {}, forzarSRI = false) {
  const resultados = [];
  let exitosos = 0;
  let fallidos = 0;
  let hayCambiosTotales = false;

  for (const [tipo, config] of Object.entries(CATASTROS_CONFIG)) {
    if (!config.actualizacionAutomatica) {
      continue;
    }

    try {
      const url = urlsPersonalizadas[tipo] || null;
      const resultado = await descargarCatastro(tipo, url, forzarSRI);
      
      if (resultado.actualizacion) {
        hayCambiosTotales = true;
      }

      resultados.push({ tipo, exito: true, ...resultado });
      exitosos++;
    } catch (error) {
      resultados.push({ tipo, exito: false, error: error.message });
      fallidos++;
    }
  }

  return {
    exito: fallidos === 0,
    total: exitosos + fallidos,
    exitosos,
    fallidos,
    hayCambiosTotales,
    resultados,
  };
}

/**
 * Verifica si hay actualizaciones disponibles para los catastros.
 * Compara archivos locales con Google Drive (si está configurado).
 * Solo marca para descarga si Drive tiene archivos más nuevos.
 */
async function verificarActualizaciones() {
  const metadata = await leerMetadata();
  const actualizaciones = [];

  // Si Google Drive está habilitado, verificar archivos en Drive
  let archivosDrive = null;
  if (config.googleDriveEnabled && googleDriveCdn && config.googleDriveFolderId) {
    try {
      archivosDrive = await googleDriveCdn.listarArchivos(config.googleDriveFolderId);
      console.log(`[VERIFICACIÓN] ✅ Conectado a Google Drive (${archivosDrive.length} archivos)`);
    } catch (error) {
      console.log(`[VERIFICACIÓN] ⚠️ No se pudo conectar a Drive: ${error.message}`);
      console.log('[VERIFICACIÓN] 📁 Usando verificación local');
    }
  }

  for (const [tipo, configCatastro] of Object.entries(CATASTROS_CONFIG)) {
    const rutaArchivo = obtenerRutaArchivo(tipo);
    const existeArchivo = fsSync.existsSync(rutaArchivo);

    if (!existeArchivo) {
      actualizaciones.push({
        tipo,
        nombre: configCatastro.nombre,
        requiereDescarga: true,
        motivo: 'Catastro no descargado',
      });
      continue;
    }

    const meta = metadata.catastros[tipo];
    const ultimaDescargaLocal = meta?.ultimaDescarga || null;

    // Si tenemos información de Drive, comparar fechas
    if (archivosDrive) {
      const archivoDrive = archivosDrive.find(a => a.name.includes(tipo));

      if (archivoDrive) {
        const fechaDrive = new Date(archivoDrive.modifiedTime);
        const fechaLocal = ultimaDescargaLocal ? new Date(ultimaDescargaLocal) : new Date(0);

        // Si Drive es más nuevo que local → requiere descarga
        if (fechaDrive > fechaLocal) {
          actualizaciones.push({
            tipo,
            nombre: configCatastro.nombre,
            requiereDescarga: true,
            motivo: `Drive tiene versión más reciente (${archivoDrive.modifiedTime})`,
            ultimaDescarga: ultimaDescargaLocal,
            fechaEnDrive: archivoDrive.modifiedTime,
          });
        } else {
          // Drive no tiene cambios → mantener datos locales
          actualizaciones.push({
            tipo,
            nombre: configCatastro.nombre,
            requiereDescarga: false,
            motivo: 'Sin cambios en Drive (manteniendo datos locales)',
            ultimaDescarga: ultimaDescargaLocal,
          });
        }
      } else {
        // No encontrado en Drive → verificar por fecha local
        if (!ultimaDescargaLocal || hanPasadoDias(ultimaDescargaLocal, 15)) {
          actualizaciones.push({
            tipo,
            nombre: configCatastro.nombre,
            requiereDescarga: true,
            motivo: 'No encontrado en Drive o han pasado más de 15 días',
            ultimaDescarga: ultimaDescargaLocal,
          });
        } else {
          actualizaciones.push({
            tipo,
            nombre: configCatastro.nombre,
            requiereDescarga: false,
            motivo: 'Catastro actualizado',
            ultimaDescarga: ultimaDescargaLocal,
          });
        }
      }
    } else {
      // Sin Drive → verificar solo por fecha local (15 días)
      if (!ultimaDescargaLocal || hanPasadoDias(ultimaDescargaLocal, 15)) {
        actualizaciones.push({
          tipo,
          nombre: configCatastro.nombre,
          requiereDescarga: true,
          motivo: 'Han pasado más de 15 días desde la última descarga',
          ultimaDescarga: ultimaDescargaLocal,
        });
      } else {
        actualizaciones.push({
          tipo,
          nombre: configCatastro.nombre,
          requiereDescarga: false,
          motivo: 'Catastro actualizado',
          ultimaDescarga: ultimaDescargaLocal,
        });
      }
    }
  }

  return {
    actualizaciones,
    requierenDescarga: actualizaciones.filter((a) => a.requiereDescarga).length,
    actualizados: actualizaciones.filter((a) => !a.requiereDescarga).length,
    fuente: archivosDrive ? 'Google Drive' : 'Local',
    verificadoEn: new Date().toISOString(),
  };
}

// ─── Configuración de URLs personalizadas ──────────────────────────────

/**
 * Guarda URLs personalizadas para descarga de catastros.
 * Esto permite al usuario especificar links directos de descarga
 * en lugar de usar el scraping automático.
 */
async function guardarURLPersonalizada(tipo, url) {
  const metadata = await leerMetadata();

  if (!metadata.urlsPersonalizadas) {
    metadata.urlsPersonalizadas = {};
  }

  metadata.urlsPersonalizadas[tipo] = url;
  await guardarMetadata(metadata);

  return {
    exito: true,
    tipo,
    url,
    mensaje: `URL personalizada guardada para ${CATASTROS_CONFIG[tipo]?.nombre || tipo}`,
  };
}

/**
 * Obtiene todas las URLs personalizadas guardadas
 */
async function obtenerURLsPersonalizadas() {
  const metadata = await leerMetadata();
  return metadata.urlsPersonalizadas || {};
}

/**
 * Elimina una URL personalizada
 */
async function eliminarURLPersonalizada(tipo) {
  const metadata = await leerMetadata();

  if (metadata.urlsPersonalizadas) {
    delete metadata.urlsPersonalizadas[tipo];
    await guardarMetadata(metadata);
  }

  return {
    exito: true,
    tipo,
    mensaje: 'URL personalizada eliminada',
  };
}

// ─── Parseo Especializado de Catastros ─────────────────────────────

/**
 * Lee todas las hojas de un archivo Excel y combina los datos.
 * Detecta automáticamente las hojas con datos reales (ignorando metadata).
 * 
 * @param {string} rutaArchivo - Ruta del archivo Excel
 * @param {object} opciones - Opciones de parseo
 * @param {number} opciones.skipRows - Filas a saltar al inicio (default: 0)
 * @param {function} opciones.filterFn - Función para filtrar filas válidas
 * @param {string[]} opciones.hojasIncluir - Hojas específicas a incluir (opcional)
 * @param {string[]} opciones.hojasExcluir - Hojas a excluir (opcional)
 * @returns {object} Datos combinados de todas las hojas
 */
function leerTodasLasHojas(rutaArchivo, opciones = {}) {
  const {
    skipRows = 0,
    filterFn = null,
    hojasIncluir = null,
    hojasExcluir = []
  } = opciones;

  if (!fsSync.existsSync(rutaArchivo)) {
    throw new Error(`Archivo no encontrado: ${rutaArchivo}`);
  }

  const workbook = XLSX.readFile(rutaArchivo);
  let hojasAProcesar = workbook.SheetNames;

  // Filtrar hojas si se especificó
  if (hojasIncluir && hojasIncluir.length > 0) {
    hojasAProcesar = hojasAProcesar.filter(h => hojasIncluir.includes(h));
  }

  if (hojasExcluir.length > 0) {
    hojasAProcesar = hojasAProcesar.filter(h => !hojasExcluir.some(ex => h.includes(ex)));
  }

  const todasLasFilas = [];
  const infoHojas = {};

  for (const nombreHoja of hojasAProcesar) {
    const hoja = workbook.Sheets[nombreHoja];
    const datos = XLSX.utils.sheet_to_json(hoja, {
      defval: '',
      header: 'A'
    });

    // Saltar filas de metadata/encabezado
    const datosReales = datos.slice(skipRows);

    // Aplicar filtro si existe
    const datosFiltrados = filterFn
      ? datosReales.filter(filterFn)
      : datosReales;

    // Verificar si la hoja tiene datos reales (no solo encabezados)
    const tieneDatos = datosFiltrados.some(fila => {
      const valores = Object.values(fila);
      return valores.some(v => v && String(v).trim().length > 0);
    });

    if (tieneDatos) {
      infoHojas[nombreHoja] = {
        totalFilas: datos.length,
        filasDatos: datosFiltrados.length,
        columnas: Object.keys(datosFiltrados[0] || {})
      };

      // Añadir datos con identificador de hoja
      datosFiltrados.forEach(fila => {
        todasLasFilas.push({
          ...fila,
          _hojaOrigen: nombreHoja
        });
      });
    }
  }

  return {
    exito: true,
    totalHojas: hojasAProcesar.length,
    hojasConDatos: Object.keys(infoHojas).length,
    infoHojas,
    totalRegistros: todasLasFilas.length,
    registros: todasLasFilas
  };
}

/**
 * Parsea el archivo de Grandes Contribuyentes correctamente.
 * Estructura:
 *   Fila 1: "Total:" 520
 *   Fila 2: Cabeceras (RUC, Razón Social, etc.)
 *   Fila 3+: Datos
 * 
 * NOTA: Este archivo puede tener múltiples hojas (Sociedades, Personas Naturales)
 */
async function parsearGrandesContribuyentes() {
  const rutaArchivo = obtenerRutaArchivo('grandes_contribuyentes');

  if (!fsSync.existsSync(rutaArchivo)) {
    throw new Error('Archivo de grandes contribuyentes no encontrado');
  }

  try {
    const resultado = leerTodasLasHojas(rutaArchivo, {
      skipRows: 1, // Saltar fila de "Total:"
      filterFn: fila => {
        const ruc = String(fila.B || '').trim();
        return ruc.length >= 10 && /^\d+$/.test(ruc);
      }
    });

    const registros = resultado.registros.map((fila, index) => ({
      numero: parseInt(fila.A) || index + 1,
      ruc: String(fila.B || '').trim(),
      razonSocial: String(fila.C || '').trim(),
      oficioAtributo: String(fila.D || '').trim(),
      jurisdiccion: String(fila.E || '').trim(),
      provincia: String(fila.F || '').trim(),
      subtipo: String(fila.G || '').trim(),
      hojaOrigen: fila._hojaOrigen
    }));

    return {
      exito: true,
      total: registros.length,
      hojas: resultado.infoHojas,
      cabeceras: {
        ruc: 'B',
        razonSocial: 'C',
        oficio: 'D',
        jurisdiccion: 'E',
        provincia: 'F',
        subtipo: 'G'
      },
      registros
    };
  } catch (error) {
    throw new Error(`Error parseando grandes contribuyentes: ${error.message}`);
  }
}

/**
 * Parsea el archivo de Exportadores Habituales de Bienes.
 * Este archivo tiene múltiples hojas por año (2020-2026).
 * Combina todas las hojas y retorna los datos más recientes primero.
 */
async function parsearExportadoresBienes() {
  const rutaArchivo = obtenerRutaArchivo('exportadores_bienes');

  if (!fsSync.existsSync(rutaArchivo)) {
    throw new Error('Archivo de exportadores de bienes no encontrado');
  }

  try {
    const resultado = leerTodasLasHojas(rutaArchivo, {
      skipRows: 0,
      filterFn: fila => {
        const ruc = String(fila.A || fila.B || '').trim();
        return ruc.length >= 10 && /^\d+$/.test(ruc);
      }
    });

    const registros = resultado.registros.map(fila => {
      // Detectar columnas dinámicamente
      const valores = Object.values(fila);
      return {
        ruc: String(valores[0] || fila.A || '').trim(),
        nombre: String(valores[1] || fila.B || '').trim(),
        certificado: String(valores[2] || fila.C || '').trim(),
        vigencia: String(valores[3] || fila.D || '').trim(),
        hojaOrigen: fila._hojaOrigen
      };
    }).filter(r => r.ruc && r.ruc.length >= 10);

    return {
      exito: true,
      total: registros.length,
      hojas: resultado.infoHojas,
      registros
    };
  } catch (error) {
    throw new Error(`Error parseando exportadores de bienes: ${error.message}`);
  }
}

/**
 * Parsea el archivo de Exportadores Habituales de Servicios.
 * Similar a bienes, tiene múltiples hojas por año.
 * Estructura:
 *   Fila 1: Título del catastro
 *   Fila 2: Cabeceras (Año fiscal, Año aplicación, RUC, Razón Social, etc.)
 *   Fila 3+: Datos
 */
async function parsearExportadoresServicios() {
  const rutaArchivo = obtenerRutaArchivo('exportadores_servicios');

  if (!fsSync.existsSync(rutaArchivo)) {
    throw new Error('Archivo de exportadores de servicios no encontrado');
  }

  try {
    const resultado = leerTodasLasHojas(rutaArchivo, {
      skipRows: 2, // Saltar título y cabeceras
      filterFn: fila => {
        const ruc = String(fila.C || '').trim();
        return ruc.length >= 10 && /^\d+$/.test(ruc);
      }
    });

    const registros = resultado.registros.map(fila => {
      return {
        ruc: String(fila.C || '').trim(),
        nombre: String(fila.D || '').trim(),
        jurisdiccion: String(fila.E || '').trim(),
        provincia: String(fila.F || '').trim(),
        tipoContribuyente: String(fila.G || '').trim(),
        obligadoContabilidad: String(fila.H || '').trim(),
        hojaOrigen: fila._hojaOrigen
      };
    }).filter(r => r.ruc && r.ruc.length >= 10);

    return {
      exito: true,
      total: registros.length,
      hojas: resultado.infoHojas,
      registros
    };
  } catch (error) {
    throw new Error(`Error parseando exportadores de servicios: ${error.message}`);
  }
}

/**
 * Parsea el archivo de Contribuyentes Especiales.
 * Puede tener 2 hojas con la misma información.
 */
async function parsearContribuyentesEspeciales() {
  const rutaArchivo = obtenerRutaArchivo('contribuyentes_especiales');

  if (!fsSync.existsSync(rutaArchivo)) {
    throw new Error('Archivo de contribuyentes especiales no encontrado');
  }

  try {
    const resultado = leerTodasLasHojas(rutaArchivo, {
      skipRows: 0,
      filterFn: fila => {
        const ruc = String(fila.A || fila.B || '').trim();
        return ruc.length >= 10 && /^\d+$/.test(ruc);
      }
    });

    const registros = resultado.registros.map(fila => {
      const valores = Object.values(fila);
      return {
        ruc: String(valores[0] || fila.A || '').trim(),
        nombre: String(valores[1] || fila.B || '').trim(),
        hojaOrigen: fila._hojaOrigen
      };
    }).filter(r => r.ruc && r.ruc.length >= 10);

    // Eliminar duplicados (si las hojas tienen la misma info)
    const rucsUnicos = new Set();
    const registrosUnicos = [];

    for (const reg of registros) {
      if (!rucsUnicos.has(reg.ruc)) {
        rucsUnicos.add(reg.ruc);
        registrosUnicos.push(reg);
      }
    }

    return {
      exito: true,
      total: registrosUnicos.length,
      hojas: resultado.infoHojas,
      registros: registrosUnicos
    };
  } catch (error) {
    throw new Error(`Error parseando contribuyentes especiales: ${error.message}`);
  }
}

/**
 * Busca un RUC en el catastro de Grandes Contribuyentes
 */
async function buscarRUCEnGrandesContribuyentes(ruc) {
  const resultado = await parsearGrandesContribuyentes();

  const encontrado = resultado.registros.find(r =>
    r.ruc === ruc || r.ruc.replace(/[-\s]/g, '') === ruc.replace(/[-\s]/g, '')
  );

  return {
    encontrado: !!encontrado,
    datos: encontrado || null,
    mensaje: encontrado
      ? `Encontrado en Grandes Contribuyentes: ${encontrado.razonSocial}`
      : 'No encontrado en Grandes Contribuyentes'
  };
}

// ─── Validación de Porcentajes de Retención ──────────────────────

/**
 * Carga y parsea la tabla de porcentajes de retención de renta
 * @returns {object[]} Array de configuraciones de retención
 */
async function cargarPorcentajesRenta() {
  const rutaArchivo = obtenerRutaArchivo('porcentajes_renta');

  if (!fsSync.existsSync(rutaArchivo)) {
    throw new Error('Tabla de porcentajes de renta no descargada. Descarga el catastro primero.');
  }

  try {
    const workbook = XLSX.readFile(rutaArchivo);
    // Usar la primera hoja que tenga "Retenciones" en el nombre
    const hojaRenta = workbook.SheetNames.find(name => name.includes('Retenciones') && name.includes('2026'))
      || workbook.SheetNames[0];

    const datos = XLSX.utils.sheet_to_json(workbook.Sheets[hojaRenta], {
      header: 'A',
      defval: '',
      range: 3 // Saltar las primeras 3 filas de encabezado
    });

    return datos
      .map(fila => {
        const concepto = String(fila.B || '').trim();
        const porcentajeRaw = String(fila.C || '0').replace('%', '').replace(',', '.');
        const porcentaje = parseFloat(porcentajeRaw) || 0;
        const codigoFormulario = String(fila.D || '').trim();
        const codigoAnexo = String(fila.E || '').trim();

        return {
          codigo: codigoAnexo || codigoFormulario,
          codigoFormulario,
          codigoAnexo,
          concepto,
          porcentaje,
          baseLegal: '',
        };
      })
      .filter(item => item.concepto && item.porcentaje > 0); // Solo filas con datos válidos
  } catch (error) {
    throw new Error(`Error leyendo porcentajes de renta: ${error.message}`);
  }
}

/**
 * Carga y parsea la tabla de porcentajes de retención de IVA
 * @returns {object[]} Array de configuraciones de retención
 */
async function cargarPorcentajesIVA() {
  const rutaArchivo = obtenerRutaArchivo('porcentajes_iva');

  if (!fsSync.existsSync(rutaArchivo)) {
    throw new Error('Tabla de porcentajes de IVA no descargada. Descarga el catastro primero.');
  }

  try {
    const workbook = XLSX.readFile(rutaArchivo);
    const primeraHoja = workbook.SheetNames[0];
    const datos = XLSX.utils.sheet_to_json(workbook.Sheets[primeraHoja], {
      header: 'A',
      defval: '',
      range: 5 // Saltar encabezados
    });

    // La estructura del IVA es diferente: es una tabla de agentes de retención vs porcentajes
    // Columna B: Agente de retención
    // Columnas C-J: Diferentes tipos de retenido con porcentajes
    return datos
      .map(fila => {
        const agenteRetencion = String(fila.B || '').trim();

        // Extraer todos los tipos de retención y sus porcentajes
        const tipos = [];
        const columnas = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

        for (const col of columnas) {
          const valor = String(fila[col] || '').trim();
          if (valor && valor !== '------------------') {
            // Extraer porcentajes del texto (ej: "BIENES 30%", "SERVICIOS 70%")
            const porcentajesBienes = valor.match(/BIENES\s+(\d+)%/);
            const porcentajesServicios = valor.match(/SERVICIOS\s+(\d+)%/);

            tipos.push({
              columna: col,
              texto: valor,
              porcentajeBienes: porcentajesBienes ? parseInt(porcentajesBienes[1]) : null,
              porcentajeServicios: porcentajesServicios ? parseInt(porcentajesServicios[1]) : null,
            });
          }
        }

        return {
          agente: agenteRetencion,
          tipos,
          codigo: '',
          concepto: agenteRetencion,
          porcentaje: 0, // IVA tiene múltiples porcentajes según tipo
          aplicacion: tipos.map(t => t.texto).join(' | '),
        };
      })
      .filter(item => item.agente && item.agente.toUpperCase() !== 'EXCEPCIONES:' &&
        !item.agente.startsWith('-') && !item.agente.startsWith('CONSIDERACIONES'));
  } catch (error) {
    throw new Error(`Error leyendo porcentajes de IVA: ${error.message}`);
  }
}

/**
 * Valida si un porcentaje de retención es correcto según las tablas del SRI
 *
 * @param {object} params - Parámetros de validación
 * @param {string} params.tipoImpuesto - 'renta' o 'iva'
 * @param {string} params.codigo - Código del concepto de retención
 * @param {number} params.porcentajeAplicado - Porcentaje que se aplicó en la retención
 * @param {string} [params.baseImponible] - Base imponible (opcional, para cálculo)
 * @returns {object} Resultado de la validación
 */
async function validarPorcentajeRetencion({ tipoImpuesto, codigo, porcentajeAplicado, baseImponible }) {
  let tablaPorcentajes;
  let nombreImpuesto;

  try {
    if (tipoImpuesto === 'renta') {
      tablaPorcentajes = await cargarPorcentajesRenta();
      nombreImpuesto = 'Impuesto a la Renta';
    } else if (tipoImpuesto === 'iva') {
      tablaPorcentajes = await cargarPorcentajesIVA();
      nombreImpuesto = 'IVA';
    } else {
      return {
        exito: false,
        valido: false,
        error: `Tipo de impuesto no reconocido: ${tipoImpuesto}. Use 'renta' o 'iva'`,
      };
    }
  } catch (error) {
    return {
      exito: false,
      valido: false,
      error: error.message,
    };
  }

  // Buscar el código en la tabla
  const conceptoEncontrado = tablaPorcentajes.find(item =>
    item.codigo === codigo ||
    item.codigo.toLowerCase().includes(codigo.toLowerCase())
  );

  if (!conceptoEncontrado) {
    return {
      exito: true,
      valido: false,
      tipoImpuesto,
      nombreImpuesto,
      codigoBuscado: codigo,
      mensaje: `Código "${codigo}" no encontrado en la tabla de ${nombreImpuesto}`,
      porcentajeEsperado: null,
      porcentajeAplicado: porcentajeAplicado,
      diferencia: null,
    };
  }

  const porcentajeEsperado = conceptoEncontrado.porcentaje;
  const diferencia = Math.abs(porcentajeAplicado - porcentajeEsperado);
  const esValido = diferencia < 0.01; // Tolerancia de 0.01%

  let valorRetenido = null;
  if (baseImponible && !isNaN(baseImponible)) {
    valorRetenido = (parseFloat(baseImponible) * porcentajeEsperado) / 100;
  }

  return {
    exito: true,
    valido: esValido,
    tipoImpuesto,
    nombreImpuesto,
    codigo: conceptoEncontrado.codigo,
    concepto: conceptoEncontrado.concepto,
    porcentajeEsperado: `${porcentajeEsperado}%`,
    porcentajeAplicado: `${porcentajeAplicado}%`,
    diferencia: `${diferencia.toFixed(2)}%`,
    baseLegal: conceptoEncontrado.baseLegal || conceptoEncontrado.aplicacion || '',
    valorRetenidoCalculado: valorRetenido,
    mensaje: esValido
      ? `✓ Porcentaje correcto para ${conceptoEncontrado.concepto}`
      : `✗ Porcentaje incorrecto. Esperado: ${porcentajeEsperado}%, Aplicado: ${porcentajeAplicado}%`,
  };
}

/**
 * Valida múltiples retenciones de un archivo Excel
 *
 * @param {object[]} retenciones - Array de retenciones a validar
 * @param {string} retenciones[].tipoImpuesto - 'renta' o 'iva'
 * @param {string} retenciones[].codigo - Código del concepto
 * @param {number} retenciones[].porcentaje - Porcentaje aplicado
 * @param {number} [retenciones[].baseImponible] - Base imponible opcional
 * @returns {object[]} Resultados de validación
 */
async function validarMultiplesRetenciones(retenciones) {
  const resultados = [];

  for (const retencion of retenciones) {
    const resultado = await validarPorcentajeRetencion(retencion);
    resultados.push(resultado);
  }

  const validos = resultados.filter(r => r.valido).length;
  const invalidos = resultados.filter(r => !r.valido).length;
  const errores = resultados.filter(r => !r.exito).length;

  return {
    exito: true,
    total: resultados.length,
    validos,
    invalidos,
    errores,
    resultados,
    resumen: {
      porcentajeCorrectos: ((validos / resultados.length) * 100).toFixed(2) + '%',
      porcentajeIncorrectos: ((invalidos / resultados.length) * 100).toFixed(2) + '%',
    },
  };
}

/**
 * Función de inicialización para pre-cargar la caché al arrancar el servidor.
 * Esto evita la lentitud de la primera búsqueda.
 */
async function inicializarGestor() {
  console.log('\n[GESTOR] 🔥 Iniciando pre-carga de catastros en segundo plano...');
  const tipos = Object.keys(CATASTROS_CONFIG);
  
  // Cargamos secuencialmente para no saturar memoria/CPU en el arranque
  for (const tipo of tipos) {
    try {
      const ruta = path.join(CATASTROS_DIR, `${tipo}.xlsx`);
      if (fsSync.existsSync(ruta)) {
        await asegurarCache(tipo);
      }
    } catch (err) {
      console.error(`[GESTOR] Error en pre-carga de ${tipo}:`, err.message);
    }
  }
  console.log('[GESTOR] ✅ Pre-carga completada. Buscador listo.\n');
}

// ─── Exportación de módulos ────────────────────────────────────────────

module.exports = {
  inicializarGestor,
  CATASTROS_CONFIG,
  CATASTROS_DIR,

  // Descarga
  descargarCatastro,
  descargarTodosCatastros,
  cargarCatastroManual,

  // Consulta
  buscarRUCEnCatastro,
  estaEnCatastro,
  obtenerInfoContribuyente,

  // Gestión
  listarCatastros,
  eliminarCatastro,
  verificarActualizaciones,

  // URLs personalizadas
  guardarURLPersonalizada,
  obtenerURLsPersonalizadas,
  eliminarURLPersonalizada,

  // Validación de retenciones
  validarPorcentajeRetencion,
  validarMultiplesRetenciones,
  cargarPorcentajesRenta,
  cargarPorcentajesIVA,

  // Parseo especializado
  parsearGrandesContribuyentes,
  buscarRUCEnGrandesContribuyentes,
  parsearExportadoresBienes,
  parsearExportadoresServicios,
  parsearContribuyentesEspeciales,
  leerTodasLasHojas,

  // Utilidades
  obtenerURLDescarga,
  hanPasadoDias,
};
