const express = require('express');
const { consultarComprobante, consultarFacturaNegociable, consultarMasivo } = require('./sriClient');
const { config, getAmbiente, AMBIENTES } = require('./config');

const router = express.Router();

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

    // Validar claves
    const clavesValidas = [];
    const clavesInvalidas = [];

    clavesAcceso.forEach((clave) => {
      const normalizada = clave.trim();
      if (/^\d{49}$/.test(normalizada)) {
        clavesValidas.push(normalizada);
      } else if (normalizada.length > 0) {
        clavesInvalidas.push({
          claveAcceso: normalizada,
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

    const tipoServicio = tipo || 'comprobante';
    const ambienteUsado = ambiente || config.sriEnv;

    console.log(`[MASIVA] ${clavesValidas.length} claves válidas, ${clavesInvalidas.length} inválidas | Tipo: ${tipoServicio} | Ambiente: ${ambienteUsado}`);

    const inicioTiempo = Date.now();

    const resultadosSRI = await consultarMasivo(clavesValidas, tipoServicio, ambienteUsado);

    const tiempoTotal = Date.now() - inicioTiempo;

    // Combinar resultados válidos e inválidos
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

module.exports = router;
