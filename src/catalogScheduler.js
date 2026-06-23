const {
  verificarActualizaciones,
  descargarTodosCatastros,
  obtenerURLsPersonalizadas,
  hanPasadoDias,
  listarCatastros,
} = require('./catalogManager');
const { config, CATASTROS_DIR } = require('./config');

// Importar Google Drive CDN
let googleDriveCdn;
try {
  googleDriveCdn = require('./googleDriveCdn');
} catch {
  googleDriveCdn = null;
}

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { sincronizarMaestroCompleto } = require('./maestroManager');

// ─── Configuración del programador ─────────────────────────────────────

const INTERVALO_VERIFICACION = config.catastroActualizacionDias || 15; // días
const INTERVALO_CHECK = 24 * 60 * 60 * 1000; // Verificar cada 24 horas (1 vez al día)
const SCHEDULER_FILE = path.join(CATASTROS_DIR, 'scheduler.json');

// ─── Estado del scheduler ──────────────────────────────────────────────

let schedulerActivo = false;
let intervaloId = null;

/**
 * Asegura que el directorio de datos exista
 */
async function asegurarDirectorio() {
  const dir = CATASTROS_DIR;
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

/**
 * Lee el estado del scheduler desde archivo
 */
async function leerEstadoScheduler() {
  try {
    const contenido = await fs.readFile(SCHEDULER_FILE, 'utf-8');
    return JSON.parse(contenido);
  } catch {
    return {
      ultimaEjecucion: null,
      ejecucionesTotales: 0,
      descargasExitosas: 0,
      descargasFallidas: 0,
      activo: false,
    };
  }
}

/**
 * Guarda el estado del scheduler
 */
async function guardarEstadoScheduler(estado) {
  await asegurarDirectorio();
  await fs.writeFile(SCHEDULER_FILE, JSON.stringify(estado, null, 2), 'utf-8');
}

// ─── Funciones del scheduler ───────────────────────────────────────────

/**
 * Ejecuta una verificación de actualizaciones y descarga si es necesario
 */
async function ejecutarVerificacion() {
  const ahora = new Date();
  const esDíaUno = ahora.getDate() === 1;
  const horaActual = ahora.getHours();
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   [SCHEDULER] Verificando actualizaciones de       ║');
  console.log(`║   catastros... (Día: ${ahora.getDate()}, Hora: ${horaActual}:00)          ║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  const estado = await leerEstadoScheduler();
  estado.ultimaEjecucion = ahora.toISOString();
  estado.ejecucionesTotales++;

  try {
    // ─── MODO MASTER: Descargar del SRI y subir a Drive ──────────────
    if (config.googleDriveMasterServer && googleDriveCdn) {
      console.log('[SCHEDULER] 🌟 Modo MASTER activo');

      // Solo forzamos descarga del SRI si es el día 1 del mes,
      // o si han pasado los días configurados (15 por defecto)
      const requiereActualizarSRI = esDíaUno || hanPasadoDias(estado.ultimaActualizacionSRI, config.catastroActualizacionDias);

      if (requiereActualizarSRI) {
        console.log('[SCHEDULER] 🏛️ Iniciando descarga mensual obligatoria del SRI...');
        
        const urlsPersonalizadas = await obtenerURLsPersonalizadas();
        // Usamos el nuevo parámetro 'forzarSRI = true'
        const resultado = await descargarTodosCatastros(urlsPersonalizadas, true);

        estado.descargasExitosas += resultado.exitosos;
        estado.descargasFallidas += resultado.fallidos;
        estado.ultimaActualizacionSRI = ahora.toISOString();

        // Solo subir a Google Drive SI hubo cambios reales en los archivos
        if (resultado.exitosos > 0 && resultado.hayCambiosTotales) {
          console.log('[SCHEDULER] ✨ Se detectaron CAMBIOS. Subiendo a Google Drive...');

          try {
            const subidaDrive = await googleDriveCdn.subirTodos(config.googleDriveFolderId);
            estado.subidasDriveExitosas = (estado.subidasDriveExitosas || 0) + subidaDrive.subidos;
            console.log(`[SCHEDULER] ✅ ${subidaDrive.subidos} archivos subidos a Drive correctamente`);
          } catch (error) {
            console.error('[SCHEDULER] ❌ Error subiendo a Drive:', error.message);
          }
        } else if (resultado.exitosos > 0) {
          console.log('[SCHEDULER] 🍃 No hay cambios en el SRI. Drive ya está sincronizado.');
        }

        await guardarEstadoScheduler(estado);
        return { exito: true, modo: 'MASTER', resultado };
      } else {
        console.log(`[SCHEDULER] ✅ Aún no es el día 1 ni han pasado ${config.catastroActualizacionDias} días. Esperando...`);
      }
    }

    // ─── MODO USUARIO: Verificar Drive y descargar solo si hay cambios ─
    console.log('[SCHEDULER] 👤 Modo USUARIO: Verificando Google Drive');

    const verificacion = await verificarActualizaciones();

    // Filtrar solo los que realmente necesitan descarga (nuevos o modificados)
    const necesitanDescarga = verificacion.actualizaciones.filter(a => a.requiereDescarga);

    if (necesitanDescarga.length > 0) {
      console.log(`[SCHEDULER] 📥 ${necesitanDescarga.length} catastros requieren actualización`);

      // Descargar solo los que cambiaron desde Drive
      const urlsPersonalizadas = {};
      const tiposCambiar = necesitanDescarga.map(a => a.tipo);

      console.log('[SCHEDULER] Descargando catastros actualizados desde Drive...');
      const resultado = await descargarTodosCatastros(urlsPersonalizadas);

      estado.descargasExitosas += resultado.exitosos;
      estado.descargasFallidas += resultado.fallidos;

      console.log(`[SCHEDULER] ✅ ${resultado.exitosos} catastros actualizados, ${verificacion.actualizaciones.length - resultado.exitosos} mantenidos`);

      await guardarEstadoScheduler(estado);


      // 🔥 AUTOMATIZACIÓN: Después de actualizar los catastros del SRI,
      // sincronizar el Maestro de Proveedores para detectar cambios.
      sincronizarMaestroCompleto().catch(err => console.error('[SCHEDULER] Error sincronizando maestro:', err));

      return {
        exito: true,
        modo: 'USUARIO',
        descargados: resultado.exitosos,
        mantenidos: verificacion.actualizaciones.length - resultado.exitosos,
        verificacion,
      };
    } else {
      console.log('[SCHEDULER] ✅ Todos los catastros están actualizados (sin cambios en Drive)');
      console.log('[SCHEDULER] 📁 Manteniendo datos locales actuales');

      await guardarEstadoScheduler(estado);

      return {
        exito: true,
        modo: 'USUARIO',
        mensaje: 'Todos los catastros están actualizados (sin cambios)',
        mantenidos: verificacion.actualizaciones.length,
      };
    }
  } catch (error) {
    console.error('[SCHEDULER] ❌ Error en verificación:', error.message);
    estado.descargasFallidas++;
    await guardarEstadoScheduler(estado);

    return {
      exito: false,
      error: error.message,
    };
  }
}

/**
 * Inicia el scheduler que verifica periódicamente los catastros
 */
function iniciarScheduler() {
  if (schedulerActivo) {
    console.log('[SCHEDULER] El scheduler ya está activo');
    return;
  }

  schedulerActivo = true;
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   [SCHEDULER] Iniciando programador de catastros   ║');
  console.log(`║   Verificación cada: ${String(INTERVALO_CHECK / (60 * 60 * 1000)).padEnd(26)} horas  ║`);
  console.log(`║   Actualización cada: ${String(INTERVALO_VERIFICACION).padEnd(26)} días    ║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  // Ejecutar verificación inmediata al iniciar
  ejecutarVerificacion().then((resultado) => {
    if (resultado.exito) {
      console.log('[SCHEDULER] Verificación inicial completada');
    } else {
      console.error('[SCHEDULER] Error en verificación inicial:', resultado.error);
    }
  });

  // Programar verificaciones periódicas
  intervaloId = setInterval(async () => {
    await ejecutarVerificacion();
  }, INTERVALO_CHECK);

  // Guardar estado
  leerEstadoScheduler().then((estado) => {
    estado.activo = true;
    guardarEstadoScheduler(estado);
  });
}

/**
 * Detiene el scheduler
 */
function detenerScheduler() {
  if (!schedulerActivo) {
    console.log('[SCHEDULER] El scheduler ya está detenido');
    return;
  }

  schedulerActivo = false;

  if (intervaloId) {
    clearInterval(intervaloId);
    intervaloId = null;
  }

  console.log('[SCHEDULER] Scheduler detenido');

  // Guardar estado
  leerEstadoScheduler().then((estado) => {
    estado.activo = false;
    guardarEstadoScheduler(estado);
  });
}

/**
 * Obtiene el estado actual del scheduler
 */
async function obtenerEstadoScheduler() {
  const estado = await leerEstadoScheduler();
  const listaCatastros = await listarCatastros();

  return {
    activo: schedulerActivo,
    ...estado,
    intervaloVerificacion: `${INTERVALO_CHECK / (60 * 60 * 1000)} horas`,
    intervaloActualizacion: `${INTERVALO_VERIFICACION} días`,
    catastros: listaCatastros,
  };
}

/**
 * Fuerza una verificación manual (independientemente del scheduler)
 */
async function forzarVerificacion() {
  console.log('[SCHEDULER] Verificación manual forzada');
  return await ejecutarVerificacion();
}

// ─── Exportación de módulos ────────────────────────────────────────────

module.exports = {
  iniciarScheduler,
  detenerScheduler,
  obtenerEstadoScheduler,
  forzarVerificacion,
  ejecutarVerificacion,
  INTERVALO_VERIFICACION,
  INTERVALO_CHECK,
};
