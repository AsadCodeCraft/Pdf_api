require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const {
  closeBrowser,
  convertHtmlToBase64,
  convertHtmlToPdfUrl,
  ensureLocalPdfDirectory,
  pdfDirectory,
  supabaseBucket,
  useSupabaseStorage
} = require('./lib/pdf-service');

const app = express();
const PORT = process.env.PORT || 3000;

ensureLocalPdfDirectory();

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use('/pdfs', express.static(pdfDirectory));

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'HTML to PDF API is running' });
});

app.post('/convert', async (req, res) => {
  try {
    const { html, options = {} } = req.body;
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const storedPdf = await convertHtmlToPdfUrl(html, options, requestOrigin);

    res.json({
      success: true,
      fileName: storedPdf.fileName,
      storage: storedPdf.storage,
      path: storedPdf.path,
      url: storedPdf.url,
      expiresIn: storedPdf.expiresIn
    });
  } catch (error) {
    console.error('Error converting HTML to PDF:', error);
    res.status(error.statusCode || 500).json({
      error: 'Failed to convert HTML to PDF',
      message: error.message
    });
  }
});

app.post('/convert-base64', async (req, res) => {
  try {
    const { html, options = {} } = req.body;
    const result = await convertHtmlToBase64(html, options);
    res.json(result);
  } catch (error) {
    console.error('Error converting HTML to PDF:', error);
    res.status(error.statusCode || 500).json({
      error: 'Failed to convert HTML to PDF',
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`HTML to PDF API running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health                 - Health check');
  console.log('  POST /convert                - Return PDF URL');
  console.log('  POST /convert-base64         - Get PDF as base64');
  console.log(`  Storage mode: ${useSupabaseStorage ? `Supabase (${supabaseBucket})` : 'Local fallback'}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing browser...');
  await closeBrowser();
  process.exit(0);
});
