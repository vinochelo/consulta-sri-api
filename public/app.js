// ═══════════════════════════════════════════════════════════════
// Consulta SRI - Dashboard con soporte Excel y procesamiento
// por lotes progresivo para archivos grandes (1600+ claves)
// ═══════════════════════════════════════════════════════════════

const API_BASE = window.location.origin + '/api';
let ambienteActual = 'produccion';
let consultaCancelada = false;
let resultadosMasivos = [];
let clavesDesdeExcel = [];
let metadatosExcel = {};
let filasOmitidas = 0;
let nombreArchivoExcel = '';

function obtenerFilaEIdentificadorExcel(clave) {
  if (!clave) return '';
  if (clave.includes('_dup_ret_')) {
    return clave.split('_dup_ret_')[1];
  }
  return clave;
}

function encontrarMetadatos(clave) {
  if (!clave) return {};
  const idExcel = obtenerFilaEIdentificadorExcel(clave);
  return metadatosExcel[idExcel] || {};
}

function obtenerNombreTipoComprobante(codigo) {
  const cod = String(codigo).trim();
  switch (cod) {
    case '01': return 'FACTURA';
    case '03': return 'LIQUIDACIÓN DE COMPRA';
    case '04': return 'NOTA DE CRÉDITO';
    case '05': return 'NOTA DE DÉBITO';
    case '06': return 'GUÍA DE REMISIÓN';
    case '07': return 'RETENCIÓN';
    default: return codigo;
  }
}

// Tamaño de cada lote enviado al servidor y concurrencia
const TAMANO_LOTE = 100;
const CONEXIONES_SIMULTANEAS = 2; // Cantidad de lotes en paralelo

let tablaRentaOficial = [];
let tablaIvaOficial = [];

// ─── Inicialización ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTabs();
  initConsultaIndividual();
  initConsultaMasiva();
  initExcelUpload();
  initFiltro();
  checkHealth();
  initMaestroAndNotifications();
  cargarTablasRetencion();
});

// Cargar catastro oficial de tarifas de retención desde la API
async function cargarTablasRetencion() {
  try {
    const resRenta = await fetch(`${API_BASE}/retenciones/tabla-renta`);
    if (resRenta.ok) {
      const data = await resRenta.json();
      if (data.exito && data.datos) {
        tablaRentaOficial = data.datos.map(d => ({
          codigo: String(d.codigo || '').trim(),
          concepto: d.concepto || '',
          porcentaje: parseFloat(String(d.porcentaje || '0').replace('%', '').replace(',', '.'))
        }));
        console.log(`[RETENCIONES] Cargadas ${tablaRentaOficial.length} tarifas de Renta oficiales.`);
      }
    }
    const resIva = await fetch(`${API_BASE}/retenciones/tabla-iva`);
    if (resIva.ok) {
      const data = await resIva.json();
      if (data.exito && data.datos) {
        tablaIvaOficial = data.datos;
        console.log(`[RETENCIONES] Cargadas ${tablaIvaOficial.length} tarifas de IVA oficiales.`);
      }
    }
  } catch (error) {
    console.error('Error al cargar tablas de retenciones:', error);
  }
}

// Desestructura una clave de 49 dígitos en sus partes oficiales
function desestructurarClaveAcceso(clave) {
  if (!clave || clave.length !== 49 || !/^\d{49}$/.test(clave)) {
    return null;
  }
  return {
    fechaEmision: clave.substring(0, 8),
    tipoComprobante: clave.substring(8, 10),
    rucEmisor: clave.substring(10, 23),
    ambiente: clave.substring(23, 24),
    establecimiento: clave.substring(24, 27),
    puntoEmision: clave.substring(27, 30),
    secuencial: clave.substring(30, 39),
    codigoNumerico: clave.substring(39, 47),
    tipoEmision: clave.substring(47, 48),
    digitoVerificador: clave.substring(48, 49)
  };
}

// Valida una clave con el algoritmo Módulo 11
function validarDigitoVerificador(clave) {
  if (!clave || clave.length !== 49 || !/^\d{49}$/.test(clave)) return false;
  const digitoVerificadorEsperado = parseInt(clave[48]);
  let suma = 0;
  let factor = 2;
  for (let i = 47; i >= 0; i--) {
    suma += parseInt(clave[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const residuo = suma % 11;
  let verificadorCalculado = 11 - residuo;
  if (verificadorCalculado === 11) verificadorCalculado = 0;
  if (verificadorCalculado === 10) verificadorCalculado = 1;
  return verificadorCalculado === digitoVerificadorEsperado;
}

// Calcula la antigüedad de un comprobante en días basándose en la fecha de emisión codificada en su clave de acceso
function obtenerAntiguedadClave(clave) {
  if (!clave || clave.length < 8) return 0;
  const dia = parseInt(clave.substring(0, 2), 10);
  const mes = parseInt(clave.substring(2, 4), 10) - 1; // 0-indexed en JS
  const anio = parseInt(clave.substring(4, 8), 10);
  if (isNaN(dia) || isNaN(mes) || isNaN(anio)) return 0;
  
  const fechaDoc = new Date(anio, mes, dia);
  const hoy = new Date();
  const hoyMidnight = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const diffTime = hoyMidnight - fechaDoc;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Determina si una factura es del exterior (importación) sin clave del SRI
function detectarFacturaExterior(meta, autorizacion) {
  const m = meta || {};
  const autLimpia = String(autorizacion || '').trim().split('_dup_')[0];
  const esLiquidacionPorClave = autLimpia.length === 49 && autLimpia.substring(8, 10) === '03';
  const tipoDocUpper = String(m.tipoDoc || '').trim().toUpperCase();
  const esLiquidacionCompra = esLiquidacionPorClave ||
                              tipoDocUpper === 'LC' || 
                              tipoDocUpper.includes('LIQ') || 
                              tipoDocUpper.includes('LIQUIDACION');
  if (esLiquidacionCompra) {
    return true;
  }

  const estab = String(m.estab || '').trim().toUpperCase();
  const pto = String(m.ptoEmi || '').trim().toUpperCase();
  const sec = String(m.secuencial || '').trim().toUpperCase();
  const aut = String(autorizacion || '').trim().toUpperCase();
  
  // Si contiene palabras típicas de error de ingreso del ERP, NO es exterior
  if (aut.includes('FACTURA') || aut.includes('NOTA') || aut.includes('CREDITO') || aut.includes('ELECTR') || aut.includes('ERROR')) {
    return false;
  }
  
  const tieneLetrasEstab = /[A-Z]/.test(estab);
  const tieneLetrasSec = /[A-Z]/.test(sec);
  const tieneLetrasAut = /[A-Z]/.test(aut);
  
  const autCoincideConSerie = aut !== '' && aut === (estab + pto);
  
  return tieneLetrasEstab || tieneLetrasSec || tieneLetrasAut || autCoincideConSerie;
}

// Determina si un valor de celda está vacío o contiene solo placeholders típicos
function esVacioOPlaceholder(val) {
  if (val === undefined || val === null) return true;
  const s = String(val).trim();
  if (s === '') return true;
  
  // Normalizar removiendo guiones, espacios, puntos, barras, etc.
  const clean = s.replace(/[-_.\s/]/g, '');
  if (clean === '') return true;
  
  // Si consiste únicamente de ceros (ej: "0", "000", "000000000")
  if (/^0+$/.test(clean)) return true;
  
  // Si es un valor provisional de pocos caracteres o un string descriptivo de ausencia
  const upper = clean.toUpperCase();
  if (upper === 'NA' || upper === 'ND' || upper === 'NULL' || upper === 'NOAPLICA' || upper === 'SINRETENCION') {
    return true;
  }
  
  return false;
}

// Analiza inconsistencias de digitación y retenciones
function analizarInconsistencias(r, meta) {
  const inconsistencias = [];
  const clave = r.claveAcceso || '';
  const esConsultaRetencion = clave.includes('_dup_ret_');
  const claveLimpia = esConsultaRetencion ? '' : clave.split('_dup_')[0];
  
  const valorAutorizacion = esConsultaRetencion ? '' : (meta.originalValorAutorizacion !== undefined ? meta.originalValorAutorizacion : claveLimpia);
  
  // 1. Ingreso Anulado leve (SAP Documento empieza con 52 y sin facturación/autorización)
  const docSap = String(meta.documentoSap || '').trim();
  const esNotaCredito = docSap.startsWith('17');
  
  const tipoDocUpper = String(meta.tipoDoc || '').trim().toUpperCase();
  const esNotaVenta = tipoDocUpper === 'VD' || 
                      tipoDocUpper.includes('NOTA DE VENTA') || 
                      tipoDocUpper.includes('NOTA_VENTA') || 
                      tipoDocUpper.includes('NOTAS DE VENTA') || 
                      tipoDocUpper === 'NV';
  const esNegocioPopular = (r && r.esNegocioPopular) || esNotaVenta;
  const secFactura = String(meta.secuencial || '').trim();
  const autFactura = valorAutorizacion.startsWith('SIN_CLAVE_FILA') ? '' : valorAutorizacion.trim();
  const autRetencion = String(meta.autRet || '').trim();

  const esIngresoAnulado52 = docSap.startsWith('52') && 
                              esVacioOPlaceholder(secFactura) && 
                              esVacioOPlaceholder(autFactura) && 
                              esVacioOPlaceholder(autRetencion);

  if (esIngresoAnulado52) {
    return [{
      tipo: 'ADVERTENCIA',
      titulo: 'Ingreso Anulado',
      mensaje: `Transacción SAP que comienza con 52 sin factura, sin autorización de factura ni de retención. Se trata como ingreso anulado (advertencia leve).`
    }];
  }

  // 1. Facturas del Exterior
  if (detectarFacturaExterior(meta, valorAutorizacion)) {
    return [];
  }

  // 1b. Detección de claves de acceso provisionales con 9s (ej: 999999999999...)
  const esProvisional9s = /^9{10,}$/.test(valorAutorizacion) || valorAutorizacion.startsWith('9999');
  if (esProvisional9s) {
    inconsistencias.push({
      tipo: 'ADVERTENCIA',
      titulo: 'Autorización 9s',
      mensaje: `La celda de autorización contiene una secuencia provisional de nueves ("${valorAutorizacion}"), lo que indica que es una factura provisional o física.`
    });
  }

  // 1c. Coherencia de formato de Factura en Excel (Establecimiento, Punto Emisión y Secuencial)
  const estabStr = String(meta.estab || '').trim();
  const ptoStr = String(meta.ptoEmi || '').trim();
  const secStr = String(meta.secuencial || '').trim();

  if (estabStr !== '' && !/^\d{3}$/.test(estabStr)) {
    inconsistencias.push({
      tipo: 'ADVERTENCIA',
      titulo: 'Formato Estab',
      mensaje: `El Establecimiento en Excel ("${estabStr}") no tiene el formato coherente de 3 dígitos (ej: 001).`
    });
  }
  if (ptoStr !== '' && !/^\d{3}$/.test(ptoStr)) {
    inconsistencias.push({
      tipo: 'ADVERTENCIA',
      titulo: 'Formato Punto',
      mensaje: `El Punto de Emisión en Excel ("${ptoStr}") no tiene el formato coherente de 3 dígitos (ej: 001).`
    });
  }
  if (secStr !== '' && !/^\d{9}$/.test(secStr)) {
    inconsistencias.push({
      tipo: 'ADVERTENCIA',
      titulo: 'Formato Secuencial',
      mensaje: `El Secuencial en Excel ("${secStr}") no tiene el formato coherente de 9 dígitos (ej: 000014565).`
    });
  }
  
  // 2. Errores de Ingreso (Secuencial no cargado en ERP) - Omitido si es provisional con 9s
  let esAutFacturaInvalida = false;
  if (!esProvisional9s) {
    const autUpper = valorAutorizacion.toUpperCase();
    if (autUpper.includes('FACTURA') || autUpper.includes('NOTA') || autUpper.includes('CREDITO') || autUpper.includes('ELECTR') || !/^\d+$/.test(valorAutorizacion) || valorAutorizacion === '') {
      esAutFacturaInvalida = true;
      const tieneCamposNumeracion = estabStr !== '' && ptoStr !== '' && secStr !== '';
      const tieneAlertasFormato = inconsistencias.some(inc => inc.titulo.startsWith('Formato') && !inc.titulo.includes('Ret'));
      const formatoCoherente = tieneCamposNumeracion && !tieneAlertasFormato;

      const tituloAlerta = esNotaCredito ? 'NC Sin Autorización' : 'Sin Autorización';

      // Chequear si el documento tiene una retención autorizada válida
      const autRetLimpia = String(meta.autRet || '').trim().split('_dup_')[0];
      const tieneRetencionValida = /^\d{49}$/.test(autRetLimpia) && !/^9{10,}$/.test(autRetLimpia);
      const facturaSinNumero = esVacioOPlaceholder(meta.secuencial);

      if (tieneRetencionValida && facturaSinNumero) {
        // En este caso, no agregamos un error crítico sino una advertencia naranja
        const estadoRet = r.estadoFinal || 'AUTORIZADO';
        let tipoAlerta = 'ADVERTENCIA';
        let tituloAlertaRet = 'Retención Activa';
        let mensajeAlertaRet = `Factura sin autorización, pero posee retención autorizada con estado "${estadoRet}" en el SRI (posible venta en verde o factura anulada).`;

        if (estadoRet === 'ANULADO') {
          tituloAlertaRet = 'Retención Anulada';
          mensajeAlertaRet = `La factura no tiene autorización y la retención asociada ha sido ANULADA en el SRI.`;
        } else if (estadoRet === 'RECHAZADA') {
          tipoAlerta = 'ERROR';
          tituloAlertaRet = 'Retención Rechazada';
          mensajeAlertaRet = `La factura no tiene autorización y la retención asociada fue RECHAZADA en el SRI.`;
        } else if (estadoRet === 'NO AUTORIZADO') {
          tipoAlerta = 'ERROR';
          tituloAlertaRet = 'Retención No Autorizada';
          mensajeAlertaRet = `La factura no tiene autorización y la retención asociada NO está autorizada en el SRI.`;
        }

        inconsistencias.push({
          tipo: tipoAlerta,
          titulo: tituloAlertaRet,
          mensaje: mensajeAlertaRet
        });
      } else {
        if (formatoCoherente) {
          inconsistencias.push({
            tipo: 'ERROR',
            titulo: tituloAlerta,
            mensaje: valorAutorizacion === ''
              ? `La ${esNotaCredito ? 'nota de crédito' : 'factura'} tiene formato de numeración correcto (${estabStr}-${ptoStr}-${secStr}) pero la celda de autorización en el Excel está vacía. Verifique por qué no se generó o registró la autorización.`
              : `La ${esNotaCredito ? 'nota de crédito' : 'factura'} tiene formato de numeración correcto (${estabStr}-${ptoStr}-${secStr}) pero no se ha recuperado su clave de acceso del SRI. Verifique por qué no se generó o registró la autorización.`
          });
        } else {
          inconsistencias.push({
            tipo: 'ERROR',
            titulo: tituloAlerta,
            mensaje: valorAutorizacion === ''
              ? `La celda de autorización de la ${esNotaCredito ? 'nota de crédito' : 'factura'} en el Excel está vacía.`
              : `No se recuperó autorización en ERP (se leyó "${valorAutorizacion}"). Probablemente el secuencial o los dígitos de la ${esNotaCredito ? 'nota de crédito' : 'factura'} estén mal ingresados.`
          });
        }
      }
    }
  }
  
  // 3. Clave de Acceso estándar de 49 dígitos (omitida si es provisional de 9s o si la clave es inválida en ERP)
  if (!esProvisional9s && !esAutFacturaInvalida) {
    if (claveLimpia.length === 49 && /^\d{49}$/.test(claveLimpia)) {
      const claveParts = desestructurarClaveAcceso(claveLimpia);
      
      if (!validarDigitoVerificador(claveLimpia)) {
        inconsistencias.push({
          tipo: 'ERROR',
          titulo: 'Clave Inválida',
          mensaje: 'El dígito verificador de la clave de acceso es incorrecto (clave de acceso mal generada o con tipografía incorrecta).'
        });
      }
      
      if (claveParts) {
        // Comparar RUC
        const rucExcelNorm = String(meta.idProv || '').replace(/\D/g, '');
        const rucClaveNorm = String(claveParts.rucEmisor).replace(/\D/g, '');
        
        const tipoDocUpper = String(meta.tipoDoc || '').trim().toUpperCase();
        const esLiquidacionCompra = (claveLimpia.length === 49 && claveLimpia.substring(8, 10) === '03') || 
                                    tipoDocUpper === 'LC' || 
                                    tipoDocUpper.includes('LIQ') || 
                                    tipoDocUpper.includes('LIQUIDACION');
        
        if (!esLiquidacionCompra && rucExcelNorm && rucClaveNorm) {
          let rucMismatch = false;
          if (rucExcelNorm.length === 13) {
            rucMismatch = rucExcelNorm !== rucClaveNorm;
          } else if (rucExcelNorm.length === 10) {
            rucMismatch = !rucClaveNorm.startsWith(rucExcelNorm);
          } else {
            rucMismatch = rucExcelNorm !== rucClaveNorm;
          }
          if (rucMismatch) {
            inconsistencias.push({
              tipo: 'ERROR',
              titulo: 'Discrepancia RUC',
              mensaje: `El RUC del emisor en Excel (${meta.idProv}) no coincide con el RUC codificado en la clave de acceso (${claveParts.rucEmisor}).`
            });
          }
        }
        
        // Comparar Establecimiento
        const estabExcelNorm = parseInt(String(meta.estab || '').replace(/\D/g, ''), 10);
        const estabClaveNorm = parseInt(claveParts.establecimiento, 10);
        if (!isNaN(estabExcelNorm) && estabExcelNorm !== estabClaveNorm) {
          inconsistencias.push({
            tipo: 'ADVERTENCIA',
            titulo: 'Serie (Estab)',
            mensaje: `El Establecimiento en Excel (${meta.estab}) no coincide con el codificado en la clave (${claveParts.establecimiento}).`
          });
        }
        
        // Comparar Punto de Emisión
        const ptoExcelNorm = parseInt(String(meta.ptoEmi || '').replace(/\D/g, ''), 10);
        const ptoClaveNorm = parseInt(claveParts.puntoEmision, 10);
        if (!isNaN(ptoExcelNorm) && ptoExcelNorm !== ptoClaveNorm) {
          inconsistencias.push({
            tipo: 'ADVERTENCIA',
            titulo: 'Serie (Pto)',
            mensaje: `El Punto de Emisión en Excel (${meta.ptoEmi}) no coincide con el codificado en la clave (${claveParts.puntoEmision}).`
          });
        }
        
        // Comparar Secuencial
        const secExcelNorm = parseInt(String(meta.secuencial || '').replace(/\D/g, ''), 10);
        const secClaveNorm = parseInt(claveParts.secuencial, 10);
        if (!isNaN(secExcelNorm) && secExcelNorm !== secClaveNorm) {
          inconsistencias.push({
            tipo: 'ERROR',
            titulo: 'Secuencial',
            mensaje: `El Secuencial en Excel (${meta.secuencial}) no coincide con el codificado en la clave de acceso (${claveParts.secuencial}).`
          });
        }
      }
    } else {
      if (esNegocioPopular) {
        inconsistencias.push({
          tipo: 'ADVERTENCIA',
          titulo: 'Nota Venta Física',
          mensaje: `El contribuyente es RIMPE Negocio Popular y emite comprobante físico. La autorización "${valorAutorizacion}" no contiene 49 dígitos, lo cual es normal para este régimen.`
        });
      } else {
        inconsistencias.push({
          tipo: 'ERROR',
          titulo: 'Formato Incompleto',
          mensaje: `La autorización "${valorAutorizacion}" no contiene 49 dígitos numéricos.`
        });
      }
    }
  }
  
  // 4. Validación de Retención de Renta (AIR)
  const codigoRet = String(meta.codigoRetencion || '').trim();
  const pctAIRStr = String(meta.porcentajeAIR || '').trim();
  
  if (codigoRet !== '') {
    const conceptoOficial = tablaRentaOficial.find(item => item.codigo === codigoRet);
    if (!conceptoOficial) {
      inconsistencias.push({
        tipo: 'ADVERTENCIA',
        titulo: 'AIR No Válido',
        mensaje: `El código de retención "${codigoRet}" no existe en el catálogo oficial de Renta del SRI.`
      });
    } else if (pctAIRStr !== '') {
      const pctAplicado = parseFloat(pctAIRStr.replace('%', '').replace(',', '.'));
      const pctEsperado = conceptoOficial.porcentaje;
      const dif = Math.abs(pctAplicado - pctEsperado);
      if (dif >= 0.01) {
        inconsistencias.push({
          tipo: 'ERROR',
          titulo: 'Tarifa AIR',
          mensaje: `Retención Renta incorrecta para código ${codigoRet}. Aplicado: ${pctAplicado}%, Esperado por catálogo: ${pctEsperado}% (${conceptoOficial.concepto.substring(0, 40)}...)`
        });
      }
    }
  }

  // 5. Validar Documento de Retención (Establecimiento, Punto, Secuencial y Autorización de Retención)
  // Verificar si el emisor es RIMPE Negocio Popular (desde backend esNegocioPopular o desde columna t documento = 'VD')
  if (esNegocioPopular) {
    inconsistencias.push({
      tipo: 'SUCCESS',
      titulo: 'Negocio Popular',
      mensaje: 'El contribuyente pertenece al régimen RIMPE Negocios Populares (exento de retenciones).'
    });
  }

  const estabRetStr = String(meta.estabRet || '').trim();
  const ptoEmiRetStr = String(meta.ptoEmiRet || '').trim();
  const secRetStr = String(meta.secuencialRet || '').trim();
  const autRetStr = String(meta.autRet || '').trim();

  const tieneDatosRetencionEnExcel = !esVacioOPlaceholder(estabRetStr) || 
                                     !esVacioOPlaceholder(ptoEmiRetStr) || 
                                     !esVacioOPlaceholder(secRetStr) || 
                                     !esVacioOPlaceholder(autRetStr);

  // Omitido por requerimiento del usuario: No debe dar error de retención en NC
  /*
  if (esNotaCredito && tieneDatosRetencionEnExcel) {
    inconsistencias.push({
      tipo: 'ERROR',
      titulo: 'Retención en NC',
      mensaje: `El documento SAP corresponde a una Nota de Crédito (empieza con 17), por lo que no debe tener retención asociada.`
    });
  }
  */

  // Si es negocio popular o nota de crédito, no procesamos la retención de manera estándar
  const tieneRetencion = !esNegocioPopular && !esNotaCredito && tieneDatosRetencionEnExcel;

  if (tieneRetencion) {
    let formatoRetCoherente = true;
    if (estabRetStr !== '' && !/^\d{3}$/.test(estabRetStr)) {
      formatoRetCoherente = false;
      inconsistencias.push({
        tipo: 'ADVERTENCIA',
        titulo: 'Formato Estab Ret',
        mensaje: `El Establecimiento de retención en Excel ("${estabRetStr}") no tiene el formato coherente de 3 dígitos (ej: 001).`
      });
    }
    if (ptoEmiRetStr !== '' && !/^\d{3}$/.test(ptoEmiRetStr)) {
      formatoRetCoherente = false;
      inconsistencias.push({
        tipo: 'ADVERTENCIA',
        titulo: 'Formato Punto Ret',
        mensaje: `El Punto de Emisión de retención en Excel ("${ptoEmiRetStr}") no tiene el formato coherente de 3 dígitos (ej: 001).`
      });
    }
    if (secRetStr !== '' && !/^\d{6}$/.test(secRetStr)) {
      formatoRetCoherente = false;
      inconsistencias.push({
        tipo: 'ADVERTENCIA',
        titulo: 'Formato Secuencial Ret',
        mensaje: `El Secuencial de retención en Excel ("${secRetStr}") no tiene el formato coherente de 6 dígitos (ej: 221266).`
      });
    }

    // Verificar si falta o es inválida la autorización de retención
    const autRetUpper = autRetStr.toUpperCase();
    const esAutRetInvalida = autRetStr === '' || 
                             autRetUpper.includes('FACTURA') || 
                             autRetUpper.includes('NOTA') || 
                             autRetUpper.includes('CREDITO') || 
                             autRetUpper.includes('ELECTR') || 
                             autRetUpper.includes('ERROR') || 
                             !/^\d{49}$/.test(autRetStr);

    if (esAutRetInvalida) {
      const tieneCamposNumeracionRet = estabRetStr !== '' && ptoEmiRetStr !== '' && secRetStr !== '';
      const tieneAlertasFormatoRet = inconsistencias.some(inc => inc.titulo.startsWith('Formato Estab Ret') || inc.titulo.startsWith('Formato Punto Ret') || inc.titulo.startsWith('Formato Secuencial Ret'));
      const numeracionRetCoherente = tieneCamposNumeracionRet && !tieneAlertasFormatoRet;

      if (numeracionRetCoherente) {
        inconsistencias.push({
          tipo: 'ERROR',
          titulo: 'Retención Sin Autorización',
          mensaje: `Se emitió la retención ${estabRetStr}-${ptoEmiRetStr}-${secRetStr} pero no se ha recuperado su clave de acceso del SRI. Verifique por qué no se generó o registró la autorización de la retención.`
        });
      } else {
        inconsistencias.push({
          tipo: 'ERROR',
          titulo: 'Retención Sin Aut',
          mensaje: `Se detectaron datos de retención en Excel pero falta o es incorrecto el número de autorización de retención (se leyó "${autRetStr}").`
        });
      }
    } else {
      // Si la clave de acceso de retención tiene 49 dígitos, validar el dígito verificador
      if (!validarDigitoVerificador(autRetStr)) {
        inconsistencias.push({
          tipo: 'ERROR',
          titulo: 'Clave Ret Inválida',
          mensaje: 'El dígito verificador de la clave de acceso de la retención es incorrecto.'
        });
      }
    }
  }
  
  // Regla especial para Notas de Crédito antiguas (Dinners / etc.) mayores a 30 días de antigüedad
  const antDias = obtenerAntiguedadClave(claveLimpia);
  const esNotaCreditoVieja = esNotaCredito && antDias > 30;
  if (esNotaCreditoVieja && (r.estadoFinal === 'NO AUTORIZADO' || r.estadoFinal === 'RECHAZADA')) {
    inconsistencias.push({
      tipo: 'ADVERTENCIA',
      titulo: 'Antigüedad > 30 días',
      mensaje: `La Nota de Crédito tiene ${antDias} días de antigüedad (mes anterior). El SRI reporta estado "${r.estadoFinal}", pero debido a limitaciones de consulta del SRI para documentos anteriores a 30 días, se presume correcta.`
    });
  }

  return inconsistencias;
}

// ─── Tema (Oscuro / Claro) ───────────────────────────────────

function initTheme() {
  const toggleBtn = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const root = document.documentElement;

  const iconMoon = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  const iconSun = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';

  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'light') {
    root.setAttribute('data-theme', 'light');
    if (themeIcon) themeIcon.innerHTML = iconSun;
  } else {
    root.removeAttribute('data-theme');
    if (themeIcon) themeIcon.innerHTML = iconMoon;
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isLight = root.getAttribute('data-theme') === 'light';
      if (isLight) {
        root.removeAttribute('data-theme');
        localStorage.setItem('theme', 'dark');
        themeIcon.innerHTML = iconMoon;
      } else {
        root.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
        themeIcon.innerHTML = iconSun;
      }
    });
  }
}

// ─── Verificación de conexión ────────────────────────────────

async function checkHealth() {
  const badge = document.getElementById('statusBadge');
  const text = document.getElementById('statusText');
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      badge.className = 'status-badge online';
      text.textContent = 'Conectado';
    } else {
      badge.className = 'status-badge offline';
      text.textContent = 'Error';
    }
  } catch {
    badge.className = 'status-badge offline';
    text.textContent = 'Desconectado';
  }
}

// ─── Pestañas ────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('panelIndividual').style.display = target === 'individual' ? 'block' : 'none';
      document.getElementById('panelMasiva').style.display = target === 'masiva' ? 'block' : 'none';
    });
  });
}

// ─── Selector de ambiente ────────────────────────────────────

function initAmbienteSelector() {
  document.querySelectorAll('.ambiente-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ambiente-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ambienteActual = btn.dataset.ambiente;
      mostrarNotificacion(`Ambiente: ${ambienteActual === 'pruebas' ? 'Pruebas (CELCER)' : 'Producción (CEL)'}`, 'info');
    });
  });
}

// ─── Grupos de radio ─────────────────────────────────────────

function initRadioGroups() {
  document.querySelectorAll('.radio-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const grupo = opt.closest('.radio-group');
      grupo.querySelectorAll('.radio-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      opt.querySelector('input[type="radio"]').checked = true;
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// CONSULTA INDIVIDUAL
// ═══════════════════════════════════════════════════════════════

function initConsultaIndividual() {
  const input = document.getElementById('claveAccesoInput');
  const contador = document.getElementById('inputCounter');
  const btn = document.getElementById('btnConsultar');

  input.addEventListener('input', () => {
    const val = input.value.replace(/\D/g, '');
    input.value = val;
    contador.textContent = `${val.length}/49`;
    contador.className = val.length === 49 ? 'input-counter valid' : 'input-counter';
    btn.disabled = val.length !== 49;
  });

  btn.addEventListener('click', realizarConsultaIndividual);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !btn.disabled) realizarConsultaIndividual();
  });
}

async function realizarConsultaIndividual() {
  const clave = document.getElementById('claveAccesoInput').value.trim();
  const tarjetaResultado = document.getElementById('resultadoIndividual');
  const cuerpoResultado = document.getElementById('resultadoIndividualBody');

  mostrarCargando(true);
  try {
    const res = await fetch(`${API_BASE}/consulta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claveAcceso: clave, ambiente: ambienteActual }),
    });
    const datos = await res.json();

    tarjetaResultado.style.display = 'block';
    cuerpoResultado.innerHTML = renderResultadoIndividual(datos, 'comprobante');
    tarjetaResultado.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (datos.exito) {
      mostrarNotificacion(`Estado: ${datos.estadoFinal}`, datos.error ? 'error' : 'success');
    } else {
      mostrarNotificacion(datos.error || 'Error en la consulta', 'error');
    }
  } catch (err) {
    mostrarNotificacion('Error de conexión con el servidor', 'error');
  } finally {
    mostrarCargando(false);
  }
}

function renderResultadoIndividual(datos, tipo) {
  const claseEstado = obtenerClaseEstado(datos.estadoFinal);
  let html = '<div class="resultado-detalle">';
  html += `<div class="resultado-campo estado-field ${claseEstado}">
    <div class="campo-label">Estado</div>
    <div class="campo-valor">${datos.estadoFinal || datos.estadoAutorizacion || datos.estadoConfirmacion || 'N/A'}</div>
  </div>`;
  html += `<div class="resultado-campo">
    <div class="campo-label">Clave de Acceso</div>
    <div class="campo-valor" style="font-family:Consolas,monospace;font-size:0.82rem">${datos.claveAcceso || 'N/A'}</div>
  </div>`;
  if (tipo === 'comprobante') {
    if (datos.tipoComprobante) html += `<div class="resultado-campo"><div class="campo-label">Tipo Comprobante</div><div class="campo-valor">${datos.tipoComprobante}</div></div>`;
    if (datos.rucEmisor) html += `<div class="resultado-campo"><div class="campo-label">RUC Emisor</div><div class="campo-valor">${datos.rucEmisor}</div></div>`;
    if (datos.fechaAutorizacion) html += `<div class="resultado-campo"><div class="campo-label">Fecha Autorización</div><div class="campo-valor">${formatearFecha(datos.fechaAutorizacion)}</div></div>`;
  }
  html += '</div>';
  if (datos.mensajes && datos.mensajes.length > 0) {
    html += '<div class="resultado-mensajes"><h3>Mensajes del SRI</h3>';
    datos.mensajes.forEach(m => {
      html += `<div class="mensaje-item"><strong>[${m.identificador}] ${m.mensaje}</strong>`;
      if (m.informacionAdicional) html += `<br>${m.informacionAdicional}`;
      html += '</div>';
    });
    html += '</div>';
  }
  return html;
}

// ═══════════════════════════════════════════════════════════════
// CARGA DE EXCEL
// Busca la columna "autorizacion" entre las filas 1 a 6
// ═══════════════════════════════════════════════════════════════

function initExcelUpload() {
  const zonaArrastre = document.getElementById('excelDropzone');
  const inputArchivo = document.getElementById('excelUpload');
  const infoBox = document.getElementById('excelInfo');
  const btnQuitar = document.getElementById('btnQuitarExcel');

  // Clic para abrir selector de archivo
  zonaArrastre.addEventListener('click', () => inputArchivo.click());

  // Arrastrar y soltar
  zonaArrastre.addEventListener('dragover', e => {
    e.preventDefault();
    zonaArrastre.classList.add('dragover');
  });
  zonaArrastre.addEventListener('dragleave', () => {
    zonaArrastre.classList.remove('dragover');
  });
  zonaArrastre.addEventListener('drop', e => {
    e.preventDefault();
    zonaArrastre.classList.remove('dragover');
    const archivo = e.dataTransfer.files[0];
    if (archivo) procesarArchivoExcel(archivo);
  });

  // Selección de archivo
  inputArchivo.addEventListener('change', e => {
    const archivo = e.target.files[0];
    if (archivo) procesarArchivoExcel(archivo);
    e.target.value = '';
  });

  // Quitar archivo
  btnQuitar.addEventListener('click', () => {
    clavesDesdeExcel = [];
    metadatosExcel = {};
    filasOmitidas = 0;
    nombreArchivoExcel = '';
    infoBox.style.display = 'none';
    zonaArrastre.style.display = 'block';
    actualizarContadorTotal();
  });
}

/**
 * Verifica si una columna contiene números (secuenciales) en las primeras filas de datos.
 * Excluye explícitamente palabras típicas de nombres/tipos de documentos.
 */
function verificarColumnaTieneNumeros(filas, c, f) {
  let conteoValidos = 0;
  const limiteInspeccion = Math.min(filas.length, f + 20); // Revisar hasta 20 filas siguientes
  for (let inspectR = f + 1; inspectR < limiteInspeccion; inspectR++) {
    const val = filas[inspectR][c];
    if (val !== undefined && val !== null) {
      const valStr = String(val).trim();
      if (valStr !== '') {
        // Si contiene dígitos y no es una palabra descriptiva de tipo de comprobante
        if (/\d+/.test(valStr) && !/factura|retencion|nota|credito|debito/i.test(valStr)) {
          conteoValidos++;
        }
      }
    }
  }
  return conteoValidos > 0;
}

/**
 * Verifica si los valores de una columna se comportan como el secuencial de factura (9 dígitos mayormente).
 */
function verificarColumnaEsSecuencialFactura(filas, c, f) {
  let conteo9Digitos = 0;
  let conteoTotal = 0;
  const limiteInspeccion = Math.min(filas.length, f + 20);
  for (let inspectR = f + 1; inspectR < limiteInspeccion; inspectR++) {
    const val = filas[inspectR][c];
    if (val !== undefined && val !== null) {
      const valStr = String(val).trim().replace(/\D/g, ''); // Solo dígitos
      if (valStr !== '') {
        conteoTotal++;
        if (valStr.length === 9) {
          conteo9Digitos++;
        }
      }
    }
  }
  return conteoTotal > 0 && (conteo9Digitos / conteoTotal) >= 0.5;
}

/**
 * Procesa un archivo Excel (.xlsx/.xls):
 * 1. Lee todas las hojas del libro
 * 2. Busca la columna "autorizacion" en las PRIMERAS 6 FILAS de cada hoja
 * 3. Extrae las claves de 49 dígitos de esa columna (debajo del encabezado)
 * 4. Ignora filas vacías o con valores que no tienen 49 dígitos
 */
function procesarArchivoExcel(archivo) {
  const lector = new FileReader();
  lector.onload = function (e) {
    try {
      const datos = new Uint8Array(e.target.result);
      const libro = XLSX.read(datos, { type: 'array' });

      let clavesEncontradas = [];
      let totalFilasDatos = 0;
      let nombreColumna = null;
      let hojaUsada = null;
      let filaEncabezado = -1;

      // Recorrer cada hoja del libro
      for (const nombreHoja of libro.SheetNames) {
        const hoja = libro.Sheets[nombreHoja];
        const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: false });

        if (filas.length === 0) continue;

        let indiceColumna = -1;
        let pId = -1, pNom = -1, pEst = -1, pPunto = -1, pSec = -1;
        let pCodRet = -1, pPctAIR = -1, pBaseImp = -1;
        let pEstRet = -1, pPuntoRet = -1, pSecRet = -1, pAutRet = -1;
        let pTipoDoc = -1;
        let pDocSap = -1; // Columna de número de transacción/documento SAP
        const maxFilaBusqueda = Math.min(6, filas.length);

        for (let f = 0; f < maxFilaBusqueda; f++) {
          const fila = filas[f];
          if (!fila) continue;

          for (let c = 0; c < fila.length; c++) {
            const encabezado = normalizar(String(fila[c]));

            // Si ya lo encontramos en esta fila, no lo sobreescribimos con otras columnas
            if (indiceColumna === -1 && !encabezado.includes('retencion') && !encabezado.includes('ret') && (encabezado.includes('autorizacion') || encabezado.includes('clavedeacceso') || encabezado.includes('clave_acceso') || encabezado === 'clave')) {
              indiceColumna = c; nombreColumna = String(fila[c]); hojaUsada = nombreHoja; filaEncabezado = f;
            }
            else if (pId === -1 && (encabezado.includes('idproveedor') || encabezado.includes('identificacion') || encabezado === 'ruc' || encabezado === 'cedula')) { pId = c; }
            else if (pNom === -1 && (encabezado.includes('nombreproveedor') || encabezado.includes('razonsocial') || (encabezado.includes('proveedor') && !encabezado.includes('id') && !encabezado.includes('tipo')))) { pNom = c; }
            else if (pEst === -1 && !encabezado.includes('retencion') && !encabezado.includes('ret') && (encabezado === 'establecimiento' || encabezado === 'estab')) { pEst = c; }
            else if (pPunto === -1 && !encabezado.includes('retencion') && !encabezado.includes('ret') && (encabezado.includes('puntodeemision') || encabezado === 'puntoemision' || encabezado === 'ptoemi')) { pPunto = c; }
            else if (pSec === -1 && !encabezado.includes('retencion') && !encabezado.includes('ret') && (
              encabezado === 'secuencial' || 
              encabezado.includes('numdoc') || 
              encabezado === 'sec' || 
              encabezado.includes('numdocumento') || 
              encabezado.includes('nrodocumento') || 
              encabezado.includes('numerodocumento') || 
              encabezado.includes('nrocomprobante') || 
              encabezado.includes('numerocomprobante')
            )) { pSec = c; }
            else if (pDocSap === -1 && encabezado === 'documento' && verificarColumnaTieneNumeros(filas, c, f)) {
              pDocSap = c;
            }
            else if (pTipoDoc === -1 && (
              encabezado === 'tdocumento' || 
              encabezado === 'tipodocumento' || 
              encabezado === 'tipodoc' || 
              encabezado === 'tdoc' || 
              encabezado === 'tipodedocumento' || 
              (encabezado === 'documento' && !verificarColumnaTieneNumeros(filas, c, f)) || 
              encabezado === 'tipocomprobante'
            )) { pTipoDoc = c; }
            
            // Campos de retenciones (tarifas)
            else if (pCodRet === -1 && (encabezado.includes('codigoretencion') || encabezado.includes('codret') || encabezado.includes('codigoderetencion') || encabezado === 'retencion_codigo')) { pCodRet = c; }
            else if (pPctAIR === -1 && (encabezado.includes('porcentajederetencionair') || encabezado.includes('porcentajeair') || encabezado.includes('porcentajeretencionair') || encabezado.includes('porcentajeair') || encabezado.includes('porcentajeir') || encabezado.includes('pctair') || encabezado === 'porcentajea_ir' || encabezado === 'porcentajeretencionir')) { pPctAIR = c; }
            else if (pBaseImp === -1 && (encabezado.includes('baseimponible') || encabezado.includes('baseimp') || encabezado === 'base')) { pBaseImp = c; }
            
            // Campos del documento de retención (número y clave)
            else if (pEstRet === -1 && (encabezado.includes('establecimientoderetencion') || encabezado === 'estabret' || encabezado === 'establecimientoretencion' || encabezado === 'estabretencion' || encabezado === 'retencionestablecimiento')) { pEstRet = c; }
            else if (pPuntoRet === -1 && (encabezado.includes('puntodeemisionderetencion') || encabezado === 'puntoretencion' || encabezado === 'puntoemisionretencion' || encabezado === 'ptoemiret' || encabezado === 'ptoretencion' || encabezado === 'retencionpuntoemision')) { pPuntoRet = c; }
            else if (pSecRet === -1 && (encabezado.includes('secuencialderetencion') || encabezado === 'secuencialretencion' || encabezado === 'secret' || encabezado === 'secretencion' || encabezado === 'retencionsecuencial')) { pSecRet = c; }
            else if (pAutRet === -1 && (
              encabezado.includes('autorizacionderetencion') || 
              encabezado.includes('autorizacionretencion') || 
              encabezado.includes('autret') || 
              encabezado.includes('autretencion') || 
              encabezado.includes('numerodeautorizaciondelaretencion') || 
              encabezado.includes('numautret') ||
              // Caso especial: si ya encontramos la clave de la factura y esta columna está a la derecha de algún campo de numeración de retención
              (indiceColumna !== -1 && (pSecRet !== -1 || pEstRet !== -1 || pPuntoRet !== -1) && c > Math.max(pSecRet, pEstRet, pPuntoRet) && (encabezado === 'numeroautorizacion' || encabezado === 'autorizacion' || encabezado === 'clave' || encabezado === 'claveacceso' || encabezado === 'clavedeacceso'))
            )) { 
              pAutRet = c; 
            }
          }
          if (indiceColumna !== -1) break;
        }

        if (indiceColumna === -1) continue;

        // Si no encontramos pSec pero sí pDocSap, y pDocSap parece secuencial de factura (tiene 9 dígitos), reasignarlo
        if (pSec === -1 && pDocSap !== -1) {
          if (verificarColumnaEsSecuencialFactura(filas, pDocSap, filaEncabezado !== -1 ? filaEncabezado : 0)) {
            pSec = pDocSap;
            pDocSap = -1;
          }
        }

        metadatosExcel = {}; // Limpiar estado anterior
        for (let r = filaEncabezado + 1; r < filas.length; r++) {
          const fila = filas[r];
          if (!fila) continue;

          // Verificar si la fila tiene algún valor real en alguna celda para evitar procesar filas vacías de Excel
          const tieneAlgunaCeldaConValor = fila.some(val => val !== undefined && val !== null && String(val).trim() !== '');
          if (!tieneAlgunaCeldaConValor) continue;

          // Obtener el número de documento SAP si existe la columna
          const docSapVal = pDocSap !== -1 && fila[pDocSap] !== undefined ? String(fila[pDocSap]).trim() : '';

          // Obtener el número de documento/secuencial si existe la columna
          const secVal = pSec !== -1 && fila[pSec] !== undefined ? String(fila[pSec]).trim() : '';

          // Si hay columna de Documento de SAP, validamos que tenga números (es una transacción SAP válida)
          if (pDocSap !== -1) {
            if (!/\d+/.test(docSapVal)) {
              continue;
            }
          } else if (pSec !== -1) {
            // Si no hay columna de Documento SAP pero sí Secuencial, validamos que el secuencial tenga números
            if (!/\d+/.test(secVal)) {
              continue;
            }
          } else {
            // Si no hay ninguna de las dos, exigimos al menos que la columna de autorización no esté vacía
            const valorAut = (fila[indiceColumna] !== undefined && fila[indiceColumna] !== null) ? String(fila[indiceColumna]).trim() : '';
            if (valorAut === '') {
              continue;
            }
          }

          totalFilasDatos++;
          const valor = (fila[indiceColumna] !== undefined && fila[indiceColumna] !== null) ? String(fila[indiceColumna]).trim() : '';

          let claveIdentificador = valor;
          if (valor === '') {
            claveIdentificador = `SIN_CLAVE_FILA_${r}`;
          } else if (metadatosExcel[claveIdentificador]) {
            claveIdentificador = `${valor}_dup_${r}`;
          }

          clavesEncontradas.push(claveIdentificador);
          metadatosExcel[claveIdentificador] = {
            filaOriginal: r + 1,
            originalValorAutorizacion: valor,
            idProv: pId !== -1 && fila[pId] !== undefined ? String(fila[pId]).trim() : '',
            nomProv: pNom !== -1 && fila[pNom] !== undefined ? String(fila[pNom]).trim() : '',
            estab: pEst !== -1 && fila[pEst] !== undefined ? String(fila[pEst]).trim() : '',
            ptoEmi: pPunto !== -1 && fila[pPunto] !== undefined ? String(fila[pPunto]).trim() : '',
            secuencial: secVal,
            documentoSap: docSapVal,
            tipoDoc: pTipoDoc !== -1 && fila[pTipoDoc] !== undefined ? String(fila[pTipoDoc]).trim() : '',
            
            // Campos de retenciones
            codigoRetencion: pCodRet !== -1 && fila[pCodRet] !== undefined ? String(fila[pCodRet]).trim() : '',
            porcentajeAIR: pPctAIR !== -1 && fila[pPctAIR] !== undefined ? String(fila[pPctAIR]).trim() : '',
            baseImponible: pBaseImp !== -1 && fila[pBaseImp] !== undefined ? String(fila[pBaseImp]).trim() : '',

            // Campos del documento de retención
            estabRet: pEstRet !== -1 && fila[pEstRet] !== undefined ? String(fila[pEstRet]).trim() : '',
            ptoEmiRet: pPuntoRet !== -1 && fila[pPuntoRet] !== undefined ? String(fila[pPuntoRet]).trim() : '',
            secuencialRet: pSecRet !== -1 && fila[pSecRet] !== undefined ? String(fila[pSecRet]).trim() : '',
            autRet: pAutRet !== -1 && fila[pAutRet] !== undefined ? String(fila[pAutRet]).trim() : ''
          };
        }
        break; // Usar solo la primera hoja que sirva
      }

      if (nombreColumna === null) {
        mostrarNotificacion(
          'No se encontró la columna "autorizacion" en las primeras 6 filas del archivo. Verifica que el encabezado contenga la palabra "autorizacion".',
          'error'
        );
        return;
      }

      clavesDesdeExcel = clavesEncontradas;
      filasOmitidas = totalFilasDatos - clavesEncontradas.length;
      nombreArchivoExcel = archivo.name;

      // Mostrar información del archivo cargado
      const zonaArrastre = document.getElementById('excelDropzone');
      const infoBox = document.getElementById('excelInfo');
      zonaArrastre.style.display = 'none';
      infoBox.style.display = 'flex';

      document.getElementById('excelFilename').textContent = archivo.name;
      let textoDetalle = `${clavesEncontradas.length} claves válidas · Columna "${nombreColumna}" · Hoja: ${hojaUsada} (encabezado en fila ${filaEncabezado + 1})`;
      if (filasOmitidas > 0) {
        textoDetalle += ` · ${filasOmitidas} filas omitidas (vacías o sin 49 dígitos)`;
      }
      document.getElementById('excelDetails').textContent = textoDetalle;

      actualizarContadorTotal();

      if (clavesEncontradas.length > 0) {
        mostrarNotificacion(
          `Excel cargado: ${clavesEncontradas.length} comprobantes detectados.`,
          'success'
        );

        // Iniciar consulta automáticamente
        setTimeout(() => {
          realizarConsultaMasiva();
        }, 300);
      } else {
        mostrarNotificacion(
          `Se encontró la columna "${nombreColumna}" pero está vacía.`,
          'error'
        );
      }

    } catch (err) {
      console.error('Error al leer el archivo Excel:', err);
      mostrarNotificacion('Error al leer el archivo Excel: ' + err.message, 'error');
    }
  };
  lector.readAsArrayBuffer(archivo);
}

/** Normaliza texto: quita tildes, espacios y convierte a minúsculas */
function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // quitar tildes
    .replace(/\s+/g, '')              // quitar espacios
    .replace(/[^a-z0-9_]/g, '');      // solo letras, números y guion bajo
}

// ═══════════════════════════════════════════════════════════════
// CONSULTA MASIVA CON PROCESAMIENTO POR LOTES PROGRESIVO
// Envía las claves en grupos de 50, actualizando el progreso
// en tiempo real para manejar archivos de 1600+ claves
// ═══════════════════════════════════════════════════════════════

function initConsultaMasiva() {
  const textarea = document.getElementById('clavesTextarea');
  const btnConsultar = document.getElementById('btnConsultarMasivo');
  const btnCancelar = document.getElementById('btnCancelarMasivo');
  const btnLimpiar = document.getElementById('btnLimpiar');
  const btnExportarExcel = document.getElementById('btnExportarExcel');

  textarea.addEventListener('input', () => actualizarContadorTotal());

  btnConsultar.addEventListener('click', realizarConsultaMasiva);

  btnCancelar.addEventListener('click', () => {
    consultaCancelada = true;
    btnCancelar.disabled = true;
    document.getElementById('progresoTexto').textContent = 'Cancelando lotes, por favor espera...';
  });

  btnLimpiar.addEventListener('click', () => {
    textarea.value = '';
    actualizarContadorTotal();
  });

  btnExportarExcel.addEventListener('click', exportarExcel);
}

/** Obtener claves del textarea */
function obtenerClavesTexto() {
  const textarea = document.getElementById('clavesTextarea');
  return textarea.value.split(/[\n,;]+/).map(l => l.trim()).filter(l => l.length > 0);
}

/** Obtener TODAS las claves (Excel + textarea) */
function obtenerTodasLasClaves() {
  const delTexto = obtenerClavesTexto();
  // Eliminar duplicados
  const unicas = [...new Set([...clavesDesdeExcel, ...delTexto])];
  return unicas;
}

/** Actualizar el contador y estado del botón */
function actualizarContadorTotal() {
  const todas = obtenerTodasLasClaves();
  const contador = document.getElementById('contadorClaves');
  const btn = document.getElementById('btnConsultarMasivo');

  let texto = `${todas.length} clave${todas.length !== 1 ? 's' : ''} detectada${todas.length !== 1 ? 's' : ''}`;
  if (clavesDesdeExcel.length > 0 && obtenerClavesTexto().length > 0) {
    texto += ` (${clavesDesdeExcel.length} del Excel + ${obtenerClavesTexto().length} manuales)`;
  } else if (clavesDesdeExcel.length > 0) {
    texto += ` (del archivo Excel)`;
  }
  if (filasOmitidas > 0) {
    texto += ` · ${filasOmitidas} filas omitidas`;
  }

  contador.textContent = texto;
  btn.disabled = todas.length === 0;
}

/**
 * CONSULTA MASIVA POR LOTES
 * Divide las claves en lotes de TAMANO_LOTE y envía cada lote
 * al servidor, actualizando el progreso en tiempo real.
 * Esto permite procesar 1600+ claves sin timeout.
 */
async function realizarConsultaMasiva() {
  const claves = obtenerTodasLasClaves();
  const tipo = 'comprobante';
  consultaCancelada = false;

  if (claves.length === 0) return;

  // Referencias a elementos del DOM
  const progresoCard = document.getElementById('progresoCard');
  const progresoFill = document.getElementById('progresoFill');
  const progresoTexto = document.getElementById('progresoTexto');
  const progresoContador = document.getElementById('progresoContador');
  const progresoStats = document.getElementById('progresoStats');
  const statsGrid = document.getElementById('statsGrid');
  const resultadosCard = document.getElementById('resultadosMasivosCard');
  const btnConsultar = document.getElementById('btnConsultarMasivo');
  const btnCancelar = document.getElementById('btnCancelarMasivo');

  // Inicializar UI de progreso
  progresoCard.style.display = 'block';
  progresoFill.style.width = '0%';
  progresoTexto.textContent = 'Preparando lotes...';
  progresoContador.textContent = `0 / ${claves.length}`;
  progresoStats.textContent = '';
  statsGrid.style.display = 'none';
  resultadosCard.style.display = 'none';
  btnConsultar.style.display = 'none';

  btnCancelar.style.display = 'flex';
  btnCancelar.disabled = false;

  const totalOriginal = claves.length;
  
  // Separar claves normales (49 dígitos y no provisionales) y especiales (no 49 dígitos, provisionales con 9s, etc.)
  const clavesNormales = [];
  const clavesEspeciales = [];
  
  claves.forEach(c => {
    const claveLimpia = c.split('_dup_')[0];
    const meta = metadatosExcel[c] || {};
    const esProvisional = /^9{10,}$/.test(claveLimpia) || claveLimpia.startsWith('9999');
    
    // Identificar si es Liquidación de Compra
    const tipoDocUpper = String(meta.tipoDoc || '').trim().toUpperCase();
    const esLiquidacionCompra = (claveLimpia.length === 49 && claveLimpia.substring(8, 10) === '03') || 
                                tipoDocUpper === 'LC' || 
                                tipoDocUpper.includes('LIQ') || 
                                tipoDocUpper.includes('LIQUIDACION');
    
    if (/^\d{49}$/.test(claveLimpia) && !esProvisional && !esLiquidacionCompra) {
      clavesNormales.push(c);
    } else {
      // Caso especial: Factura sin número de documento/secuencial AND con retención autorizada con clave de 49 dígitos
      const autRetLimpia = String(meta.autRet || '').trim().split('_dup_')[0];
      const tieneRetencionValida = /^\d{49}$/.test(autRetLimpia) && !/^9{10,}$/.test(autRetLimpia);
      const facturaSinNumero = esVacioOPlaceholder(meta.secuencial);
      
      if (tieneRetencionValida && facturaSinNumero) {
        // En lugar de procesar offline, mandamos a consultar online la retención.
        // Construimos una clave de consulta única que asocie esta fila/clave a la retención consultada
        const queryKey = `${autRetLimpia}_dup_ret_${c}`;
        clavesNormales.push(queryKey);
      } else {
        clavesEspeciales.push(c);
      }
    }
  });

  const MAX_REINTENTOS = 3;
  resultadosMasivos = [];
  let procesados = 0;
  let lotesProcesados = 0;
  let erroresConexion = 0;
  const inicioTiempo = Date.now();

  const stats = {
    autorizados: 0, noAutorizados: 0, pendientes: 0,
    anulados: 0, rechazados: 0, errores: 0,
    inconsistencias: 0, exterior: 0
  };

  try {
    function guardarResultadoFinal(resItem) {
      // Realizar validación inteligente de inconsistencias antes de contar
      const meta = encontrarMetadatos(resItem.claveAcceso);
      const inconsistencias = analizarInconsistencias(resItem, meta);
      resItem.inconsistencias = inconsistencias; // Guardar en el objeto
      
      if (inconsistencias.some(inc => inc.tipo === 'ERROR' || inc.tipo === 'ADVERTENCIA')) {
        stats.inconsistencias++;
      }
      
      if (resItem.estadoFinal === 'SIN_AUTORIZACION_EXTERIOR') {
        stats.exterior++;
      }
      
      resultadosMasivos.push(resItem);
      procesados++;
      const esRetencionQuery = resItem.claveAcceso && resItem.claveAcceso.includes('_dup_ret_');
      switch (resItem.estadoFinal) {
        case 'AUTORIZADO': case 'SI': 
          if (!esRetencionQuery) stats.autorizados++; 
          break;
        case 'NO AUTORIZADO': 
          if (!esRetencionQuery) stats.noAutorizados++; 
          break;
        case 'PENDIENTE DE ANULAR': 
          if (!esRetencionQuery) stats.pendientes++; 
          break;
        case 'ANULADO': 
          if (!esRetencionQuery) stats.anulados++; 
          break;
        case 'RECHAZADA': 
          if (!esRetencionQuery) stats.rechazados++; 
          break;
        case 'SIN_AUTORIZACION_EXTERIOR':
          // Contabilizado en exterior, no cuenta como estado normal SRI
          break;
        case 'ERROR_INGRESO':
        case 'INGRESO ANULADO':
        case 'FISICO_NP':
          // Contabilizado en inconsistencias, no es error de red
          break;
        case 'ERROR_CONEXION': case 'FORMATO_INVALIDO':
          stats.errores++;
          if (resItem.estadoFinal === 'ERROR_CONEXION') erroresConexion++;
          break;
        default: 
          if (!esRetencionQuery) stats.pendientes++; 
          break;
      }
      actualizarProgresoUI();
    }

    function actualizarProgresoUI() {
      const porcentaje = Math.round((procesados / totalOriginal) * 100) || 0;
      progresoFill.style.width = `${porcentaje > 100 ? 100 : porcentaje}%`;
      progresoContador.textContent = `${procesados} / ${totalOriginal}`;

      progresoStats.innerHTML = `
        <span style="color:var(--accent-green)">✓ ${stats.autorizados} autorizados</span> · 
        <span style="color:var(--accent-orange)">⚠ ${stats.inconsistencias} errores ingreso</span> · 
        <span style="color:var(--accent-blue)">🌐 ${stats.exterior} exterior</span> · 
        <span style="color:var(--accent-red)">⚠ ${stats.errores} errores red</span> · 
        Tiempo: ${((Date.now() - inicioTiempo) / 1000).toFixed(0)}s
      `;
    }

    // 1. Extraer los RUCs de las claves especiales para ver cuáles son RIMPE Negocios Populares
    const rucsEspeciales = [...new Set(clavesEspeciales.map(c => {
      const meta = metadatosExcel[c] || {};
      return meta.idProv;
    }).filter(Boolean))];

    const mapaRucNP = {};
    if (rucsEspeciales.length > 0) {
      progresoTexto.textContent = 'Verificando regímenes de catastros físicos...';
      await Promise.all(rucsEspeciales.map(async ruc => {
        try {
          const res = await fetch(`${API_BASE}/catastros/buscar/${ruc}`);
          if (res.ok) {
            const data = await res.json();
            if (data.busqueda?.rimpe_negocios_populares?.encontrado) {
              mapaRucNP[ruc] = true;
            }
          }
        } catch (err) {
          console.error('Error buscando RUC en catastros:', err);
        }
      }));
    }

    // Procesar especiales localmente e instantáneamente
    clavesEspeciales.forEach(c => {
      const meta = metadatosExcel[c] || {};
      const valorOrig = meta.originalValorAutorizacion !== undefined ? meta.originalValorAutorizacion : c;
      const ruc = meta.idProv;
      
      const tipoDocUpper = String(meta.tipoDoc || '').trim().toUpperCase();
      const esNotaVenta = tipoDocUpper === 'VD' || 
                          tipoDocUpper.includes('NOTA DE VENTA') || 
                          tipoDocUpper.includes('NOTA_VENTA') || 
                          tipoDocUpper.includes('NOTAS DE VENTA') || 
                          tipoDocUpper === 'NV';
      const esNP = mapaRucNP[ruc] || esNotaVenta;

      let estadoFinalLocal = 'ERROR_INGRESO';
      let mensajesLocal = [];

      // Chequear si es un ingreso anulado (comienza con 52 y campos vacíos)
      const docSap = String(meta.documentoSap || '').trim();
      const secFactura = String(meta.secuencial || '').trim();
      const autFactura = valorOrig.startsWith('SIN_CLAVE_FILA') ? '' : valorOrig.trim();
      const autRetencion = String(meta.autRet || '').trim();

      const esIngresoAnulado52 = docSap.startsWith('52') && 
                                  esVacioOPlaceholder(secFactura) && 
                                  esVacioOPlaceholder(autFactura) && 
                                  esVacioOPlaceholder(autRetencion);
      
      if (esIngresoAnulado52) {
        estadoFinalLocal = 'INGRESO ANULADO';
        mensajesLocal = [{
          identificador: 'VAL',
          mensaje: 'Ingreso Anulado',
          informacionAdicional: `Transacción SAP que comienza con 52 sin factura, sin autorización de factura ni de retención. Se trata como ingreso anulado (advertencia leve).`,
          tipo: 'ADVERTENCIA'
        }];
      } else if (detectarFacturaExterior(meta, valorOrig)) {
        estadoFinalLocal = 'SIN_AUTORIZACION_EXTERIOR';
      } else if (esNP) {
        estadoFinalLocal = 'FISICO_NP';
        mensajesLocal = [{
          identificador: 'VAL',
          mensaje: 'Comprobante Físico RIMPE NP',
          informacionAdicional: `El contribuyente es RIMPE Negocio Popular y emite comprobante físico. La autorización "${valorOrig}" no contiene 49 dígitos, lo cual es normal para este régimen.`,
          tipo: 'ADVERTENCIA'
        }];
      } else if (/^9{10,}$/.test(valorOrig) || valorOrig.startsWith('9999')) {
        estadoFinalLocal = 'NO AUTORIZADO';
        mensajesLocal = [{
          identificador: 'VAL',
          mensaje: 'Autorización provisional (nueves)',
          informacionAdicional: `Se ingresaron nueves ("${valorOrig}") en la columna de autorización. Esto representa un comprobante físico o pendiente de autorización.`,
          tipo: 'ADVERTENCIA'
        }];
      } else {
        const estabStr = String(meta.estab || '').trim();
        const ptoStr = String(meta.ptoEmi || '').trim();
        const secStr = String(meta.secuencial || '').trim();
        
        const tieneCamposNumeracion = estabStr !== '' && ptoStr !== '' && secStr !== '';
        const tieneAlertasFormato = 
          (estabStr !== '' && !/^\d{3}$/.test(estabStr)) || 
          (ptoStr !== '' && !/^\d{3}$/.test(ptoStr)) || 
          (secStr !== '' && !/^\d{9}$/.test(secStr));
        const formatoCoherente = tieneCamposNumeracion && !tieneAlertasFormato;

        if (formatoCoherente) {
          mensajesLocal = [{
            identificador: 'VAL',
            mensaje: 'Comprobante sin autorización',
            informacionAdicional: valorOrig === ''
              ? `La factura tiene formato de numeración correcto (${estabStr}-${ptoStr}-${secStr}) pero la celda de autorización en el Excel está vacía. Verifique por qué no se generó la autorización.`
              : `La factura tiene formato de numeración correcto (${estabStr}-${ptoStr}-${secStr}) pero no se ha recuperado su clave de acceso del SRI. Verifique por qué no se generó la autorización.`,
            tipo: 'ERROR'
          }];
        } else {
          mensajesLocal = [{
            identificador: 'VAL',
            mensaje: valorOrig === '' ? 'Celda de autorización vacía' : 'Clave de acceso incorrecta o incompleta',
            informacionAdicional: valorOrig === ''
              ? 'La celda de autorización de la factura en el Excel está vacía.'
              : `Se leyó "${valorOrig}" (no es una clave válida de 49 dígitos). Típicamente indica un secuencial incorrecto en el ERP.`,
            tipo: 'ERROR'
          }];
        }
      }
      
      const resLocal = {
        claveAcceso: c,
        estadoFinal: estadoFinalLocal,
        error: estadoFinalLocal === 'ERROR_INGRESO',
        mensajes: mensajesLocal,
        tipoComprobante: meta.originalValorAutorizacion !== undefined ? 'N/A' : null,
        rucEmisor: null,
        fechaAutorizacion: null,
        esLocalSpecial: true
      };
      
      guardarResultadoFinal(resLocal);
    });

    let clavesEnCola = clavesNormales.map(c => ({ clave: c, intentos: 0 }));

    const ejecutarTrabajador = async (workerId) => {
      while (clavesEnCola.length > 0 && !consultaCancelada) {
        // Tomar lote de forma segura
        const loteActualObj = clavesEnCola.splice(0, TAMANO_LOTE);
        if (loteActualObj.length === 0) break;

        const loteClavesStr = loteActualObj.map(obj => obj.clave);
        lotesProcesados++;

        const numReintento = loteActualObj[0].intentos;
        const msjReintento = numReintento > 0 ? ` (Reintento ${numReintento})` : '';
        const msjWorker = CONEXIONES_SIMULTANEAS > 1 ? `[W${workerId}] ` : '';

        progresoTexto.textContent = `${msjWorker}Procesando ${loteClavesStr.length} claves${msjReintento}... ${clavesEnCola.length} en cola.`;

        actualizarProgresoUI();

        try {
          const res = await fetch(`${API_BASE}/consulta/masiva`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clavesAcceso: loteClavesStr,
              tipo,
              ambiente: ambienteActual
            }),
          });

          const datos = await res.json();

          if (datos.exito && datos.resultados) {
            datos.resultados.forEach(resItem => {
              const indexOrig = loteActualObj.findIndex(item => item.clave === resItem.claveAcceso);
              const objOrig = indexOrig !== -1 ? loteActualObj[indexOrig] : { clave: resItem.claveAcceso, intentos: 0 };

              if (resItem.estadoFinal === 'ERROR_CONEXION' && objOrig.intentos < MAX_REINTENTOS) {
                clavesEnCola.push({ clave: objOrig.clave, intentos: objOrig.intentos + 1 });
              } else {
                guardarResultadoFinal(resItem);
              }
            });
          } else {
            manejarFalloLote(loteActualObj, datos.error || 'Error del servidor');
          }
        } catch (err) {
          manejarFalloLote(loteActualObj, err.message);
        }

        if (clavesEnCola.length > 0 && !consultaCancelada) {
          const tieneReintentos = clavesEnCola.some(c => c.intentos > 0);
          const pausaMs = tieneReintentos ? 500 + (clavesEnCola[0]?.intentos || 0) * 800 : 50;
          await new Promise(r => setTimeout(r, pausaMs));
        }
      }
    };

    function manejarFalloLote(lote, msjError) {
      lote.forEach(obj => {
        if (obj.intentos < MAX_REINTENTOS) {
          clavesEnCola.push({ clave: obj.clave, intentos: obj.intentos + 1 });
        } else {
          guardarResultadoFinal({
            claveAcceso: obj.clave,
            estadoFinal: 'ERROR_CONEXION',
            error: true,
            mensajes: [{ identificador: 'SYS', mensaje: 'Fallo de Red o API', informacionAdicional: msjError, tipo: 'ERROR' }]
          });
        }
      });
    }

    // Iniciar múltiples trabajadores en paralelo
    const trabajadores = [];
    for (let i = 0; i < CONEXIONES_SIMULTANEAS; i++) {
      trabajadores.push(ejecutarTrabajador(i + 1));
    }

    // Esperar a que todos terminen
    await Promise.all(trabajadores);

    const tiempoTotal = Date.now() - inicioTiempo;

    if (consultaCancelada) {
      progresoTexto.textContent = '¡Consulta cancelada! Mostrando resultados parciales.';
      mostrarNotificacion('Consulta cancelada. Se muestran resultados parciales.', 'error');
    } else {
      progresoFill.style.width = '100%';
      progresoTexto.textContent = '¡Consulta completada!';
      mostrarNotificacion(
        `${totalOriginal} comprobantes consultados en ${(tiempoTotal / 1000).toFixed(1)}s`,
        'success'
      );
      reproducirSonidoExito();
    }

    progresoContador.textContent = `${procesados} / ${totalOriginal}`;
    progresoStats.innerHTML = `
      Procesado en ${(tiempoTotal / 1000).toFixed(1)} segundos · 
      ${lotesProcesados} peticiones enviadas · 
      ${erroresConexion > 0 ? `<span style="color:var(--accent-red)">${erroresConexion} sin conexión</span>` : '<span style="color:var(--accent-green)">Red 100% exitosa</span>'}
    `;

    document.getElementById('statAutorizados').textContent = stats.autorizados;
    document.getElementById('statInconsistencias').textContent = stats.inconsistencias;
    document.getElementById('statExterior').textContent = stats.exterior;
    document.getElementById('statNoAutorizados').textContent = stats.noAutorizados;
    document.getElementById('statPendientes').textContent = stats.pendientes;
    document.getElementById('statAnulados').textContent = stats.anulados;
    document.getElementById('statRechazados').textContent = stats.rechazados;
    document.getElementById('statErrores').textContent = stats.errores;
    statsGrid.style.display = 'grid';

    renderTablaResultados(resultadosMasivos);
    resultadosCard.style.display = 'block';

    // Mostrar/ocultar botones de acción para errores
    actualizarBotonesErrores();

    if (!consultaCancelada) setTimeout(() => { progresoCard.style.display = 'none'; }, 5000);

  } catch (err) {
    mostrarNotificacion('Error inesperado: ' + err.message, 'error');
    progresoCard.style.display = 'none';
  } finally {
    btnConsultar.style.display = 'flex';
    btnConsultar.disabled = false;
    btnCancelar.style.display = 'none';
    actualizarContadorTotal();
  }
}

// ═══════════════════════════════════════════════════════════════
// REINTENTAR SOLO ERRORES
// Toma las claves con ERROR_CONEXION y vuelve a consultarlas
// ═══════════════════════════════════════════════════════════════

function actualizarBotonesErrores() {
  const errores = resultadosMasivos.filter(r => r.estadoFinal === 'ERROR_CONEXION');
  const contenedorAcciones = document.getElementById('accionesErrores');
  const btnReintentar = document.getElementById('btnReintentarErrores');
  const btnExportarErr = document.getElementById('btnExportarErrores');
  const contadorErr = document.getElementById('contadorErrores');

  if (errores.length > 0 && contenedorAcciones) {
    contenedorAcciones.style.display = 'flex';
    contadorErr.textContent = `${errores.length} con error`;
    btnReintentar.disabled = false;
    btnExportarErr.disabled = false;
  } else if (contenedorAcciones) {
    contenedorAcciones.style.display = 'none';
  }
}

async function reintentarSoloErrores() {
  const errores = resultadosMasivos.filter(r => r.estadoFinal === 'ERROR_CONEXION');
  if (errores.length === 0) {
    mostrarNotificacion('No hay errores de conexión para reintentar', 'info');
    return;
  }

  const clavesError = errores.map(r => r.claveAcceso);

  // Guardar los resultados exitosos (los que NO son error)
  const resultadosExitosos = resultadosMasivos.filter(r => r.estadoFinal !== 'ERROR_CONEXION');

  // Guardar estado temporal
  const excelBackup = [...clavesDesdeExcel];
  const textareaBackup = document.getElementById('clavesTextarea').value;

  // Inyectar solo las claves con error y limpiar textarea
  clavesDesdeExcel = clavesError;
  document.getElementById('clavesTextarea').value = '';

  mostrarNotificacion(`Reintentando ${clavesError.length} claves con error de conexión...`, 'info');

  // Ejecutar consulta masiva con las claves de error
  await realizarConsultaMasiva();

  // Fusionar: resultados exitosos previos + nuevos resultados del reintento
  const nuevosResultados = [...resultadosMasivos];
  resultadosMasivos = [...resultadosExitosos, ...nuevosResultados];

  // Restaurar estado
  clavesDesdeExcel = excelBackup;
  document.getElementById('clavesTextarea').value = textareaBackup;

  // Re-renderizar tabla fusionada y actualizar botones
  renderTablaResultados(resultadosMasivos);
  actualizarBotonesErrores();

  // Actualizar estadísticas
  const stats = {
    autorizados: resultadosMasivos.filter(r => (r.estadoFinal === 'AUTORIZADO' || r.estadoFinal === 'SI') && !r.claveAcceso.includes('_dup_ret_')).length,
    inconsistencias: resultadosMasivos.filter(r => {
      const meta = encontrarMetadatos(r.claveAcceso);
      const incs = r.inconsistencias || analizarInconsistencias(r, meta);
      return incs.some(inc => inc.tipo === 'ERROR' || inc.tipo === 'ADVERTENCIA');
    }).length,
    exterior: resultadosMasivos.filter(r => r.estadoFinal === 'SIN_AUTORIZACION_EXTERIOR').length,
    noAutorizados: resultadosMasivos.filter(r => r.estadoFinal === 'NO AUTORIZADO' && !r.claveAcceso.includes('_dup_ret_')).length,
    pendientes: resultadosMasivos.filter(r => r.estadoFinal === 'PENDIENTE DE ANULAR' && !r.claveAcceso.includes('_dup_ret_')).length,
    anulados: resultadosMasivos.filter(r => r.estadoFinal === 'ANULADO' && !r.claveAcceso.includes('_dup_ret_')).length,
    rechazados: resultadosMasivos.filter(r => r.estadoFinal === 'RECHAZADA' && !r.claveAcceso.includes('_dup_ret_')).length,
    errores: resultadosMasivos.filter(r => r.estadoFinal === 'ERROR_CONEXION' || r.estadoFinal === 'FORMATO_INVALIDO').length,
  };
  document.getElementById('statAutorizados').textContent = stats.autorizados;
  document.getElementById('statInconsistencias').textContent = stats.inconsistencias;
  document.getElementById('statExterior').textContent = stats.exterior;
  document.getElementById('statNoAutorizados').textContent = stats.noAutorizados;
  document.getElementById('statPendientes').textContent = stats.pendientes;
  document.getElementById('statAnulados').textContent = stats.anulados;
  document.getElementById('statRechazados').textContent = stats.rechazados;
  document.getElementById('statErrores').textContent = stats.errores;

  const erroresRestantes = resultadosMasivos.filter(r => r.estadoFinal === 'ERROR_CONEXION').length;
  if (erroresRestantes === 0) {
    mostrarNotificacion('¡Todos los errores se resolvieron exitosamente!', 'success');
  } else {
    mostrarNotificacion(`Quedan ${erroresRestantes} claves con error de conexión`, 'error');
  }
}

function exportarSoloErrores() {
  const errores = resultadosMasivos.filter(r => r.estadoFinal === 'ERROR_CONEXION');
  if (errores.length === 0) {
    mostrarNotificacion('No hay errores de conexión para exportar', 'info');
    return;
  }

  const libro = XLSX.utils.book_new();

  // Hoja 1: Solo claves con error (formato simple para re-subir)
  const datosResubir = errores.map((r, i) => {
    const meta = encontrarMetadatos(r.claveAcceso);
    return {
      'autorizacion': r.claveAcceso || '',
      'Id Proveedor': meta.idProv || '',
      'Nombre Proveedor': meta.nomProv || '',
      'Establecimiento': meta.estab || '',
      'Punto Emisión': meta.ptoEmi || '',
      'Secuencial': meta.secuencial || '',
    };
  });

  const hojaErrores = XLSX.utils.json_to_sheet(datosResubir);
  hojaErrores['!cols'] = [
    { wch: 52 },  // autorizacion
    { wch: 15 },  // Id Proveedor
    { wch: 30 },  // Nombre Proveedor
    { wch: 15 },  // Establecimiento
    { wch: 15 },  // Punto Emisión
    { wch: 15 },  // Secuencial
  ];
  XLSX.utils.book_append_sheet(libro, hojaErrores, 'Errores para reintentar');

  // Hoja 2: Detalle de errores
  const datosDetalle = errores.map((r, i) => ({
    '#': i + 1,
    'Clave de Acceso': r.claveAcceso || '',
    'Error': r.mensajes && r.mensajes.length > 0
      ? r.mensajes.map(m => m.informacionAdicional || m.mensaje).join('; ')
      : 'Error de conexión con el SRI',
  }));
  const hojaDetalle = XLSX.utils.json_to_sheet(datosDetalle);
  hojaDetalle['!cols'] = [{ wch: 6 }, { wch: 52 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(libro, hojaDetalle, 'Detalle de Errores');

  // Descargar
  const fecha = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `errores_sri_${fecha}.xlsx`;

  try {
    const excelBuffer = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    a.click();
    URL.revokeObjectURL(url);
    mostrarNotificacion(`${errores.length} claves con error exportadas a ${nombreArchivo}`, 'success');
  } catch (err) {
    mostrarNotificacion('Error al exportar: ' + err.message, 'error');
  }
}

// Determina la prioridad de ordenamiento de una fila (menor valor = mayor prioridad)
// 1. Errores críticos (ERROR_INGRESO, NO AUTORIZADO, RECHAZADA o inconsistencias tipo ERROR)
// 2. Ingreso Anulado (leve)
// 3. Documentos del exterior
// 4. Autorizados y otros
function obtenerPrioridadOrdenamiento(r, meta) {
  const incs = r.inconsistencias || analizarInconsistencias(r, meta);
  const docSap = String(meta.documentoSap || '').trim();
  const esNotaCredito = docSap.startsWith('17');
  
  const clave = r.claveAcceso || '';
  const claveLimpia = clave.split('_dup_')[0];
  const antDias = obtenerAntiguedadClave(claveLimpia);
  const esNotaCreditoVieja = esNotaCredito && antDias > 30;

  // A. Nota de Crédito sin autorización (SAP empieza con 17 y no tiene autorización) - excluyendo viejas
  const esNotaCreditoSinAutorizacion = esNotaCredito && !esNotaCreditoVieja && (
                                       r.estadoFinal === 'ERROR_INGRESO' || 
                                       r.estadoFinal === 'NO AUTORIZADO' ||
                                       incs.some(inc => inc.titulo === 'NC Sin Autorización')
  );

  // B. Factura sin autorización (no es nota de crédito y carece de autorización)
  const esFacturaSinAutorizacion = !esNotaCredito && (
                                  r.estadoFinal === 'ERROR_INGRESO' || 
                                  r.estadoFinal === 'NO AUTORIZADO' || 
                                  incs.some(inc => inc.titulo === 'Sin Autorización' || inc.titulo === 'Error Ingreso')
  );

  // C. Otros errores críticos (Rechazadas, fallas de conexión o cualquier otra inconsistencia de tipo ERROR) - excluyendo viejas notas de crédito con NO AUTORIZADO/RECHAZADA
  const tieneOtroErrorCritico = !esFacturaSinAutorizacion && !esNotaCreditoSinAutorizacion && (
                                (r.estadoFinal === 'ERROR_INGRESO' ||
                                 r.estadoFinal === 'NO AUTORIZADO' ||
                                 r.estadoFinal === 'RECHAZADA' ||
                                 r.estadoFinal === 'ERROR_CONEXION' ||
                                 r.estadoFinal === 'FORMATO_INVALIDO' ||
                                 incs.some(inc => inc.tipo === 'ERROR')) && 
                                !(esNotaCreditoVieja && (r.estadoFinal === 'NO AUTORIZADO' || r.estadoFinal === 'RECHAZADA'))
  );

  if (esFacturaSinAutorizacion) {
    return 1;
  }
  if (tieneOtroErrorCritico) {
    return 2;
  }
  if (esNotaCreditoSinAutorizacion) {
    return 3;
  }
  
  // 4. Ingreso Anulado (leve), Físico NP o Nota de Crédito antigua con estado SRI NO AUTORIZADO/RECHAZADA
  if (r.estadoFinal === 'INGRESO ANULADO' || r.estadoFinal === 'FISICO_NP' || (esNotaCreditoVieja && (r.estadoFinal === 'NO AUTORIZADO' || r.estadoFinal === 'RECHAZADA'))) {
    return 4;
  }
  
  // 5. Documentos del exterior
  if (r.estadoFinal === 'SIN_AUTORIZACION_EXTERIOR') {
    return 5;
  }
  
  // 6. Autorizados y otros
  return 6;
}

// ─── Tabla de resultados ─────────────────────────────────────

function renderTablaResultados(resultadosOriginal) {
  const tbody = document.getElementById('tablaBody');
  tbody.innerHTML = '';

  // Ordenar por prioridad predefinida y luego por fila original para mantener coherencia
  const resultados = [...resultadosOriginal].sort((a, b) => {
    const metaA = encontrarMetadatos(a.claveAcceso);
    const metaB = encontrarMetadatos(b.claveAcceso);
    const prioA = obtenerPrioridadOrdenamiento(a, metaA);
    const prioB = obtenerPrioridadOrdenamiento(b, metaB);
    
    if (prioA !== prioB) {
      return prioA - prioB;
    }
    
    const filaA = metaA.filaOriginal || 999999;
    const filaB = metaB.filaOriginal || 999999;
    return filaA - filaB;
  });

  resultados.forEach((r, i) => {
    const meta = encontrarMetadatos(r.claveAcceso);
    const docSap = String(meta.documentoSap || '').trim();
    const esNotaCredito = docSap.startsWith('17');
    const claveLimpia = (r.claveAcceso || '').split('_dup_')[0];
    const antDias = obtenerAntiguedadClave(claveLimpia);
    const esNotaCreditoVieja = esNotaCredito && antDias > 30;

    let estadoCSS = (r.estadoFinal || '').replace(/ /g, '_');
    if (esNotaCreditoVieja && (r.estadoFinal === 'NO AUTORIZADO' || r.estadoFinal === 'RECHAZADA')) {
      estadoCSS = 'PENDIENTE_DE_ANULAR'; // Estilo amarillo
    }

    const detalle = r.mensajes && r.mensajes.length > 0
      ? r.mensajes.map(m => m.informacionAdicional || m.mensaje).join('; ')
      : '—';

    let valorAutorizacion = meta.originalValorAutorizacion || '';
    if (r.claveAcceso && r.claveAcceso.includes('_dup_ret_')) {
      valorAutorizacion = `Ret: ${meta.autRet || '—'}`;
    } else if (!valorAutorizacion && r.claveAcceso) {
      valorAutorizacion = r.claveAcceso.split('_dup_')[0];
    }
    if (!valorAutorizacion) valorAutorizacion = '—';
    
    const inconsistencias = r.inconsistencias || analizarInconsistencias(r, meta);
    
    let alertaHTML = '';
    if (inconsistencias.length === 0) {
      if (r.estadoFinal === 'SIN_AUTORIZACION_EXTERIOR') {
        alertaHTML = `<span class="inconsistency-badge badge-info" title="Factura del exterior no sujeta a autorización del SRI.">🌐 Exterior</span>`;
      } else {
        alertaHTML = `<span class="inconsistency-badge badge-success" title="Datos correctos">✓ Correcto</span>`;
      }
    } else {
      alertaHTML = `<div class="inconsistency-badge-container">`;
      inconsistencias.forEach(inc => {
        const badgeClass = inc.tipo === 'ERROR' ? 'badge-danger' : 
                           (inc.tipo === 'SUCCESS' ? 'badge-success' : 
                           (inc.tipo === 'INFO' ? 'badge-info' : 'badge-warning'));
        alertaHTML += `<span class="inconsistency-badge ${badgeClass}" title="${inc.mensaje}">${inc.titulo}</span>`;
      });
      alertaHTML += `</div>`;
    }

    const tr = document.createElement('tr');
    
    // Aplicar clases de fila
    const esRetencionQuery = r.claveAcceso && r.claveAcceso.includes('_dup_ret_');
    if (r.estadoFinal === 'SIN_AUTORIZACION_EXTERIOR') {
      tr.classList.add('row-exterior');
    } else if (r.estadoFinal === 'INGRESO ANULADO') {
      tr.classList.add('row-anulado-leve');
    } else if (r.estadoFinal === 'FISICO_NP') {
      tr.classList.add('row-advertencia');
    } else if (esRetencionQuery) {
      tr.classList.add('row-advertencia');
    } else if (esNotaCreditoVieja && (r.estadoFinal === 'NO AUTORIZADO' || r.estadoFinal === 'RECHAZADA')) {
      tr.classList.add('row-advertencia');
    } else if (inconsistencias.some(inc => inc.tipo === 'ERROR')) {
      tr.classList.add('row-inconsistente');
    } else if (inconsistencias.some(inc => inc.tipo === 'ADVERTENCIA')) {
      tr.classList.add('row-advertencia');
    }

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="clave-cell" style="max-width:200px; overflow:hidden; text-overflow:ellipsis;" title="${valorAutorizacion}">${valorAutorizacion}</td>
      <td>${meta.idProv || '—'}</td>
      <td>${meta.nomProv || '—'}</td>
      <td>${meta.estab || '—'}</td>
      <td>${meta.ptoEmi || '—'}</td>
      <td>${meta.secuencial || '—'}</td>
      <td>${alertaHTML}</td>
      <td><span class="estado-badge estado-${estadoCSS}">${r.estadoFinal || '—'}</span></td>
      <td>${obtenerNombreTipoComprobante(r.tipoComprobante) || '—'}</td>
      <td>${r.rucEmisor || '—'}</td>
      <td>${r.fechaAutorizacion ? formatearFecha(r.fechaAutorizacion) : '—'}</td>
      <td>${meta.documentoSap || '—'}</td>
      <td>${meta.filaOriginal || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Filtro de resultados ────────────────────────────────────

function initFiltro() {
  document.getElementById('filtroEstado').addEventListener('change', e => {
    const filtro = e.target.value;
    if (filtro === 'inconsistentes') {
      const filtered = resultadosMasivos.filter(r => {
        const meta = encontrarMetadatos(r.claveAcceso);
        const incs = r.inconsistencias || analizarInconsistencias(r, meta);
        return incs.some(inc => inc.tipo === 'ERROR' || inc.tipo === 'ADVERTENCIA');
      });
      renderTablaResultados(filtered);
    } else if (filtro === 'exterior') {
      renderTablaResultados(resultadosMasivos.filter(r => r.estadoFinal === 'SIN_AUTORIZACION_EXTERIOR'));
    } else if (filtro === 'todos') {
      renderTablaResultados(resultadosMasivos);
    } else {
      renderTablaResultados(resultadosMasivos.filter(r => r.estadoFinal === filtro));
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// EXPORTAR A EXCEL (.xlsx) con hoja de resultados y resumen
// ═══════════════════════════════════════════════════════════════

async function exportarExcel() {
  if (resultadosMasivos.length === 0) {
    mostrarNotificacion('No hay resultados para exportar', 'error');
    return;
  }

  // Ordenar resultados antes de exportar usando el mismo orden de prioridades
  const resultadosOrdenados = [...resultadosMasivos].sort((a, b) => {
    const metaA = encontrarMetadatos(a.claveAcceso);
    const metaB = encontrarMetadatos(b.claveAcceso);
    const prioA = obtenerPrioridadOrdenamiento(a, metaA);
    const prioB = obtenerPrioridadOrdenamiento(b, metaB);
    
    if (prioA !== prioB) {
      return prioA - prioB;
    }
    
    const filaA = metaA.filaOriginal || 999999;
    const filaB = metaB.filaOriginal || 999999;
    return filaA - filaB;
  });

  // Preparar datos para la hoja principal
  const datos = resultadosOrdenados.map((r, i) => {
    const meta = encontrarMetadatos(r.claveAcceso);
    const incs = r.inconsistencias || [];
    const inconsistenciasTexto = incs.map(inc => `[${inc.titulo}] ${inc.mensaje}`).join('; ');
    
    let valorAutorizacion = meta.originalValorAutorizacion !== undefined ? meta.originalValorAutorizacion : r.claveAcceso;
    if (r.claveAcceso && r.claveAcceso.includes('_dup_ret_')) {
      valorAutorizacion = `Ret: ${meta.autRet || '—'}`;
    }
    
    return {
      '#': i + 1,
      'Clave de Acceso / Valor Excel': valorAutorizacion,
      'Id Proveedor': meta.idProv || '',
      'Nombre Proveedor': meta.nomProv || '',
      'Establecimiento': meta.estab || '',
      'Punto Emisión': meta.ptoEmi || '',
      'Secuencial': meta.secuencial || '',
      'Establecimiento Retención': meta.estabRet || '',
      'Punto Emisión Retención': meta.ptoEmiRet || '',
      'Secuencial Retención': meta.secuencialRet || '',
      'Autorización Retención': meta.autRet || '',
      'Validaciones / Alertas': inconsistenciasTexto || 'Correcto',
      'Estado Aut Factura': r.estadoFinal || '',
      'Tipo Comprobante': obtenerNombreTipoComprobante(r.tipoComprobante) || '',
      'RUC Emisor': r.rucEmisor || '',
      'Fecha Autorización': r.fechaAutorizacion ? formatearFecha(r.fechaAutorizacion) : '',
      'Documento SAP': meta.documentoSap || '',
      'Fila Excel': meta.filaOriginal || '',
    };
  });

  const libro = XLSX.utils.book_new();

  // Hoja 1: Resultados
  const hojaResultados = XLSX.utils.json_to_sheet(datos);
  hojaResultados['!cols'] = [
    { wch: 6 },   // #
    { wch: 52 },  // Clave de Acceso
    { wch: 15 },  // Id Proveedor
    { wch: 30 },  // Nombre Proveedor
    { wch: 15 },  // Establecimiento
    { wch: 15 },  // Punto Emisión
    { wch: 15 },  // Secuencial
    { wch: 22 },  // Establecimiento Retención
    { wch: 22 },  // Punto Emisión Retención
    { wch: 22 },  // Secuencial Retención
    { wch: 45 },  // Autorización Retención
    { wch: 45 },  // Validaciones / Alertas
    { wch: 24 },  // Estado Aut Factura
    { wch: 22 },  // Tipo Comprobante
    { wch: 16 },  // RUC Emisor
    { wch: 22 },  // Fecha Autorización
    { wch: 18 },  // Documento SAP
    { wch: 12 },  // Fila Excel
  ];

  // Aplicar estilos y colores a la hoja de resultados usando xlsx-js-style
  for (const ref in hojaResultados) {
    if (ref[0] === '!') continue; // Saltar propiedades de control
    const col = ref.replace(/[0-9]/g, '');
    const row = parseInt(ref.replace(/[^0-9]/g, ''), 10);

    // 1. Estilo para fila de encabezado (Fila 1)
    if (row === 1) {
      hojaResultados[ref].s = {
        fill: { patternType: "solid", fgColor: { rgb: "2B303A" } }, // Gris oscuro premium
        font: { color: { rgb: "FFFFFF" }, bold: true, name: "Calibri", sz: 11 },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: {
          bottom: { style: "medium", color: { rgb: "1E2129" } }
        }
      };
      continue;
    }

    // Estilo base para todas las celdas de datos
    // Resaltar en rojo muy suave si la factura o retención tiene un error crítico
    const r = resultadosOrdenados[row - 2];
    const meta = encontrarMetadatos(r.claveAcceso);
    const incs = r.inconsistencias || analizarInconsistencias(r, meta);
    const esRetencionQuery = r.claveAcceso && r.claveAcceso.includes('_dup_ret_');
    const docSap = String(meta.documentoSap || '').trim();
    const esNotaCredito = docSap.startsWith('17');
    const claveLimpia = (r.claveAcceso || '').split('_dup_')[0];
    const antDias = obtenerAntiguedadClave(claveLimpia);
    const esNotaCreditoVieja = esNotaCredito && antDias > 30;

    const tieneErrorCritico = !esRetencionQuery && (
                              r.estadoFinal === 'ERROR_INGRESO' || 
                              (r.estadoFinal === 'NO AUTORIZADO' && !esNotaCreditoVieja) || 
                              (r.estadoFinal === 'RECHAZADA' && !esNotaCreditoVieja) ||
                              r.estadoFinal === 'ERROR_CONEXION' ||
                              r.estadoFinal === 'FORMATO_INVALIDO' ||
                              incs.some(inc => inc.tipo === 'ERROR')
                            );
    const esIngresoAnuladoLeve = r.estadoFinal === 'INGRESO ANULADO' || r.estadoFinal === 'FISICO_NP';

    let bgRGB = "FFFFFF";
    if (tieneErrorCritico) {
      bgRGB = "FDF2F2"; // Rojo suave
    } else if (esIngresoAnuladoLeve || esRetencionQuery || (esNotaCreditoVieja && (r.estadoFinal === 'NO AUTORIZADO' || r.estadoFinal === 'RECHAZADA'))) {
      bgRGB = "FEF3C7"; // Amarillo/Naranja suave (ingreso anulado, físico NP o consulta de retención)
    }

    hojaResultados[ref].s = {
      fill: { patternType: "solid", fgColor: { rgb: bgRGB } },
      font: { name: "Calibri", sz: 10 },
      border: {
        bottom: { style: "thin", color: { rgb: "E9ECEF" } },
        top: { style: "thin", color: { rgb: "E9ECEF" } },
        left: { style: "thin", color: { rgb: "E9ECEF" } },
        right: { style: "thin", color: { rgb: "E9ECEF" } }
      }
    };

    // 2. Colorear columna L (Validaciones / Alertas)
    if (col === 'L') {
      const val = String(hojaResultados[ref].v || '');
      if (val === 'Correcto' || val.includes('Negocio Popular') || val.includes('Exterior')) {
        hojaResultados[ref].s.fill = { patternType: "solid", fgColor: { rgb: "D4EDDA" } }; // Verde suave
        hojaResultados[ref].s.font = { color: { rgb: "155724" }, bold: true, name: "Calibri", sz: 10 };
      } else if (val.includes('ADVERTENCIA') || val.includes('[Formato') || val.includes('[Autorización 9s]') || val.includes('[Ingreso Anulado]') || val.includes('[Antigüedad') || val.includes('[Comprobante Físico')) {
        hojaResultados[ref].s.fill = { patternType: "solid", fgColor: { rgb: "FFF3CD" } }; // Amarillo suave
        hojaResultados[ref].s.font = { color: { rgb: "856404" }, bold: true, name: "Calibri", sz: 10 };
      } else if (val !== '') { // Errores
        hojaResultados[ref].s.fill = { patternType: "solid", fgColor: { rgb: "F8D7DA" } }; // Rojo suave
        hojaResultados[ref].s.font = { color: { rgb: "721C24" }, bold: true, name: "Calibri", sz: 10 };
      }
    }

    // 3. Colorear columna M (Estado Aut Factura)
    if (col === 'M') {
      const val = String(hojaResultados[ref].v || '');
      if ((val === 'AUTORIZADO' || val === 'SI') && !tieneErrorCritico) {
        hojaResultados[ref].s.fill = { patternType: "solid", fgColor: { rgb: "D4EDDA" } }; // Verde suave
        hojaResultados[ref].s.font = { color: { rgb: "155724" }, bold: true, name: "Calibri", sz: 10 };
      } else if (val === 'SIN_AUTORIZACION_EXTERIOR') {
        hojaResultados[ref].s.fill = { patternType: "solid", fgColor: { rgb: "D1ECF1" } }; // Azul suave
        hojaResultados[ref].s.font = { color: { rgb: "0C5460" }, bold: true, name: "Calibri", sz: 10 };
      } else if (val === 'INGRESO ANULADO' || val === 'FISICO_NP' || (esNotaCreditoVieja && (val === 'NO AUTORIZADO' || val === 'RECHAZADA'))) {
        hojaResultados[ref].s.fill = { patternType: "solid", fgColor: { rgb: "FFE8A1" } }; // Naranja/Amarillo medio
        hojaResultados[ref].s.font = { color: { rgb: "856404" }, bold: true, name: "Calibri", sz: 10 };
      } else if (val.startsWith('ERROR_') || val === 'NO AUTORIZADO' || val === 'RECHAZADA' || val === 'ERROR_INGRESO') {
        hojaResultados[ref].s.fill = { patternType: "solid", fgColor: { rgb: "F8D7DA" } }; // Rojo suave
        hojaResultados[ref].s.font = { color: { rgb: "721C24" }, bold: true, name: "Calibri", sz: 10 };
      }
    }
  }

  XLSX.utils.book_append_sheet(libro, hojaResultados, 'Resultados SRI');

  // Hoja 2: Resumen
  const resumen = [
    { 'Concepto': 'Total consultados', 'Valor': resultadosMasivos.length },
    { 'Concepto': 'Autorizados', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'AUTORIZADO' && !r.claveAcceso.includes('_dup_ret_')).length },
    { 'Concepto': 'Facturas del Exterior', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'SIN_AUTORIZACION_EXTERIOR').length },
    { 'Concepto': 'Errores de Ingreso / Inconsistencias', 'Valor': resultadosMasivos.filter(r => {
        const meta = encontrarMetadatos(r.claveAcceso);
        const incs = r.inconsistencias || [];
        return incs.some(inc => inc.tipo === 'ERROR' || inc.tipo === 'ADVERTENCIA');
      }).length
    },
    { 'Concepto': 'No Autorizados', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'NO AUTORIZADO' && !r.claveAcceso.includes('_dup_ret_')).length },
    { 'Concepto': 'Pendientes de Anular', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'PENDIENTE DE ANULAR' && !r.claveAcceso.includes('_dup_ret_')).length },
    { 'Concepto': 'Anulados', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'ANULADO' && !r.claveAcceso.includes('_dup_ret_')).length },
    { 'Concepto': 'Rechazados', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'RECHAZADA' && !r.claveAcceso.includes('_dup_ret_')).length },
    { 'Concepto': 'Errores de conexión / Red', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'ERROR_CONEXION' || r.estadoFinal === 'FORMATO_INVALIDO').length },
    { 'Concepto': '', 'Valor': '' },
    { 'Concepto': 'Fecha de consulta', 'Valor': new Date().toLocaleString('es-EC') },
    { 'Concepto': 'Ambiente', 'Valor': ambienteActual === 'pruebas' ? 'Pruebas (CELCER)' : 'Producción (CEL)' },
    { 'Concepto': 'Archivo de origen', 'Valor': nombreArchivoExcel || 'Ingreso manual' },
  ];
  const hojaResumen = XLSX.utils.json_to_sheet(resumen);
  hojaResumen['!cols'] = [{ wch: 35 }, { wch: 35 }];

  // Aplicar estilos a la hoja de Resumen
  for (const ref in hojaResumen) {
    if (ref[0] === '!') continue;
    const col = ref.replace(/[0-9]/g, '');
    const row = parseInt(ref.replace(/[^0-9]/g, ''), 10);

    if (row === 1) {
      hojaResumen[ref].s = {
        fill: { patternType: "solid", fgColor: { rgb: "2B303A" } },
        font: { color: { rgb: "FFFFFF" }, bold: true, name: "Calibri", sz: 11 },
        alignment: { horizontal: "center", vertical: "center" }
      };
      continue;
    }

    hojaResumen[ref].s = {
      font: { name: "Calibri", sz: 10 }
    };
  }

  XLSX.utils.book_append_sheet(libro, hojaResumen, 'Resumen');

  // Guardar archivo (File System Access API si está disponible)
  const fecha = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `consulta_sri_${fecha}.xlsx`;

  try {
    const excelBuffer = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });

    // Descarga directa automática (sin diálogo de confirmación 'Save As')
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    a.click();
    URL.revokeObjectURL(url);
    mostrarNotificacion('Archivo Excel descargado con colores y formato premium', 'success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      mostrarNotificacion('Error al exportar: ' + err.message, 'error');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════

function obtenerClaseEstado(estado) {
  if (!estado) return '';
  const mapa = {
    'AUTORIZADO': 'autorizado', 'SI': 'autorizado',
    'NO AUTORIZADO': 'no-autorizado', 'RECHAZADA': 'rechazada',
    'PENDIENTE DE ANULAR': 'pendiente', 'ANULADO': 'anulado',
    'ERROR_CONEXION': 'no-autorizado', 'FORMATO_INVALIDO': 'no-autorizado',
    'FISICO_NP': 'pendiente',
  };
  return mapa[estado] || '';
}

function formatearFecha(fechaStr) {
  if (!fechaStr) return '—';
  try {
    const d = new Date(fechaStr);
    return d.toLocaleString('es-EC', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return fechaStr; }
}

function mostrarCargando(mostrar) {
  document.getElementById('loadingOverlay').style.display = mostrar ? 'flex' : 'none';
}

function mostrarNotificacion(mensaje, tipo = 'info') {
  const contenedor = document.getElementById('toastContainer');
  const notificacion = document.createElement('div');
  notificacion.className = `toast toast-${tipo}`;
  notificacion.textContent = mensaje;
  contenedor.appendChild(notificacion);
  setTimeout(() => {
    notificacion.style.opacity = '0';
    notificacion.style.transform = 'translateX(50px)';
    notificacion.style.transition = 'all 0.3s ease';
    setTimeout(() => notificacion.remove(), 300);
  }, 4000);
}

function reproducirSonidoExito() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const ganancia = ctx.createGain();

    osc1.connect(ganancia);
    osc2.connect(ganancia);
    ganancia.connect(ctx.destination);

    // Acorde mayor (Do mayor invertido) para indicar éxito o fin
    osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc2.frequency.setValueAtTime(659.25, ctx.currentTime); // E5

    // Tipo de onda más agradable y metálica
    osc1.type = 'triangle';
    osc2.type = 'sine';

    // Rampa de volumen para que no suene brusco
    ganancia.gain.setValueAtTime(0, ctx.currentTime);
    ganancia.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.1); // Subido de 0.3 a 0.8
    ganancia.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);

    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 1.2);
    osc2.stop(ctx.currentTime + 1.2);
  } catch (e) { /* ignorar si falla en algún navegador viejo */ }
}

// ═══════════════════════════════════════════════════════════════
// GESTIÓN DE CATASTROS DEL SRI
// ═══════════════════════════════════════════════════════════════

// ─── Inicialización de la pestaña de Catastros ──────────────────

function initCatastros() {
  // Actualizar pestañas para incluir catastros
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;

      document.getElementById('panelIndividual').style.display = target === 'individual' ? 'block' : 'none';
      document.getElementById('panelMasiva').style.display = target === 'masiva' ? 'block' : 'none';
      document.getElementById('panelCatastros').style.display = target === 'catastros' ? 'block' : 'none';

      // Cargar datos si es la pestaña de catastros
      if (target === 'catastros') {
        cargarEstadoCatastros();
        cargarEstadoScheduler();
        cargarURLsConfig();
      }
    });
  });

  // Input de RUC
  const rucInput = document.getElementById('rucConsulta');
  const rucCounter = document.getElementById('rucCounter');
  const btnConsultarRUC = document.getElementById('btnConsultarRUC');

  if (rucInput) {
    rucInput.addEventListener('input', () => {
      const val = rucInput.value.replace(/\D/g, '');
      rucInput.value = val;
      rucCounter.textContent = `${val.length}/13`;
      rucCounter.className = val.length >= 10 ? 'input-counter valid' : 'input-counter';
      btnConsultarRUC.disabled = val.length < 10;
    });

    rucInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !btnConsultarRUC.disabled) {
        consultarRUCEnCatastros();
      }
    });
  }
}

// ─── Cargar estado de catastros ─────────────────────────────────

async function cargarEstadoCatastros() {
  const contenedor = document.getElementById('catastrosList');

  try {
    const res = await fetch(`${API_BASE}/catastros`);
    if (!res.ok) throw new Error('Error cargando catastros');

    const datos = await res.json();

    if (datos.exito) {
      renderCatastrosList(datos.catastros, contenedor);
    } else {
      contenedor.innerHTML = `<div class="error-state"><p>Error: ${datos.error}</p></div>`;
    }
  } catch (error) {
    console.error('Error cargando catastros:', error);
    contenedor.innerHTML = `<div class="error-state"><p>Error de conexión: ${error.message}</p></div>`;
  }
}

function renderCatastrosList(catastros, contenedor) {
  if (!catastros || catastros.length === 0) {
    contenedor.innerHTML = '<p class="text-muted">No hay catastros configurados</p>';
    return;
  }

  const html = catastros.map(catastro => {
    const clase = catastro.disponible ? 'disponible' : (catastro.error ? 'error' : 'no-disponible');
    const ultimaDescarga = catastro.ultimaDescarga
      ? formatearFecha(catastro.ultimaDescarga)
      : 'Nunca';

    let errorHtml = '';
    if (catastro.error) {
      errorHtml = `<div class="catastro-error-mini">Error: ${catastro.error}</div>`;
    }

    return `
      <div class="catastro-item-simple ${clase}">
        <div class="catastro-info-simple">
          <div class="catastro-icon-simple">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
          </div>
          <div class="catastro-main-info">
            <div class="catastro-nombre-simple">${catastro.nombre}</div>
            <div class="catastro-desc-simple" title="${catastro.descripcion}">${catastro.descripcion}</div>
            ${errorHtml}
          </div>
        </div>
        
        <div class="catastro-stats-simple">
          <div class="catastro-stat-simple">
            <span class="catastro-stat-value-simple">${(catastro.registros || 0).toLocaleString()}</span>
            <span class="catastro-stat-label-simple">Registros</span>
          </div>
          <div class="catastro-stat-simple">
            <span class="catastro-stat-value-simple">${ultimaDescarga}</span>
            <span class="catastro-stat-label-simple">Sincronizado</span>
          </div>
        </div>

        <div class="catastro-actions-simple">
          <button class="btn btn-secondary btn-sm" onclick="descargarCatastro('${catastro.tipo}')" title="${catastro.disponible ? 'Re-descargar' : 'Descargar'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          <button class="btn btn-success btn-sm" onclick="seleccionarArchivoCatastro('${catastro.tipo}')" title="Subir Excel local">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </button>
          ${catastro.disponible ? `
            <button class="btn btn-danger btn-sm" onclick="eliminarCatastro('${catastro.tipo}')" title="Eliminar localmente">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  contenedor.innerHTML = html;
}

// ─── Cargar estado del scheduler ────────────────────────────────

async function cargarEstadoScheduler() {
  try {
    const res = await fetch(`${API_BASE}/scheduler/estado`);
    if (!res.ok) throw new Error('Error cargando scheduler');

    const datos = await res.json();

    if (datos.exito) {
      document.getElementById('schedulerEstado').textContent = datos.activo ? 'Activo' : 'Inactivo';
      document.getElementById('schedulerEstado').style.color = datos.activo ? 'var(--accent-green)' : 'var(--accent-gray)';

      document.getElementById('schedulerUltimaEjecucion').textContent = datos.ultimaEjecucion
        ? formatearFecha(datos.ultimaEjecucion)
        : 'Nunca';

      document.getElementById('schedulerExitosas').textContent = datos.descargasExitosas || 0;
    }
  } catch (error) {
    console.error('Error cargando scheduler:', error);
  }
}

// ─── Cargar configuración de URLs ───────────────────────────────

async function cargarURLsConfig() {
  const contenedor = document.getElementById('urlsConfig');

  try {
    const res = await fetch(`${API_BASE}/catastros/urls`);
    if (!res.ok) throw new Error('Error cargando URLs');

    const datos = await res.json();
    const urlsGuardadas = datos.urls || {};

    // Lista de tipos de catastros (debería coincidir con el backend)
    const tiposCatastros = [
      'grandes_contribuyentes',
      'agentes_retencion',
      'exportadores_bienes',
      'exportadores_servicios',
      'rimpe_emprendedores',
      'rimpe_negocios_populares',
      'contribuyentes_especiales',
      'porcentajes_renta',
      'porcentajes_iva'
    ];

    const nombresCatastros = {
      grandes_contribuyentes: 'Grandes Contribuyentes',
      agentes_retencion: 'Agentes de Retención',
      exportadores_bienes: 'Exportadores Hab. de Bienes',
      exportadores_servicios: 'Exportadores Hab. de Servicios',
      rimpe_emprendedores: 'RIMPE - Emprendedores (2023)',
      rimpe_negocios_populares: 'RIMPE - Negocios Populares (2022)',
      contribuyentes_especiales: 'Contribuyentes Especiales',
      porcentajes_renta: 'Porcentajes Retención - Renta',
      porcentajes_iva: 'Porcentajes Retención - IVA'
    };

    const html = tiposCatastros.map(tipo => {
      const urlGuardada = urlsGuardadas[tipo] || '';
      return `
        <div class="url-config-item">
          <div class="url-config-header">
            <div class="url-config-nombre">${nombresCatastros[tipo]}</div>
          </div>
          <div class="url-config-input">
            <input type="text" id="url_${tipo}" placeholder="Pega aquí el link de descarga del SRI" value="${urlGuardada}">
            <button class="btn btn-success btn-sm" onclick="guardarURL('${tipo}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Guardar
            </button>
          </div>
        </div>
      `;
    }).join('');

    contenedor.innerHTML = html;
  } catch (error) {
    console.error('Error cargando URLs:', error);
    contenedor.innerHTML = '<p class="text-muted">Error cargando configuración de URLs</p>';
  }
}

// ─── Funciones de acción ────────────────────────────────────────

async function descargarCatastro(tipo) {
  try {
    mostrarNotificacion(`Iniciando descarga de catastro...`, 'info');

    const res = await fetch(`${API_BASE}/catastros/${tipo}/descargar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const datos = await res.json();

    if (datos.exito) {
      mostrarNotificacion(datos.mensaje || 'Catastro descargado correctamente', 'success');
      cargarEstadoCatastros();
      cargarEstadoScheduler();
    } else {
      mostrarNotificacion(`Error: ${datos.error}`, 'error');
    }
  } catch (error) {
    mostrarNotificacion('Error de conexión: ' + error.message, 'error');
  }
}

async function descargarTodosCatastros() {
  try {
    mostrarNotificacion('Iniciando descarga de todos los catastros...', 'info');

    const res = await fetch(`${API_BASE}/catastros/descargar-todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const datos = await res.json();

    if (datos.exito) {
      mostrarNotificacion(`${datos.exitosos} catastros descargados correctamente`, 'success');
      cargarEstadoCatastros();
      cargarEstadoScheduler();
    } else {
      mostrarNotificacion(`Error: ${datos.error}`, 'error');
    }
  } catch (error) {
    mostrarNotificacion('Error de conexión: ' + error.message, 'error');
  }
}

async function sincronizarConDrive() {
  const btn = document.getElementById('btnSincronizarDrive');
  const originalHtml = btn.innerHTML;
  
  try {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-small"></span> Sincronizando...';
    mostrarNotificacion('Sincronizando catastros con Google Drive...', 'info');

    const res = await fetch(`${API_BASE}/drive/subir-todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const datos = await res.json();

    if (datos.exito) {
      mostrarNotificacion('¡Sincronización con Drive exitosa!', 'success');
      reproducirSonidoExito();
    } else {
      mostrarNotificacion(`Error en Drive: ${datos.error}`, 'error');
    }
  } catch (error) {
    mostrarNotificacion('Error de conexión con el servidor', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function eliminarCatastro(tipo) {
  if (!confirm('¿Estás seguro de eliminar este catastro descargado?')) return;

  try {
    const res = await fetch(`${API_BASE}/catastros/${tipo}`, {
      method: 'DELETE',
    });

    const datos = await res.json();

    if (datos.exito) {
      mostrarNotificacion('Catastro eliminado correctamente', 'success');
      cargarEstadoCatastros();
    } else {
      mostrarNotificacion(`Error: ${datos.error}`, 'error');
    }
  } catch (error) {
    mostrarNotificacion('Error de conexión: ' + error.message, 'error');
  }
}

async function guardarURL(tipo) {
  const input = document.getElementById(`url_${tipo}`);
  const url = input.value.trim();

  if (!url) {
    mostrarNotificacion('La URL no puede estar vacía', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/catastros/urls/${tipo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const datos = await res.json();

    if (datos.exito) {
      mostrarNotificacion('URL guardada correctamente', 'success');
    } else {
      mostrarNotificacion(`Error: ${datos.error}`, 'error');
    }
  } catch (error) {
    mostrarNotificacion('Error de conexión: ' + error.message, 'error');
  }
}

async function forzarVerificacionCatastros() {
  try {
    mostrarNotificacion('Verificando actualizaciones de catastros...', 'info');

    const res = await fetch(`${API_BASE}/scheduler/verificar`, {
      method: 'POST',
    });

    const datos = await res.json();

    if (datos.exito) {
      if (datos.descarga) {
        mostrarNotificacion(`${datos.descarga.exitosos} catastros actualizados`, 'success');
      } else {
        mostrarNotificacion('Todos los catastros están actualizados', 'success');
      }
      cargarEstadoCatastros();
      cargarEstadoScheduler();
    } else {
      mostrarNotificacion(`Error: ${datos.error}`, 'error');
    }
  } catch (error) {
    mostrarNotificacion('Error de conexión: ' + error.message, 'error');
  }
}

async function consultarRUCEnCatastros() {
  const rucInput = document.getElementById('rucConsulta');
  const ruc = rucInput.value.trim();
  const resultadoDiv = document.getElementById('resultadoRUC');

  if (!ruc || ruc.length < 10) {
    mostrarNotificacion('Ingresa un RUC válido (mínimo 10 dígitos)', 'error');
    return;
  }

  resultadoDiv.style.display = 'none';
  mostrarCargando(true);

  try {
    const res = await fetch(`${API_BASE}/catastros/buscar/${ruc}`);

    if (!res.ok) throw new Error('Error consultando RUC');

    const datos = await res.json();

    if (datos.exito) {
      renderResultadoRUC(ruc, datos.busqueda, resultadoDiv);
      resultadoDiv.style.display = 'block';
    } else {
      mostrarNotificacion(`Error: ${datos.error}`, 'error');
    }
  } catch (error) {
    mostrarNotificacion('Error de conexión: ' + error.message, 'error');
  } finally {
    mostrarCargando(false);
  }
}

function renderResultadoRUC(ruc, busqueda, contenedor) {
  let encontrado = false;
  const catastrosEncontrados = [];

  for (const [tipo, resultado] of Object.entries(busqueda)) {
    if (resultado.encontrado) {
      encontrado = true;
      catastrosEncontrados.push({ tipo, datos: resultado.datos });
    }
  }

  const nombresCatastros = {
    grandes_contribuyentes: 'Grandes Contribuyentes',
    agentes_retencion: 'Agentes de Retención',
    exportadores_bienes: 'Exportadores Hab. de Bienes',
    exportadores_servicios: 'Exportadores Hab. de Servicios',
    rimpe_emprendedores: 'RIMPE - Emprendedores (2023)',
    rimpe_negocios_populares: 'RIMPE - Negocios Populares (2022)',
    contribuyentes_especiales: 'Contribuyentes Especiales',
    porcentajes_renta: 'Porcentajes Retención - Renta',
    porcentajes_iva: 'Porcentajes Retención - IVA'
  };

  let html = `
    <div class="resultado-ruc-header">
      <div class="resultado-ruc-info">
        <div class="resultado-ruc-ruc">${ruc}</div>
        <div class="resultado-ruc-encontrado ${encontrado ? 'si' : 'no'}">
          ${encontrado ? '✓ Encontrado' : '✗ No encontrado'}
        </div>
      </div>
      <div class="resultado-ruc-actions">
        ${encontrado ? `
          <button class="btn btn-primary btn-sm" onclick="agregarAlMaestroManual('${ruc}', null)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <line x1="20" y1="8" x2="20" y2="14"></line>
              <line x1="23" y1="11" x2="17" y2="11"></line>
            </svg>
            Seguir en Maestro
          </button>
        ` : ''}
      </div>
    </div>
  `;

  if (encontrado) {
    html += '<div class="resultado-catastros-grid">';

    for (const { tipo, datos } of catastrosEncontrados) {
      const nombre = nombresCatastros[tipo] || tipo;
      html += `
        <div class="resultado-catastro encontrado">
          <div class="resultado-catastro-header">
            <div class="resultado-catastro-nombre">${nombre}</div>
            <div class="resultado-catastro-icon">✓</div>
          </div>
          <div class="resultado-catastro-datos">
      `;

      if (datos) {
        for (const [campo, valor] of Object.entries(datos)) {
          if (valor && String(valor).trim()) {
            html += `<div><strong>${campo}:</strong> ${valor}</div>`;
          }
        }
      }

      html += `
          </div>
        </div>
      `;
    }

    html += '</div>';
  } else {
    html += '<p class="text-muted">El RUC no se encontró en ningún catastro descargado</p>';
  }

  contenedor.innerHTML = html;
}

async function sincronizarConDrive() {
  try {
    mostrarNotificacion('Iniciando sincronización con Google Drive...', 'info');
    
    const res = await fetch(`${API_BASE}/drive/subir-todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const datos = await res.json();
    
    if (datos.exito) {
      mostrarNotificacion(`Sincronización completa: ${datos.totalArchivos} archivos procesados`, 'success');
      cargarEstadoCatastros();
    } else {
      mostrarNotificacion(`Error en sincronización: ${datos.error}`, 'error');
    }
  } catch (error) {
    console.error('Error en sincronización:', error);
    mostrarNotificacion('Error de conexión con el servidor', 'error');
  }
}

// Añadir initCatastros al DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  initCatastros();
});
// --- Funciones de Carga Manual de Catastros ---

function seleccionarArchivoCatastro(tipo) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx, .xls';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm(`¿Estás seguro de subir "${file.name}" como catastro de "${tipo}"?`)) return;

    await cargarArchivoCatastro(tipo, file);
  };
  
  input.click();
}

async function cargarArchivoCatastro(tipo, file) {
  showToast('Procesando y subiendo archivo...', 'info');
  
  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      
      try {
        const res = await fetch(`${API_URL}/catastros/${tipo}/cargar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archivo: base64 })
        });
        
        const datos = await res.json();
        
        if (datos.exito) {
          showToast(`✅ ${datos.nombre} cargado correctamente (${datos.registros} registros)`, 'success');
          await cargarCatastros(); // Refrescar lista
        } else {
          showToast(`❌ Error: ${datos.error}`, 'error');
        }
      } catch (err) {
        showToast('❌ Error de conexión al subir', 'error');
      }
    };
    reader.readAsDataURL(file);
  } catch (error) {
    console.error('Error leyendo archivo:', error);
    showToast('Error al leer el archivo local', 'error');
  }
}

// ─── MAESTRO DE PROVEEDORES Y NOTIFICACIONES ─────────────────

function initMaestroAndNotifications() {
  cargarMaestro();
  cargarNotificaciones();
  
  // Toggle Notificaciones Dropdown
  const notifBtn = document.getElementById('notificationBtn');
  const notifDropdown = document.getElementById('notificationDropdown');
  
  if (notifBtn) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle('active');
    });
  }

  document.addEventListener('click', () => {
    if (notifDropdown) notifDropdown.classList.remove('active');
  });

  // Polling para notificaciones cada 5 minutos
  setInterval(cargarNotificaciones, 5 * 60 * 1000);
}

async function cargarMaestro() {
  try {
    const res = await fetch(`${API_BASE}/maestro`);
    const data = await res.json();
    const list = document.getElementById('maestroList');
    
    if (data.exito) {
      const proveedores = Object.values(data.maestro);
      if (proveedores.length === 0) {
        list.innerHTML = '<tr><td colspan="4" class="text-center p-8 text-muted">Aún no hay proveedores en el maestro. Busca un RUC o sube un Excel.</td></tr>';
        return;
      }

      list.innerHTML = proveedores.map(p => `
        <tr>
          <td class="font-mono font-bold">${p.ruc}</td>
          <td>${p.nombre}</td>
          <td>
            <div class="badge-fiscal">
              ${p.estados.map(e => {
                let cls = 'accent-blue';
                if (e.includes('Grande')) cls = 'accent-green';
                if (e.includes('RIMPE')) cls = 'accent-yellow';
                return `<span class="badge-tag ${cls}">${e}</span>`;
              }).join('')}
            </div>
          </td>
          <td class="text-muted text-xs">${new Date(p.ultimaVerificacion).toLocaleString()}</td>
        </tr>
      `).join('');
    }
  } catch (error) {
    console.error('Error cargando maestro:', error);
  }
}

async function cargarNotificaciones() {
  try {
    const res = await fetch(`${API_BASE}/notificaciones`);
    const data = await res.json();
    const badge = document.getElementById('notificationBadge');
    const list = document.getElementById('notificationList');
    
    if (data.exito) {
      const nuevas = data.notificaciones.filter(n => !n.leida);
      if (nuevas.length > 0) {
        badge.textContent = nuevas.length;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }

      if (data.notificaciones.length === 0) {
        list.innerHTML = '<p class="empty-notif">No hay cambios recientes</p>';
        return;
      }

      list.innerHTML = data.notificaciones.reverse().map(n => `
        <div class="notification-item ${n.leida ? '' : 'unread'}">
          <div class="notification-item-header">
            <span class="notification-ruc">${n.ruc}</span>
            <span class="notification-date">${new Date(n.fecha).toLocaleDateString()}</span>
          </div>
          <div class="notification-body">
            <strong>${n.nombre}</strong> ha cambiado su estado fiscal:
            <span class="notif-change">
              <span class="notif-old">${n.anterior}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin: 0 4px">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              <span class="notif-new">${n.nuevo}</span>
            </span>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error cargando notificaciones:', error);
  }
}

async function marcarNotificacionesLeidas() {
  try {
    await fetch(`${API_BASE}/notificaciones/marcar-leidas`, { method: 'POST' });
    cargarNotificaciones();
  } catch (error) {
    console.error('Error al marcar notificaciones:', error);
  }
}

async function sincronizarMaestroManual() {
  const btn = event.currentTarget;
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Sincronizando...';
  
  try {
    const res = await fetch(`${API_BASE}/maestro/sincronizar`, { method: 'POST' });
    const data = await res.json();
    if (data.exito) {
      alert(`Sincronización completada. Se detectaron ${data.cambios} cambios en tus proveedores.`);
      cargarMaestro();
      cargarNotificaciones();
    }
  } catch (error) {
    alert('Error al sincronizar el maestro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function agregarAlMaestroManual(ruc, nombre) {
  try {
    const res = await fetch(`${API_BASE}/maestro/agregar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruc, nombre })
    });
    const data = await res.json();
    if (data.exito) {
      alert('Proveedor añadido con éxito al Maestro Inteligente.');
      cargarMaestro();
    }
  } catch (error) {
    alert('Error al añadir proveedor.');
  }
}

async function subirMaestroExcel(input) {
  const file = input.files[0];
  if (!file) return;

  // Mostramos un mensaje de espera
  const list = document.getElementById('maestroList');
  list.innerHTML = '<tr><td colspan="4" class="text-center p-8">Procesando archivo Master... Esto puede tardar unos segundos.</td></tr>';

  // Usamos el mismo endpoint de carga de catastros peeo marcándolo como tipo 'maestro_proveedores'
  const formData = new FormData();
  formData.append('archivo', file);

  try {
    const res = await fetch(`${API_BASE}/catastros/maestro_proveedores/cargar`, {
      method: 'POST',
      body: formData
    });
    
    if (res.ok) {
      // Una vez subido el archivo Excel, disparamos la sincronización inteligente
      // para poblar los estados fiscales desde cero.
      await sincronizarMaestroManual();
      alert('Maestro cargado y sincronizado correctamente.');
    } else {
      alert('Error al subir el archivo del maestro.');
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Error de conexión.');
  } finally {
    input.value = '';
    cargarMaestro();
  }
}
