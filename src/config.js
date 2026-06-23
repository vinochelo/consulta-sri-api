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
  timeout: 45000,

  // ─── Configuración de Catastros ────────────────────────────────────
  catastroActualizacionDias: parseInt(process.env.CATASTRO_ACTUALIZACION_DIAS) || 15,
  catastroSchedulerActivo: process.env.CATASTRO_SCHEDULER !== 'false',

  // ─── Google Drive CDN (Fuente Principal) ───────────────────────────
  googleDriveEnabled: process.env.GOOGLE_DRIVE_ENABLED === 'true' || process.env.GOOGLE_DRIVE_ENABLED === '1',
  googleDriveClientId: process.env.GOOGLE_DRIVE_CLIENT_ID || '',
  googleDriveClientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || '',
  googleDriveRedirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI || '',
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',

  // Modo servidor principal (sube a Drive cada 15 días)
  googleDriveMasterServer: process.env.GOOGLE_DRIVE_MASTER === 'true' || process.env.GOOGLE_DRIVE_MASTER === '1',
};

const path = require('path');
const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? '/tmp/data' : path.join(__dirname, '..', 'data');
const CATASTROS_DIR = path.join(DATA_DIR, 'catastros');

function getAmbiente(ambiente) {
  const env = ambiente || config.sriEnv;
  return AMBIENTES[env] || AMBIENTES.produccion;
}

module.exports = { config, getAmbiente, AMBIENTES, DATA_DIR, CATASTROS_DIR };
