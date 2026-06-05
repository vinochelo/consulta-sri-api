const path = require('path');
const { 
  parsearGrandesContribuyentes,
  parsearExportadoresBienes,
  parsearExportadoresServicios,
  parsearContribuyentesEspeciales
} = require('../src/catalogManager');

async function probarMultiHoja() {
  console.log('🧪 PROBANDO PARSEO MULTI-HOJA\n');
  console.log('═'.repeat(60));

  // 1. Grandes Contribuyentes
  console.log('\n📊 1. GRANDES CONTRIBUYENTES');
  try {
    const gc = await parsearGrandesContribuyentes();
    console.log(`   ✅ Total registros: ${gc.total}`);
    console.log(`   📁 Hojas procesadas: ${Object.keys(gc.hojas).length}`);
    Object.entries(gc.hojas).forEach(([hoja, info]) => {
      console.log(`      - ${hoja}: ${info.filasDatos} registros`);
    });
    if (gc.registros.length > 0) {
      console.log(`   📄 Ejemplo: ${gc.registros[0].razonSocial} (${gc.registros[0].ruc})`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 2. Exportadores de Bienes (7 hojas: 2020-2026)
  console.log('\n📊 2. EXPORTADORES DE BIENES');
  try {
    const eb = await parsearExportadoresBienes();
    console.log(`   ✅ Total registros: ${eb.total}`);
    console.log(`   📁 Hojas procesadas: ${Object.keys(eb.hojas).length}`);
    Object.entries(eb.hojas).forEach(([hoja, info]) => {
      console.log(`      - ${hoja}: ${info.filasDatos} registros`);
    });
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 3. Exportadores de Servicios (4 hojas: 2023-2026)
  console.log('\n📊 3. EXPORTADORES DE SERVICIOS');
  try {
    const es = await parsearExportadoresServicios();
    console.log(`   ✅ Total registros: ${es.total}`);
    console.log(`   📁 Hojas procesadas: ${Object.keys(es.hojas).length}`);
    Object.entries(es.hojas).forEach(([hoja, info]) => {
      console.log(`      - ${hoja}: ${info.filasDatos} registros`);
    });
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 4. Contribuyentes Especiales (2 hojas)
  console.log('\n📊 4. CONTRIBUYENTES ESPECIALES');
  try {
    const ce = await parsearContribuyentesEspeciales();
    console.log(`   ✅ Total registros (únicos): ${ce.total}`);
    console.log(`   📁 Hojas procesadas: ${Object.keys(ce.hojas).length}`);
    Object.entries(ce.hojas).forEach(([hoja, info]) => {
      console.log(`      - ${hoja}: ${info.filasDatos} registros`);
    });
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ PRUEBAS COMPLETADAS\n');
}

probarMultiHoja().catch(console.error);
