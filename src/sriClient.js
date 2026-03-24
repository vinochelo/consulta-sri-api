const fetch = require('node-fetch');
const xml2js = require('xml2js');
const https = require('https');
const { config, getAmbiente } = require('./config');

// Agente HTTPS que acepta certificados del SRI sin fallar
const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // El SRI puede tener certificados que cambien
});

// ─── Construcción de envelopes SOAP ───────────────────────────────────

/**
 * Construye el XML SOAP para consultar el estado de autorización de un comprobante
 */
function buildConsultaComprobanteXML(claveAcceso) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.consultas">
  <soapenv:Header/>
  <soapenv:Body>
    <ec:consultarEstadoAutorizacionComprobante>
      <claveAcceso>${claveAcceso}</claveAcceso>
    </ec:consultarEstadoAutorizacionComprobante>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Construye el XML SOAP para consultar factura comercial negociable
 */
function buildConsultaFacturaXML(claveAcceso) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.consultas">
  <soapenv:Header/>
  <soapenv:Body>
    <ec:consultarEstadoConfirmacionFacturaComercialNegociable>
      <claveAcceso>${claveAcceso}</claveAcceso>
    </ec:consultarEstadoConfirmacionFacturaComercialNegociable>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ─── Envío de peticiones SOAP ─────────────────────────────────────────

/**
 * Envía una petición SOAP al SRI y devuelve el XML de respuesta
 */
async function enviarPeticionSOAP(url, xmlBody) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '',
      },
      body: xmlBody,
      agent: httpsAgent,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Parseo de respuestas XML ─────────────────────────────────────────

/**
 * Parsea la respuesta XML del servicio ConsultaComprobante a un objeto JSON
 */
async function parsearRespuestaComprobante(xmlResponse) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: true,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  });

  const result = await parser.parseStringPromise(xmlResponse);

  // Navegar la estructura SOAP
  const body = result.Envelope.Body;
  const respuesta = body.consultarEstadoAutorizacionComprobanteResponse;
  const estado = respuesta.EstadoAutorizacionComprobante;

  // Construir objeto normalizado
  const resultado = {
    claveAcceso: estado.claveAcceso || '',
    estadoAutorizacion: estado.estadoAutorizacion || null,
    estadoConsulta: estado.estadoConsulta || null,
    tipoComprobante: estado.tipoComprobante || null,
    rucEmisor: estado.rucEmisor || null,
    fechaAutorizacion: estado.fechaAutorizacion || null,
    mensajes: [],
    error: false,
  };

  // Determinar estado final
  if (resultado.estadoAutorizacion) {
    resultado.estadoFinal = resultado.estadoAutorizacion;
  } else if (resultado.estadoConsulta) {
    resultado.estadoFinal = resultado.estadoConsulta;
    resultado.error = resultado.estadoConsulta === 'RECHAZADA';
  }

  // Parsear mensajes si existen
  if (estado.mensajes && estado.mensajes.mensaje) {
    const mensajes = Array.isArray(estado.mensajes.mensaje)
      ? estado.mensajes.mensaje
      : [estado.mensajes.mensaje];

    resultado.mensajes = mensajes.map((m) => ({
      identificador: m.identificador || '',
      mensaje: m.mensaje || '',
      informacionAdicional: m.informacionAdicional || '',
      tipo: m.tipo || '',
    }));
  }

  return resultado;
}

/**
 * Parsea la respuesta XML del servicio ConsultaFactura a un objeto JSON
 */
async function parsearRespuestaFactura(xmlResponse) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: true,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  });

  const result = await parser.parseStringPromise(xmlResponse);

  const body = result.Envelope.Body;
  const respuesta = body.consultarEstadoConfirmacionFacturaComercialNegociableResponse;
  const estado = respuesta.EstadoConfirmacionFacturaComercialNegociable;

  const resultado = {
    claveAcceso: estado.claveAcceso || '',
    estadoConfirmacion: estado.estadoConfirmacion || null,
    estadoConsulta: estado.estadoConsulta || null,
    mensajes: [],
    error: false,
  };

  if (resultado.estadoConfirmacion) {
    resultado.estadoFinal = resultado.estadoConfirmacion;
  } else if (resultado.estadoConsulta) {
    resultado.estadoFinal = resultado.estadoConsulta;
    resultado.error = resultado.estadoConsulta === 'RECHAZADA';
  }

  if (estado.mensajes && estado.mensajes.mensaje) {
    const mensajes = Array.isArray(estado.mensajes.mensaje)
      ? estado.mensajes.mensaje
      : [estado.mensajes.mensaje];

    resultado.mensajes = mensajes.map((m) => ({
      identificador: m.identificador || '',
      mensaje: m.mensaje || '',
      informacionAdicional: m.informacionAdicional || '',
      tipo: m.tipo || '',
    }));
  }

  return resultado;
}

// ─── Funciones de consulta pública ────────────────────────────────────

/**
 * Consulta el estado de autorización de un comprobante electrónico
 * @param {string} claveAcceso - Clave de acceso de 49 dígitos
 * @param {string} ambiente - 'pruebas' o 'produccion'
 * @returns {object} Resultado normalizado en JSON
 */
async function consultarComprobante(claveAcceso, ambiente) {
  const amb = getAmbiente(ambiente);
  const xml = buildConsultaComprobanteXML(claveAcceso);

  try {
    const respuestaXML = await enviarPeticionSOAP(amb.consultaComprobante, xml);
    const resultado = await parsearRespuestaComprobante(respuestaXML);
    return { exito: true, ...resultado };
  } catch (error) {
    return {
      exito: false,
      claveAcceso,
      estadoFinal: 'ERROR_CONEXION',
      error: true,
      mensajes: [
        {
          identificador: 'SYS',
          mensaje: 'Error de conexión con el SRI',
          informacionAdicional: error.message,
          tipo: 'ERROR',
        },
      ],
    };
  }
}

/**
 * Consulta si una factura es comercial negociable
 * @param {string} claveAcceso - Clave de acceso de 49 dígitos
 * @param {string} ambiente - 'pruebas' o 'produccion'
 * @returns {object} Resultado normalizado en JSON
 */
async function consultarFacturaNegociable(claveAcceso, ambiente) {
  const amb = getAmbiente(ambiente);
  const xml = buildConsultaFacturaXML(claveAcceso);

  try {
    const respuestaXML = await enviarPeticionSOAP(amb.consultaFactura, xml);
    const resultado = await parsearRespuestaFactura(respuestaXML);
    return { exito: true, ...resultado };
  } catch (error) {
    return {
      exito: false,
      claveAcceso,
      estadoFinal: 'ERROR_CONEXION',
      error: true,
      mensajes: [
        {
          identificador: 'SYS',
          mensaje: 'Error de conexión con el SRI',
          informacionAdicional: error.message,
          tipo: 'ERROR',
        },
      ],
    };
  }
}

// ─── Consulta masiva con concurrencia controlada ──────────────────────

/**
 * Espera un número de milisegundos
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Consulta masiva de comprobantes con concurrencia controlada.
 * Envía las peticiones en lotes para no saturar al SRI.
 *
 * @param {string[]} clavesAcceso - Array de claves de acceso
 * @param {string} tipo - 'comprobante' o 'factura_negociable'
 * @param {string} ambiente - 'pruebas' o 'produccion'
 * @param {function} onProgreso - Callback opcional: (completados, total) => {}
 * @returns {object[]} Array de resultados
 */
async function consultarMasivo(clavesAcceso, tipo = 'comprobante', ambiente, onProgreso) {
  const resultados = [];
  const total = clavesAcceso.length;
  let completados = 0;

  const funcionConsulta =
    tipo === 'factura_negociable' ? consultarFacturaNegociable : consultarComprobante;

  // Procesar en lotes de MAX_CONCURRENT
  for (let i = 0; i < total; i += config.maxConcurrent) {
    const lote = clavesAcceso.slice(i, i + config.maxConcurrent);

    const promesas = lote.map(async (clave) => {
      const resultado = await funcionConsulta(clave.trim(), ambiente);
      completados++;
      if (onProgreso) onProgreso(completados, total);
      return resultado;
    });

    const resultadosLote = await Promise.all(promesas);
    resultados.push(...resultadosLote);

    // Esperar entre lotes para no saturar el SRI
    if (i + config.maxConcurrent < total) {
      await delay(config.delayMs);
    }
  }

  return resultados;
}

module.exports = {
  consultarComprobante,
  consultarFacturaNegociable,
  consultarMasivo,
};
