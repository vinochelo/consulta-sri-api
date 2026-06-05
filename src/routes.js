const express = require('express');
const { consultarComprobante, consultarFacturaNegociable, consultarMasivo } = require('./sriClient');
const { config, getAmbiente, AMBIENTES } = require('./config');
const {
  listarCatastros,
  descargarCatastro,
  descargarTodosCatastros,
  cargarCatastroManual,
  buscarRUCEnCatastro,
  obtenerInfoContribuyente,
  eliminarCatastro,
  verificarActualizaciones,
  guardarURLPersonalizada,
  obtenerURLsPersonalizadas,
  eliminarURLPersonalizada,
  obtenerURLDescarga,
  validarPorcentajeRetencion,
  validarMultiplesRetenciones,
  cargarPorcentajesRenta,
  cargarPorcentajesIVA,
} = require('./catalogManager');

// Importar Google Drive CDN (puede no estar instalado)
let googleDriveCdn;
try {
  googleDriveCdn = require('./googleDriveCdn');
} catch {
  googleDriveCdn = null;
}
const {
  obtenerEstadoScheduler,
  forzarVerificacion,
} = require('./catalogScheduler');
const {
  cargarMaestro,
  sincronizarMaestroCompleto,
  cargarNotificaciones,
  guardarNotificaciones,
  agregarAlMaestro,
  procesarExcelMaestro
} = require('./maestroManager');

const router = express.Router();

// ─── Autenticación OAuth2 ──────────────────────────────────────────────

router.get('/drive/auth', (req, res) => {
  try {
    if (!googleDriveCdn) {
      return res.status(500).send('Google Drive CDN no cargado');
    }
    const url = googleDriveCdn.generarUrlAutenticacion();
    res.redirect(url);
  } catch (error) {
    res.status(500).send('Error generando URL de autenticación: ' + error.message);
  }
});

router.get('/drive/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('No se recibió el código de autorización');

    await googleDriveCdn.intercambiarCodigoPorToken(code);
    
    res.send('<h1>¡Autenticación exitosa!</h1><p>Ya puedes cerrar esta ventana y volver a intentar la subida.</p>');
  } catch (error) {
    res.status(500).send('Error en el callback de Drive: ' + error.message);
  }
});

// Alias de emergencia para evitar problemas de rutas
router.get('/login-drive', (req, res) => {
  try {
    if (!googleDriveCdn) return res.status(500).send('Google Drive CDN no cargado');
    const url = googleDriveCdn.generarUrlAutenticacion();
    res.redirect(url);
  } catch (error) {
    res.status(500).send('Error: ' + error.message);
  }
});

router.get('/google-callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code');
    await googleDriveCdn.intercambiarCodigoPorToken(code);
    res.send('<h1>¡Éxito!</h1>');
  } catch (error) {
    res.status(500).send('Error: ' + error.message);
  }
});

// ─── Health Check ─────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  const ambiente = getAmbiente();
  res.json({
    estado: 'activo',
    ambiente: config.sriEnv,
    ambienteNombre: ambiente.nombre,
    maxConcurrent: config.maxConcurrent,
    delayMs: config.delayMs,
    timestamp: new Date().toISOString(),
  });
});

// ─── Obtener configuración de ambientes ───────────────────────────────

router.get('/ambientes', (req, res) => {
  res.json({
    actual: config.sriEnv,
    disponibles: Object.keys(AMBIENTES).map((key) => ({
      id: key,
      nombre: AMBIENTES[key].nombre,
    })),
  });
});

// ─── Consulta Individual de Comprobante ───────────────────────────────

router.post('/consulta', async (req, res) => {
  try {
    const { claveAcceso, ambiente } = req.body;

    if (!claveAcceso) {
      return res.status(400).json({
        exito: false,
        error: 'Se requiere una clave de acceso',
      });
    }

    // Validar formato de clave de acceso (49 dígitos)
    const claveNormalizada = claveAcceso.trim();
    if (!/^\d{49}$/.test(claveNormalizada)) {
      return res.status(400).json({
        exito: false,
        error: 'La clave de acceso debe tener exactamente 49 dígitos numéricos',
      });
    }

    console.log(`[CONSULTA] Comprobante: ${claveNormalizada} | Ambiente: ${ambiente || config.sriEnv}`);

    const resultado = await consultarComprobante(claveNormalizada, ambiente);

    console.log(`[RESULTADO] ${claveNormalizada} → ${resultado.estadoFinal}`);

    res.json(resultado);
  } catch (error) {
    console.error('[ERROR] Consulta individual:', error.message);
    res.status(500).json({
      exito: false,
      error: 'Error interno del servidor',
      detalle: error.message,
    });
  }
});

// ─── Consulta Masiva de Comprobantes ──────────────────────────────────

router.post('/consulta/masiva', async (req, res) => {
  try {
    const { clavesAcceso, tipo, ambiente } = req.body;

    if (!clavesAcceso || !Array.isArray(clavesAcceso) || clavesAcceso.length === 0) {
      return res.status(400).json({
        exito: false,
        error: 'Se requiere un array de claves de acceso (clavesAcceso)',
      });
    }

    // Limitar a 200 claves por petición (el frontend envía en lotes)
    if (clavesAcceso.length > 200) {
      return res.status(400).json({
        exito: false,
        error: 'Máximo 200 claves de acceso por petición. Use lotes más pequeños.',
      });
    }

    // Validar claves y agrupar duplicados con sufijo _dup_
    const mapaBaseAOriginales = {}; // baseKey -> [originalKey1, originalKey2, ...]
    const clavesInvalidas = [];

    clavesAcceso.forEach((clave) => {
      const original = clave.trim();
      const baseClave = original.split('_dup_')[0];
      
      if (/^\d{49}$/.test(baseClave)) {
        if (!mapaBaseAOriginales[baseClave]) {
          mapaBaseAOriginales[baseClave] = [];
        }
        mapaBaseAOriginales[baseClave].push(original);
      } else if (original.length > 0) {
        clavesInvalidas.push({
          claveAcceso: original,
          exito: false,
          estadoFinal: 'FORMATO_INVALIDO',
          error: true,
          mensajes: [
            {
              identificador: 'VAL',
              mensaje: 'Formato de clave inválido',
              informacionAdicional: 'La clave de acceso debe tener exactamente 49 dígitos numéricos',
              tipo: 'ERROR',
            },
          ],
        });
      }
    });

    const clavesValidasUnicas = Object.keys(mapaBaseAOriginales);
    const tipoServicio = tipo || 'comprobante';
    const ambienteUsado = ambiente || config.sriEnv;

    console.log(`[MASIVA] ${clavesValidasUnicas.length} claves válidas únicas (${clavesAcceso.length - clavesInvalidas.length} total válidas), ${clavesInvalidas.length} inválidas | Tipo: ${tipoServicio} | Ambiente: ${ambienteUsado}`);

    const inicioTiempo = Date.now();

    // Consultar solo las claves válidas únicas
    const resultadosSRIUnicos = await consultarMasivo(clavesValidasUnicas, tipoServicio, ambienteUsado);

    const tiempoTotal = Date.now() - inicioTiempo;

    // Replicar resultados de claves únicas para cada clave duplicada original y adjuntar estado de Negocio Popular
    const resultadosSRI = [];
    for (const resItem of resultadosSRIUnicos) {
      const baseClave = resItem.claveAcceso;
      
      // Extraer RUC (dígitos 10 a 22 de la clave) y buscar en catastro rimpe_negocios_populares
      let esNegocioPopular = false;
      if (baseClave && baseClave.length === 49) {
        try {
          const rucEmisor = baseClave.substring(10, 23);
          const busqueda = await buscarRUCEnCatastro(rucEmisor, 'rimpe_negocios_populares');
          esNegocioPopular = !!(busqueda && busqueda.rimpe_negocios_populares && busqueda.rimpe_negocios_populares.encontrado);
        } catch (err) {
          console.error('[CATASTRO] Error buscando RUC en consulta masiva:', err.message);
        }
      }
      
      const originales = mapaBaseAOriginales[baseClave] || [baseClave];
      originales.forEach((orig) => {
        resultadosSRI.push({
          ...resItem,
          claveAcceso: orig,
          esNegocioPopular
        });
      });
    }

    // Combinar resultados válidos (incluyendo replicados) e inválidos
    const todosResultados = [...resultadosSRI, ...clavesInvalidas];

    // Estadísticas
    const estadisticas = {
      total: todosResultados.length,
      autorizados: todosResultados.filter((r) => r.estadoFinal === 'AUTORIZADO').length,
      noAutorizados: todosResultados.filter((r) => r.estadoFinal === 'NO AUTORIZADO').length,
      pendientes: todosResultados.filter((r) => r.estadoFinal === 'PENDIENTE DE ANULAR').length,
      anulados: todosResultados.filter((r) => r.estadoFinal === 'ANULADO').length,
      rechazados: todosResultados.filter((r) => r.estadoFinal === 'RECHAZADA').length,
      errores: todosResultados.filter((r) => r.estadoFinal === 'ERROR_CONEXION' || r.estadoFinal === 'FORMATO_INVALIDO').length,
      tiempoMs: tiempoTotal,
    };

    console.log(`[MASIVA COMPLETADA] ${estadisticas.total} resultados en ${tiempoTotal}ms`);

    res.json({
      exito: true,
      estadisticas,
      resultados: todosResultados,
    });
  } catch (error) {
    console.error('[ERROR] Consulta masiva:', error.message);
    res.status(500).json({
      exito: false,
      error: 'Error interno del servidor',
      detalle: error.message,
    });
  }
});

// ─── Consulta de Factura Comercial Negociable ─────────────────────────

router.post('/factura-negociable', async (req, res) => {
  try {
    const { claveAcceso, ambiente } = req.body;

    if (!claveAcceso) {
      return res.status(400).json({
        exito: false,
        error: 'Se requiere una clave de acceso',
      });
    }

    const claveNormalizada = claveAcceso.trim();
    if (!/^\d{49}$/.test(claveNormalizada)) {
      return res.status(400).json({
        exito: false,
        error: 'La clave de acceso debe tener exactamente 49 dígitos numéricos',
      });
    }

    console.log(`[FACTURA NEGOCIABLE] ${claveNormalizada} | Ambiente: ${ambiente || config.sriEnv}`);

    const resultado = await consultarFacturaNegociable(claveNormalizada, ambiente);

    console.log(`[RESULTADO] ${claveNormalizada} → ${resultado.estadoFinal}`);

    res.json(resultado);
  } catch (error) {
    console.error('[ERROR] Consulta factura negociable:', error.message);
    res.status(500).json({
      exito: false,
      error: 'Error interno del servidor',
      detalle: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  ENDPOINTS DE GESTIÓN DE CATASTROS DEL SRI
// ═══════════════════════════════════════════════════════════════════════

// ─── Listar todos los catastros disponibles ────────────────────────────

router.get('/catastros', async (req, res) => {
  try {
    const lista = await listarCatastros();
    res.json({
      exito: true,
      ...lista,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error listando catastros',
      detalle: error.message,
    });
  }
});

// ─── Verificar actualizaciones disponibles ─────────────────────────────

router.get('/catastros/verificar-actualizaciones', async (req, res) => {
  try {
    const verificacion = await verificarActualizaciones();
    res.json({
      exito: true,
      ...verificacion,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error verificando actualizaciones',
      detalle: error.message,
    });
  }
});

// ─── Descargar un catastro específico ──────────────────────────────────

router.post('/catastros/:tipo/descargar', async (req, res) => {
  try {
    const { tipo } = req.params;
    const { url } = req.body; // URL personalizada opcional

    // Si no se proporciona URL, usar la guardada en metadata
    let urlDescarga = url || null;
    if (!urlDescarga) {
      const urlsGuardadas = await obtenerURLsPersonalizadas();
      urlDescarga = urlsGuardadas[tipo] || null;
    }

    const resultado = await descargarCatastro(tipo, urlDescarga);

    res.json({
      exito: true,
      ...resultado,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: `Error descargando catastro ${req.params.tipo}`,
      detalle: error.message,
    });
  }
});

// ─── Descargar todos los catastros ─────────────────────────────────────

router.post('/catastros/descargar-todos', async (req, res) => {
  try {
    const { urlsPersonalizadas } = req.body; // URLs opcionales por tipo

    // Combinar URLs proporcionadas con las guardadas
    const urlsGuardadas = await obtenerURLsPersonalizadas();
    const urlsFinales = { ...urlsGuardadas, ...(urlsPersonalizadas || {}) };

    const resultado = await descargarTodosCatastros(urlsFinales);

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error descargando todos los catastros',
      detalle: error.message,
    });
  }
});

// ─── Cargar catastro manualmente (archivo Excel) ───────────────────────

router.post('/catastros/:tipo/cargar', async (req, res) => {
  try {
    const { tipo } = req.params;
    const { archivo, url } = req.body;

    if (!archivo) {
      return res.status(400).json({
        exito: false,
        error: 'Se requiere el contenido del archivo Excel en formato base64',
      });
    }

    // Decodificar archivo base64
    const buffer = Buffer.from(archivo, 'base64');

    if (tipo === 'maestro_proveedores') {
      const resultado = await procesarExcelMaestro(buffer);
      return res.json({
        exito: true,
        ...resultado,
        mensaje: `Maestro actualizado: ${resultado.nuevos} nuevos proveedores añadidos.`
      });
    }

    const resultado = await cargarCatastroManual(tipo, buffer, url || null);

    res.json({
      exito: true,
      ...resultado,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: `Error cargando catastro ${req.params.tipo}`,
      detalle: error.message,
    });
  }
});

// ─── Buscar RUC en catastros ───────────────────────────────────────────

router.get('/catastros/buscar/:ruc', async (req, res) => {
  try {
    const { ruc } = req.params;
    const { tipo } = req.query; // opcional: tipo específico de catastro

    // Validar formato de RUC
    if (!/^\d{10,13}$/.test(ruc)) {
      return res.status(400).json({
        exito: false,
        error: 'El RUC debe tener entre 10 y 13 dígitos numéricos',
      });
    }

    const resultado = await buscarRUCEnCatastro(ruc, tipo || 'todos');

    // [AUTOMATIZACIÓN] Si se encontró en algún catastro, lo añadimos al maestro proactivamente
    let nombreEncontrado = null;
    let encontradoGeneral = false;
    for (const resCatastro of Object.values(resultado)) {
      if (resCatastro.encontrado && resCatastro.datos) {
        encontradoGeneral = true;
        // Intentar obtener el nombre del campo más probable (nombre, razon_social, contribuyente)
        nombreEncontrado = resCatastro.datos.nombre || 
                           resCatastro.datos.razon_social || 
                           resCatastro.datos.contribuyente || 
                           resCatastro.datos.NOMBRE_O_RAZON_SOCIAL;
        if (nombreEncontrado) break;
      }
    }

    if (encontradoGeneral) {
      // Añadir al maestro (la función agregarAlMaestro ya maneja si existe)
      await agregarAlMaestro(ruc, nombreEncontrado || 'Proveedor Nuevo');
    }

    res.json({
      exito: true,
      ruc,
      busqueda: resultado,
      agregadoAMaestro: encontradoGeneral
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error buscando RUC en catastros',
      detalle: error.message,
    });
  }
});

// ─── Obtener información completa de un contribuyente ──────────────────

router.get('/catastros/contribuyente/:ruc', async (req, res) => {
  try {
    const { ruc } = req.params;

    if (!/^\d{10,13}$/.test(ruc)) {
      return res.status(400).json({
        exito: false,
        error: 'El RUC debe tener entre 10 y 13 dígitos numéricos',
      });
    }

    const info = await obtenerInfoContribuyente(ruc);

    res.json({
      exito: true,
      ...info,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error obteniendo información del contribuyente',
      detalle: error.message,
    });
  }
});

// ─── Eliminar un catastro ──────────────────────────────────────────────

router.delete('/catastros/:tipo', async (req, res) => {
  try {
    const { tipo } = req.params;

    const resultado = await eliminarCatastro(tipo);

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: `Error eliminando catastro ${req.params.tipo}`,
      detalle: error.message,
    });
  }
});

// ─── Gestión de URLs personalizadas ────────────────────────────────────

router.post('/catastros/urls/:tipo', async (req, res) => {
  try {
    const { tipo } = req.params;
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        exito: false,
        error: 'Se requiere una URL válida',
      });
    }

    const resultado = await guardarURLPersonalizada(tipo, url);

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error guardando URL personalizada',
      detalle: error.message,
    });
  }
});

router.get('/catastros/urls', async (req, res) => {
  try {
    const urls = await obtenerURLsPersonalizadas();

    res.json({
      exito: true,
      urls,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error obteniendo URLs personalizadas',
      detalle: error.message,
    });
  }
});

router.delete('/catastros/urls/:tipo', async (req, res) => {
  try {
    const { tipo } = req.params;

    const resultado = await eliminarURLPersonalizada(tipo);

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error eliminando URL personalizada',
      detalle: error.message,
    });
  }
});

// ─── Obtener URL de descarga automática del SRI ────────────────────────

router.get('/catastros/:tipo/obtener-url', async (req, res) => {
  try {
    const { tipo } = req.params;

    const url = await obtenerURLDescarga(tipo);

    res.json({
      exito: true,
      tipo,
      url: url || 'No se encontró URL de descarga automática',
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error obteniendo URL de descarga',
      detalle: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  ENDPOINTS DEL SCHEDULER (Programador de descargas)
// ═══════════════════════════════════════════════════════════════════════

// ─── Estado del scheduler ──────────────────────────────────────────────

router.get('/scheduler/estado', async (req, res) => {
  try {
    const estado = await obtenerEstadoScheduler();

    res.json({
      exito: true,
      ...estado,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error obteniendo estado del scheduler',
      detalle: error.message,
    });
  }
});

// ─── Iniciar scheduler ─────────────────────────────────────────────────

router.post('/scheduler/iniciar', async (req, res) => {
  try {
    iniciarScheduler();

    res.json({
      exito: true,
      mensaje: 'Scheduler iniciado correctamente',
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error iniciando scheduler',
      detalle: error.message,
    });
  }
});

// ─── Detener scheduler ─────────────────────────────────────────────────

router.post('/scheduler/detener', async (req, res) => {
  try {
    detenerScheduler();

    res.json({
      exito: true,
      mensaje: 'Scheduler detenido correctamente',
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error deteniendo scheduler',
      detalle: error.message,
    });
  }
});

// ─── Forzar verificación manual ────────────────────────────────────────

router.post('/scheduler/verificar', async (req, res) => {
  try {
    const resultado = await forzarVerificacion();

    res.json({
      exito: resultado.exito,
      ...resultado,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error en verificación manual',
      detalle: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  ENDPOINTS DE VALIDACIÓN DE PORCENTAJES DE RETENCIÓN
// ═══════════════════════════════════════════════════════════════════════

// ─── Validar porcentaje de retención individual ────────────────────────

router.post('/retenciones/validar', async (req, res) => {
  try {
    const { tipoImpuesto, codigo, porcentaje, baseImponible } = req.body;

    if (!tipoImpuesto || !codigo || porcentaje === undefined) {
      return res.status(400).json({
        exito: false,
        error: 'Se requiere: tipoImpuesto (renta/iva), codigo y porcentaje',
      });
    }

    const resultado = await validarPorcentajeRetencion({
      tipoImpuesto,
      codigo,
      porcentajeAplicado: parseFloat(porcentaje),
      baseImponible: baseImponible ? parseFloat(baseImponible) : undefined,
    });

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error validando porcentaje de retención',
      detalle: error.message,
    });
  }
});

// ─── Validar múltiples retenciones ─────────────────────────────────────

router.post('/retenciones/validar-multiple', async (req, res) => {
  try {
    const { retenciones } = req.body;

    if (!retenciones || !Array.isArray(retenciones) || retenciones.length === 0) {
      return res.status(400).json({
        exito: false,
        error: 'Se requiere un array de retenciones con: tipoImpuesto, codigo, porcentaje',
      });
    }

    const resultado = await validarMultiplesRetenciones(retenciones);

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error validando múltiples retenciones',
      detalle: error.message,
    });
  }
});

// ─── Obtener tabla de porcentajes de renta ─────────────────────────────

router.get('/retenciones/tabla-renta', async (req, res) => {
  try {
    const tabla = await cargarPorcentajesRenta();

    res.json({
      exito: true,
      tipo: 'Impuesto a la Renta',
      registros: tabla.length,
      datos: tabla.map(item => ({
        codigo: item.codigo,
        concepto: item.concepto,
        porcentaje: item.porcentaje + '%',
        baseLegal: item.baseLegal,
      })),
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error cargando tabla de renta',
      detalle: error.message,
    });
  }
});

// ─── Obtener tabla de porcentajes de IVA ───────────────────────────────

router.get('/retenciones/tabla-iva', async (req, res) => {
  try {
    const tabla = await cargarPorcentajesIVA();

    res.json({
      exito: true,
      tipo: 'IVA',
      registros: tabla.length,
      datos: tabla.map(item => ({
        codigo: item.codigo,
        concepto: item.concepto,
        porcentaje: item.porcentaje + '%',
        aplicacion: item.aplicacion,
      })),
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error cargando tabla de IVA',
      detalle: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  ENDPOINTS DE GOOGLE DRIVE CDN
// ═══════════════════════════════════════════════════════════════════════

// ─── Subir todos los catastros a Google Drive ──────────────────────────

router.post('/drive/subir-todos', async (req, res) => {
  try {
    if (!googleDriveCdn) {
      return res.status(500).json({
        exito: false,
        error: 'Google Drive CDN no está instalado. Ejecuta: npm install googleapis',
      });
    }

    const folderId = config.googleDriveFolderId;

    if (!folderId) {
      return res.status(400).json({
        exito: false,
        error: 'Se requiere GOOGLE_DRIVE_FOLDER_ID',
      });
    }

    const resultado = await googleDriveCdn.subirTodos(folderId);

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error subiendo archivos a Google Drive',
      detalle: error.message,
    });
  }
});

// ─── Descargar todos los catastros desde Google Drive ──────────────────

router.post('/drive/descargar-todos', async (req, res) => {
  try {
    if (!googleDriveCdn) {
      return res.status(500).json({
        exito: false,
        error: 'Google Drive CDN no está instalado. Ejecuta: npm install googleapis',
      });
    }

    const folderId = config.googleDriveFolderId;

    if (!folderId) {
      return res.status(400).json({
        exito: false,
        error: 'Se requiere GOOGLE_DRIVE_FOLDER_ID',
      });
    }

    const resultado = await googleDriveCdn.descargarTodos(folderId);

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error descargando archivos desde Google Drive',
      detalle: error.message,
    });
  }
});

// ─── Verificar actualizaciones en Drive ────────────────────────────────

router.get('/drive/verificar', async (req, res) => {
  try {
    if (!googleDriveCdn) {
      return res.status(500).json({
        exito: false,
        error: 'Google Drive CDN no está instalado',
      });
    }

    const folderId = config.googleDriveFolderId;

    if (!folderId) {
      return res.status(400).json({
        exito: false,
        error: 'Google Drive no está configurado',
      });
    }

    const resultado = await googleDriveCdn.verificarActualizaciones(folderId);

    res.json({
      exito: true,
      ...resultado,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error verificando actualizaciones',
      detalle: error.message,
    });
  }
});

// ─── Estadísticas de Google Drive ──────────────────────────────────────

router.get('/drive/estadisticas', async (req, res) => {
  try {
    if (!googleDriveCdn) {
      return res.status(500).json({
        exito: false,
        error: 'Google Drive CDN no está instalado',
      });
    }

    const folderId = config.googleDriveFolderId;

    if (!folderId) {
      return res.status(400).json({
        exito: false,
        error: 'Google Drive no está configurado',
      });
    }

    const stats = await googleDriveCdn.obtenerEstadisticas(folderId);

    res.json({
      exito: true,
      ...stats,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error obteniendo estadísticas',
      detalle: error.message,
    });
  }
});

// ─── Sincronizar (subir solo archivos nuevos/modificados) ──────────────

router.post('/drive/sincronizar', async (req, res) => {
  try {
    if (!googleDriveCdn) {
      return res.status(500).json({
        exito: false,
        error: 'Google Drive CDN no está instalado',
      });
    }

    const folderId = config.googleDriveFolderId;

    if (!folderId) {
      return res.status(400).json({
        exito: false,
        error: 'Google Drive no está configurado',
      });
    }

    // Verificar qué archivos necesitan actualización
    const verificacion = await googleDriveCdn.verificarActualizaciones(folderId);
    const necesitanSubida = verificacion.archivos.filter(a => a.necesitaDescarga);

    if (necesitanSubida.length === 0) {
      return res.json({
        exito: true,
        mensaje: 'Todos los archivos están sincronizados',
        sincronizados: 0,
      });
    }

    // Subir solo los que necesitan actualización
    const resultado = await googleDriveCdn.subirTodos(folderId);

    res.json({
      exito: true,
      sincronizados: resultado.subidos,
      ...resultado,
    });
  } catch (error) {
    res.status(500).json({
      exito: false,
      error: 'Error sincronizando archivos',
      detalle: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  ENDPOINTS DEL MAESTRO DE PROVEEDORES
// ═══════════════════════════════════════════════════════════════════════

// --- Obtener el Maestro completo ---
router.get('/maestro', async (req, res) => {
  try {
    const maestro = await cargarMaestro();
    res.json({ exito: true, maestro });
  } catch (error) {
    res.status(500).json({ exito: false, error: error.message });
  }
});

// --- Sincronizar manualmente el Maestro contra los catastros ---
router.post('/maestro/sincronizar', async (req, res) => {
  try {
    const resultado = await sincronizarMaestroCompleto();
    res.json({ exito: true, ...resultado });
  } catch (error) {
    res.status(500).json({ exito: false, error: error.message });
  }
});

// --- Obtener notificaciones de cambios ---
router.get('/notificaciones', async (req, res) => {
  try {
    const notificaciones = await cargarNotificaciones();
    res.json({ exito: true, notificaciones });
  } catch (error) {
    res.status(500).json({ exito: false, error: error.message });
  }
});

// --- Marcar notificaciones como leídas ---
router.post('/notificaciones/marcar-leidas', async (req, res) => {
  try {
    let notificaciones = await cargarNotificaciones();
    notificaciones = notificaciones.map(n => ({ ...n, leida: true }));
    await guardarNotificaciones(notificaciones);
    res.json({ exito: true });
  } catch (error) {
    res.status(500).json({ exito: false, error: error.message });
  }
});

// --- Agregar RUC al Maestro ---
router.post('/maestro/agregar', async (req, res) => {
  try {
    const { ruc, nombre } = req.body;
    if (!ruc) return res.status(400).json({ exito: false, error: 'RUC requerido' });
    const nuevo = await agregarAlMaestro(ruc, nombre);
    res.json({ exito: true, proveedor: nuevo });
  } catch (error) {
    res.status(500).json({ exito: false, error: error.message });
  }
});

router.get('/maestro/exportar', async (req, res) => {
  try {
    const maestro = await cargarMaestro();
    const proveedores = Object.values(maestro);
    
    // Preparar datos para Excel (aplanar la estructura)
    const exportData = proveedores.map(p => {
      const row = {
        RUC: p.ruc,
        Nombre: p.nombre,
        'Estado General': p.estados.join(', '),
        'Ultima Verificacion': p.ultimaVerificacion
      };
      
      // Añadir columnas por cada catastro
      if (p.detalleCompleto) {
        for (const [tipo, info] of Object.entries(p.detalleCompleto)) {
          row[tipo] = info.encontrado ? 'SÍ' : 'NO';
        }
      }
      
      return row;
    });

    res.json({
      exito: true,
      datos: exportData
    });
  } catch (error) {
    res.status(500).json({ exito: false, error: error.message });
  }
});

module.exports = router;

