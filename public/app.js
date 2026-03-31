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

// Tamaño de cada lote enviado al servidor
const TAMANO_LOTE = 100;
const CONEXIONES_SIMULTANEAS = 2; // Cantidad de lotes en paralelo

// ─── Inicialización ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTabs();
  initConsultaIndividual();
  initConsultaMasiva();
  initExcelUpload();
  initFiltro();
  checkHealth();
});

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
        const maxFilaBusqueda = Math.min(6, filas.length);

        for (let f = 0; f < maxFilaBusqueda; f++) {
          const fila = filas[f];
          if (!fila) continue;

          for (let c = 0; c < fila.length; c++) {
            const encabezado = normalizar(String(fila[c]));
            
            // Si ya lo encontramos en esta fila, no lo sobreescribimos con otras columnas
            if (indiceColumna === -1 && (encabezado.includes('autorizacion') || encabezado.includes('clavedeacceso') || encabezado.includes('clave_acceso') || encabezado === 'clave')) {
              indiceColumna = c; nombreColumna = String(fila[c]); hojaUsada = nombreHoja; filaEncabezado = f;
            } 
            else if (pId === -1 && (encabezado.includes('idproveedor') || encabezado.includes('identificacion'))) { pId = c; }
            else if (pNom === -1 && (encabezado.includes('nombreproveedor') || encabezado.includes('razonsocial') || (encabezado.includes('proveedor') && !encabezado.includes('id') && !encabezado.includes('tipo')))) { pNom = c; }
            else if (pEst === -1 && (encabezado === 'establecimiento' || encabezado === 'estab')) { pEst = c; }
            else if (pPunto === -1 && (encabezado.includes('puntodeemision') || encabezado === 'puntoemision' || encabezado === 'ptoemi')) { pPunto = c; }
            else if (pSec === -1 && (encabezado === 'secuencial' || encabezado.includes('numdoc'))) { pSec = c; }
          }
          if (indiceColumna !== -1) break;
        }

        if (indiceColumna === -1) continue;

        metadatosExcel = {}; // Limpiar estado anterior
        for (let r = filaEncabezado + 1; r < filas.length; r++) {
          const fila = filas[r];
          if (!fila || !fila[indiceColumna]) continue;

          totalFilasDatos++;
          const valor = String(fila[indiceColumna]).trim();

          if (/^\d{49}$/.test(valor)) {
            clavesEncontradas.push(valor);
            metadatosExcel[valor] = {
              idProv: pId !== -1 ? String(fila[pId]).trim() : '',
              nomProv: pNom !== -1 ? String(fila[pNom]).trim() : '',
              estab: pEst !== -1 ? String(fila[pEst]).trim() : '',
              ptoEmi: pPunto !== -1 ? String(fila[pPunto]).trim() : '',
              secuencial: pSec !== -1 ? String(fila[pSec]).trim() : ''
            };
          }
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
          `Excel cargado: ${clavesEncontradas.length} claves válidas encontradas` +
          (filasOmitidas > 0 ? ` (${filasOmitidas} filas omitidas)` : ''),
          'success'
        );
        
        // Iniciar consulta automáticamente
        setTimeout(() => {
          realizarConsultaMasiva();
        }, 300);
      } else {
        mostrarNotificacion(
          `Se encontró la columna "${nombreColumna}" pero no contiene claves válidas de 49 dígitos`,
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
  let clavesEnCola = claves.map(c => ({ clave: c, intentos: 0 }));
  const MAX_REINTENTOS = 3; // Intentar hasta 4 veces en total (para cierre de mes)

  resultadosMasivos = [];
  let procesados = 0;
  let lotesProcesados = 0;
  let erroresConexion = 0;
  const inicioTiempo = Date.now();

  const stats = {
    autorizados: 0, noAutorizados: 0, pendientes: 0,
    anulados: 0, rechazados: 0, errores: 0
  };

  try {
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
        // Pausa progresiva: más larga si hay reintentos pendientes
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

  function guardarResultadoFinal(resItem) {
    resultadosMasivos.push(resItem);
    procesados++;
    switch(resItem.estadoFinal) {
      case 'AUTORIZADO': case 'SI': stats.autorizados++; break;
      case 'NO AUTORIZADO': stats.noAutorizados++; break;
      case 'PENDIENTE DE ANULAR': stats.pendientes++; break;
      case 'ANULADO': stats.anulados++; break;
      case 'RECHAZADA': stats.rechazados++; break;
      case 'ERROR_CONEXION': case 'FORMATO_INVALIDO': 
        stats.errores++;
        if (resItem.estadoFinal === 'ERROR_CONEXION') erroresConexion++;
        break;
      default: stats.pendientes++; break;
    }
    actualizarProgresoUI();
  }

  function actualizarProgresoUI() {
    const porcentaje = Math.round((procesados / totalOriginal) * 100) || 0;
    progresoFill.style.width = `${porcentaje > 100 ? 100 : porcentaje}%`;
    progresoContador.textContent = `${procesados} / ${totalOriginal}`;
    
    progresoStats.innerHTML = `
      <span style="color:var(--accent-green)">✓ ${stats.autorizados} autorizados</span> · 
      <span style="color:var(--accent-orange)">✗ ${stats.rechazados} rechazados</span> · 
      <span style="color:var(--accent-red)">⚠ ${stats.errores} errores</span> · 
      Tiempo: ${((Date.now() - inicioTiempo) / 1000).toFixed(0)}s
    `;
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
    autorizados: resultadosMasivos.filter(r => r.estadoFinal === 'AUTORIZADO' || r.estadoFinal === 'SI').length,
    noAutorizados: resultadosMasivos.filter(r => r.estadoFinal === 'NO AUTORIZADO').length,
    pendientes: resultadosMasivos.filter(r => r.estadoFinal === 'PENDIENTE DE ANULAR').length,
    anulados: resultadosMasivos.filter(r => r.estadoFinal === 'ANULADO').length,
    rechazados: resultadosMasivos.filter(r => r.estadoFinal === 'RECHAZADA').length,
    errores: resultadosMasivos.filter(r => r.estadoFinal === 'ERROR_CONEXION' || r.estadoFinal === 'FORMATO_INVALIDO').length,
  };
  document.getElementById('statAutorizados').textContent = stats.autorizados;
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
    const meta = metadatosExcel[r.claveAcceso] || {};
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

// ─── Tabla de resultados ─────────────────────────────────────

function renderTablaResultados(resultadosOriginal) {
  const tbody = document.getElementById('tablaBody');
  tbody.innerHTML = '';

  // Ordenar: Autorizados y SI al final (para tener los errores primero)
  const resultados = [...resultadosOriginal].sort((a, b) => {
    const esAutA = (a.estadoFinal === 'AUTORIZADO' || a.estadoFinal === 'SI') ? 1 : 0;
    const esAutB = (b.estadoFinal === 'AUTORIZADO' || b.estadoFinal === 'SI') ? 1 : 0;
    return esAutA - esAutB;
  });

  resultados.forEach((r, i) => {
    const estadoCSS = (r.estadoFinal || '').replace(/ /g, '_');
    const detalle = r.mensajes && r.mensajes.length > 0
      ? r.mensajes.map(m => m.informacionAdicional || m.mensaje).join('; ')
      : '—';

    const meta = metadatosExcel[r.claveAcceso] || { idProv: '—', nomProv: '—', estab: '—', ptoEmi: '—', secuencial: '—' };

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="clave-cell">${r.claveAcceso || '—'}</td>
      <td>${meta.idProv}</td>
      <td>${meta.nomProv}</td>
      <td>${meta.estab}</td>
      <td>${meta.ptoEmi}</td>
      <td>${meta.secuencial}</td>
      <td><span class="estado-badge estado-${estadoCSS}">${r.estadoFinal || '—'}</span></td>
      <td>${r.tipoComprobante || '—'}</td>
      <td>${r.rucEmisor || '—'}</td>
      <td>${r.fechaAutorizacion ? formatearFecha(r.fechaAutorizacion) : '—'}</td>
      <td class="detalle-cell" title="${detalle}">${detalle.length > 60 ? detalle.substring(0, 60) + '...' : detalle}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Filtro de resultados ────────────────────────────────────

function initFiltro() {
  document.getElementById('filtroEstado').addEventListener('change', e => {
    const filtro = e.target.value;
    if (filtro === 'todos') {
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

  // Preparar datos para la hoja principal
  const datos = resultadosMasivos.map((r, i) => {
    const meta = metadatosExcel[r.claveAcceso] || {};
    return {
      '#': i + 1,
      'Clave de Acceso': r.claveAcceso || '',
      'Id Proveedor': meta.idProv || '',
      'Nombre Proveedor': meta.nomProv || '',
      'Establecimiento': meta.estab || '',
      'Punto Emisión': meta.ptoEmi || '',
      'Secuencial': meta.secuencial || '',
      'Estado': r.estadoFinal || '',
      'Tipo Comprobante': r.tipoComprobante || '',
      'RUC Emisor': r.rucEmisor || '',
      'Fecha Autorización': r.fechaAutorizacion ? formatearFecha(r.fechaAutorizacion) : '',
      'Mensajes': r.mensajes && r.mensajes.length > 0
        ? r.mensajes.map(m => m.informacionAdicional || m.mensaje).join('; ')
        : '',
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
    { wch: 20 },  // Estado
    { wch: 22 },  // Tipo Comprobante
    { wch: 16 },  // RUC Emisor
    { wch: 22 },  // Fecha Autorización
    { wch: 50 },  // Mensajes
  ];
  XLSX.utils.book_append_sheet(libro, hojaResultados, 'Resultados SRI');

  // Hoja 2: Resumen
  const resumen = [
    { 'Concepto': 'Total consultados', 'Valor': resultadosMasivos.length },
    { 'Concepto': 'Autorizados', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'AUTORIZADO').length },
    { 'Concepto': 'No Autorizados', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'NO AUTORIZADO').length },
    { 'Concepto': 'Pendientes de Anular', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'PENDIENTE DE ANULAR').length },
    { 'Concepto': 'Anulados', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'ANULADO').length },
    { 'Concepto': 'Rechazados', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'RECHAZADA').length },
    { 'Concepto': 'Errores de conexión', 'Valor': resultadosMasivos.filter(r => r.estadoFinal === 'ERROR_CONEXION' || r.estadoFinal === 'FORMATO_INVALIDO').length },
    { 'Concepto': '', 'Valor': '' },
    { 'Concepto': 'Fecha de consulta', 'Valor': new Date().toLocaleString('es-EC') },
    { 'Concepto': 'Ambiente', 'Valor': ambienteActual === 'pruebas' ? 'Pruebas (CELCER)' : 'Producción (CEL)' },
    { 'Concepto': 'Archivo de origen', 'Valor': nombreArchivoExcel || 'Ingreso manual' },
  ];
  const hojaResumen = XLSX.utils.json_to_sheet(resumen);
  hojaResumen['!cols'] = [{ wch: 25 }, { wch: 35 }];
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
    mostrarNotificacion('Archivo Excel descargado de forma automática', 'success');
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
  } catch(e) { /* ignorar si falla en algún navegador viejo */ }
}
