const express = require('express');
const cors = require('cors');
const path = require('path');
const { config } = require('./config');
const routes = require('./routes');
const { iniciarScheduler } = require('./catalogScheduler');
const { inicializarGestor } = require('./catalogManager');

const app = express();

// RUTA DE EMERGENCIA ABSOLUTA - PRIMERA PRIORIDAD
app.get('/auth-test', (req, res) => {
  try {
    const googleDriveCdn = require('./googleDriveCdn');
    const url = googleDriveCdn.generarUrlAutenticacion();
    res.redirect(url);
  } catch (error) {
    res.status(500).send('Error en prioridad 1: ' + error.message);
  }
});

// ─── Middleware ────────────────────────────────────────────────────────

// Permitir CORS para que tu web existente pueda consumir la API
app.use(cors());

// Parsear JSON en el body de las peticiones
app.use(express.json({ limit: '5mb' }));

// Logging de peticiones
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// ─── Archivos estáticos (Dashboard de pruebas) ───────────────────────

app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Rutas de la API ──────────────────────────────────────────────────

app.use('/api', routes);

// Ruta de emergencia directa en el servidor
app.get('/api/login-directo', (req, res) => {
  try {
    const googleDriveCdn = require('./googleDriveCdn');
    const url = googleDriveCdn.generarUrlAutenticacion();
    res.redirect(url);
  } catch (error) {
    res.status(500).send('Error directo: ' + error.message);
  }
});

// ─── Ruta raíz → Dashboard ───────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Iniciar servidor ─────────────────────────────────────────────────

if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   Consulta API SRI - Comprobantes Electrónicos      ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  Servidor:    http://localhost:${config.port}                ║`);
    console.log(`║  Dashboard:   http://localhost:${config.port}                ║`);
    console.log(`║  Ambiente:    ${(config.sriEnv === 'pruebas' ? 'PRUEBAS (celcer)' : 'PRODUCCIÓN (cel)').padEnd(38)}║`);
    console.log(`║  Concurrencia: ${String(config.maxConcurrent).padEnd(37)}║`);
    console.log(`║  Delay:       ${(config.delayMs + 'ms').padEnd(38)}║`);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    // Iniciar el programador de descargas de catastros si está configurado
    if (config.catastroSchedulerActivo) {
      iniciarScheduler();
    } else {
      console.log('[CATASTROS] Scheduler desactivado. Active con: CATASTRO_SCHEDULER=true');
    }

    // 🔥 PRE-CARGA DE CATASTROS (Nuevo: calentamiento de caché)
    inicializarGestor().catch(err => console.error('[GESTOR] Error inicializando:', err));
  });
}

module.exports = app;
