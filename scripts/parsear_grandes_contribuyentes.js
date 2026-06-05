const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// ─── Función para parsear Grandes Contribuyentes ─────────────────────

/**
 * Parsea el archivo de Grandes Contribuyentes correctamente.
 * Estructura:
 *   Fila 1: "Total:" 520
 *   Fila 2: Cabeceras (RUC, Razón Social, etc.)
 *   Fila 3+: Datos
 */
function parsearGrandesContribuyentes(rutaArchivo) {
  if (!fsSync.existsSync(rutaArchivo)) {
    throw new Error('Archivo de grandes contribuyentes no encontrado');
  }

  try {
    const workbook = XLSX.readFile(rutaArchivo);
    const primeraHoja = workbook.SheetNames[0];

    // Leer con encabezados manuales para controlar el rango
    const datos = XLSX.utils.sheet_to_json(
      workbook.Sheets[primeraHoja],
      {
        header: 'A',
        defval: '',
        range: 1 // Saltar fila 1 (Total), empezar desde fila 2 (cabeceras)
      }
    );

    // La fila 0 ahora son las cabeceras
    // Las filas 1+ son los datos
    const cabeceras = datos[0];
    const registros = datos.slice(1).map((fila, index) => ({
      numero: parseInt(fila.A) || index + 1,
      ruc: String(fila.B || '').trim(),
      razonSocial: String(fila.C || '').trim(),
      oficioAtributo: String(fila.D || '').trim(),
      jurisdiccion: String(fila.E || '').trim(),
      provincia: String(fila.F || '').trim(),
      subtipo: String(fila.G || '').trim(),
    })).filter(r => r.ruc && r.ruc.length >= 10); // Filtrar filas vacías

    return {
      total: registros.length,
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

// ─── Ejecutar y mostrar resultados ───────────────────────────────────

const rutaArchivo = path.join(__dirname, '..', 'data', 'catastros', 'grandes_contribuyentes.xlsx');

try {
  console.log('📊 Parseando Grandes Contribuyentes...\n');

  const resultado = parsearGrandesContribuyentes(rutaArchivo);

  console.log(`✅ Total de registros: ${resultado.total}`);
  console.log('\n📋 Cabeceras detectadas:');
  console.log(`   RUC → Columna ${resultado.cabeceras.ruc}`);
  console.log(`   Razón Social → Columna ${resultado.cabeceras.razonSocial}`);
  console.log(`   Oficio → Columna ${resultado.cabeceras.oficio}`);
  console.log(`   Jurisdicción → Columna ${resultado.cabeceras.jurisdiccion}`);
  console.log(`   Provincia → Columna ${resultado.cabeceras.provincia}`);
  console.log(`   Subtipo → Columna ${resultado.cabeceras.subtipo}`);

  console.log('\n📄 Primeros 5 registros:');
  resultado.registros.slice(0, 5).forEach((r, i) => {
    console.log(`\n${i + 1}. ${r.razonSocial}`);
    console.log(`   RUC: ${r.ruc}`);
    console.log(`   Provincia: ${r.provincia}`);
    console.log(`   Oficio: ${r.oficioAtributo.substring(0, 30)}...`);
  });

  console.log('\n✅ Parser funcionando correctamente!');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
