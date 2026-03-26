require('dotenv').config();

const AMBIENTES = {
  pruebas: {
    nombre: 'Pruebas (CELCER)',
    consultaComprobante: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante',
    consultaFactura: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/ConsultaFactura',
  },
  produccion: {
    nombre: 'Producción (CEL)',
    consultaComprobante: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante',
    consultaFactura: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/ConsultaFactura',
  },
};

const config = {
  port: parseInt(process.env.PORT) || 3000,
  sriEnv: process.env.SRI_ENV || 'produccion',
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT) || 10,
  delayMs: parseInt(process.env.DELAY_MS) || 0,
  timeout: 30000, // 30 segundos timeout por petición SOAP
};

/**
 * Obtiene las URLs del ambiente actual o de uno específico
 */
function getAmbiente(ambiente) {
  const env = ambiente || config.sriEnv;
  return AMBIENTES[env] || AMBIENTES.produccion;
}

module.exports = { config, getAmbiente, AMBIENTES };
