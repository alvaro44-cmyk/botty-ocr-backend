const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ── Endpoint: analizar ticket con Claude Vision ────────────────────────
app.post('/analizar-ticket', upload.single('imagen'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada' });

  try {
    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // ✅ Haiku: más rápido y barato para tickets
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 }
            },
            {
              type: 'text',
              text: `Analiza este ticket de compra y devuelve SOLO un JSON con este formato exacto, sin texto adicional ni backticks:
{
  "establecimiento": "nombre del lugar o null",
  "fecha": "fecha si aparece o null",
  "productos": [
    { "nombre": "nombre del producto", "precio": 2.50, "cantidad": 1 }
  ],
  "total": 15.30
}
Si no puedes leer algún precio usa 0. Los precios deben ser números decimales.`
            }
          ]
        }]
      })
    });

    const data = await response.json();
    const texto = data.content?.[0]?.text ?? '';
    const clean = texto.replace(/```json|```/g, '').trim();
    const analisis = JSON.parse(clean);
    res.json(analisis);

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Error al procesar el ticket' });
  }
});

// ── Health check ───────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, tesseractListo: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
