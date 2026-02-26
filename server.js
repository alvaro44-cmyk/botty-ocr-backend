const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createWorker } = require('tesseract.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ✅ Worker precargado al arrancar
let worker = null;

async function inicializarWorker() {
  console.log('⏳ Precargando Tesseract...');
  worker = await createWorker('spa+eng', 1, {
    // ✅ Modo rápido: optimizado para texto impreso (tickets)
    tessedit_pageseg_mode: '6',  // Bloque uniforme de texto
  });
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    // ✅ Solo reconoce caracteres útiles para tickets — mucho más rápido
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzáéíóúÁÉÍÓÚñÑ0123456789.,€$%/:- ',
  });
  console.log('✅ Tesseract listo');
}

app.post('/analizar-ticket', upload.single('imagen'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  if (!worker) return res.status(503).json({ error: 'Servidor iniciando, espera unos segundos' });

  try {
    const { data } = await worker.recognize(req.file.buffer);
    const analisis = parsearTicket(data.text);
    res.json(analisis);
  } catch (err) {
    console.error('Error OCR:', err);
    res.status(500).json({ error: 'Error al procesar el ticket' });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, tesseractListo: !!worker });
});

// ── Parser ─────────────────────────────────────────────────────────────
function parsearTicket(texto) {
  const lineas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 1);
  return {
    establecimiento: detectarEstablecimiento(lineas),
    fecha: detectarFecha(lineas),
    ...detectarProductos(lineas)
  };
}

function detectarEstablecimiento(lineas) {
  for (const linea of lineas.slice(0, 4)) {
    if (linea.length > 3 && !/\d{2}[/:]\d{2}/.test(linea) && !/^\d+/.test(linea)) return linea;
  }
  return null;
}

function detectarFecha(lineas) {
  const patron = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/;
  for (const linea of lineas) {
    const match = linea.match(patron);
    if (match) return match[0];
  }
  return null;
}

function detectarProductos(lineas) {
  const productos = [];
  let total = 0;
  const patronPrecio = /(-?\d{1,4}[.,]\d{2})\s*€?$/;
  const ignorar = /total|subtotal|iva|tax|cambio|efectivo|tarjeta|visa|mastercard|ticket|factura|gracias|cif|nif/i;
  const patronTotal = /total\s*:?\s*(-?\d{1,4}[.,]\d{2})/i;

  for (const linea of lineas) {
    const matchTotal = linea.match(patronTotal);
    if (matchTotal) { total = parsePrecio(matchTotal[1]); continue; }
    if (ignorar.test(linea)) continue;
    const matchPrecio = linea.match(patronPrecio);
    if (matchPrecio) {
      const precio = parsePrecio(matchPrecio[1]);
      if (precio <= 0) continue;
      let nombre = linea.replace(matchPrecio[0], '').trim().replace(/[|\\/_]{2,}/g, '').trim();
      if (nombre.length < 2) continue;
      const matchCantidad = nombre.match(/^(\d+)\s*[xX]?\s+(.+)/);
      if (matchCantidad) {
        productos.push({ nombre: cap(matchCantidad[2]), precio, cantidad: parseInt(matchCantidad[1]) });
      } else {
        productos.push({ nombre: cap(nombre), precio, cantidad: 1 });
      }
    }
  }
  if (total === 0 && productos.length > 0) {
    total = Math.round(productos.reduce((s, p) => s + p.precio * p.cantidad, 0) * 100) / 100;
  }
  return { productos, total };
}

function parsePrecio(str) { return parseFloat(str.replace(',', '.')); }
function cap(n) { return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); }

app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  await inicializarWorker();
});
