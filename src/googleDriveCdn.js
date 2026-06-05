const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CATASTROS_DIR = path.join(__dirname, '..', 'data', 'catastros');
const CONFIG_FILE = path.join(CATASTROS_DIR, 'drive-sync.json');

/**
 * Google Drive CDN con Service Account
 * 
 * Permite subida y descarga automática de catastros.
 * Requiere:
 * 1. Service Account creado en Google Cloud
 * 2. Archivo JSON de credenciales descargado
 * 3. Carpeta compartida con el email del Service Account
 */

// ─── Autenticación con OAuth2 ──────────────────────────────────────

let oAuth2Client = null;
const TOKEN_PATH = path.join(__dirname, '..', 'data', 'token.json');

/**
 * Obtiene el cliente de OAuth2 configurado
 */
function obtenerClienteOAuth2() {
  const { config } = require('./config');
  
  if (oAuth2Client) return oAuth2Client;

  const id = (process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const secret = (process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  const uri = (process.env.GOOGLE_DRIVE_REDIRECT_URI || '').trim();

  console.log(`[DRIVE-DEBUG] Usando ID: ${id.substring(0, 15)}...`);
  console.log(`[DRIVE-DEBUG] Usando Secret: ${secret.substring(0, 10)}...`);
  console.log(`[DRIVE-DEBUG] Usando Redirect: ${uri}`);

  oAuth2Client = new google.auth.OAuth2(id, secret, uri);

  return oAuth2Client;
}

/**
 * Genera la URL para que el usuario autorice la aplicación
 */
function generarUrlAutenticacion() {
  const client = obtenerClienteOAuth2();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file']
  });
}

/**
 * Intercambia el código de autorización por tokens
 */
async function intercambiarCodigoPorToken(code) {
  const client = obtenerClienteOAuth2();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  
  // Guardar token para futuras sesiones
  await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
  
  return tokens;
}

/**
 * Obtiene cliente de Google Drive autenticado
 */
async function obtenerDrive() {
  const client = obtenerClienteOAuth2();
  
  // Intentar cargar token guardado
  try {
    const token = await fs.readFile(TOKEN_PATH, 'utf-8');
    client.setCredentials(JSON.parse(token));
  } catch (error) {
    // Si no hay token, el usuario debe autenticarse via web
    throw new Error('AUTH_REQUIRED');
  }

  return google.drive({ version: 'v3', auth: client });
}

// ─── Funciones Auxiliares ───────────────────────────────────────────

async function guardarConfig(config) {
  await fs.mkdir(CATASTROS_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

async function leerConfig() {
  try {
    const contenido = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(contenido);
  } catch {
    return { ultimaSubida: null, ultimaDescarga: null, archivos: {} };
  }
}

// ─── Funciones Principales ──────────────────────────────────────────

/**
 * Sube un archivo a Google Drive
 */
async function subirArchivo(filePath, fileName, folderId) {
  const drive = await obtenerDrive();

  // Buscar si existe archivo con mismo nombre
  const response = await drive.files.list({
    q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)'
  });

  const existente = response.data.files[0];

  if (existente) {
    // Eliminar versión anterior
    await drive.files.delete({ 
      fileId: existente.id,
      supportsAllDrives: true 
    });
  }

  // Subir nueva versión
  const fileMetadata = {
    name: fileName,
    parents: [folderId]
  };

  const media = {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: fsSync.createReadStream(filePath)
  };

  const result = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, size, modifiedTime',
    supportsAllDrives: true
  });

  return result.data;
}

/**
 * Descarga un archivo desde Google Drive
 */
async function descargarArchivo(fileId, destino) {
  const drive = await obtenerDrive();
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    const dest = fsSync.createWriteStream(destino);
    response.data
      .on('end', () => resolve(destino))
      .on('error', reject)
      .pipe(dest);
  });
}

/**
 * Lista todos los archivos de catastros en Drive
 */
async function listarArchivos(folderId) {
  const drive = await obtenerDrive();
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and (name contains '.xlsx' or name contains '.xls')`,
    fields: 'files(id, name, size, modifiedTime)',
    orderBy: 'name'
  });
  return response.data.files;
}

/**
 * Obtiene información de un archivo en Drive
 */
async function obtenerInfoArchivo(folderId, fileName) {
  const drive = await obtenerDrive();
  const response = await drive.files.list({
    q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, size, modifiedTime)',
    orderBy: 'modifiedTime desc'
  });
  return response.data.files[0] || null;
}

// ─── Operaciones Masivas ────────────────────────────────────────────

/**
 * Sube TODOS los catastros a Google Drive (Servidor Master)
 * Se ejecuta automáticamente cada 15 días
 */
async function subirTodos(folderId) {
  const archivos = fsSync.readdirSync(CATASTROS_DIR)
    .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));

  const resultados = [];
  let subidos = 0;

  for (const archivo of archivos) {
    try {
      const filePath = path.join(CATASTROS_DIR, archivo);
      console.log(`[DRIVE] ⬆️ Subiendo ${archivo}...`);

      const resultado = await subirArchivo(filePath, archivo, folderId);

      resultados.push({
        archivo,
        exito: true,
        fileId: resultado.id,
        tamaño: parseInt(resultado.size),
        modificado: resultado.modifiedTime
      });
      subidos++;

      console.log(`  ✅ ${archivo} (${(resultado.size / 1024 / 1024).toFixed(2)} MB)`);
    } catch (error) {
      resultados.push({ archivo, exito: false, error: error.message });
      console.error(`  ❌ ${archivo}: ${error.message}`);
    }
  }

  // Guardar registro
  await guardarConfig({
    ultimaSubida: new Date().toISOString(),
    totalArchivos: archivos.length,
    subidos,
    archivos: resultados
  });

  return {
    exito: true,
    total: archivos.length,
    subidos,
    fallidos: archivos.length - subidos,
    resultados
  };
}

/**
 * Descarga TODOS los catastros desde Google Drive
 * Se ejecuta automáticamente en todos los servidores/usuarios
 */
async function descargarTodos(folderId) {
  const archivos = await listarArchivos(folderId);

  if (archivos.length === 0) {
    throw new Error('No se encontraron catastros en Google Drive');
  }

  const resultados = [];
  let descargados = 0;

  for (const archivo of archivos) {
    try {
      const destino = path.join(CATASTROS_DIR, archivo.name);
      console.log(`[DRIVE] ⬇️ Descargando ${archivo.name}...`);

      const pathDescarga = await descargarArchivo(archivo.id, destino);

      resultados.push({
        archivo: archivo.name,
        exito: true,
        tamaño: parseInt(archivo.size),
        modificado: archivo.modifiedTime
      });
      descargados++;

      console.log(`  ✅ ${archivo.name} (${(archivo.size / 1024 / 1024).toFixed(2)} MB)`);
    } catch (error) {
      resultados.push({ archivo: archivo.name, exito: false, error: error.message });
      console.error(`  ❌ ${archivo.name}: ${error.message}`);
    }
  }

  // Guardar registro
  const config = await leerConfig();
  config.ultimaDescarga = new Date().toISOString();
  config.totalDescargados = descargados;
  config.archivosDrive = resultados;
  await guardarConfig(config);

  return {
    exito: true,
    total: archivos.length,
    descargados,
    fallidos: archivos.length - descargados,
    resultados
  };
}

/**
 * Compara archivos locales con Drive y determina si hay actualizaciones
 */
async function verificarActualizaciones(folderId) {
  const config = await leerConfig();
  const archivosDrive = await listarArchivos(folderId);

  const actualizaciones = archivosDrive.map(archivo => {
    const archivoLocal = config.archivos?.find(a => a.archivo === archivo.name);
    const esNuevo = !archivoLocal;
    const estaActualizado = archivoLocal && archivoLocal.modificado === archivo.modifiedTime;

    return {
      archivo: archivo.name,
      enDrive: true,
      nuevo: esNuevo,
      actualizado: estaActualizado,
      modificadoEnDrive: archivo.modifiedTime,
      tamaño: parseInt(archivo.size),
      necesitaDescarga: esNuevo || !estaActualizado
    };
  });

  return {
    total: archivosDrive.length,
    nuevos: actualizaciones.filter(a => a.nuevo).length,
    actualizados: actualizaciones.filter(a => a.actualizado).length,
    necesitanDescarga: actualizaciones.filter(a => a.necesitaDescarga).length,
    archivos: actualizaciones,
    ultimaVerificacion: new Date().toISOString()
  };
}

/**
 * Obtiene estadísticas de uso
 */
async function obtenerEstadisticas(folderId) {
  const archivos = await listarArchivos(folderId);
  const config = await leerConfig();

  const tamañoTotal = archivos.reduce((sum, a) => sum + parseInt(a.size || 0), 0);

  return {
    totalArchivos: archivos.length,
    tamañoTotal,
    tamañoTotalMB: (tamañoTotal / 1024 / 1024).toFixed(2),
    ultimaSubida: config.ultimaSubida || 'Nunca',
    ultimaDescarga: config.ultimaDescarga || 'Nunca',
    archivos: archivos.map(a => ({
      nombre: a.name,
      tamaño: parseInt(a.size),
      tamañoMB: (parseInt(a.size) / 1024 / 1024).toFixed(2),
      modificado: a.modifiedTime
    }))
  };
}

module.exports = {
  CATASTROS_DIR,
  subirTodos,
  descargarTodos,
  verificarActualizaciones,
  obtenerEstadisticas,
  leerConfig,
  guardarConfig,
  obtenerClienteOAuth2,
  generarUrlAutenticacion,
  intercambiarCodigoPorToken,
  obtenerDrive,
  listarArchivos,
  descargarArchivo,
  obtenerInfoArchivo,
};
