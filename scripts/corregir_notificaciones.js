const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { buscarRUCEnCatastro } = require('../src/catalogManager');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NOTIFICACIONES_FILE = path.join(DATA_DIR, 'notificaciones_cambios.json');

async function corregirNotificaciones() {
  if (!fsSync.existsSync(NOTIFICACIONES_FILE)) {
    console.log('No se encontró el archivo de notificaciones.');
    return;
  }

  try {
    const rawData = await fs.readFile(NOTIFICACIONES_FILE, 'utf-8');
    const notificaciones = JSON.parse(rawData);
    let corregidos = 0;

    console.log(`Procesando ${notificaciones.length} notificaciones...`);

    for (const notif of notificaciones) {
      if (notif.nombre === 'Nombre no encontrado') {
        const resultados = await buscarRUCEnCatastro(notif.ruc, 'todos');
        
        let nombreEncontrado = null;
        for (const r of Object.values(resultados)) {
          if (r.datos) {
            const val = r.datos.nombre || r.datos.razonSocial || r.datos.razon_social || 
                        r.datos['Razón Social'] || r.datos['RAZON SOCIAL'] || 
                        r.datos['Nombre'] || r.datos['NOMBRE'];
            if (val && val !== 'Nombre no encontrado') {
              nombreEncontrado = String(val).trim();
              break;
            }
          }
        }

        if (nombreEncontrado) {
          console.log(`✅ Corrigiendo RUC ${notif.ruc}: 'Nombre no encontrado' -> '${nombreEncontrado}'`);
          notif.nombre = nombreEncontrado;
          corregidos++;
        }
      }
    }

    if (corregidos > 0) {
      await fs.writeFile(NOTIFICACIONES_FILE, JSON.stringify(notificaciones, null, 2), 'utf-8');
      console.log(`Sincronización completada. Se corrigieron ${corregidos} notificaciones.`);
    } else {
      console.log('No se encontraron notificaciones que requieran corrección.');
    }
  } catch (error) {
    console.error('Error durante la corrección:', error);
  }
}

corregirNotificaciones();
